import { $ctx } from '@milkdown/kit/utils';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';

export interface ImagesConfig {
  assetRootPath: string | null;
  storePastedImage: (file: File) => Promise<StoredImageAsset>;
}

export const imagesConfig = $ctx<ImagesConfig, 'imagesConfig'>(
  {
    assetRootPath: null,
    storePastedImage: async () => {
      throw new Error('Pasted image storage is not configured');
    }
  },
  'imagesConfig'
);
