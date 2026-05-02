import type { NoteKey } from '$lib/features/notepad/state/noteStore';
import { DocumentRuntime } from '$lib/features/notepad/document/documentRuntime';

/**
 * DocumentRegistry is a single per-note runtime map. It replaces the
 * collection of parallel maps that previously lived in runtimeStore
 * (sharedEditorResourcesByNoteKey, sharedEditorStateByNoteKey,
 * sharedEditorStateGenerationByNoteKey, noteSaveTimers, noteSaveQueues,
 * documentSyncFrameIds, editorPaneControllersByNoteKey).
 *
 * One DocumentRuntime is created lazily per NoteKey and owns all of its
 * runtime state (CodeMirror resources, save timers/queues, sync frames,
 * attached panes). The registry coordinates lookup, transfer (when a draft
 * is rekeyed to a saved path), and cleanup.
 */
export class DocumentRegistry {
  private _runtimes = new Map<NoteKey, DocumentRuntime>();

  /** Get or create the runtime for a note. */
  ensure(noteKey: NoteKey): DocumentRuntime {
    let runtime = this._runtimes.get(noteKey);
    if (!runtime) {
      runtime = new DocumentRuntime(noteKey);
      this._runtimes.set(noteKey, runtime);
    }
    return runtime;
  }

  /** Look up an existing runtime without creating one. */
  get(noteKey: NoteKey): DocumentRuntime | null {
    return this._runtimes.get(noteKey) ?? null;
  }

  /** Iterate over all runtimes (used for global flush sweeps). */
  values(): IterableIterator<DocumentRuntime> {
    return this._runtimes.values();
  }

  /**
   * Move runtime state from `oldKey` to `nextKey`. If a runtime already
   * exists at `nextKey`, the old runtime's state is merged into it; otherwise
   * the runtime is moved and re-keyed.
   */
  transfer(oldKey: NoteKey, nextKey: NoteKey): void {
    if (oldKey === nextKey) return;

    const oldRuntime = this._runtimes.get(oldKey);
    if (!oldRuntime) return;

    const existingNext = this._runtimes.get(nextKey);
    if (existingNext) {
      existingNext.adoptFrom(oldRuntime);
      // Old runtime now empty; discard.
      this._runtimes.delete(oldKey);
      return;
    }

    const movedRuntime = new DocumentRuntime(nextKey);
    movedRuntime.adoptFrom(oldRuntime);
    this._runtimes.set(nextKey, movedRuntime);
    this._runtimes.delete(oldKey);
  }

  /** Dispose and remove the runtime for a note. */
  dispose(noteKey: NoteKey): void {
    const runtime = this._runtimes.get(noteKey);
    if (!runtime) return;
    runtime.dispose();
    this._runtimes.delete(noteKey);
  }
}

/**
 * Singleton registry for the notepad feature.
 */
export const documentRegistry = new DocumentRegistry();
