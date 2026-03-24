import { $ctx } from '@milkdown/kit/utils';
import type { StoredImageAsset } from './notepadTypes';

export interface NotepadImagesConfig {
  assetRootPath: string | null;
  storePastedImage: (file: File) => Promise<StoredImageAsset>;
}

export const notepadImagesConfig = $ctx<NotepadImagesConfig, 'notepadImagesConfig'>(
  {
    assetRootPath: null,
    storePastedImage: async () => {
      throw new Error('Pasted image storage is not configured');
    }
  },
  'notepadImagesConfig'
);
