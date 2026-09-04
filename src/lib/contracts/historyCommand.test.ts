import { describe, expect, it } from 'vitest';
import {
  HistoryCommandFailure,
  toHistoryCommandFailure
} from './historyCommand';

describe('history command failures', () => {
  it('preserves stable product state and recovery action from the command seam', () => {
    const failure = toHistoryCommandFailure({
      state: 'stale',
      message: 'untrusted backend wording',
      recoveryAction: 'retry'
    });

    expect(failure).toBeInstanceOf(HistoryCommandFailure);
    expect({
      name: failure.name,
      state: failure.state,
      message: failure.message,
      recoveryAction: failure.recoveryAction
    }).toEqual({
      name: 'HistoryCommandFailure',
      state: 'stale',
      message: 'History changed before this action finished.',
      recoveryAction: 'refresh'
    });
  });

  it('redacts legacy or malformed command failures behind unavailable state', () => {
    const failure = toHistoryCommandFailure(
      'SELECT payload FROM note_revisions at /vault/.gneauxghts/history.sqlite3'
    );

    expect(failure).toBeInstanceOf(HistoryCommandFailure);
    const commandFailure = failure as HistoryCommandFailure;
    expect({
      state: commandFailure.state,
      message: commandFailure.message,
      recoveryAction: commandFailure.recoveryAction
    }).toEqual({
      state: 'unavailable',
      message: 'History is unavailable right now.',
      recoveryAction: 'retry'
    });
    expect(failure.message).not.toContain('SELECT');
    expect(failure.message).not.toContain('/vault');
  });

});
