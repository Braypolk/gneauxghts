import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOwnedIosProcess, captureOwnedIosProcess, createIosCommandGate, IOS_ACCEPTANCE_BUNDLE, parseIosProcess, validateIosCommand, validateIosReceipt } from './ios-acceptance.mjs';

function commandGate(sequence = 0) {
  const state = { runId: 'test-run-identity', currentLaunchId: 'launch-1', launches: ['launch-1'], blockedLaunchIds: [], sequence, active: undefined, commands: [], interruptions: [] };
  const timers = new Map(); let nextTimer = 0, now = 1000;
  const gate = createIosCommandGate(state, () => {}, { now: () => now,
    schedule: callback => { timers.set(++nextTimer, callback); return nextTimer; }, cancel: id => timers.delete(id) });
  return { gate, state, expire() { now += 30000; for (const callback of [...timers.values()]) callback(); }, timers };
}

test('overlapping controlled request bodies cannot overwrite active command or exceed final command budget', async () => {
  for (const initialSequence of [0, 159]) {
    const { gate, state } = commandGate(initialSequence);
    const slowBody = Promise.withResolvers(), fastBody = Promise.withResolvers();
    // Matches the HTTP route: await bounded body parsing, then synchronous gate admission.
    const slowRequest = slowBody.promise.then(input => gate.admit(input));
    const fastRequest = fastBody.promise.then(input => gate.admit(input));
    fastBody.resolve({ action: 'snapshot' });
    const first = await fastRequest;
    if (initialSequence === 159) gate.receipt({ ...first, kind: 'completed' });
    slowBody.resolve({ action: 'inspect-context' });
    await assert.rejects(slowRequest);
    assert.equal(state.active, initialSequence === 159 ? undefined : first);
    assert.equal(state.commands.length, 1); assert.equal(state.sequence, initialSequence + 1);
    gate.close();
  }
});

test('phase deadline records interruption and rejects old-launch commands and late receipts', () => {
  const { gate, state, expire, timers } = commandGate();
  const command = gate.admit({ action: 'publish', args: { intentId: 'generated-intent' } });
  assert.equal(command.deadlineAtMillis, 31000); expire();
  assert.equal(state.active, undefined); assert.equal(timers.size, 0);
  assert.equal(state.interruptions[0].reason, 'controller-deadline'); assert.equal(state.interruptions[0].underlyingProductMayContinue, true);
  assert.throws(() => gate.admit({ action: 'snapshot' }));
  assert.throws(() => gate.receipt({ ...command, kind: 'completed' }));
  state.launches.push('launch-2'); state.currentLaunchId = 'launch-2';
  assert.equal(gate.admit({ action: 'snapshot' }).launchId, 'launch-2'); gate.close();
});

test('lost native acknowledgement remains active until exact external interruption', () => {
  const { gate, state } = commandGate();
  const command = gate.admit({ action: 'publish', args: { intentId: 'generated-intent', parkAcknowledgement: true } });
  gate.receipt({ ...command, kind: 'publication-boundary' });
  assert.equal(state.active.phase, 'awaiting-external-interruption');
  assert.throws(() => gate.admit({ action: 'snapshot' }));
  assert.throws(() => gate.interrupt({ sequence: command.sequence + 1, launchId: command.launchId, reason: 'process-termination' }));
  gate.interrupt({ sequence: command.sequence, launchId: command.launchId, reason: 'process-termination' });
  assert.equal(state.interruptions[0].phase, 'awaiting-external-interruption');
  assert.throws(() => gate.admit({ action: 'snapshot' })); gate.close();
});

test('probe-reported deadline also requires fresh launch while ordinary completion clears timer', () => {
  const { gate, state, timers } = commandGate();
  const first = gate.admit({ action: 'snapshot' }); gate.receipt({ ...first, kind: 'completed' });
  assert.equal(timers.size, 0);
  const next = gate.admit({ action: 'publish', args: { intentId: 'generated-intent' } });
  gate.receipt({ ...next, kind: 'failed', evidence: { code: 'acceptance_phase_deadline', underlyingProductMayContinue: true } });
  assert.equal(state.interruptions[0].reason, 'controller-deadline'); assert.throws(() => gate.admit({ action: 'snapshot' })); gate.close();
});

test('history compaction control accepts only fixed generated modes, never supplied history or sizing', () => {
  for (const mode of ['threshold', 'background']) assert.deepEqual(validateIosCommand({ action: 'seed-history', args: { mode } }), { action: 'seed-history', args: { mode } });
  assert.deepEqual(validateIosCommand({ action: 'inspect-context' }), { action: 'inspect-context', args: {} });
  for (const args of [{}, { mode: 'manual' }, { mode: 'threshold', body: 'arbitrary' }, { mode: 'threshold', characters: 600000 }, { mode: 'background', capacity: 1 }, { mode: 'background', blocks: [] }]) {
    assert.throws(() => validateIosCommand({ action: 'seed-history', args }));
  }
  assert.throws(() => validateIosCommand({ action: 'send', args: { kind: 'long-context', characters: 1000 } }));
  assert.throws(() => validateIosCommand({ action: 'inspect-context', args: { sql: 'SELECT 1' } }));
  assert.deepEqual(validateIosCommand({ action: 'history-fixture', args: { noteId: 'generated-note-id' } }), { action: 'history-fixture', args: { noteId: 'generated-note-id' } });
  assert.throws(() => validateIosCommand({ action: 'history-fixture', args: {} }));
  assert.throws(() => validateIosCommand({ action: 'history-fixture', args: { noteId: 'generated-note-id', path: '/arbitrary' } }));
  assert.throws(() => validateIosCommand({ action: 'wait-idle', timeoutMillis: 660001 }));
  assert.equal(validateIosCommand({ action: 'wait-idle', timeoutMillis: 600000 }).timeoutMillis, 600000);
});

test('context receipts allow only observations and reject content or credentials at any depth', () => {
  const receipt = { launchId: '00000000-0000-4000-8000-000000000001', sequence: 1, runId: 'test-run-identity', action: 'inspect-context', kind: 'completed', atMillis: 1,
    evidence: { head: { id: 20, kind: 'pi.compaction', reason: 'threshold' }, contextCharacters: 300, historyPageCount: 2,
      historyEntries: [{ id: 1, kind: 'acceptance.synthetic-history' }, { id: 20, kind: 'pi.compaction', reason: 'threshold' }],
      requests: [{ summary: false, hasSummary: true, hasContinuation: true, characters: 300 }] } };
  assert.equal(validateIosReceipt(receipt), receipt);
  for (const key of ['body', 'content', 'markdown', 'thinking', 'reasoningText', 'headers', 'apiKey', 'token']) {
    assert.throws(() => validateIosReceipt({ ...receipt, evidence: { requests: [{ [key]: 'private' }] } }));
  }
});

test('diagnostic control accepts fixed synthetic scenarios and never caller-provided reports or faults', () => {
  for (const mode of ['observe', 'reports', 'terminal-notification']) {
    assert.deepEqual(validateIosCommand({ action: 'diagnostics', args: { mode } }), { action: 'diagnostics', args: { mode } });
  }
  for (const args of [{}, { mode: 'storage-fault' }, { mode: 'reports', count: 100000 }, { mode: 'reports', error: 'arbitrary' },
    { mode: 'reports', code: 'credential' }, { mode: 'terminal-notification', body: 'arbitrary' }, { mode: 'observe', sql: 'SELECT 1' }]) {
    assert.throws(() => validateIosCommand({ action: 'diagnostics', args }));
  }
  const receipt = { launchId: '00000000-0000-4000-8000-000000000001', sequence: 1, runId: 'test-run-identity', action: 'diagnostics', kind: 'completed', atMillis: 1,
    evidence: { evidenceKind: 'synthetic-runtime-report', state: 'open', noticeCount: 2, codes: ['runtime_report', 'provider_credential'], repeatCount: 999,
      gettersRead: 0, sinkSafe: true, domSafe: true, noInventedActivity: true, reportVisible: true, failureVisible: false,
      inferenceCallsUnchanged: true, nativeAuthorityUnchanged: true, generationActive: true, compactionCount: 0 } };
  assert.equal(validateIosReceipt(receipt), receipt);
  for (const key of ['message', 'errorMessage', 'body', 'content', 'markdown', 'thinking', 'headers', 'apiKey', 'token']) {
    assert.throws(() => validateIosReceipt({ ...receipt, evidence: { diagnostic: { [key]: 'private' } } }));
  }
});

test('owned process identity rejects PID reuse and a different executable before any signal', () => {
  const executable = '/private/tmp/generated.app/gneauxghts';
  const original = parseIosProcess(`1234 S Fri Oct 16 12:00:00 2026 ${executable}`);
  const owner = captureOwnedIosProcess({ launchOutput: `${IOS_ACCEPTANCE_BUNDLE}: 1234`, installedExecutable: executable, inspect: () => original });
  assert.equal(assertOwnedIosProcess(owner, () => original), original);
  assert.throws(() => assertOwnedIosProcess(owner, () => ({ ...original, startedAt: 'Fri Oct 16 12:01:00 2026' })));
  assert.throws(() => assertOwnedIosProcess(owner, () => ({ ...original, executable: '/private/tmp/other.app/gneauxghts' })));
  assert.throws(() => captureOwnedIosProcess({ launchOutput: 'com.other.app: 1234', installedExecutable: executable, inspect: () => original }));
});
