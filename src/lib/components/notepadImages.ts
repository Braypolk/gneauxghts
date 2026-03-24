import type { Editor } from '@milkdown/kit/core';
import { notepadImageEmbedsPlugin } from './notepadImageEmbeds';
import { notepadImagePastePlugin } from './notepadImagePaste';
import { notepadImagesConfig, type NotepadImagesConfig } from './notepadImagesShared';

export function notepadImages(editor: Editor, config: Partial<NotepadImagesConfig> = {}) {
  editor
    .config((ctx) => {
      ctx.update(notepadImagesConfig.key, (previous) => ({
        ...previous,
        ...config
      }));
    })
    .use(notepadImagesConfig)
    .use(notepadImageEmbedsPlugin)
    .use(notepadImagePastePlugin);
}
