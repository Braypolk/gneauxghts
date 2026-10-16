import { describe, expect, it } from 'vitest';
import { expandedPhases, requireSharedReport } from './expandedProbeContract';

describe('expanded native fixture admission', () => {
  const state = { a: 'a', b: 'b', source: { noteId: 'n' }, interruptedId: 'i', keepId: 'k', discardId: 'd' };
  it('runs setup only for fresh storage and resumes only an acknowledged interruption', () => {
    expect(expandedPhases()).toEqual(['seed', 'first']);
    expect(expandedPhases(JSON.stringify(state))).toEqual(['relaunch', 'failures']);
    expect(() => expandedPhases(JSON.stringify({ ...state, interruptedId: null }))).toThrow('did not acknowledge');
    expect(() => expandedPhases(JSON.stringify({ ...state, savedId: 'saved' }))).toThrow('already completed');
  });
  it('cannot turn a failed, stale or absent shared report into acceptance', () => {
    const report = { gate: 'first-usable-desktop-fixture', phase: 'first', status: 'passed', checks: [], receipts: {} };
    expect(requireSharedReport(report, 'first')).toBe(report);
    expect(() => requireSharedReport({ ...report, status: 'failed', error: 'native handoff failed' }, 'first')).toThrow('native handoff failed');
    expect(() => requireSharedReport(report, 'relaunch')).toThrow('does not match');
    expect(() => requireSharedReport(undefined, 'first')).toThrow('must return');
  });
});
