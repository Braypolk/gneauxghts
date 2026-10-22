import type { DocumentBody } from '../document/documentBody';
import type { EditorView } from '@codemirror/view';
import type { StoredImageAsset } from '#lib/features/notepad/model/types.js';
import type {
  EditorViewCallbacks,
  SharedEditorResources
} from './types';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { invoke } from '@tauri-apps/api/core';
import { createImageAssetLoader } from '../images/imageAssetLoader';
import { createImageDimensionCache } from '../images/imageDimensions';

export interface CreateSharedEditorResourcesOptions {
  initialBody?: DocumentBody;
  assetRootPath: string | null;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
  onReadImageAsset?: (name: string) => Promise<string>;
}

export function createSharedEditorResources({
  initialBody,
  assetRootPath,
  onStorePastedImage,
  onReadImageAsset = (fileName) => invoke<string>('resolve_image_asset_url', { fileName })
}: CreateSharedEditorResourcesOptions): SharedEditorResources {
  const viewCallbacks = new WeakMap<EditorView, EditorViewCallbacks>();
  const runtime = new EditorDocumentRuntime(initialBody ?? '');
  const dimensions = createImageDimensionCache(() => imagesConfig.assetRootPath);
  const imagesConfig = { assetRootPath, storePastedImage: onStorePastedImage, loadImage: loaderLoad, imageDimensions: dimensions };
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
      dimensions.clear();
      runtime.destroy();
    }
  };
}
