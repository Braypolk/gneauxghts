import type { DocumentHandle } from '$lib/features/notepad/state/noteStore';
import { DocumentRuntime } from '$lib/features/notepad/document/documentRuntime';

/**
 * DocumentRegistry is a single per-note runtime map. It replaces the
 * collection of parallel maps that previously lived in runtimeStore.
 *
 * One DocumentRuntime is created lazily per immutable DocumentHandle and owns
 * all of its runtime state (CodeMirror resources and save timers/queues).
 */
export class DocumentRegistry {
  private _runtimes = new Map<DocumentHandle, DocumentRuntime>();

  /** Get or create the runtime for a note. */
  ensure(documentHandle: DocumentHandle): DocumentRuntime {
    let runtime = this._runtimes.get(documentHandle);
    if (!runtime) {
      runtime = new DocumentRuntime(documentHandle);
      this._runtimes.set(documentHandle, runtime);
    }
    return runtime;
  }

  /** Look up an existing runtime without creating one. */
  get(documentHandle: DocumentHandle): DocumentRuntime | null {
    return this._runtimes.get(documentHandle) ?? null;
  }

  /** Iterate over all runtimes (used for global flush sweeps). */
  values(): IterableIterator<DocumentRuntime> {
    return this._runtimes.values();
  }

  /** Dispose and remove the runtime for a note. */
  dispose(documentHandle: DocumentHandle): void {
    const runtime = this._runtimes.get(documentHandle);
    if (!runtime) return;
    runtime.dispose();
    this._runtimes.delete(documentHandle);
  }
}

/**
 * Singleton registry for the notepad feature.
 */
export const documentRegistry = new DocumentRegistry();
