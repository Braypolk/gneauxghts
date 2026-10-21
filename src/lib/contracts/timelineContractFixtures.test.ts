import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_COMMAND_ERRORS,
  type HistoryCommandError
} from './historyCommand';
import type {
  HistoryLifecycleEventKind,
  HistoryMutationSource
} from '#lib/features/history/historyModeMachine.js';
import type {
  BaselineInitializationPhase,
  HistoryHealthState,
  HistoryIntegrityState
} from '#lib/types/history.js';

// Array membership alone accepts incomplete vocabularies. This helper also
// rejects a missing union member at the ordinary TypeScript check boundary.
function exhaustiveValues<Union>() {
  return <const Values extends readonly Union[]>(
    values: Values & (Exclude<Union, Values[number]> extends never ? unknown : never)
  ) => values;
}

const MUTATION_SOURCES = exhaustiveValues<HistoryMutationSource>()([
  'editor', 'taskAction', 'agentPublication', 'externalEdit',
  'versionRestore', 'noteCreation', 'baselineInitialization', 'recoveryReconciliation'
]);
const LIFECYCLE_KINDS = exhaustiveValues<HistoryLifecycleEventKind>()([
  'created', 'renamed', 'moved', 'forgotten', 'recovered', 'missing', 'reattached', 'purged'
]);
const TIME_KINDS = exhaustiveValues<import('#lib/types/history.js').RevisionTimeEvidence['kind']>()(['knownSince', 'committed', 'observed', 'editingWindow']);
const HEALTH_STATES = exhaustiveValues<HistoryHealthState>()([
  'healthy', 'initializing', 'degraded', 'warning', 'unavailable', 'corrupt'
]);
const NOTE_HEALTH_STATES = exhaustiveValues<import('#lib/types/history.js').NoteHistoryHealth['state']>()([
  'healthy', 'initializing', 'degraded', 'unavailable', 'corrupt'
]);
const INTEGRITY_STATES = exhaustiveValues<HistoryIntegrityState>()([
  'verified', 'unavailable', 'corrupt'
]);
const INITIALIZATION_PHASES = exhaustiveValues<BaselineInitializationPhase>()([
  'notStarted', 'initializing', 'complete', 'degraded'
]);
const ERROR_STATES = HISTORY_COMMAND_ERRORS.map((error) => error.state);
const RECOVERY_ACTIONS = exhaustiveValues<HistoryCommandError['recoveryAction']>()([
  'retry', 'refresh', 'recoverNote', 'backUpAndReset', 'correctRequest'
]);

interface TimelineContractFixture {
  version: number;
  mutationSources: string[];
  lifecycleKinds: string[];
  timeKinds: string[];
  historyHealthStates: string[];
  noteHistoryHealthStates: string[];
  historyIntegrityStates: string[];
  baselineInitializationPhases: string[];
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
});

const TIME_EVIDENCE = [
  { kind: 'knownSince', knownSinceMillis: 100 },
  { kind: 'committed', committedAtMillis: 200 },
  { kind: 'observed', observedAtMillis: 300, modifiedAtMillis: 1 },
  { kind: 'editingWindow', version: 1, firstWallMillis: 1000, lastWallMillis: 1200,
    minWallMillis: 1000, maxWallMillis: 1200, clockDiscontinuity: false },
  { kind: 'editingWindow', version: 1, firstWallMillis: 3000, lastWallMillis: 1000,
    minWallMillis: 1000, maxWallMillis: 3000, clockDiscontinuity: true }
] as const satisfies readonly import('#lib/types/history.js').RevisionTimeEvidence[];

it('shares exact legacy and versioned interval evidence with Rust, including reversed raw clock times', () => {
  const timeFixture = JSON.parse(readFileSync(new URL(
    '../../../src-tauri/test-fixtures/contracts/timeline-time-evidence.json', import.meta.url
  ).pathname, 'utf8'));
  expect(timeFixture.version).toBe(1);
  expect(timeFixture.evidence).toEqual(TIME_EVIDENCE);
});

it('matches the advisory readiness IPC states and nullable correlated snapshot', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../src-tauri/test-fixtures/contracts/history-readiness-contract.json', import.meta.url).pathname, 'utf8'));
  const states = exhaustiveValues<import('./historyReadiness').HistoryReadiness['state']>()(['recoveryPending', 'targetVerificationPending', 'ready', 'unavailable', 'corrupt']);
  const snapshot: import('./historyReadiness').HistoryReadiness = {
    scope: 'runtime-scope', revision: 2, noteId: null, state: 'recoveryPending', verifiedNotes: 3,
    totalNotes: null, backgroundComplete: false, backgroundUnavailable: false
  };
  expect(fixture.states).toEqual(states);
  expect(fixture.snapshot).toEqual(snapshot);
});
