import {
  createSharedEditorResources,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import type { NoteKey } from '$lib/features/notepad/state/noteStore';

/**
 * Narrow per-note registry entry. Live document state, history, revision and
 * attached panes belong to SharedEditorResources.runtime; this wrapper only
 * owns resource lookup and persistence scheduling.
 */
export class DocumentRuntime {
  readonly noteKey: NoteKey;
  private _resources: SharedEditorResources | null = null;
  private _saveTimerId: number | null = null;
  private _saveQueue: Promise<void> | null = null;

  constructor(noteKey: NoteKey) {
    this.noteKey = noteKey;
  }

  ensureResources(initial: {
    assetRootPath: string | null;
    storePastedImage: (file: File) => Promise<StoredImageAsset>;
  }): SharedEditorResources {
    if (!this._resources) {
      this._resources = createSharedEditorResources({
        assetRootPath: initial.assetRootPath,
        onStorePastedImage: initial.storePastedImage
      });
    }
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

  getSaveTimer(): number | null {
    return this._saveTimerId;
  }

  setSaveTimer(timerId: number): void {
    this._saveTimerId = timerId;
  }

  clearSaveTimer(): void {
    if (this._saveTimerId === null) return;
    window.clearTimeout(this._saveTimerId);
    this._saveTimerId = null;
  }

  getSaveQueue(): Promise<void> {
    return this._saveQueue ?? Promise.resolve();
  }

  setSaveQueue(queue: Promise<void> | null): void {
    this._saveQueue = queue;
  }

  attachedPaneCount(): number {
    return this._resources?.runtime.attachedPaneCount ?? 0;
  }

  /**
   * Preserve the canonical editor runtime and persistence work when a draft
   * receives its saved path key.
   */
  adoptFrom(source: DocumentRuntime): void {
    if (source === this) return;
    let adoptedResources = false;
    if (
      source._resources &&
      (!this._resources ||
        (source.attachedPaneCount() > 0 && this.attachedPaneCount() === 0))
    ) {
      this._resources?.destroy();
      this._resources = source._resources;
      source._resources = null;
      adoptedResources = true;
    }
    if (this._saveTimerId === null && source._saveTimerId !== null) {
      this._saveTimerId = source._saveTimerId;
      source._saveTimerId = null;
    } else if (source._saveTimerId !== null) {
      source.clearSaveTimer();
    }
    if (source._saveQueue) {
      this._saveQueue = this._saveQueue
        ? Promise.all([
            this._saveQueue,
            source._saveQueue
          ]).then(() => {})
        : source._saveQueue;
      source._saveQueue = null;
    }
    if (!adoptedResources && source._resources) {
      // Collision rekeys first move every source pane to the target runtime.
      // The now-unattached source resources must not be leaked.
      source._resources.destroy();
      source._resources = null;
    }
  }

  dispose(): void {
    this.clearSaveTimer();
    this._resources?.destroy();
    this._resources = null;
    this._saveQueue = null;
  }
}
