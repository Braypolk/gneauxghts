import {
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  defaultKeymap,
  insertNewlineAndIndent,
  redo,
  selectGroupLeft,
  selectGroupRight,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  undo
} from '@codemirror/commands';
import { Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentOnInput } from '@codemirror/language';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { createSelectionSurroundExtension } from './selectionSurround';
import {
  deleteCurrentBlock,
  getClipboardMarkdownForCurrentBlock,
  insertParagraphBelow,
  moveCurrentBlock
} from './blockTypes';
import { createIndentExtensions } from './indentConfig';
import {
  indentEditorSelection,
  outdentEditorSelection
} from './structuralIndentation';
import { createMarkdownExtensions } from '$lib/features/notepad/markdown/markdownExtensions';
import { applyInlineFormat } from './inlineFormatting';
import {
  keyboardShortcutMatchesEvent,
  usesNativeCutShortcut
} from '$lib/keyboardShortcuts.svelte';
import type { EditorController } from './types';

export function markdownEnter(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) {
    const line = view.state.doc.lineAt(selection.head);
    if (
      selection.head === line.to &&
      /^[\t ]*(?:[-+*]|\d{1,9}[.)])(?:[\t ]+\[[ xX]\])?[\t ]+$/.test(
        line.text
      )
    ) {
      view.dispatch(
        view.state.update({
          changes: { from: line.from, to: line.to, insert: '' },
          selection: { anchor: line.from },
          scrollIntoView: true,
          userEvent: 'input'
        })
      );
      return true;
    }
  }

  return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
}

const markdownEditingKeymap = [{ key: 'Enter', run: markdownEnter }];

export function createMarkdownBaseExtensions(): Extension[] {
  return [
    createMarkdownExtensions(),
    keymap.of(markdownEditingKeymap),
    EditorView.lineWrapping,
    createIndentExtensions(),
    indentOnInput(),
    createSelectionSurroundExtension(),
    Prec.highest(
      keymap.of([
        {
          key: 'Tab',
          run: indentEditorSelection,
          shift: outdentEditorSelection
        }
      ])
    )
  ];
}

export function createEditorShortcuts(
  controller: () => EditorController | null
) {
  return EditorView.domEventHandlers({
    keydown: (event, view) => {
      const current = controller();
      const runtime = current?.sharedResources?.runtime ?? null;

      if (keyboardShortcutMatchesEvent(event, 'editorUndo')) {
        event.preventDefault();
        return runtime ? runtime.undo(current?.paneKey ?? null) : undo(view);
      }

      if (
        keyboardShortcutMatchesEvent(event, 'editorRedo') ||
        keyboardShortcutMatchesEvent(event, 'editorRedoAlternate')
      ) {
        event.preventDefault();
        return runtime ? runtime.redo(current?.paneKey ?? null) : redo(view);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorInsertBelow')) {
        event.preventDefault();
        return insertParagraphBelow(view);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorMoveLineUp')) {
        event.preventDefault();
        return moveCurrentBlock(view, -1);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorMoveLineDown')) {
        event.preventDefault();
        return moveCurrentBlock(view, 1);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorCutLine')) {
        if (
          usesNativeCutShortcut('editorCutLine') ||
          !view.state.selection.main.empty
        ) {
          return false;
        }

        const markdown = getClipboardMarkdownForCurrentBlock(view);
        if (!markdown) {
          return false;
        }

        const paneKey = current?.paneKey;
        const owner = current?.sharedResources?.runtime;
        event.preventDefault();
        void cutCurrentBlock(view, () => {
          const latest = controller();
          return latest === current && latest?.paneKey === paneKey && latest?.sharedResources?.runtime === owner;
        }).catch((error) => console.error('Failed to copy block markdown to clipboard:', error));
        return true;
      }

      if (keyboardShortcutMatchesEvent(event, 'editorHardBreak')) {
        event.preventDefault();
        const selection = view.state.selection.main;
        view.dispatch(
          view.state.update({
            changes: {
              from: selection.from,
              to: selection.to,
              insert: '\n'
            },
            selection: { anchor: selection.from + 1 }
          })
        );
        return true;
      }

      if (keyboardShortcutMatchesEvent(event, 'editorBold')) {
        event.preventDefault();
        return applyInlineFormat(view, 'bold');
      }

      if (keyboardShortcutMatchesEvent(event, 'editorItalic')) {
        event.preventDefault();
        return applyInlineFormat(view, 'italic');
      }

      if (keyboardShortcutMatchesEvent(event, 'editorLink')) {
        event.preventDefault();
        return applyInlineFormat(view, 'link');
      }

      return false;
    }
  });
}

export function createPlatformNavigationKeymap() {
  return keymap.of([
    {
      mac: 'Alt-ArrowLeft',
      run: cursorGroupLeft,
      shift: selectGroupLeft,
      preventDefault: true
    },
    {
      mac: 'Alt-ArrowRight',
      run: cursorGroupRight,
      shift: selectGroupRight,
      preventDefault: true
    },
    {
      mac: 'Cmd-ArrowLeft',
      run: cursorLineBoundaryLeft,
      shift: selectLineBoundaryLeft,
      preventDefault: true
    },
    {
      mac: 'Cmd-ArrowRight',
      run: cursorLineBoundaryRight,
      shift: selectLineBoundaryRight,
      preventDefault: true
    }
  ]);
}

export function createFilteredDefaultKeymap() {
  return keymap.of(
    defaultKeymap.filter(
      (binding) => !['Enter', 'Mod-Enter', 'Mod-i'].includes(binding.key ?? '')
    )
  );
}

/** Copy completes before deletion, but only the captured document/selection may be cut. */
export async function cutCurrentBlock(view: EditorView, isCurrent: () => boolean, writeText = (text: string) => navigator.clipboard.writeText(text)) {
  const state = view.state;
  const markdown = getClipboardMarkdownForCurrentBlock(view);
  if (!markdown || state.readOnly) return false;
  await writeText(markdown);
  if (!isCurrent() || !view.dom.isConnected || view.state.readOnly || view.composing ||
      view.state.doc !== state.doc || !view.state.selection.eq(state.selection)) return false;
  return deleteCurrentBlock(view);
}
