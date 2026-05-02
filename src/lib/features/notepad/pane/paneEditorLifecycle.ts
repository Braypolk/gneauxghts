import { readEditorState } from '$lib/features/notepad/editor/editor';
import type { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import { getSharedEditorStateGeneration } from '$lib/features/notepad/session/noteRuntime';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

type EditorLifecycleController = ReturnType<typeof createEditorLifecycleController>;

export interface PaneEditorLifecycleDeps<TPaneId extends string> {
  paneIds: readonly TPaneId[];
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getEditorLifecycleController: (paneId: TPaneId) => EditorLifecycleController;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  /** Whether the pane should currently have an editor mounted. */
  paneShouldMountEditor: (paneId: TPaneId) => boolean;
  registerPaneEditorForDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  unregisterPaneEditorForDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  markPaneDocumentGeneration: (paneId: TPaneId, document: NoteDraftState) => void;
  saveSharedEditorStateForDocument: (
    document: NoteDraftState,
    editorState: ReturnType<typeof readEditorState>,
    paneId: TPaneId
  ) => void;
  closeWikilinkAutocomplete: (paneId: TPaneId) => void;
}

/**
 * PaneEditorLifecycle owns per-pane editor mount/destroy and the
 * serialization queue that prevents the use:editor action from racing
 * with explicit ensurePaneEditors() barriers.
 *
 * Notepad.svelte previously held paneEditorQueues + mountPaneEditor +
 * destroyPaneEditor + ensurePaneEditors inline. Centralising them here
 * makes the component's responsibilities thinner and keeps the lifecycle
 * fixes (initial editor content, Svelte effect loop) in one place.
 */
export function createPaneEditorLifecycle<TPaneId extends string>(
  deps: PaneEditorLifecycleDeps<TPaneId>
) {
  /**
   * Per-pane mount/destroy queue. Serializes lifecycle transitions so that
   * the use:editor action and any explicit ensurePaneEditors() barrier do
   * not race when both attempt to mount/destroy the same pane in the same
   * microtask.
   */
  const paneEditorQueues = new Map<TPaneId, Promise<void>>();
  for (const paneId of deps.paneIds) {
    paneEditorQueues.set(paneId, Promise.resolve());
  }

  function enqueuePaneEditorOp(paneId: TPaneId, op: () => Promise<void>): Promise<void> {
    const previous = paneEditorQueues.get(paneId) ?? Promise.resolve();
    const queue = previous.then(op).catch((error) => {
      console.error(`Pane editor lifecycle (${paneId}) failed:`, error);
    });
    paneEditorQueues.set(paneId, queue);
    return queue;
  }

  /**
   * Mount the editor for a single pane. Idempotent: if already mounted,
   * returns immediately. Serialized per-pane so concurrent callers (the
   * use:editor action and ensurePaneEditors) do not race.
   */
  function mountPaneEditor(paneId: TPaneId): Promise<void> {
    return enqueuePaneEditorOp(paneId, async () => {
      const runtime = deps.getPaneRuntime(paneId);
      if (runtime.controller) return;
      const editorRoot = runtime.refs.editorRoot;
      if (!editorRoot) return;
      const paneDocument = deps.getPaneDocument(paneId);

      const lifecycle = deps.getEditorLifecycleController(paneId);
      await lifecycle.createEditor(paneDocument.bodyMarkdown);
      if (runtime.controller) {
        deps.registerPaneEditorForDocument(paneId, paneDocument);
      }
      lifecycle.restoreCursorPositionForDocument(paneDocument);
      deps.markPaneDocumentGeneration(paneId, paneDocument);
    });
  }

  /**
   * Destroy the editor for a single pane. Idempotent: if not mounted,
   * returns immediately. Serialized per-pane.
   */
  function destroyPaneEditor(paneId: TPaneId): Promise<void> {
    return enqueuePaneEditorOp(paneId, async () => {
      const runtime = deps.getPaneRuntime(paneId);
      const controller = runtime.controller;
      if (!controller) return;
      const paneDocument = deps.getPaneDocument(paneId);

      deps.unregisterPaneEditorForDocument(paneId, paneDocument);
      const lifecycle = deps.getEditorLifecycleController(paneId);
      lifecycle.saveCursorPositionForDocument(paneDocument);
      if (runtime.ui.editorGeneration >= getSharedEditorStateGeneration(paneDocument)) {
        deps.saveSharedEditorStateForDocument(paneDocument, readEditorState(controller), paneId);
      }
      await lifecycle.destroyEditor();
      runtime.ui.isEditorReady = false;
      deps.closeWikilinkAutocomplete(paneId);
    });
  }

  /**
   * Reconcile every pane's editor mount state with the workspace. Used as
   * an explicit barrier in async flows that need to wait for editors to be
   * ready (split/close/setKind/onMount). Reactively, the use:editor action
   * also drives the same mount/destroy transitions.
   */
  async function ensurePaneEditors(): Promise<void> {
    for (const paneId of deps.paneIds) {
      if (deps.paneShouldMountEditor(paneId)) {
        await mountPaneEditor(paneId);
      } else {
        await destroyPaneEditor(paneId);
      }
    }
  }

  return {
    mountPaneEditor,
    destroyPaneEditor,
    ensurePaneEditors
  };
}

export type PaneEditorLifecycle<TPaneId extends string> = ReturnType<
  typeof createPaneEditorLifecycle<TPaneId>
>;
