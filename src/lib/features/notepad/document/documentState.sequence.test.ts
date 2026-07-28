import { describe, expect, it } from 'vitest';
import {
  applySessionSnapshotToDocument,
  beginDocumentOperation,
  captureExternalDeletionConflict,
  captureExternalSnapshotConflict,
  completeDocumentOperation,
  createDocumentState,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  failDocumentOperation,
  getDocumentStatusViewModel,
  invalidateDocumentOperations,
  isDocumentOperationCurrent,
  resolveConflictKeepingWorking,
  resolveConflictUsingExternal,
  updateDocumentMarkdown,
  type DocumentOperationKind,
  type NoteDraftState
} from './documentState';
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
    `path:${path}`
  );
}

function assertDocumentInvariants(
  note: NoteDraftState,
  previousToken: number,
  previousRevision: number
) {
  expect(note.operation.token).toBeGreaterThanOrEqual(
    previousToken
  );
  expect(note.operation.revision).toBeGreaterThanOrEqual(
    previousRevision
  );
  expect(documentHasUnresolvedConflict(note)).toBe(
    note.externalSync.kind === 'conflict'
  );
  if (note.externalSync.kind === 'conflict') {
    expect(note.externalSync.external).toBeDefined();
    expect(getDocumentStatusViewModel(note).kind).toBe(
      'conflict'
    );
  }
  if (note.externalSync.kind === 'inSync') {
    expect(documentHasCleanBuffer(note)).toBe(true);
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
  'remembering',
  'forgetting',
  'opening'
];

const commands: DocumentCommand[] = [
  ...operationKinds.map(
    (kind): DocumentCommand => ({
      label: `begin:${kind}`,
      apply: (state) => {
        state.issuedTokens.push(
          beginDocumentOperation(state.note, kind)
        );
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
      invalidateDocumentOperations(note);
    }
  },
  {
    label: 'complete:oldest',
    apply: ({ note, issuedTokens }) => {
      completeDocumentOperation(
        note,
        issuedTokens[0] ?? -1
      );
    }
  },
  {
    label: 'fail:oldest',
    apply: ({ note, issuedTokens }) => {
      failDocumentOperation(
        note,
        'saving',
        new Error('sequence failure'),
        issuedTokens[0] ?? -1
      );
    }
  },
  {
    label: 'conflict:snapshot',
    apply: ({ note }) => {
      if (documentHasCleanBuffer(note)) {
        updateDocumentMarkdown(note, 'local-before-conflict');
      }
      captureExternalSnapshotConflict(
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
      captureExternalDeletionConflict(
        note,
        path,
        'watcher'
      );
    }
  },
  {
    label: 'resolve:keep',
    apply: ({ note }) => {
      resolveConflictKeepingWorking(note);
    }
  },
  {
    label: 'resolve:load',
    apply: ({ note }) => {
      resolveConflictUsingExternal(note);
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
            command.apply(state);
            transitionCount += 1;
            try {
              assertDocumentInvariants(
                state.note,
                previousToken,
                previousRevision
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
      const staleToken = beginDocumentOperation(note, kind);
      const currentToken = beginDocumentOperation(
        note,
        kind === 'opening' ? 'saving' : 'opening'
      );
      const before = structuredClone(note.operation);

      expect(
        completeDocumentOperation(note, staleToken)
      ).toBe(false);
      expect(
        failDocumentOperation(
          note,
          kind,
          new Error('stale'),
          staleToken
        )
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
      resolve: resolveConflictKeepingWorking,
      markdown: 'local',
      sync: 'dirty'
    },
    {
      resolution: 'load',
      resolve: resolveConflictUsingExternal,
      markdown: 'external',
      sync: 'inSync'
    }
  ] as const)(
    'keeps conflict blocking explicit until $resolution resolution',
    ({ resolve, markdown, sync }) => {
      const note = document();
      updateDocumentMarkdown(note, 'local');
      captureExternalSnapshotConflict(
        note,
        savedSnapshot('external'),
        'taskMutation'
      );

      expect(documentHasUnresolvedConflict(note)).toBe(true);
      expect(resolve(note)).toBe(true);
      expect(documentHasUnresolvedConflict(note)).toBe(
        false
      );
      expect(note.working.markdown).toBe(markdown);
      expect(note.externalSync.kind).toBe(sync);
      expect(resolve(note)).toBe(false);
    }
  );

  it('refreshes one shared clean document reference exactly once', () => {
    const shared = document();
    const paneDocuments = [shared, shared, shared];
    const beforeRevision = shared.operation.revision;

    applySessionSnapshotToDocument(
      shared,
      savedSnapshot('external')
    );

    expect(new Set(paneDocuments).size).toBe(1);
    expect(
      paneDocuments.map((note) => note.working.markdown)
    ).toEqual(['external', 'external', 'external']);
    expect(shared.operation.revision).toBe(
      beforeRevision + 1
    );
    expect(shared.externalSync.kind).toBe('inSync');
  });
});
