import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';

interface PlaceholderEntry {
  id: symbol;
  from: number;
  to: number;
}

const addPlaceholderEffect = StateEffect.define<{ id: symbol; pos: number }>();
const removePlaceholderEffect = StateEffect.define<{ id: symbol }>();

class UploadPlaceholderWidget extends WidgetType {
  override toDOM() {
    const placeholder = document.createElement('span');
    placeholder.className = 'gn-image-upload-placeholder';
    placeholder.textContent = 'Saving image...';
    return placeholder;
  }
}

const placeholderField = StateField.define<readonly PlaceholderEntry[]>({
  create() {
    return [];
  },
  update(value, transaction) {
    let next = value.map((entry) => ({
      ...entry,
      from: transaction.changes.mapPos(entry.from, -1),
      to: transaction.changes.mapPos(entry.to, 1)
    }));

    for (const effect of transaction.effects) {
      if (effect.is(addPlaceholderEffect)) {
        next = [...next, { id: effect.value.id, from: effect.value.pos, to: effect.value.pos }];
      } else if (effect.is(removePlaceholderEffect)) {
        next = next.filter((entry) => entry.id !== effect.value.id);
      }
    }

    return next;
  },
  provide(field) {
    return EditorView.decorations.from(field, (entries) => {
      const builder = new RangeSetBuilder<Decoration>();
      for (const entry of entries) {
        builder.add(
          entry.from,
          entry.from,
          Decoration.widget({
            widget: new UploadPlaceholderWidget(),
            side: -1
          })
        );
      }
      return builder.finish();
    });
  }
});

function findUploadPlaceholder(view: EditorView, id: symbol) {
  return view.state.field(placeholderField).find((entry) => entry.id === id)?.from ?? -1;
}

export function createImagePasteExtension(config: ImagesConfig) {
  return [
    placeholderField,
    EditorView.domEventHandlers({
      paste: (event, view) => {
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
        const selection = view.state.selection.main;
        let changes = null as { from: number; to: number; insert: string } | null;
        let insertPos = selection.from;

        if (!selection.empty) {
          changes = { from: selection.from, to: selection.to, insert: '' };
          insertPos = selection.from;
        }

        view.dispatch(
          view.state.update({
            ...(changes ? { changes } : {}),
            effects: addPlaceholderEffect.of({ id: placeholderId, pos: insertPos })
          })
        );

        void Promise.all(imageFiles.map((file) => config.storePastedImage(file)))
          .then((assets) => {
            const placeholderPos = findUploadPlaceholder(view, placeholderId);
            if (placeholderPos < 0) {
              return;
            }

            const embedMarkdown = assets.map((asset) => `![[${asset.fileName}]]`).join('\n\n');
            view.dispatch(
              view.state.update({
                changes: { from: placeholderPos, to: placeholderPos, insert: embedMarkdown },
                effects: removePlaceholderEffect.of({ id: placeholderId })
              })
            );
          })
          .catch((error) => {
            console.error('Failed to store pasted image:', error);
            if (findUploadPlaceholder(view, placeholderId) < 0) {
              return;
            }

            view.dispatch(
              view.state.update({
                effects: removePlaceholderEffect.of({ id: placeholderId })
              })
            );
          });

        return true;
      }
    })
  ];
}
