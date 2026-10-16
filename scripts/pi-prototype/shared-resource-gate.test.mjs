import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharedReply, cleanEnvironment, DUMMY_AUTHORIZATION } from './shared-resource-gate.mjs';

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
