import type { Editor } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $ctx, $prose } from '@milkdown/kit/utils';

const WIKILINK_PATTERN = /\[\[([^\[\]\n]+?)\]\]/g;

interface NotepadWikilinkConfig {
  onOpenLink: (rawTarget: string) => void;
}

const notepadWikilinkConfig = $ctx<NotepadWikilinkConfig, 'notepadWikilinkConfig'>(
  {
    onOpenLink: () => {}
  },
  'notepadWikilinkConfig'
);

function isInCodeContext(view: EditorView) {
  const { $from } = view.state.selection;
  if ($from.parent.type.name === 'code_block') {
    return true;
  }

  return $from.marks().some((mark) => mark.type.name === 'code');
}

function buildWikilinkDecorations(doc: ProseMirrorNode) {
  const decorations: Decoration[] = [];

  doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text) {
      return;
    }

    if (parent?.type.name === 'code_block' || node.marks.some((mark) => mark.type.name === 'code')) {
      return;
    }

    for (const match of node.text.matchAll(WIKILINK_PATTERN)) {
      const index = match.index ?? -1;
      const rawTarget = match[1]?.trim();

      if (index < 0 || !rawTarget) {
        continue;
      }

      const from = position + index;
      const to = from + match[0].length;

      decorations.push(
        Decoration.inline(from, to, {
          class: 'gn-wikilink',
          'data-wikilink-target': rawTarget
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function findWikilinkElement(target: EventTarget | null) {
  if (target instanceof HTMLElement) {
    return target.closest<HTMLElement>('.gn-wikilink');
  }

  if (target instanceof Text) {
    return target.parentElement?.closest<HTMLElement>('.gn-wikilink') ?? null;
  }

  return null;
}

export const notepadWikilinksPlugin = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey('NOTEPAD_WIKILINKS'),
    props: {
      decorations: (state) => buildWikilinkDecorations(state.doc),
      handleTextInput: (view, from, to, text) => {
        if (text !== '[' || from !== to || isInCodeContext(view)) {
          return false;
        }

        const previousCharacter = view.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\0');
        if (previousCharacter !== '[') {
          return false;
        }

        const nextCharacters = view.state.doc.textBetween(to, Math.min(view.state.doc.content.size, to + 2), '\n', '\0');
        if (nextCharacters === ']]') {
          return false;
        }

        const transaction = view.state.tr.insertText('[]]', from, to);
        transaction.setSelection(TextSelection.create(transaction.doc, from + 1));
        view.dispatch(transaction);
        return true;
      },
      handleClick: (_view, _position, event) => {
        const wikilinkElement = findWikilinkElement(event.target);
        const rawTarget = wikilinkElement?.dataset.wikilinkTarget?.trim();

        if (!rawTarget) {
          return false;
        }

        event.preventDefault();
        ctx.get(notepadWikilinkConfig.key).onOpenLink(rawTarget);
        return true;
      }
    }
  });
});

export function notepadWikilinks(
  editor: Editor,
  config: Partial<NotepadWikilinkConfig> = {}
) {
  editor
    .config((ctx) => {
      ctx.update(notepadWikilinkConfig.key, (previous) => ({
        ...previous,
        ...config
      }));
    })
    .use(notepadWikilinkConfig)
    .use(notepadWikilinksPlugin);
}
