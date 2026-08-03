import { describe, expect, it } from 'vitest';
import {
  createDocumentExternalSyncState,
  transitionDocumentExternalSync,
  type DocumentExternalSyncState
} from './documentExternalSyncMachine';
import type { ExternalDocumentChange } from './documentState';

const external: ExternalDocumentChange = {
  kind: 'deletion',
  source: 'watcher',
  path: '/vault/note.md'
};

function capture(state = createDocumentExternalSyncState()) {
  return transitionDocumentExternalSync(state, {
    type: 'externalCaptured',
    external
  });
}

describe('document external-sync machine', () => {
  it('starts without a conflict', () => {
    expect(createDocumentExternalSyncState()).toEqual({
      kind: 'noConflict',
      sequence: 0
    });
  });

  it('captures each external change under a new conflict identity', () => {
    const first = capture();
    const second = capture(first);

    expect(first).toMatchObject({
      kind: 'conflict',
      conflictId: 1,
      sequence: 1,
      phase: 'awaitingChoice',
      external
    });
    expect(second).toMatchObject({
      kind: 'conflict',
      conflictId: 2,
      sequence: 2,
      phase: 'awaitingChoice'
    });
  });

  it('requires the current awaiting conflict to keep working', () => {
    const conflict = capture();

    expect(
      transitionDocumentExternalSync(conflict, {
        type: 'keepWorking',
        conflictId: 0
      })
    ).toBe(conflict);
    expect(
      transitionDocumentExternalSync(conflict, {
        type: 'keepWorking',
        conflictId: 1
      })
    ).toEqual({ kind: 'noConflict', sequence: 1 });
  });

  it('moves external application through applying and completion', () => {
    const conflict = capture();
    const applying = transitionDocumentExternalSync(conflict, {
      type: 'beginApplyingExternal',
      conflictId: 1
    });
    const applied = transitionDocumentExternalSync(applying, {
      type: 'externalApplied',
      conflictId: 1
    });

    expect(applying).toMatchObject({
      kind: 'conflict',
      conflictId: 1,
      phase: 'applyingExternal'
    });
    expect(applied).toEqual({ kind: 'noConflict', sequence: 1 });
  });

  it('returns a failed application to the same recoverable conflict', () => {
    const conflict = capture();
    const applying = transitionDocumentExternalSync(conflict, {
      type: 'beginApplyingExternal',
      conflictId: 1
    });
    const recovered = transitionDocumentExternalSync(applying, {
      type: 'externalApplyFailed',
      conflictId: 1
    });

    expect(recovered).toMatchObject({
      kind: 'conflict',
      conflictId: 1,
      phase: 'awaitingChoice',
      external
    });
  });

  it('rejects late results from an older conflict', () => {
    const first = capture();
    const firstApplying = transitionDocumentExternalSync(
      first,
      {
        type: 'beginApplyingExternal',
        conflictId: 1
      }
    );
    const newer = capture(firstApplying);
    const events = [
      {
        type: 'externalApplied',
        conflictId: 1
      },
      { type: 'externalApplyFailed', conflictId: 1 },
      { type: 'keepWorking', conflictId: 1 }
    ] as const;

    for (const event of events) {
      expect(
        transitionDocumentExternalSync(newer, event)
      ).toBe(newer);
    }
  });

  it('lets an authoritative boundary reconcile any prior state', () => {
    const applying = transitionDocumentExternalSync(capture(), {
      type: 'beginApplyingExternal',
      conflictId: 1
    });

    expect(
      transitionDocumentExternalSync(applying, {
        type: 'boundaryApplied'
      })
    ).toEqual({ kind: 'noConflict', sequence: 1 });
  });

  it('keeps the conflict sequence monotonic through mixed events', () => {
    let state: DocumentExternalSyncState =
      createDocumentExternalSyncState();
    let previousSequence = state.sequence;
    const events = [
      { type: 'externalCaptured', external },
      { type: 'beginApplyingExternal', conflictId: 1 },
      { type: 'externalApplyFailed', conflictId: 1 },
      { type: 'externalCaptured', external },
      { type: 'keepWorking', conflictId: 2 }
    ] as const;

    for (const event of events) {
      state = transitionDocumentExternalSync(state, event);
      expect(state.sequence).toBeGreaterThanOrEqual(
        previousSequence
      );
      previousSequence = state.sequence;
    }
  });
});
