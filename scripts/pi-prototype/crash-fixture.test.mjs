import test from 'node:test';
import assert from 'node:assert/strict';
import { crashReply } from './crash-fixture.mjs';
for (const compatible of [true, false]) {
  const wrap = history => compatible ? { messages: history } : { input: history };
  test(`${compatible ? 'compatible' : 'Responses'}: scoped prepared review becomes a tool, then a completion`, () => {
    const user = { role: 'user', content: 'PI_CRASH_REVIEW PI_E2E_CRASH_scope-123456' };
    const reply = crashReply(wrap([user]), compatible);
    assert.equal(reply.scope, 'scope-123456'); assert.equal(reply.tool.name, 'propose_note');
    assert.equal(JSON.parse(reply.tool.arguments).title, 'PI_E2E_CRASH_scope-123456');
    const result = compatible ? { role: 'tool', content: 'staged' } : { type: 'function_call_output', output: 'staged' };
    assert.equal(crashReply(wrap([user, result]), compatible).text, 'Synthetic crash review staging completed.');
  });
  test(`${compatible ? 'compatible' : 'Responses'}: terminal text is exact and an unscoped request fails`, () => {
    assert.throws(() => crashReply(wrap([{ role: 'user', content: 'ordinary' }]), compatible), /scope/);
    assert.equal(crashReply(wrap([{ role: 'user', content: 'PI_CRASH_TERMINAL PI_E2E_CRASH_scope-123456' }]), compatible).text, 'Synthetic terminal partial PI_E2E_CRASH_scope-123456.');
  });
}
