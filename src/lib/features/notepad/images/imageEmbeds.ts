import { ViewPlugin, type DecorationSet } from '@codemirror/view';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import {
  buildImageEmbedDecorations,
  selectionIntersectsImageEmbed,
  type ImageEmbedRange
} from '$lib/features/notepad/images/imageEmbedWidgets';

export function createImageEmbedsExtension(config: ImagesConfig) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      #embedRanges: ImageEmbedRange[] = [];

      constructor(view: import('@codemirror/view').EditorView) {
        const built = buildImageEmbedDecorations(view, config.assetRootPath);
        this.decorations = built.decorations;
        this.#embedRanges = built.ranges;
      }

      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged) {
          this.rebuild(update.view);
          return;
        }

        // Selection intersection hides the widget so the markdown source is
        // editable. Skip rebuilds when neither the old nor new selection touches
        // an embed — the common case for caret movement elsewhere in the doc.
        if (
          !update.selectionSet ||
          this.#embedRanges.length === 0 ||
          (!selectionIntersectsImageEmbed(update.startState.selection.main, this.#embedRanges) &&
            !selectionIntersectsImageEmbed(update.state.selection.main, this.#embedRanges))
        ) {
          return;
        }

        this.rebuild(update.view);
      }

      private rebuild(view: import('@codemirror/view').EditorView) {
        const built = buildImageEmbedDecorations(view, config.assetRootPath);
        this.decorations = built.decorations;
        this.#embedRanges = built.ranges;
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
