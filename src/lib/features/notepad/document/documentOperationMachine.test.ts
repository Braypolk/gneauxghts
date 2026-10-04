import { describe, expect, it } from 'vitest';
import {
  createDocumentOperationState,
  transitionDocumentOperation
} from './documentOperationMachine';

describe('document operation machine', () => {
  it('does not let a duplicate completion erase a terminal failure', () => {
    const saving = transitionDocumentOperation(
      createDocumentOperationState(),
      { type: 'start', operation: 'saving' }
    );
    const failed = transitionDocumentOperation(saving, {
      type: 'fail',
      token: saving.token,
      error: 'disk unavailable'
    });

    expect(
      transitionDocumentOperation(failed, {
        type: 'succeed',
        token: saving.token
      })
    ).toBe(failed);
  });
});

it('correlates progress to the running save and rejects terminal and superseded results', () => {
  const started = transitionDocumentOperation(createDocumentOperationState(), { type: 'start', operation: 'saving' });
  const progress = { type: 'savingProgress' as const, token: started.token, waitReason: 'verification' as const };
  const waiting = transitionDocumentOperation(started, progress);
  expect(waiting).toMatchObject({ kind: 'saving', waitReason: 'verification' });
  for (const event of [
    { type: 'succeed' as const, token: started.token },
    { type: 'fail' as const, token: started.token, error: 'history unavailable' },
    { type: 'invalidate' as const },
    { type: 'start' as const, operation: 'saving' as const }
  ]) {
    const next = transitionDocumentOperation(waiting, event);
    expect(transitionDocumentOperation(next, progress)).toBe(next);
    expect(next).not.toHaveProperty('waitReason');
  }
  expect(transitionDocumentOperation(waiting, { type: 'contentChanged' })).toMatchObject({
    revision: 1, waitReason: 'verification'
  });
});
