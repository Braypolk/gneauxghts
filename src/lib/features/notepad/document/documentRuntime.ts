import {
  createSharedEditorResources,
  type EditorSnapshot,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import type { NoteKey } from '$lib/features/notepad/state/noteStore';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';

/**
 * DocumentRuntime owns all per-note runtime state for one open note/document:
 * shared editor resources, the latest editor snapshot, save timers/queues,
 * the document-sync rAF id, and the set of editor panes currently bound to
 * this document.
 *
 * One instance is created lazily per NoteKey by DocumentRegistry. When a
 * note is unreferenced, its runtime is destroyed, releasing CodeMirror
 * resources and any pending timers/frames.
 */
export class DocumentRuntime {
  readonly noteKey: NoteKey;

  /** Shared editor resources (one set per note, used by all panes editing this note). */
  private _resources: SharedEditorResources | null = null;

  /** Source-of-truth editor snapshot for this note (populated when last bound editor unmounts). */
  private _editorSnapshot: EditorSnapshot | null = null;

  /** Monotonic generation counter; incremented on each markdown change so panes can reconcile. */
  private _editorGeneration = 0;

  /** Pending autosave timer id (window.setTimeout). */
  private _saveTimerId: number | null = null;

  /** Currently-running serialized save queue. */
  private _saveQueue: Promise<void> | null = null;

  /** rAF id for the document-sync sweep. */
  private _syncFrameId: number | null = null;

  /** Editor controllers attached to this document, keyed by paneId. */
  private _attachedPanes = new Set<string>();

  constructor(noteKey: NoteKey) {
    this.noteKey = noteKey;
  }

  // -------------------------------------------------------------------------
  // Shared editor resources
  // -------------------------------------------------------------------------

  ensureResources(initial: {
    assetRootPath: string | null;
    storePastedImage: (file: File) => Promise<StoredImageAsset>;
  }): SharedEditorResources {
    if (this._resources) {
      return this._resources;
    }
    this._resources = createSharedEditorResources({
      assetRootPath: initial.assetRootPath,
      onTaskListToggle: () => {
        // Caller is responsible for flushing the autosave.
      },
      onStorePastedImage: initial.storePastedImage
    });
    return this._resources;
  }

  hasResources(): boolean {
    return this._resources !== null;
  }

  resources(): SharedEditorResources | null {
    return this._resources;
  }

  applyResourceConfig(
    assetRootPath: string | null,
    storePastedImage: (file: File) => Promise<StoredImageAsset>
  ): void {
    if (!this._resources) return;
    this._resources.imagesConfig.assetRootPath = assetRootPath;
    this._resources.imagesConfig.storePastedImage = storePastedImage;
  }

  // -------------------------------------------------------------------------
  // Editor snapshot + generation
  // -------------------------------------------------------------------------

  getEditorSnapshot(): EditorSnapshot | null {
    return this._editorSnapshot;
  }

  setEditorSnapshot(snapshot: EditorSnapshot | null): void {
    this._editorSnapshot = snapshot;
  }

  getEditorGeneration(): number {
    return this._editorGeneration;
  }

  setEditorGeneration(generation: number): void {
    this._editorGeneration = generation;
  }

  bumpEditorGeneration(): number {
    this._editorGeneration += 1;
    return this._editorGeneration;
  }

  // -------------------------------------------------------------------------
  // Save timer
  // -------------------------------------------------------------------------

  getSaveTimer(): number | null {
    return this._saveTimerId;
  }

  setSaveTimer(timerId: number): void {
    this._saveTimerId = timerId;
  }

  clearSaveTimer(): void {
    if (this._saveTimerId !== null) {
      window.clearTimeout(this._saveTimerId);
      this._saveTimerId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Save queue
  // -------------------------------------------------------------------------

  getSaveQueue(): Promise<void> {
    return this._saveQueue ?? Promise.resolve();
  }

  setSaveQueue(queue: Promise<void> | null): void {
    this._saveQueue = queue;
  }

  // -------------------------------------------------------------------------
  // Document-sync rAF frame
  // -------------------------------------------------------------------------

  hasSyncFrame(): boolean {
    return this._syncFrameId !== null;
  }

  setSyncFrame(frameId: number): void {
    this._syncFrameId = frameId;
  }

  clearSyncFrame(): void {
    if (this._syncFrameId !== null) {
      window.cancelAnimationFrame(this._syncFrameId);
      this._syncFrameId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Attached pane tracking
  // -------------------------------------------------------------------------

  attachPane(paneId: string): void {
    this._attachedPanes.add(paneId);
  }

  detachPane(paneId: string): void {
    this._attachedPanes.delete(paneId);
  }

  attachedPaneCount(): number {
    return this._attachedPanes.size;
  }

  // -------------------------------------------------------------------------
  // Transfer / dispose
  // -------------------------------------------------------------------------

  /**
   * Move all owned state from `source` into this runtime. Used when a note's
   * NoteKey changes (e.g. draft → path) and we need to preserve resources,
   * timers, attached panes, etc. without disposing them.
   *
   * Existing state on `this` takes precedence; only fields not yet set are
   * adopted from `source`.
   */
  adoptFrom(source: DocumentRuntime): void {
    if (source === this) return;

    if (this._resources === null && source._resources !== null) {
      this._resources = source._resources;
      source._resources = null;
    }

    if (this._editorSnapshot === null && source._editorSnapshot !== null) {
      this._editorSnapshot = source._editorSnapshot;
      source._editorSnapshot = null;
    }

    if (this._editorGeneration === 0 && source._editorGeneration !== 0) {
      this._editorGeneration = source._editorGeneration;
      source._editorGeneration = 0;
    }

    if (this._saveTimerId === null && source._saveTimerId !== null) {
      this._saveTimerId = source._saveTimerId;
      source._saveTimerId = null;
    }

    if (this._saveQueue === null && source._saveQueue !== null) {
      this._saveQueue = source._saveQueue;
      source._saveQueue = null;
    }

    if (this._syncFrameId === null && source._syncFrameId !== null) {
      this._syncFrameId = source._syncFrameId;
      source._syncFrameId = null;
    }

    for (const paneId of source._attachedPanes) {
      this._attachedPanes.add(paneId);
    }
    source._attachedPanes.clear();
  }

  /**
   * Release all owned resources for this runtime. Cancels timers/frames and
   * destroys CodeMirror shared resources.
   */
  dispose(): void {
    this.clearSaveTimer();
    this.clearSyncFrame();
    this._resources?.destroy();
    this._resources = null;
    this._editorSnapshot = null;
    this._editorGeneration = 0;
    this._saveQueue = null;
    this._attachedPanes.clear();
  }
}
