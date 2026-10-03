import type { StoredImageAsset } from '$lib/features/notepad/model/types';

export interface ImagesConfig {
  assetRootPath: string | null;
  storePastedImage: (file: File) => Promise<StoredImageAsset>;
  loadImage?: (name: string, refresh?: boolean) => Promise<string>;
}

export const defaultImagesConfig: ImagesConfig = {
  assetRootPath: null,
  storePastedImage: async () => {
    throw new Error('Pasted image storage is not configured');
  }
};
