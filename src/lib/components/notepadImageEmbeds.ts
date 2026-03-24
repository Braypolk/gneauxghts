import {
  Plugin,
  PluginKey,
  type Selection,
  type Transaction
} from '@milkdown/kit/prose/state';
import { DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { notepadImagesConfig } from './notepadImagesShared';
import {
  findTouchedImageEmbedKey,
  isInCodeContext,
  transactionMayAffectImageEmbeds
} from './notepadImageEmbedParser';
import { buildImageEmbedDecorations } from './notepadImageEmbedWidgets';

interface ImageEmbedDecorationsState {
  decorations: DecorationSet;
  activeWidgetKey: string | null;
}

export const notepadImageEmbedsPlugin = $prose((ctx) => {
  const key = new PluginKey<ImageEmbedDecorationsState>('NOTEPAD_IMAGE_EMBEDS');

  return new Plugin({
    key,
    state: {
      init(_, state) {
        const assetRootPath = ctx.get(notepadImagesConfig.key).assetRootPath;
        return {
          decorations: buildImageEmbedDecorations(state.doc, state.selection, assetRootPath),
          activeWidgetKey: findTouchedImageEmbedKey(state.doc, state.selection)
        };
      },
      apply(transaction, pluginState, oldState, newState) {
        const assetRootPath = ctx.get(notepadImagesConfig.key).assetRootPath;
        if (!assetRootPath || isInCodeContext(newState.selection)) {
          return {
            decorations: DecorationSet.empty,
            activeWidgetKey: null
          };
        }

        const activeWidgetKey = findTouchedImageEmbedKey(newState.doc, newState.selection);
        if (
          transaction.docChanged &&
          activeWidgetKey === pluginState.activeWidgetKey &&
          !transactionMayAffectImageEmbeds(transaction, oldState.doc, newState.doc)
        ) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            activeWidgetKey
          };
        }

        if (!transaction.docChanged && activeWidgetKey === pluginState.activeWidgetKey) {
          return {
            decorations: pluginState.decorations,
            activeWidgetKey
          };
        }

        return {
          decorations: buildImageEmbedDecorations(newState.doc, newState.selection, assetRootPath),
          activeWidgetKey
        };
      }
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty
    }
  });
});
