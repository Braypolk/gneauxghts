import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/features/notepad/editor/editor', () => ({
  readEditorState: vi.fn(() => null)
}));

vi.mock('$lib/features/notepad/session/noteRuntime', () => ({
  getSharedEditorStateGeneration: vi.fn(() => 0)
}));

import { createPaneEditorLifecycle } from './paneEditorLifecycle';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

describe('paneEditorLifecycle', () => {
  it('discovers panes dynamically when ensuring editors', async () => {
    type PaneId = 'pane-1' | 'pane-2';
    const paneIds: PaneId[] = ['pane-1'];
    const documents = {
      'pane-1': createNoteDraftState({ ...createEmptySessionSnapshot(), bodyMarkdown: 'one' }),
      'pane-2': createNoteDraftState({ ...createEmptySessionSnapshot(), bodyMarkdown: 'two' })
    };
    const runtimes: Record<
      PaneId,
      { controller: unknown | null; refs: { editorRoot: object }; ui: { editorGeneration: number } }
    > = {
      'pane-1': { controller: null, refs: { editorRoot: {} }, ui: { editorGeneration: 0 } },
      'pane-2': { controller: null, refs: { editorRoot: {} }, ui: { editorGeneration: 0 } }
    };
    const createEditor = vi.fn(async (paneId: PaneId) => {
      runtimes[paneId].controller = { paneId };
    });

    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => paneIds,
      getPaneRuntime: (paneId: PaneId) => runtimes[paneId] as never,
      getEditorLifecycleController: (paneId: PaneId) =>
        ({
          createEditor: () => createEditor(paneId),
          destroyEditor: vi.fn(),
          restoreCursorPositionForDocument: vi.fn(),
          saveCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: (paneId: PaneId) => documents[paneId],
      paneShouldMountEditor: () => true,
      registerPaneEditorForDocument: vi.fn(),
      unregisterPaneEditorForDocument: vi.fn(),
      markPaneDocumentGeneration: vi.fn(),
      saveSharedEditorStateForDocument: vi.fn(),
      closeWikilinkAutocomplete: vi.fn()
    });

    await lifecycle.ensurePaneEditors();
    paneIds.push('pane-2');
    await lifecycle.ensurePaneEditors();

    expect(createEditor).toHaveBeenCalledWith('pane-1');
    expect(createEditor).toHaveBeenCalledWith('pane-2');
  });
});
