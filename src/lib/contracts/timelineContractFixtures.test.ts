import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_COMMAND_ERRORS,
  type HistoryCommandError
} from './historyCommand';
import type {
  HistoryLifecycleEventKind,
  HistoryMutationSource
} from '$lib/features/history/historyModeMachine';
import type {
  BaselineInitializationPhase,
  HistoryHealthState,
  HistoryIntegrityState
} from '$lib/types/history';

const MUTATION_SOURCES = [
  'editor', 'taskAction', 'acceptedChatProposal', 'externalEdit',
  'versionRestore', 'noteCreation', 'baselineInitialization', 'recoveryReconciliation'
] as const satisfies readonly HistoryMutationSource[];
const LIFECYCLE_KINDS = [
  'created', 'renamed', 'moved', 'forgotten', 'recovered', 'missing', 'reattached', 'purged'
] as const satisfies readonly HistoryLifecycleEventKind[];
const TIME_KINDS = ['knownSince', 'committed', 'observed', 'editingWindow'] as const;
const HEALTH_STATES = [
  'healthy', 'initializing', 'degraded', 'warning', 'unavailable', 'corrupt'
] as const satisfies readonly HistoryHealthState[];
const NOTE_HEALTH_STATES = [
  'healthy', 'initializing', 'degraded', 'unavailable', 'corrupt'
] as const;
const INTEGRITY_STATES = [
  'verified', 'unavailable', 'corrupt'
] as const satisfies readonly HistoryIntegrityState[];
const INITIALIZATION_PHASES = [
  'notStarted', 'initializing', 'complete', 'degraded'
] as const satisfies readonly BaselineInitializationPhase[];
const ERROR_STATES = HISTORY_COMMAND_ERRORS.map((error) => error.state);
const RECOVERY_ACTIONS = [
  'retry', 'refresh', 'recoverNote', 'backUpAndReset', 'correctRequest'
] as const;

interface TimelineContractFixture {
  version: number;
  mutationSources: string[];
  lifecycleKinds: string[];
  timeKinds: string[];
  historyHealthStates: string[];
  noteHistoryHealthStates: string[];
  historyIntegrityStates: string[];
  baselineInitializationPhases: string[];
  cursors: { initial: string | null; continuation: string | null };
  commandErrorStates: string[];
  recoveryActions: string[];
  commandErrors: HistoryCommandError[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../src-tauri/test-fixtures/contracts/timeline-command-contract.json',
      import.meta.url
    ).pathname,
    'utf8'
  )
) as TimelineContractFixture;

describe('Note Timeline command contract fixture', () => {
  it('matches every closed TypeScript timeline vocabulary', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.mutationSources).toEqual(MUTATION_SOURCES);
    expect(fixture.lifecycleKinds).toEqual(LIFECYCLE_KINDS);
    expect(fixture.timeKinds).toEqual(TIME_KINDS);
    expect(fixture.historyHealthStates).toEqual(HEALTH_STATES);
    expect(fixture.noteHistoryHealthStates).toEqual(NOTE_HEALTH_STATES);
    expect(fixture.historyIntegrityStates).toEqual(INTEGRITY_STATES);
    expect(fixture.baselineInitializationPhases).toEqual(INITIALIZATION_PHASES);
    expect(fixture.commandErrorStates).toEqual(ERROR_STATES);
    expect(fixture.recoveryActions).toEqual(RECOVERY_ACTIONS);
    expect(fixture.commandErrors).toEqual(HISTORY_COMMAND_ERRORS);
  });

  it('pins opaque nullable cursor and complete command-error shapes', () => {
    expect(fixture.cursors).toEqual({
      initial: null,
      continuation: 'opaque-timeline-cursor'
    });
    expect(fixture.commandErrors.map((error) => error.state)).toEqual(
      ERROR_STATES
    );
    for (const error of fixture.commandErrors) {
      expect(Object.keys(error).sort()).toEqual([
        'message',
        'recoveryAction',
        'state'
      ]);
      expect(error.message).not.toHaveLength(0);
      expect(RECOVERY_ACTIONS).toContain(error.recoveryAction);
    }
  });
});

const TIME_EVIDENCE = [
  { kind: 'knownSince', knownSinceMillis: 100 },
  { kind: 'committed', committedAtMillis: 200 },
  { kind: 'observed', observedAtMillis: 300, modifiedAtMillis: 1 },
  { kind: 'editingWindow', version: 1, firstWallMillis: 1000, lastWallMillis: 1200,
    minWallMillis: 1000, maxWallMillis: 1200, clockDiscontinuity: false },
  { kind: 'editingWindow', version: 1, firstWallMillis: 3000, lastWallMillis: 1000,
    minWallMillis: 1000, maxWallMillis: 3000, clockDiscontinuity: true }
] as const satisfies readonly import('$lib/types/history').RevisionTimeEvidence[];

it('shares exact legacy and versioned interval evidence with Rust, including reversed raw clock times', () => {
  const timeFixture = JSON.parse(readFileSync(new URL(
    '../../../src-tauri/test-fixtures/contracts/timeline-time-evidence.json', import.meta.url
  ).pathname, 'utf8'));
  expect(timeFixture.version).toBe(1);
  expect(timeFixture.evidence).toEqual(TIME_EVIDENCE);
});

it('matches the advisory readiness IPC states and nullable correlated snapshot', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../src-tauri/test-fixtures/contracts/history-readiness-contract.json', import.meta.url).pathname, 'utf8'));
  const states = ['recoveryPending', 'targetVerificationPending', 'ready', 'unavailable', 'corrupt'] as const satisfies readonly import('./historyReadiness').HistoryReadiness['state'][];
  const snapshot: import('./historyReadiness').HistoryReadiness = {
    scope: 'runtime-scope', revision: 2, noteId: null, state: 'recoveryPending', verifiedNotes: 3,
    totalNotes: null, backgroundComplete: false, backgroundUnavailable: false
  };
  expect(fixture.states).toEqual(states);
  expect(fixture.snapshot).toEqual(snapshot);
});
