import { describe, expect, it } from 'vitest';
import {
  createDocumentState,
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import { captureExternalSnapshotForTest } from '$lib/features/notepad/document/documentExternalSyncTestSupport';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  INITIAL_PANE_ID
} from '$lib/features/notepad/session/runtimeStore.svelte';
import { PaneRuntime } from './paneRuntime.svelte';
import { createPaneViewModelFactory } from './paneViewModelFactory';

describe('pane view model document status', () => {
  it('surfaces an external conflict on the editor branch', () => {
    const saved = {
      ...createEmptySessionSnapshot(),
      title: 'Note',
      bodyMarkdown: 'saved',
      currentNoteId: 'note-1',
      currentNotePath: '/vault/Note.md',
      lastSavedTitle: 'Note',
      lastSavedMarkdown: 'saved',
      lastSavedNoteId: 'note-1',
      lastSavedPath: '/vault/Note.md'
    };
    const document = createDocumentState(
      saved,
      'path:/vault/Note.md'
    );
    updateDocumentMarkdown(document, 'local edits');
    captureExternalSnapshotForTest(
      document,
      {
        ...saved,
        bodyMarkdown: 'disk version',
        lastSavedMarkdown: 'disk version'
      },
      'watcher'
    );
    const getPaneViewModel = createPaneViewModelFactory({
      getPaneOrder: () => [INITIAL_PANE_ID],
      getActivePaneId: () => INITIAL_PANE_ID,
      getCollapsingPaneId: () => null,
      getPaneKind: () => 'editor',
      getPaneDocument: () => document,
      getPaneRuntime: () =>
        new PaneRuntime(INITIAL_PANE_ID),
      getChatBindings: () => {
        throw new Error('chat bindings are not used for an editor');
      },
      isReviewingDocument: () => false,
      isNotePinned: (noteId) => noteId === 'note-1',
      paneTitleInputClass: 'title',
      getTransientUiState: () => ({ kind: 'none' }),
      getPaneCommandPaneId: () => null,
      getPaneCommandHighlightedIndex: () => 0,
      getPaneCommandMode: () => 'split',
      getPaneCommandCurrentNoteLabel: () => '',
      getPaneCommandPreviousNoteLabel: () => null,
      getPaneCommandPreviousNoteShortcutLabel: () => '',
      paneShouldMountEditor: () => false,
      paneLifecycle: {} as never
    });

    const viewModel = getPaneViewModel(INITIAL_PANE_ID);

    expect(viewModel.paneKind).toBe('editor');
    if (viewModel.paneKind === 'editor') {
      expect(viewModel.documentStatus).toEqual({
        kind: 'conflict',
        label: 'Changed outside the app',
        externalKind: 'snapshot'
      });
      expect(viewModel.canPin).toBe(true);
      expect(viewModel.isPinned).toBe(true);
    }
  });
});
