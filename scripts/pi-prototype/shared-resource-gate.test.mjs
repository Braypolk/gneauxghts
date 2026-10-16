import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharedReply, cleanEnvironment, DUMMY_AUTHORIZATION } from './shared-resource-gate.mjs';
import {parseArguments,OLD_SHA256} from './shared-resource-gate.mjs';
import {parseParityArguments} from './paired-parity-gate.mjs';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const digest=value=>createHash('sha256').update(value).digest('hex');
function artifacts(check) {
  const folder=realpathSync(mkdtempSync(join(tmpdir(),'pi-artifact-parser-')));
  try {
    const old=Buffer.from('Synthetic old artifact GNEAUXGHTS_OPENAI_FIXTURE_URL'),pi=Buffer.from('Synthetic Pi artifact');
    mkdirSync(join(folder,'old-source'));mkdirSync(join(folder,'pi-source'));
    writeFileSync(join(folder,'old-binary'),old);writeFileSync(join(folder,'pi-binary'),pi);
    const argv=['--root',join(folder,'fresh'),'--old-source',join(folder,'old-source'),'--pi-source',join(folder,'pi-source'),
      '--old-binary',join(folder,'old-binary'),'--pi-binary',join(folder,'pi-binary'),'--pi-sha256',digest(pi)];
    return check({argv,oldHash:digest(old)});
  }finally{rmSync(folder,{recursive:true,force:true});}
}

test('fixture accepts only absent or exact dummy authorization without credentials', () => {
  for (const authorization of [undefined, DUMMY_AUTHORIZATION]) {
    assert.equal(planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_HELLO' }] }, authorization).case, 'short');
  }
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_HELLO' }] }, 'Bearer actual-secret'));
});
test('follow-up requires earlier actual source-free assistant history', () => {
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_FOLLOWUP' }] }));
  assert.equal(planSharedReply({ messages: [{ role: 'assistant', content: 'Shared synthetic answer.' }, { role: 'user', content: 'RESOURCE_FOLLOWUP' }] }).case, 'followup');
});
test('stop fixture streams a partial and unknown prompts cannot pass', () => {
  assert.equal(planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_STOP' }] }).pause, true);
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'Unknown' }] }));
});
test('child environment is an allowlist with dummy overrides in both lanes', () => {
  for (const lane of ['old', 'pi']) {
    const env=cleanEnvironment('/synthetic/bin', lane);
    assert.equal(env.GNEAUXGHTS_LOCAL_API_KEY, 'gneauxghts-resource-fixture-dummy');
    assert.equal(env.OPENAI_API_KEY, 'gneauxghts-resource-fixture-dummy');
    assert.equal(env.PATH, '/synthetic/bin');
    assert(!Object.hasOwn(env, 'HOME'));
    assert(!Object.hasOwn(env, 'GNEAUXGHTS_E2E_FOREGROUND'));
    assert.equal(Object.hasOwn(env, 'PI_PROTOTYPE_HTTP_FIXTURE'), lane === 'pi');
  }
});
test('omitting old digest preserves the original artifact pin',()=>artifacts(({argv})=>{
  assert.equal(OLD_SHA256,'435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3');
  assert.throws(()=>parseArguments(argv),/Pinned old artifact differs/);
}));
test('explicit old digest requires exact actual artifact bytes in shared and both paired protocols',()=>artifacts(({argv,oldHash})=>{
  const pinned=[...argv,'--old-sha256',oldHash];
  assert.equal(parseArguments(pinned)['old-sha256'],oldHash);
  for(const protocol of ['compatible','responses']) {
    const options=parseParityArguments([...pinned,'--protocol',protocol]);
    assert.equal(options['old-sha256'],oldHash);assert.equal(options.protocol,protocol);
  }
  assert.throws(()=>parseArguments([...argv,'--old-sha256','0'.repeat(64)]),/Pinned old artifact differs/);
  assert.throws(()=>parseParityArguments([...argv,'--old-sha256','0'.repeat(64),'--protocol','responses']),/Pinned old artifact differs/);
}));
test('old digest override is bounded lowercase hexadecimal and cannot be repeated',()=>artifacts(({argv,oldHash})=>{
  for(const malformed of [oldHash.toUpperCase(),'a'.repeat(63),'a'.repeat(65),'g'.repeat(64),'../artifact'])
    assert.throws(()=>parseArguments([...argv,'--old-sha256',malformed]),/Invalid old binary digest/);
  assert.throws(()=>parseArguments([...argv,'--old-sha256']),/Invalid gate arguments/);
  assert.throws(()=>parseArguments([...argv,'--old-sha256',oldHash,'--old-sha256',oldHash]),/Invalid gate arguments/);
}));
