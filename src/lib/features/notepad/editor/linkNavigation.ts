import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

export function moveThroughLink(view: EditorView, direction: 'forward' | 'backward' = 'forward'): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty || state.selection.ranges.length !== 1) {
    return false;
  }

  const tree = ensureSyntaxTree(state, selection.head, 25);
  if (!tree) {
    return false;
  }

  let target: number | null = null;
  tree.iterate({
    from: selection.head,
    to: selection.head,
    enter(node) {
      if (node.name !== 'Link') {
        return;
      }

      const marks = node.node.getChildren('LinkMark');
      if (marks.length !== 4 || marks.map(mark => state.sliceDoc(mark.from, mark.to)).join('') !== '[]()') {
        return;
      }

      const [labelOpen, labelClose, urlOpen, urlClose] = marks;
      if (direction === 'forward' && selection.head >= labelOpen.to && selection.head <= labelClose.from) {
        target = urlClose.from;
      } else if (selection.head >= urlOpen.to && selection.head <= urlClose.from) {
        target = direction === 'backward' ? labelClose.from : urlClose.to;
      }
    }
  });

  if (target === null) {
    return false;
  }

  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  return true;
}
