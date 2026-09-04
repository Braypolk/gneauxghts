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
const TIME_KINDS = ['knownSince', 'committed', 'observed'] as const;
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
