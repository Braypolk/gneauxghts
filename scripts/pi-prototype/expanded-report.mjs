import assert from 'node:assert/strict';

export function assertExpandedPhase(report, phase, priorLaunchId) {
  assert.equal(report?.gate, 'expanded-native-workspace-fixture');
  assert.equal(report.phase, phase);
  assert.equal(report.status, 'passed', report.error ?? 'Native UI journey failed');
  assert.equal(typeof report.launchId, 'string');
  if (priorLaunchId) assert.notEqual(report.launchId, priorLaunchId, 'Stale prior-process report');
  assert(Array.isArray(report.shared) && report.shared.some(value => value.phase === phase && value.status === 'passed'));
  assert(Array.isArray(report.unobserved) && report.unobserved.length, 'Expanded limits must remain explicit');
  return report;
}

export function assertInteractiveTransport(requests, beforeRelaunch, beforeRetry) {
  assert.equal(beforeRetry, beforeRelaunch, 'Relaunch implicitly dispatched inference');
  assert(requests.some(value => value.path === '/local/v1/chat/completions'), 'Local-compatible protocol not observed');
  assert(requests.some(value => value.path === '/openai/v1/responses'), 'Responses protocol not observed');
  assert(!requests.some(value => value.error), 'Synthetic provider contract failed');
  const stop = requests.find(value => value.journey === 'STOP' && value.attempt === 1);
  assert(stop?.closed && !stop.completed && Number.isFinite(stop.firstTextAt) && stop.firstTextAt <= stop.closedAt,
    'Stop did not close an active native partial stream');
  const interrupted = requests.filter(value => value.journey === 'INTERRUPT');
  assert.equal(interrupted.length, 2, 'Interrupted request needs exactly one explicit retry');
  assert(!interrupted[0].completed && interrupted[1].completed, 'Interruption/retry outcomes incorrect');
  return { stoppedBeforeCompletion: true, interruptedRequests: 2, noImplicitReplay: true };
}
