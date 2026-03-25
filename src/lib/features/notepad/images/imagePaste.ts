import { EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { imagesConfig } from '$lib/features/notepad/images/imageConfig';

interface ImageUploadAction {
  add?: { id: symbol; pos: number };
  remove?: { id: symbol };
}

function findUploadPlaceholder(
  key: PluginKey<DecorationSet>,
  state: EditorState,
  id: symbol
) {
  const decorations = key.getState(state);
  if (!decorations) {
    return -1;
  }

  const matches = decorations.find(undefined, undefined, (spec) => spec.id === id);
  return matches[0]?.from ?? -1;
}

function createUploadPlaceholder() {
  const placeholder = document.createElement('span');
  placeholder.className = 'gn-image-upload-placeholder';
  placeholder.textContent = 'Saving image...';
  return placeholder;
}

export const imagePastePlugin = $prose((ctx) => {
  const key = new PluginKey<DecorationSet>('NOTEPAD_PASTED_IMAGES');

  return new Plugin({
    key,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(transaction: Transaction, decorationSet: DecorationSet) {
        const nextDecorationSet = decorationSet.map(transaction.mapping, transaction.doc);
        const action = transaction.getMeta(key) as ImageUploadAction | undefined;

        if (!action) {
          return nextDecorationSet;
        }

        if (action.add) {
          return nextDecorationSet.add(transaction.doc, [
            Decoration.widget(action.add.pos, createUploadPlaceholder, {
              id: action.add.id,
              side: -1
            })
          ]);
        }

        if (action.remove) {
          return nextDecorationSet.remove(
            nextDecorationSet.find(undefined, undefined, (spec) => spec.id === action.remove?.id)
          );
        }

        return nextDecorationSet;
      }
    },
    props: {
      decorations(state) {
        return key.getState(state) ?? DecorationSet.empty;
      },
      handlePaste: (view, event) => {
        if (!(event instanceof ClipboardEvent)) {
          return false;
        }

        const imageFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith('image/')
        );
        if (imageFiles.length === 0) {
          return false;
        }

        event.preventDefault();
        const placeholderId = Symbol('notepad image upload');
        let transaction = view.state.tr;
        if (!transaction.selection.empty) {
          transaction = transaction.deleteSelection();
        }
        const insertPos = transaction.selection.from;
        view.dispatch(transaction.setMeta(key, { add: { id: placeholderId, pos: insertPos } }));

        const { storePastedImage } = ctx.get(imagesConfig.key);
        void Promise.all(imageFiles.map((file) => storePastedImage(file)))
          .then((assets) => {
            const placeholderPos = findUploadPlaceholder(key, view.state, placeholderId);
            if (placeholderPos < 0) {
              return;
            }

            const embedMarkdown = assets
              .map((asset) => `![[${asset.fileName}]]`)
              .join('\n\n');
            const nextTransaction = view.state.tr
              .insertText(embedMarkdown, placeholderPos, placeholderPos)
              .setMeta(key, { remove: { id: placeholderId } });
            view.dispatch(nextTransaction);
          })
          .catch((error) => {
            console.error('Failed to store pasted image:', error);
            const placeholderPos = findUploadPlaceholder(key, view.state, placeholderId);
            if (placeholderPos < 0) {
              return;
            }

            view.dispatch(view.state.tr.setMeta(key, { remove: { id: placeholderId } }));
          });

        return true;
      }
    }
  });
});
