import test from 'node:test';
import assert from 'node:assert/strict';
import { retainExpandedPhase } from './retain-expanded-phase.mjs';

test('failed native phase remains retained and screenshot is attempted before validation rejects', async () => {
  const report = { gate: 'expanded-native-workspace-fixture', phase: 'first', status: 'failed', error: 'Native split control deadline', launchId: 'fresh' };
  const evidence = { phases: [] }, calls = [];
  await assert.rejects(retainExpandedPhase({ report, phase: 'first', evidence,
    flush: () => { assert.equal(evidence.phases[0], report); calls.push('flush'); },
    screenshot: phase => { assert.equal(phase, 'first'); calls.push('screenshot'); throw new Error('Screenshot unavailable'); } }), /Native split control deadline/);
  assert.deepEqual(calls, ['flush', 'screenshot', 'flush']);
  assert.match(evidence.screenshotErrors[0].error, /Screenshot unavailable/);
});

test('successful phase preserves prior-process validation and its original object', async () => {
  const report = { gate: 'expanded-native-workspace-fixture', phase: 'relaunch', status: 'passed', launchId: 'fresh', shared: [{ phase: 'relaunch', status: 'passed' }], unobserved: ['Live providers'] };
  const evidence = { phases: [] };
  assert.equal(await retainExpandedPhase({ report, phase: 'relaunch', priorLaunchId: 'old', evidence, flush: () => undefined, screenshot: () => undefined }), report);
  await assert.rejects(retainExpandedPhase({ report, phase: 'relaunch', priorLaunchId: 'fresh', evidence, flush: () => undefined, screenshot: () => undefined }), /Stale prior-process report/);
});
