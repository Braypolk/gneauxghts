import type { Editor } from '@milkdown/kit/core';
import { imageEmbedsPlugin } from '$lib/features/notepad/images/imageEmbeds';
import { imagePastePlugin } from '$lib/features/notepad/images/imagePaste';
import { imagesConfig, type ImagesConfig } from '$lib/features/notepad/images/imageConfig';

export function useImages(editor: Editor, config: Partial<ImagesConfig> = {}) {
  editor
    .config((ctx) => {
      ctx.update(imagesConfig.key, (previous) => ({
        ...previous,
        ...config
      }));
    })
    .use(imagesConfig)
    .use(imageEmbedsPlugin)
    .use(imagePastePlugin);
}
