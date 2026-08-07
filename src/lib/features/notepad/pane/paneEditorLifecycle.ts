import type { CursorPosition } from '$lib/features/notepad/editor/editorViewState';
import type { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  createPaneEditorRuntimeState,
  transitionPaneEditorRuntime,
  type PaneEditorRuntimeEvent,
  type PaneEditorRuntimeState
} from './paneLifecycleMachine';

type EditorLifecycleController = ReturnType<
  typeof createEditorLifecycleController
>;

export type PaneEditorOperationResult =
  | 'applied'
  | 'unavailable'
  | 'stale'
  | 'disposed';

export interface PaneEditorLifecycleDeps<
  TPaneId extends string
> {
  getPaneIds: () => readonly TPaneId[];
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getEditorLifecycleController: (
    paneId: TPaneId
  ) => EditorLifecycleController;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  paneShouldMountEditor: (paneId: TPaneId) => boolean;
  onEditorMounted?: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void;
  closeWikilinkAutocomplete: (paneId: TPaneId) => void;
}

export interface PaneEditorReplaceOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
  cursorPosition?: CursorPosition | null;
  expectedDocument?: NoteDraftState | null;
  suppressReadyReset?: boolean;
}

/**
 * The only serialized owner of a pane's EditorView lifecycle and document
 * transitions. Every mount, swap, replacement and teardown passes through
 * this queue, preventing a late transition from reviving a disposed pane.
 */
class PaneEditorSession<TPaneId extends string> {
  #queue: Promise<unknown> = Promise.resolve();
  #state: PaneEditorRuntimeState =
    createPaneEditorRuntimeState();

  constructor(
    readonly paneId: TPaneId,
    private readonly deps: PaneEditorLifecycleDeps<TPaneId>
  ) {}

  #assertStableResourceInvariant(runtime: PaneRuntime) {
    if (
      (this.#state.kind === 'unmounted' ||
        this.#state.kind === 'disposed') &&
      runtime.controller
    ) {
      throw new Error(
        `Pane editor session (${this.paneId}) has a controller while ${this.#state.kind}.`
      );
    }
    if (
      this.#state.kind === 'mounted' &&
      !runtime.controller
    ) {
      throw new Error(
        `Pane editor session (${this.paneId}) lost its mounted controller.`
      );
    }
  }

  #dispatch(event: PaneEditorRuntimeEvent) {
    const previous = this.#state;
    this.#state = transitionPaneEditorRuntime(previous, event);
    return this.#state !== previous;
  }

  #isDisposalRequested() {
    return (
      this.#state.kind === 'disposed' ||
      (this.#state.kind === 'unmounting' &&
        this.#state.disposeAfter)
    );
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    // Keep the queue usable after a failed operation while still propagating
    // the original failure to its caller.
    this.#queue = result.catch((error) => {
      console.error(
        `Pane editor session (${this.paneId}) failed:`,
        error
      );
    });
    return result;
  }

  mount(): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      if (this.#isDisposalRequested()) return 'disposed';
      if (!this.deps.paneShouldMountEditor(this.paneId)) {
        return 'unavailable';
      }

      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      if (runtime.controller) {
        return 'applied';
      }
      if (!runtime.refs.editorRoot) return 'unavailable';

      if (!this.#dispatch({ type: 'mountRequested' })) {
        return this.#isDisposalRequested()
          ? 'disposed'
          : 'unavailable';
      }
      if (this.#state.kind !== 'mounting') {
        return 'unavailable';
      }
      const document = this.deps.getPaneDocument(this.paneId);
      const lifecycle =
        this.deps.getEditorLifecycleController(this.paneId);
      try {
        await lifecycle.createEditor(document.working.markdown);
      } catch (error) {
        this.#dispatch({ type: 'mountFailed' });
        throw error;
      }
      if (this.#state.kind !== 'mounting') {
        if (runtime.controller) await lifecycle.destroyEditor();
        return this.#isDisposalRequested()
          ? 'disposed'
          : 'stale';
      }
      if (!runtime.controller) {
        this.#dispatch({ type: 'mountFailed' });
        return 'unavailable';
      }

      this.#dispatch({ type: 'mountCompleted' });
      lifecycle.restoreCursorPositionForDocument(document);
      this.deps.onEditorMounted?.(this.paneId, document);
      return 'applied';
    });
  }

  destroy(
    documentOverride: NoteDraftState | null = null
  ): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      const disposing =
        this.#state.kind === 'unmounting' &&
        this.#state.disposeAfter;
      if (!runtime.controller && !disposing) {
        return this.#state.kind === 'disposed'
          ? 'disposed'
          : 'unavailable';
      }

      if (!disposing) {
        if (!this.#dispatch({ type: 'unmountRequested' })) {
          return this.#isDisposalRequested()
            ? 'disposed'
            : 'unavailable';
        }
      }
      if (this.#state.kind !== 'unmounting') {
        return this.#state.kind === 'disposed'
          ? 'disposed'
          : 'unavailable';
      }
      const document =
        documentOverride ??
        this.deps.getPaneDocument(this.paneId);
      const lifecycle =
        this.deps.getEditorLifecycleController(this.paneId);
      try {
        if (runtime.controller) {
          lifecycle.saveCursorPositionForDocument(document);
          await lifecycle.destroyEditor();
        }
      } catch (error) {
        this.#dispatch({ type: 'unmountFailed' });
        throw error;
      }
      runtime.setIsEditorReady(false);
      this.deps.closeWikilinkAutocomplete(this.paneId);
      this.#dispatch({ type: 'unmountCompleted' });
      return 'applied';
    });
  }

  saveCursorPosition(
    document: NoteDraftState
  ): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      if (this.#isDisposalRequested()) return 'disposed';
      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      if (!runtime.controller) return 'unavailable';
      this.deps
        .getEditorLifecycleController(this.paneId)
        .saveCursorPositionForDocument(document);
      return 'applied';
    });
  }

  replaceContent(
    markdown: string,
    options: PaneEditorReplaceOptions = {}
  ): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      if (this.#isDisposalRequested()) return 'disposed';
      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      if (!runtime.controller) return 'unavailable';
      if (
        options.expectedDocument &&
        this.deps.getPaneDocument(this.paneId) !==
          options.expectedDocument
      ) {
        return 'stale';
      }

      await this.deps
        .getEditorLifecycleController(this.paneId)
        .replaceEditorContent(markdown, options);
      if (
        options.expectedDocument &&
        this.deps.getPaneDocument(this.paneId) !==
          options.expectedDocument
      ) {
        return 'stale';
      }
      return this.deps.getPaneRuntime(this.paneId).controller
        ? 'applied'
        : 'unavailable';
    });
  }

  replaceContentInPlace(
    markdown: string,
    expectedDocument: NoteDraftState | null = null,
    flushHistory = false
  ): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      if (this.#isDisposalRequested()) return 'disposed';
      if (
        expectedDocument &&
        this.deps.getPaneDocument(this.paneId) !==
          expectedDocument
      ) {
        return 'stale';
      }
      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      if (!runtime.controller) return 'unavailable';

      const lifecycle =
        this.deps.getEditorLifecycleController(this.paneId);
      if (flushHistory && expectedDocument) {
        await lifecycle.replaceEditorContentInPlaceForDocument(
          markdown,
          expectedDocument
        );
      } else {
        await lifecycle.replaceEditorContentInPlace(markdown);
      }
      return expectedDocument &&
        this.deps.getPaneDocument(this.paneId) !== expectedDocument
        ? 'stale'
        : 'applied';
    });
  }

  bindDocument(
    document: NoteDraftState,
    { restoreCursor = false }: { restoreCursor?: boolean } = {}
  ): Promise<PaneEditorOperationResult> {
    return this.#enqueue(async () => {
      if (this.#isDisposalRequested()) return 'disposed';
      if (this.deps.getPaneDocument(this.paneId) !== document) {
        return 'stale';
      }
      const runtime = this.deps.getPaneRuntime(this.paneId);
      this.#assertStableResourceInvariant(runtime);
      if (!runtime.controller) return 'unavailable';

      const lifecycle =
        this.deps.getEditorLifecycleController(this.paneId);
      const swapped = await lifecycle.swapEditorBuffer(document);
      if (this.deps.getPaneDocument(this.paneId) !== document) {
        return 'stale';
      }
      if (!swapped) {
        await lifecycle.replaceEditorContent(
          document.working.markdown,
          {
            restoreCursor,
            expectedDocument: document,
            suppressReadyReset: true
          }
        );
      } else if (restoreCursor) {
        lifecycle.restoreCursorPositionForDocument(document);
      }
      return this.deps.getPaneRuntime(this.paneId).controller
        ? 'applied'
        : 'unavailable';
    });
  }

  reconcile(): Promise<PaneEditorOperationResult> {
    return this.deps.paneShouldMountEditor(this.paneId)
      ? this.mount()
      : this.destroy();
  }

  dispose(
    documentOverride: NoteDraftState | null = null
  ): Promise<PaneEditorOperationResult> {
    this.#dispatch({ type: 'disposeRequested' });
    return this.destroy(documentOverride);
  }
}

export function createPaneEditorLifecycle<
  TPaneId extends string
>(deps: PaneEditorLifecycleDeps<TPaneId>) {
  const sessions = new Map<
    TPaneId,
    PaneEditorSession<TPaneId>
  >();

  function getSession(paneId: TPaneId) {
    let session = sessions.get(paneId);
    if (!session) {
      session = new PaneEditorSession(paneId, deps);
      sessions.set(paneId, session);
    }
    return session;
  }

  function mountPaneEditor(paneId: TPaneId) {
    return getSession(paneId).mount();
  }

  function destroyPaneEditor(
    paneId: TPaneId,
    document: NoteDraftState | null = null
  ): Promise<PaneEditorOperationResult> {
    const session = sessions.get(paneId);
    return session
      ? session.destroy(document)
      : Promise.resolve('disposed');
  }

  function saveCursorPosition(
    paneId: TPaneId,
    document: NoteDraftState
  ) {
    return getSession(paneId).saveCursorPosition(document);
  }

  function replaceContent(
    paneId: TPaneId,
    markdown: string,
    options: PaneEditorReplaceOptions = {}
  ) {
    return getSession(paneId).replaceContent(markdown, options);
  }

  function replaceContentInPlace(
    paneId: TPaneId,
    markdown: string,
    expectedDocument: NoteDraftState | null = null,
    flushHistory = false
  ) {
    return getSession(paneId).replaceContentInPlace(
      markdown,
      expectedDocument,
      flushHistory
    );
  }

  function bindDocument(
    paneId: TPaneId,
    document: NoteDraftState,
    options: { restoreCursor?: boolean } = {}
  ) {
    return getSession(paneId).bindDocument(document, options);
  }

  async function ensurePaneEditors(): Promise<void> {
    await Promise.all(
      deps
        .getPaneIds()
        .map((paneId) => getSession(paneId).reconcile())
    );
  }

  async function disposePane(
    paneId: TPaneId,
    document: NoteDraftState | null = null
  ): Promise<void> {
    const session = sessions.get(paneId);
    if (!session) return;
    await session.dispose(document);
    sessions.delete(paneId);
  }

  async function disposeAll(): Promise<void> {
    await Promise.all(
      [...sessions.values()].map((session) => session.dispose())
    );
    sessions.clear();
  }

  return {
    mountPaneEditor,
    destroyPaneEditor,
    saveCursorPosition,
    replaceContent,
    replaceContentInPlace,
    bindDocument,
    ensurePaneEditors,
    disposePane,
    disposeAll
  };
}

export type PaneEditorLifecycle<
  TPaneId extends string
> = ReturnType<typeof createPaneEditorLifecycle<TPaneId>>;
