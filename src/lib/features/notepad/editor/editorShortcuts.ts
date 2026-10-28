import {
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  defaultKeymap,
  standardKeymap,
  copyLineUp,
  copyLineDown,
  addCursorAbove,
  addCursorBelow,
  selectLine,
  indentLess,
  indentMore,
  indentSelection,
  deleteLine,
  cursorMatchingBracket,
  toggleComment,
  toggleBlockComment,
  toggleTabFocusMode,
  simplifySelection,
  transposeChars,
  splitLine,
  deleteToLineEnd,
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
import { continueLetterList, deleteLetterListMarkup } from './letterListCommands';
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
import { createMarkdownExtensions } from '#lib/features/notepad/markdown/markdownExtensions.js';
import { applyInlineFormat } from './inlineFormatting';
import { moveThroughLink } from './linkNavigation';
import {
  keyboardShortcutMatchesEvent,
  usesNativeCutShortcut
} from '#lib/keyboardShortcuts.svelte.js';
import type { EditorController } from './types';

export function markdownEnter(view: EditorView): boolean {
  if (continueLetterList(view)) return true;
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

const markdownEditingKeymap = [
  { key: 'Enter', run: markdownEnter },
  { key: 'Backspace', run: deleteLetterListMarkup }
];

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
          run: (view) => moveThroughLink(view),
          shift: (view) => moveThroughLink(view, 'backward')
        },
        {
          any: (view, event) => {
            if (keyboardShortcutMatchesEvent(event, 'editorStructuralIndent')) return indentEditorSelection(view);
            if (keyboardShortcutMatchesEvent(event, 'editorStructuralOutdent')) return outdentEditorSelection(view);
            return false;
          }
        }
      ])
    )
  ];
}

export function createEditorShortcuts(
  controller: () => EditorController | null
) {
  // Assigned commands must run before CodeMirror's native keymap handler.
  return Prec.high(EditorView.domEventHandlers({
    keydown: (event, view) => {
      const current = controller();
      const runtime = current?.sharedResources?.runtime ?? null;

      if (keyboardShortcutMatchesEvent(event, 'editorUndo')) {
        event.preventDefault();
        return runtime ? runtime.undo(current?.paneKey ?? null) : undo(view);
      }

      if (
        keyboardShortcutMatchesEvent(event, 'editorRedo')
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
          usesNativeCutShortcut('editorCutLine', event) ||
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
  }));
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

const explicitEditorCommands = {
  editorSplitLine: splitLine,
  editorDeleteToLineEnd: deleteToLineEnd,
  editorTransposeChars: transposeChars,
  editorCopyLineUp: copyLineUp,
  editorCopyLineDown: copyLineDown,
  editorAddCursorAbove: addCursorAbove,
  editorAddCursorBelow: addCursorBelow,
  editorSelectLine: selectLine,
  editorIndentLess: indentLess,
  editorIndentMore: indentMore,
  editorIndentSelection: indentSelection,
  editorDeleteLine: deleteLine,
  editorMatchingBracket: cursorMatchingBracket,
  editorToggleComment: toggleComment,
  editorToggleBlockComment: toggleBlockComment,
  editorToggleTabFocus: toggleTabFocusMode,
  editorSimplifySelection: simplifySelection,
} as const;

export function createFilteredDefaultKeymap() {
  return [
    // Keep remaps ahead of Markdown Enter and platform cursor navigation.
    Prec.high(keymap.of([{ any: (view, event) => {
      for (const id of Object.keys(explicitEditorCommands) as (keyof typeof explicitEditorCommands)[]) {
        if (keyboardShortcutMatchesEvent(event, id) && explicitEditorCommands[id](view)) return true;
      }
      return false;
    } }])),
    keymap.of([
      // Keep native syntax navigation alongside ordinary text movement.
      ...defaultKeymap.filter(binding => binding.key === 'Alt-ArrowLeft' || binding.key === 'Alt-ArrowRight'),
      ...standardKeymap.filter(binding => binding.key !== 'Enter' && binding.run !== transposeChars
        && binding.run !== splitLine && binding.run !== deleteToLineEnd)
    ])
  ];
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
