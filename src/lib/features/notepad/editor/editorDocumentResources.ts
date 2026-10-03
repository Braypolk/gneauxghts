import type { EditorView } from '@codemirror/view';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import type {
  EditorViewCallbacks,
  SharedEditorResources
} from './types';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { invoke } from '@tauri-apps/api/core';
import { createImageAssetLoader } from '../images/imageAssetLoader';

export interface CreateSharedEditorResourcesOptions {
  assetRootPath: string | null;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
  onReadImageAsset?: (name: string) => Promise<string>;
}

export function createSharedEditorResources({
  assetRootPath,
  onStorePastedImage,
  onReadImageAsset = (fileName) => invoke<string>('read_image_asset_data_url', { fileName })
}: CreateSharedEditorResourcesOptions): SharedEditorResources {
  const viewCallbacks = new WeakMap<EditorView, EditorViewCallbacks>();
  const runtime = new EditorDocumentRuntime('');
  const imagesConfig = { assetRootPath, storePastedImage: onStorePastedImage, loadImage: loaderLoad };
  const loader = createImageAssetLoader(onReadImageAsset, () => imagesConfig.assetRootPath,
    (fileName) => invoke<string>('read_image_asset_fingerprint', { fileName }));
  function loaderLoad(name: string, refresh?: boolean) { return loader.load(name, refresh); }

  return {
    imagesConfig,
    registerViewCallbacks: (view, callbacks) => {
      viewCallbacks.set(view, callbacks);
    },
    unregisterViewCallbacks: (view) => {
      viewCallbacks.delete(view);
    },
    resolveViewCallbacks: (view) => viewCallbacks.get(view) ?? null,
    runtime,
    destroy: () => {
      loader.destroy();
      runtime.destroy();
    }
  };
}
