import { describe, expect, it } from 'vitest';
import { HistoryCommandFailure } from './historyCommand';
import { toTimelineAwareCommandFailure } from './timelineAwareCommand';

describe('timeline-aware command failures', () => {
  it('retains a closed history failure from a mixed mutation command', () => {
    const failure = toTimelineAwareCommandFailure(
      {
        domain: 'history',
        failure: {
          state: 'stale',
          message: 'untrusted backend wording',
          recoveryAction: 'retry'
        }
      },
      'The operation failed.'
    );

    expect(failure).toBeInstanceOf(HistoryCommandFailure);
    expect(failure.message).toBe('History changed before this action finished.');
  });

  it('keeps the command owner for non-history failures', () => {
    const failure = toTimelineAwareCommandFailure(
      {
        domain: 'note',
        failure: { message: 'SELECT secret FROM /private/note.sqlite3' }
      },
      'The note could not be saved right now.'
    );

    expect(failure).not.toBeInstanceOf(HistoryCommandFailure);
    expect(failure.message).toBe('The note could not be saved right now.');
  });
});
