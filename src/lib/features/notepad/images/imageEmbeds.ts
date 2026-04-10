import {
  Plugin,
  PluginKey,
  type Selection,
  type Transaction
} from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import {
  findTouchedImageEmbedKey,
  isInCodeContext,
  transactionMayAffectImageEmbeds
} from '$lib/features/notepad/images/imageEmbedParser';
import { buildImageEmbedDecorations } from '$lib/features/notepad/images/imageEmbedWidgets';

interface ImageEmbedDecorationsState {
  decorations: DecorationSet;
  activeWidgetKey: string | null;
}

export function createImageEmbedsPlugin(config: ImagesConfig) {
  const key = new PluginKey<ImageEmbedDecorationsState>('NOTEPAD_IMAGE_EMBEDS');

  return new Plugin({
    key,
    state: {
      init(_, state) {
        const { assetRootPath } = config;
        return {
          decorations: buildImageEmbedDecorations(state.doc, state.selection, assetRootPath),
          activeWidgetKey: findTouchedImageEmbedKey(state.doc, state.selection)
        };
      },
      apply(transaction, pluginState, oldState, newState) {
        const { assetRootPath } = config;
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
}
