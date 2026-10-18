// Bounded API probe against the installed package. No native app or vault writes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createEditTool } from '@earendil-works/pi-durable/tools';

const tool = createEditTool();
const target = '/synthetic-vault/Note.md';
let sequence = 0;
const args = { path: 'Note.md', edits: [{ oldText: 'Alpha', newText: 'Beta' }] };

function fixture(initial = 'Alpha\n') {
  let canonical = initial;
  let staged;
  let writes = 0;
  let beforeWrite = () => {};
  let stageOnly = false;
  const abort = new AbortController();
  const ok = value => ({ ok: true, value });
  const env = {
    id: `pi-vault-probe-${++sequence}`,
    cwd: '/synthetic-vault',
    async absolutePath(value) { return ok(path.posix.resolve(this.cwd, value)); },
    async canonicalPath(value) { return ok(value); },
    async fileInfo(value) {
      assert.equal(value, target);
      return ok({ name: 'Note.md', path: value, kind: 'file', size: canonical.length, mtimeMs: 0 });
    },
    async readTextFile(value) { assert.equal(value, target); return ok(canonical); },
    async writeFile(value, content) {
      assert.equal(value, target);
      beforeWrite();
      writes++;
      if (stageOnly) staged = content;
      else canonical = content;
      return ok(undefined);
    }
  };
  return {
    run: (input = args) => tool.execute(input, { env }, { abortSignal: abort.signal }),
    read: () => ({ canonical, staged, writes }),
    stage() { stageOnly = true; },
    abortAfterWrite() { beforeWrite = () => abort.abort(); },
    raceBeforeWrite() { beforeWrite = () => { canonical = 'Alpha\nConcurrent human edit\n'; }; }
  };
}

const results = [];
{
  const f = fixture();
  const result = await f.run();
  assert.equal(f.read().canonical, 'Beta\n');
  assert.equal(typeof result.details.patch, 'string');
  results.push({ case: 'public stock edit', outcome: 'targeted replacement and diff returned' });
}
{
  const f = fixture('Alpha\nAlpha\n');
  await assert.rejects(f.run(), /occurrences/);
  assert.equal(f.read().writes, 0);
  results.push({ case: 'ambiguous match', outcome: 'rejected without a write' });
}
{
  const f = fixture();
  f.raceBeforeWrite();
  await f.run();
  assert.equal(f.read().canonical, 'Beta\n');
  results.push({ case: 'change after read before write', outcome: 'concurrent synthetic edit overwritten; stock write API supplies no expected base' });
}
{
  const f = fixture();
  f.abortAfterWrite();
  await assert.rejects(f.run(), /aborted/i);
  assert.equal(f.read().canonical, 'Beta\n');
  results.push({ case: 'cancellation during successful write', outcome: 'tool throws after canonical effect; no receipt reconciliation in stock edit' });
}
{
  const f = fixture();
  await f.run();
  await assert.rejects(f.run(), /Could not find/);
  assert.equal(f.read().writes, 1);
  results.push({ case: 'repeat already applied edit', outcome: 'second invocation cannot infer prior success from replacement arguments' });
}
{
  const f = fixture('\ufeffAlpha\r\n');
  f.stage();
  const result = await f.run();
  assert.equal(f.read().canonical, '\ufeffAlpha\r\n');
  assert.equal(f.read().staged, '\ufeffBeta\r\n');
  assert.equal(typeof result.details.patch, 'string');
  results.push({ case: 'per-call staging environment', outcome: 'upstream replacement, BOM/line-ending handling and diff reused without a canonical write' });
}
assert.equal(tool.replay ?? 'unsafe', 'unsafe');
console.log(JSON.stringify({ package: '@earendil-works/pi-durable@1.3.0', scope: 'direct tool execution using synthetic memory environments; no Harness restart or native acceptance', replay: tool.replay ?? 'unsafe', results }, null, 2));
