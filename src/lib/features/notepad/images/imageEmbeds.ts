import { ViewPlugin } from '@codemirror/view';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import { buildImageEmbedDecorations } from '$lib/features/notepad/images/imageEmbedWidgets';

export function createImageEmbedsExtension(config: ImagesConfig) {
  return ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: import('@codemirror/view').EditorView) {
        this.decorations = buildImageEmbedDecorations(view, config.assetRootPath);
      }

      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildImageEmbedDecorations(update.view, config.assetRootPath);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
