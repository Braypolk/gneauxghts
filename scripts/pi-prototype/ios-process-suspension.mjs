import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

export const ownedIosBundle = 'com.braypolkinghorne.gneauxghts.pi-prototype';

/** Inert challenge state: only the driver issues a challenge after CONT. */
export function createIosSuspensionChallenges({ now = Date.now, nonce = randomUUID } = {}) {
  let launchId;
  const issued = new Map(), acknowledged = new Map();
  const bind = id => {
    assert(typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id), 'Invalid suspension launch identity');
    assert(!launchId || launchId === id, 'Suspension control belongs to another launch');
    launchId = id;
  };
  return {
    discover(id) { bind(id); return { gate: 'owned-ios-suspension-control', launchId }; },
    issue(stage, id) {
      bind(id); assert(['foreground', 'lease-continue'].includes(stage), 'Invalid suspension challenge stage');
      assert(!issued.has(stage), 'Suspension challenge already issued');
      const command = { stage, launchId, nonce: nonce(), issuedAt: now() };
      assert(typeof command.nonce === 'string' && command.nonce.length >= 16, 'Invalid suspension nonce');
      issued.set(stage, command); return command;
    },
    read(stage, id) { bind(id); return issued.get(stage) ?? null; },
    acknowledge(value) {
      bind(value?.launchId); const command = issued.get(value?.stage);
      assert(command && value.nonce === command.nonce, 'Fresh driver suspension challenge required');
      assert(!acknowledged.has(value.stage), 'Suspension challenge already acknowledged');
      const receipt = { ...command, acknowledgedAt: now() };
      assert(receipt.acknowledgedAt >= command.issuedAt, 'Suspension acknowledgement precedes challenge');
      acknowledged.set(value.stage, receipt); return receipt;
    },
    receipt(stage) { return acknowledged.get(stage); },
  };
}

export function parseOwnedIosLaunch(output, bundle = ownedIosBundle) {
  assert.equal(bundle, ownedIosBundle, 'Refuse another app bundle');
  const match = String(output).trim().match(/^([^\s:]+): ([1-9]\d*)$/);
  assert(match && match[1] === bundle, 'Expected the exact owned simctl launch receipt');
  const pid = Number(match[2]);
  assert(Number.isSafeInteger(pid) && pid > 1 && pid <= 2147483647, 'Invalid owned app PID');
  return pid;
}

/** ps uses LC_ALL=C and pid=,stat=,lstart=,comm=; comm is the executable, without arguments. */
export function parseIosProcess(output) {
  const match = String(output).trim().match(/^(\d+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
  assert(match && Number.isFinite(Date.parse(match[3])), 'Unrecognized owned process identity');
  return { pid: Number(match[1]), state: match[2], startedAt: match[3], executable: match[4] };
}

export function captureOwnedIosProcess({ launchOutput, bundle = ownedIosBundle, installedExecutable, inspect }) {
  const pid = parseOwnedIosLaunch(launchOutput, bundle);
  assert(typeof installedExecutable === 'string' && installedExecutable.startsWith('/') && !installedExecutable.includes('\n'), 'Expected installed app executable path');
  const current = inspect(pid);
  assert.equal(current.pid, pid, 'Process PID differs from owned launch');
  assert.equal(current.executable, installedExecutable, 'Process is not the installed owned app executable');
  assert(current.startedAt && Number.isFinite(Date.parse(current.startedAt)), 'Missing process start identity');
  return { bundle, pid, startedAt: current.startedAt, executable: installedExecutable };
}

export function assertOwnedIosProcess(owner, inspect) {
  assert.equal(owner.bundle, ownedIosBundle, 'Refuse another app bundle');
  assert(Number.isSafeInteger(owner.pid) && owner.pid > 1, 'Invalid owned app PID');
  const current = inspect(owner.pid);
  assert.equal(current.pid, owner.pid, 'Owned process PID changed');
  assert.equal(current.startedAt, owner.startedAt, 'Owned process identity was reused');
  assert.equal(current.executable, owner.executable, 'Owned process executable changed');
  return current;
}

/** Artificial native-process STOP only. WKWebView helper processes may continue. */
export async function suspendOwnedIosProcess({ owner, inspect, signal, wait, now = () => performance.now(), durationMs = 14000, receipt = {} }) {
  assert(durationMs >= 13000 && durationMs <= 15000, 'Suspension duration must be 13–15 seconds');
  Object.assign(receipt, { kind: 'artificial-owned-native-process-suspension', owner, requestedDurationMs: durationMs,
    limits: ['WKWebView helper processes may continue; this is not OS suspension or memory pressure.',
      'This process receipt alone does not establish UI retention or lease rollback; those require separate fresh challenge acknowledgements.'] });
  assert(!assertOwnedIosProcess(owner, inspect).state.includes('T'), 'Owned native process was already stopped');
  let attempted = false, failure;
  try {
    attempted = true;
    receipt.stopRequestedAt = now();
    signal(owner.pid, 'STOP');
    assert(assertOwnedIosProcess(owner, inspect).state.includes('T'), 'Owned native process did not enter stopped state');
    receipt.stoppedAt = now();
    await wait(durationMs);
    assert(assertOwnedIosProcess(owner, inspect).state.includes('T'), 'Owned native process resumed before the observation ended');
    receipt.elapsedMs = now() - receipt.stoppedAt;
    assert(receipt.elapsedMs > 12000 && receipt.elapsedMs <= 20000, 'Actual suspension must exceed 12 seconds and remain at most 20 seconds');
  } catch (error) { failure = error; }
  finally {
    if (attempted) {
      try {
        assertOwnedIosProcess(owner, inspect);
        signal(owner.pid, 'CONT');
        receipt.continued = true;
        receipt.stopToContinueMs = now() - receipt.stopRequestedAt;
      } catch (error) {
        receipt.continueError = String(error);
        failure = failure ? new AggregateError([failure, error], 'Suspension failed and owned process continuation failed') : error;
      }
    }
  }
  if (failure) throw failure;
  assert(receipt.stopToContinueMs <= 20000, 'STOP-to-CONT interval exceeded 20 seconds');
  return receipt;
}
