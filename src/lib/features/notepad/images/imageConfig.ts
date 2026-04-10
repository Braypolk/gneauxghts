import type { StoredImageAsset } from '$lib/features/notepad/model/types';

export interface ImagesConfig {
  assetRootPath: string | null;
  storePastedImage: (file: File) => Promise<StoredImageAsset>;
}

export const defaultImagesConfig: ImagesConfig = {
  assetRootPath: null,
  storePastedImage: async () => {
    throw new Error('Pasted image storage is not configured');
  }
};
