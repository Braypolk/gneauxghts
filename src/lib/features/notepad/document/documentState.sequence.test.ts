import { describe, expect, it } from 'vitest';
import {
  createDocumentState,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  dispatchDocumentExternalSync,
  dispatchDocumentOperation,
  getDocumentStatusViewModel,
  isDocumentOperationCurrent,
  resolveConflictUsingExternal,
  updateDocumentMarkdown,
  type DocumentOperationKind,
  type NoteDraftState
} from './documentState';
import {
  captureExternalDeletionForTest,
  captureExternalSnapshotForTest
} from './documentExternalSyncTestSupport';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

const path = '/vault/Sequence.md';

function savedSnapshot(
  markdown = 'saved'
): SessionSnapshot {
  return {
    ...createEmptySessionSnapshot(),
    title: 'Sequence',
    bodyMarkdown: markdown,
    currentNoteId: 'sequence-note',
    currentNotePath: path,
    lastSavedTitle: 'Sequence',
    lastSavedMarkdown: markdown,
    lastSavedNoteId: 'sequence-note',
    lastSavedPath: path
  };
}

function document() {
  return createDocumentState(
    savedSnapshot(),
    `document:`
  );
}

function assertDocumentInvariants(
  note: NoteDraftState,
  previousToken: number,
  previousRevision: number,
  previousConflictSequence: number
) {
  expect(note.operation.token).toBeGreaterThanOrEqual(
    previousToken
  );
  expect(note.operation.revision).toBeGreaterThanOrEqual(
    previousRevision
  );
  expect(note.externalSync.sequence).toBeGreaterThanOrEqual(
    previousConflictSequence
  );
  expect(documentHasUnresolvedConflict(note)).toBe(
    note.externalSync.kind === 'conflict'
  );
  if (note.externalSync.kind === 'conflict') {
    expect(note.externalSync.external).toBeDefined();
    expect(note.externalSync.conflictId).toBe(
      note.externalSync.sequence
    );
    expect([
      'awaitingChoice',
      'applyingExternal'
    ]).toContain(note.externalSync.phase);
    expect(getDocumentStatusViewModel(note).kind).toBe(
      'conflict'
    );
  }
  if (note.identity.kind === 'persisted') {
    expect(note.identity.path).not.toBe('');
  }
}

interface SequenceState {
  note: NoteDraftState;
  issuedTokens: number[];
}

interface DocumentCommand {
  label: string;
  apply: (state: SequenceState) => void;
}

const operationKinds: DocumentOperationKind[] = [
  'saving',
  'forgetting'
];

const commands: DocumentCommand[] = [
  ...operationKinds.map(
    (kind): DocumentCommand => ({
      label: `begin:${kind}`,
      apply: (state) => {
        dispatchDocumentOperation(state.note, {
          type: 'start',
          operation: kind
        });
        state.issuedTokens.push(state.note.operation.token);
      }
    })
  ),
  {
    label: 'edit',
    apply: ({ note }) => {
      updateDocumentMarkdown(
        note,
        `local-${note.operation.revision + 1}`
      );
    }
  },
  {
    label: 'invalidate',
    apply: ({ note }) => {
      dispatchDocumentOperation(note, { type: 'invalidate' });
    }
  },
  {
    label: 'complete:oldest',
    apply: ({ note, issuedTokens }) => {
      dispatchDocumentOperation(note, {
        type: 'succeed',
        token: issuedTokens[0] ?? -1
      });
    }
  },
  {
    label: 'fail:oldest',
    apply: ({ note, issuedTokens }) => {
      dispatchDocumentOperation(note, {
        type: 'fail',
        error: new Error('sequence failure'),
        token: issuedTokens[0] ?? -1
      });
    }
  },
  {
    label: 'conflict:snapshot',
    apply: ({ note }) => {
      if (documentHasCleanBuffer(note)) {
        updateDocumentMarkdown(note, 'local-before-conflict');
      }
      captureExternalSnapshotForTest(
        note,
        savedSnapshot('external'),
        'watcher'
      );
    }
  },
  {
    label: 'conflict:deletion',
    apply: ({ note }) => {
      if (documentHasCleanBuffer(note)) {
        updateDocumentMarkdown(note, 'local-before-deletion');
      }
      captureExternalDeletionForTest(
        note,
        path,
        'watcher'
      );
    }
  },
  {
    label: 'resolve:keep',
    apply: ({ note }) => {
      if (
        note.externalSync.kind === 'conflict' &&
        note.externalSync.phase === 'awaitingChoice'
      ) {
        dispatchDocumentExternalSync(note, {
          type: 'keepWorking',
          conflictId: note.externalSync.conflictId
        });
      }
    }
  },
  {
    label: 'begin:load-external',
    apply: ({ note }) => {
      if (
        note.externalSync.kind === 'conflict' &&
        note.externalSync.phase === 'awaitingChoice'
      ) {
        dispatchDocumentExternalSync(note, {
          type: 'beginApplyingExternal',
          conflictId: note.externalSync.conflictId
        });
      }
    }
  },
  {
    label: 'complete:load-external',
    apply: ({ note }) => {
      if (
        note.externalSync.kind === 'conflict' &&
        note.externalSync.phase === 'applyingExternal'
      ) {
        resolveConflictUsingExternal(
          note,
          note.externalSync.conflictId
        );
      }
    }
  },
  {
    label: 'fail:load-external',
    apply: ({ note }) => {
      if (
        note.externalSync.kind === 'conflict' &&
        note.externalSync.phase === 'applyingExternal'
      ) {
        dispatchDocumentExternalSync(note, {
          type: 'externalApplyFailed',
          conflictId: note.externalSync.conflictId
        });
      }
    }
  }
];

describe('document-state generated transition sequences', () => {
  it('preserves state-machine invariants across every command triple', () => {
    let transitionCount = 0;

    for (const firstCommand of commands) {
      for (const secondCommand of commands) {
        for (const thirdCommand of commands) {
          const sequence = [
            firstCommand,
            secondCommand,
            thirdCommand
          ];
          const state: SequenceState = {
            note: document(),
            issuedTokens: []
          };

          for (const command of sequence) {
            const previousToken =
              state.note.operation.token;
            const previousRevision =
              state.note.operation.revision;
            const previousConflictSequence =
              state.note.externalSync.sequence;
            command.apply(state);
            transitionCount += 1;
            try {
              assertDocumentInvariants(
                state.note,
                previousToken,
                previousRevision,
                previousConflictSequence
              );
            } catch (error) {
              throw new Error(
                `${sequence
                  .map((item) => item.label)
                  .join(' -> ')} violated invariants after ${command.label}`,
                { cause: error }
              );
            }
          }
        }
      }
    }

    expect(transitionCount).toBe(
      commands.length ** 3 * 3
    );
  });

  it.each(operationKinds)(
    'rejects stale completion and failure after %s is superseded',
    (kind) => {
      const note = document();
      dispatchDocumentOperation(note, {
        type: 'start',
        operation: kind
      });
      const staleToken = note.operation.token;
      dispatchDocumentOperation(note, {
        type: 'start',
        operation: kind === 'saving' ? 'forgetting' : 'saving'
      });
      const currentToken = note.operation.token;
      const before = structuredClone(note.operation);

      expect(
        dispatchDocumentOperation(note, {
          type: 'succeed',
          token: staleToken
        })
      ).toBe(false);
      expect(
        dispatchDocumentOperation(note, {
          type: 'fail',
          error: new Error('stale'),
          token: staleToken
        })
      ).toBe(false);
      expect(note.operation).toEqual(before);
      expect(
        isDocumentOperationCurrent(note, currentToken)
      ).toBe(true);
    }
  );

  it.each([
    {
      resolution: 'keep',
      resolve: (note: NoteDraftState, conflictId: number) =>
        dispatchDocumentExternalSync(note, {
          type: 'keepWorking',
          conflictId
        }),
      markdown: 'local',
      sync: 'noConflict'
    },
    {
      resolution: 'load',
      resolve: (note: NoteDraftState, conflictId: number) => {
        if (
          !dispatchDocumentExternalSync(note, {
            type: 'beginApplyingExternal',
            conflictId
          })
        ) {
          return false;
        }
        return resolveConflictUsingExternal(note, conflictId);
      },
      markdown: 'external',
      sync: 'noConflict'
    }
  ] as const)(
    'keeps conflict blocking explicit until $resolution resolution',
    ({ resolve, markdown, sync }) => {
      const note = document();
      updateDocumentMarkdown(note, 'local');
      const conflictId = captureExternalSnapshotForTest(
        note,
        savedSnapshot('external'),
        'taskMutation'
      );

      expect(documentHasUnresolvedConflict(note)).toBe(true);
      expect(resolve(note, conflictId!)).toBe(true);
      expect(documentHasUnresolvedConflict(note)).toBe(
        false
      );
      expect(note.working.markdown).toBe(markdown);
      expect(note.externalSync.kind).toBe(sync);
      expect(resolve(note, conflictId!)).toBe(false);
    }
  );
});
