import type { EditorView } from '@codemirror/view';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import type {
  EditorViewCallbacks,
  SharedEditorResources
} from './types';
import { EditorDocumentRuntime } from './editorDocumentRuntime';

export interface CreateSharedEditorResourcesOptions {
  assetRootPath: string | null;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
}

export function createSharedEditorResources({
  assetRootPath,
  onStorePastedImage
}: CreateSharedEditorResourcesOptions): SharedEditorResources {
  const viewCallbacks = new WeakMap<EditorView, EditorViewCallbacks>();
  const runtime = new EditorDocumentRuntime('');

  return {
    imagesConfig: {
      assetRootPath,
      storePastedImage: onStorePastedImage
    },
    registerViewCallbacks: (view, callbacks) => {
      viewCallbacks.set(view, callbacks);
    },
    unregisterViewCallbacks: (view) => {
      viewCallbacks.delete(view);
    },
    resolveViewCallbacks: (view) => viewCallbacks.get(view) ?? null,
    runtime,
    destroy: () => {
      runtime.destroy();
    }
  };
}
