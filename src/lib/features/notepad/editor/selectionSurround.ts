import { isMarkdownCode } from '../markdown/codeContext';
import { EditorView } from '@codemirror/view';
import { dispatchEditorChange } from '$lib/features/notepad/editor/editorDispatch';

interface SurroundSpec {
  before: string;
  after: string;
}

/** Typing these characters with a non-empty selection wraps instead of replacing. */
const SURROUND_BY_CHAR: Record<string, SurroundSpec> = {
  '*': { before: '*', after: '*' },
  _: { before: '_', after: '_' },
  '`': { before: '`', after: '`' },
  '(': { before: '(', after: ')' },
  '{': { before: '{', after: '}' },
  '"': { before: '"', after: '"' },
  "'": { before: "'", after: "'" },
  '[': { before: '[', after: ']()' },
  '~': { before: '~~', after: '~~' },
  '=': { before: '==', after: '==' },
  '%': { before: '%%', after: '%%' }
};

function selectionAfterWrap(
  from: number,
  to: number,
  selectedLength: number,
  spec: SurroundSpec,
  trigger: string
): { anchor: number; head: number } {
  if (trigger === '[') {
    const urlStart = from + spec.before.length + selectedLength + 2;
    return { anchor: urlStart, head: urlStart };
  }

  return {
    anchor: from + spec.before.length,
    head: to + spec.before.length
  };
}

export function surroundSelection(view: EditorView, trigger: string): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return surroundRange(view, selection.from, selection.to, trigger);
  }

  return false;
}

export function surroundRange(
  view: EditorView,
  from: number,
  to: number,
  trigger: string
): boolean {
  if (from === to || trigger.length !== 1) {
    return false;
  }

  const spec = SURROUND_BY_CHAR[trigger];
  if (!spec) {
    return false;
  }

  if (isMarkdownCode(view.state, from, to)) {
    return false;
  }

  const selected = view.state.sliceDoc(from, to);
  const insert = `${spec.before}${selected}${spec.after}`;
  const mappedSelection = selectionAfterWrap(from, to, selected.length, spec, trigger);

  return dispatchEditorChange(view, {
    changes: { from, to, insert },
    selection: mappedSelection,
    scrollIntoView: true
  });
}

export function createSelectionSurroundExtension() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (from === to || text.length !== 1) {
      return false;
    }

    return surroundRange(view, from, to, text);
  });
}
