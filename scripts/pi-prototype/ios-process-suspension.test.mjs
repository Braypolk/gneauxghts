import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedIosBundle, parseOwnedIosLaunch, parseIosProcess, captureOwnedIosProcess, suspendOwnedIosProcess, createIosSuspensionChallenges } from './ios-process-suspension.mjs';

const executable = '/Users/fixture/CoreSimulator/Application/owned/Gneauxghts Pi Prototype.app/Gneauxghts Pi Prototype';

test('fresh challenge cannot be acknowledged before issue, by another launch, with an old nonce, or twice', () => {
  let now = 100;
  const challenges = createIosSuspensionChallenges({ now: () => now, nonce: () => 'fresh-driver-nonce-1234' });
  const launchId = 'fixture-launch-1234';
  assert.equal(challenges.discover(launchId).launchId, launchId);
  assert.equal(challenges.read('foreground', launchId), null);
  assert.throws(() => challenges.acknowledge({ stage: 'foreground', launchId, nonce: 'old' }), /Fresh driver/);
  const command = challenges.issue('foreground', launchId); now += 10;
  assert.throws(() => challenges.acknowledge({ ...command, launchId: 'unrelated-launch-1234' }), /another launch/);
  assert.throws(() => challenges.acknowledge({ ...command, nonce: 'old' }), /Fresh driver/);
  assert.equal(challenges.acknowledge(command).acknowledgedAt, 110);
  assert.equal(challenges.receipt('foreground').issuedAt, 100);
  assert.throws(() => challenges.acknowledge(command), /already acknowledged/);
  assert.throws(() => challenges.issue('foreground', launchId), /already issued/);
  assert.throws(() => challenges.issue('unrelated-stage', launchId), /Invalid suspension challenge stage/);
  assert.throws(() => createIosSuspensionChallenges().discover('../bad'), /Invalid suspension launch identity/);
});
function fixture() {
  let time = 100, current = { pid: 123, state: 'S', startedAt: 'Thu Oct 15 10:00:00 2026', executable };
  const signals = [], inspect = () => ({ ...current });
  const owner = captureOwnedIosProcess({ launchOutput: `${ownedIosBundle}: 123`, installedExecutable: executable, inspect });
  return { owner, signals, inspect, now: () => time, set: value => Object.assign(current, value),
    wait: async ms => { time += ms; }, signal: (pid, kind) => { signals.push([pid, kind]); current.state = kind === 'STOP' ? 'T' : 'S'; } };
}

test('pins exact simctl bundle/PID and ps start time plus full installed executable', () => {
  assert.equal(parseOwnedIosLaunch(`${ownedIosBundle}: 123\n`), 123);
  assert.deepEqual(parseIosProcess(` 123 T Thu Oct 15 10:00:00 2026 ${executable}\n`), { pid: 123, state: 'T', startedAt: 'Thu Oct 15 10:00:00 2026', executable });
  for (const output of [`other.bundle: 123`, `${ownedIosBundle}: 1`, `${ownedIosBundle}: 123\nother: 321`, `${ownedIosBundle}: -3`, `${ownedIosBundle}: 2147483648`]) {
    assert.throws(() => parseOwnedIosLaunch(output));
  }
  assert.throws(() => parseOwnedIosLaunch('other.bundle: 123', 'other.bundle'), /another app bundle/);
  assert.throws(() => parseIosProcess('123 unknown'), /Unrecognized/);
  assert.throws(() => captureOwnedIosProcess({ launchOutput: `${ownedIosBundle}: 123`, installedExecutable: '/another/app', inspect: fixture().inspect }), /installed owned app/);
});

test('stops only exact owned PID, observes 14 seconds and continues before returning', async () => {
  const value = fixture(), receipt = {};
  assert.equal(await suspendOwnedIosProcess({ ...value, receipt }), receipt);
  assert.deepEqual(value.signals, [[123, 'STOP'], [123, 'CONT']]);
  assert.equal(receipt.elapsedMs, 14000); assert.equal(receipt.continued, true);
  assert.match(receipt.limits.join(' '), /not OS suspension/);
});

test('continues in finally if the delay or stopped-state verification fails', async () => {
  const value = fixture(), failure = new Error('Delay failed');
  await assert.rejects(suspendOwnedIosProcess({ ...value, wait: async () => { throw failure; } }), error => error === failure);
  assert.deepEqual(value.signals, [[123, 'STOP'], [123, 'CONT']]);
  const notStopped = fixture();
  await assert.rejects(suspendOwnedIosProcess({ ...notStopped, signal: (pid, kind) => notStopped.signals.push([pid, kind]) }), /did not enter stopped state/);
  assert.deepEqual(notStopped.signals, [[123, 'STOP'], [123, 'CONT']]);
});

test('CONT failure is retained alone and alongside an original failure', async () => {
  for (const delayFails of [false, true]) {
    const value = fixture(), receipt = {};
    await assert.rejects(suspendOwnedIosProcess({ ...value, receipt,
      wait: delayFails ? async () => { throw new Error('Delay failed'); } : value.wait,
      signal: (pid, kind) => { if (kind === 'CONT') throw new Error('CONT failed'); value.signal(pid, kind); },
    }), error => delayFails ? error instanceof AggregateError && error.errors.some(error => error.message === 'Delay failed') : error.message === 'CONT failed');
    assert.equal(receipt.continued, undefined); assert.match(receipt.continueError, /CONT failed/);
  }
});

test('PID reuse or executable replacement is never signalled during cleanup', async () => {
  for (const replacement of [{ startedAt: 'Thu Oct 15 10:01:00 2026' }, { executable: '/other/app' }]) {
    const value = fixture();
    await assert.rejects(suspendOwnedIosProcess({ ...value, wait: async () => value.set(replacement) }), AggregateError);
    assert.deepEqual(value.signals, [[123, 'STOP']]);
  }
});

test('wrong bundle or preexisting identity mismatch prevents every signal', async () => {
  for (const mutation of [value => { value.owner.bundle = 'other.bundle'; }, value => value.set({ startedAt: 'Thu Oct 15 10:01:00 2026' }), value => value.set({ state: 'T' })]) {
    const value = fixture(); mutation(value);
    await assert.rejects(suspendOwnedIosProcess(value)); assert.deepEqual(value.signals, []);
  }
});

test('invalid requested duration and actual timing outside the bounded observation fail closed', async () => {
  for (const durationMs of [12000, 20001, NaN]) {
    const value = fixture(); await assert.rejects(suspendOwnedIosProcess({ ...value, durationMs })); assert.deepEqual(value.signals, []);
  }
  for (const elapsed of [12000, 20001]) {
    const value = fixture();
    await assert.rejects(suspendOwnedIosProcess({ ...value, wait: () => value.wait(elapsed) }), /Actual suspension/);
    assert.deepEqual(value.signals, [[123, 'STOP'], [123, 'CONT']]);
  }
  const slowCleanup = fixture();
  await assert.rejects(suspendOwnedIosProcess({ ...slowCleanup, signal: (pid, kind) => {
    slowCleanup.signal(pid, kind); if (kind === 'CONT') void slowCleanup.wait(7000);
  } }), /STOP-to-CONT interval exceeded/);
  assert.deepEqual(slowCleanup.signals, [[123, 'STOP'], [123, 'CONT']]);
});
