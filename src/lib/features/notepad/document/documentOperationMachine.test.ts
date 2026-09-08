import { describe, expect, it } from 'vitest';
import {
  createDocumentOperationState,
  transitionDocumentOperation,
  type DocumentOperationKind
} from './documentOperationMachine';

const operations: DocumentOperationKind[] = [
  'saving',
  'forgetting'
];

describe('document operation machine', () => {
  it.each(operations)('runs %s through success', (operation) => {
    const started = transitionDocumentOperation(
      createDocumentOperationState(),
      { type: 'start', operation }
    );
    const completed = transitionDocumentOperation(started, {
      type: 'succeed',
      token: started.token
    });

    expect(started.kind).toBe(operation);
    expect(completed).toEqual({
      kind: 'idle',
      token: started.token,
      revision: 0
    });
  });

  it('rejects stale terminal results after supersession', () => {
    const saving = transitionDocumentOperation(
      createDocumentOperationState(),
      { type: 'start', operation: 'saving' }
    );
    const forgetting = transitionDocumentOperation(saving, {
      type: 'start',
      operation: 'forgetting'
    });

    expect(
      transitionDocumentOperation(forgetting, {
        type: 'fail',
        token: saving.token,
        error: 'late'
      })
    ).toBe(forgetting);
  });

  it('tracks content revisions independently of lifecycle state', () => {
    const saving = transitionDocumentOperation(
      createDocumentOperationState(),
      { type: 'start', operation: 'saving' }
    );
    const edited = transitionDocumentOperation(saving, {
      type: 'contentChanged'
    });

    expect(edited).toEqual({
      kind: 'saving',
      token: saving.token,
      revision: 1
    });
  });

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
