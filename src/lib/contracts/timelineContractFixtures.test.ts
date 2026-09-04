import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_INITIALIZATION_PHASES,
  HISTORY_COMMAND_ERROR_STATES,
  HISTORY_COMMAND_ERRORS,
  HISTORY_COMMAND_RECOVERY_ACTIONS,
  HISTORY_HEALTH_STATES,
  HISTORY_INTEGRITY_STATES,
  HISTORY_LIFECYCLE_KINDS,
  HISTORY_MUTATION_SOURCES,
  HISTORY_NOTE_HEALTH_STATES,
  HISTORY_TIME_KINDS,
  type HistoryCursor,
  type HistoryCommandError
} from './historyCommand';

interface TimelineContractFixture {
  version: number;
  mutationSources: string[];
  lifecycleKinds: string[];
  timeKinds: string[];
  historyHealthStates: string[];
  noteHistoryHealthStates: string[];
  historyIntegrityStates: string[];
  baselineInitializationPhases: string[];
  cursors: { initial: HistoryCursor; continuation: HistoryCursor };
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
    expect(fixture.mutationSources).toEqual(HISTORY_MUTATION_SOURCES);
    expect(fixture.lifecycleKinds).toEqual(HISTORY_LIFECYCLE_KINDS);
    expect(fixture.timeKinds).toEqual(HISTORY_TIME_KINDS);
    expect(fixture.historyHealthStates).toEqual(HISTORY_HEALTH_STATES);
    expect(fixture.noteHistoryHealthStates).toEqual(HISTORY_NOTE_HEALTH_STATES);
    expect(fixture.historyIntegrityStates).toEqual(HISTORY_INTEGRITY_STATES);
    expect(fixture.baselineInitializationPhases).toEqual(
      BASELINE_INITIALIZATION_PHASES
    );
    expect(fixture.commandErrorStates).toEqual(HISTORY_COMMAND_ERROR_STATES);
    expect(fixture.recoveryActions).toEqual(HISTORY_COMMAND_RECOVERY_ACTIONS);
    expect(fixture.commandErrors).toEqual(HISTORY_COMMAND_ERRORS);
  });

  it('pins opaque nullable cursor and complete command-error shapes', () => {
    expect(fixture.cursors).toEqual({
      initial: null,
      continuation: 'opaque-timeline-cursor'
    });
    expect(fixture.commandErrors.map((error) => error.state)).toEqual(
      HISTORY_COMMAND_ERROR_STATES
    );
    for (const error of fixture.commandErrors) {
      expect(Object.keys(error).sort()).toEqual([
        'message',
        'recoveryAction',
        'state'
      ]);
      expect(error.message).not.toHaveLength(0);
      expect(HISTORY_COMMAND_RECOVERY_ACTIONS).toContain(error.recoveryAction);
    }
  });
});
