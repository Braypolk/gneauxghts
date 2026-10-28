import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { letterListLabel } from '../markdown/letterListExtension';

function letterItemAt(state: EditorState, pos: number) {
  const tree = ensureSyntaxTree(state, pos, 25);
  let item = null;
  for (let node = tree?.resolveInner(pos, -1); node; node = node.parent ?? undefined) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
    if (!item && node.name === 'ListItem') item = node;
    // CodeMirror's native commands do not include LetterList ancestors in
    // their context. Handle the innermost item of any type in that subtree.
    if (node.name === 'LetterList') return item;
  }
  return null;
}

function labelIndex(label: string) {
  return [...label].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 96, 0) - 1;
}

export function continueLetterList(view: EditorView): boolean {
  const { state } = view;
  let declined = false;
  const transaction = state.changeByRange(range => {
    const item = range.empty ? letterItemAt(state, range.head) : null;
    const mark = item?.getChild('ListMark');
    const line = state.doc.lineAt(range.head);
    if (!item || !mark || state.doc.lineAt(mark.from).number !== line.number) {
      declined = true;
      return { range };
    }
    const afterMark = line.text.slice(mark.to - line.from).match(/^[\t ]*(?:\[[ xX]\][\t ]+)?/)?.[0] ?? '';
    const contentFrom = mark.to + afterMark.length;
    if (range.head < contentFrom) {
      declined = true;
      return { range };
    }
    const prefix = state.sliceDoc(line.from, mark.from).replace(/[^>\t ]/g, ' ');
    if (contentFrom === line.to) {
      // Match the existing empty-list behavior, retaining any enclosing quote.
      const insert = prefix.includes('>') ? prefix : '';
      return { changes: { from: line.from, to: line.to, insert },
        range: EditorSelection.cursor(line.from + insert.length) };
    }
    const marker = state.sliceDoc(mark.from, mark.to);
    const type = item.parent!.name;
    const index = type === 'LetterList' ? labelIndex(marker.slice(0, -1))
      : type === 'OrderedList' ? Number.parseInt(marker, 10) - 1 : 0;
    const markerAt = (index: number) => type === 'LetterList' ? letterListLabel(index) + '.'
      : type === 'OrderedList' ? `${index + 1}${marker.at(-1)}` : marker;
    const task = /\[[ xX]\]/.test(afterMark) ? '[ ] ' : '';
    const insert = state.lineBreak + prefix + markerAt(index + 1) + ' ' + task;
    const changes: ChangeSpec[] = [{ from: range.head, insert }];
    let expected = index + 1;
    for (let sibling = type === 'BulletList' ? null : item.nextSibling; sibling; sibling = sibling.nextSibling) {
      const nextMark = sibling.getChild('ListMark');
      if (!nextMark || state.sliceDoc(nextMark.from, nextMark.to) !== markerAt(expected)) break;
      changes.push({ from: nextMark.from, to: nextMark.to, insert: markerAt(expected + 1) });
      expected++;
    }
    return { changes, range: EditorSelection.cursor(range.head + insert.length) };
  });
  if (declined) return false;
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

export function deleteLetterListMarkup(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty || view.state.selection.ranges.length !== 1) return false;
  const item = letterItemAt(view.state, selection.head);
  const mark = item?.getChild('ListMark');
  if (!mark) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (selection.head < mark.to || !/^[\t ]*$/.test(view.state.sliceDoc(mark.to, selection.head))) return false;
  view.dispatch(view.state.update({
    changes: { from: mark.from, to: selection.head },
    selection: { anchor: mark.from }, userEvent: 'delete.backward'
  }));
  return true;
}
