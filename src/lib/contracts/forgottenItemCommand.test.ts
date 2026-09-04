import { describe, expect, it } from 'vitest';
import { HistoryCommandFailure } from './historyCommand';
import { toForgottenItemCommandFailure } from './forgottenItemCommand';

describe('forgotten item command failures', () => {
  it('preserves nested Note Timeline failures', () => {
    const failure = toForgottenItemCommandFailure({
      domain: 'history',
      failure: {
        state: 'corrupt',
        message: 'untrusted backend wording',
        recoveryAction: 'retry'
      }
    });

    expect(failure).toBeInstanceOf(HistoryCommandFailure);
    expect(failure.message).toBe(
      'History data is damaged and must be reset before it can be used.'
    );
  });

  it('keeps chat failures out of the Note Timeline error domain', () => {
    const failure = toForgottenItemCommandFailure({
      domain: 'chat',
      failure: {
        state: 'unavailable',
        message: 'SELECT secret FROM /private/chat.sqlite3',
        recoveryAction: 'retry'
      }
    });

    expect(failure).not.toBeInstanceOf(HistoryCommandFailure);
    expect(failure.message).toBe('Chat recovery is unavailable right now.');
    expect(failure.message).not.toContain('SELECT');
  });

  it('keeps forgotten-item storage failures out of the Note Timeline error domain', () => {
    const failure = toForgottenItemCommandFailure({
      domain: 'forgotten',
      failure: { message: 'read /private/vault/state.sqlite3 failed' }
    });

    expect(failure).not.toBeInstanceOf(HistoryCommandFailure);
    expect(failure.message).toBe('Forgotten items are unavailable right now.');
  });
});
