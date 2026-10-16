import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertExpandedPhase, assertInteractiveTransport } from './expanded-report.mjs';

test('stale or failed native reports cannot authorize termination/relaunch success', () => {
  const report = { gate: 'expanded-native-workspace-fixture', phase: 'relaunch', status: 'passed', launchId: 'new', shared: [{ phase: 'relaunch', status: 'passed' }], unobserved: ['live endpoints'] };
  assert.equal(assertExpandedPhase(report, 'relaunch', 'old'), report);
  assert.throws(() => assertExpandedPhase(report, 'relaunch', 'new'), /Stale/);
  assert.throws(() => assertExpandedPhase({ ...report, status: 'failed', error: 'disk unavailable' }, 'relaunch'), /disk unavailable/);
});
test('protocol presence cannot hide automatic replay or incomplete cancellation', () => {
  const requests = [{ path: '/local/v1/chat/completions', journey: 'STOP', attempt: 1, closed: true, completed: false, firstTextAt: 1, closedAt: 2 },
    { path: '/openai/v1/responses', journey: 'HELLO' }, { journey: 'INTERRUPT', completed: false }, { journey: 'INTERRUPT', completed: true }];
  assert.equal(assertInteractiveTransport(requests, 3, 3).noImplicitReplay, true);
  assert.throws(() => assertInteractiveTransport(requests, 3, 4), /implicitly/);
  assert.throws(() => assertInteractiveTransport(requests.map(value => ({ ...value, completed: true })), 3, 3), /Stop/);
});
