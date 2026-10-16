import type { EditorView } from '@codemirror/view';

/** Fixture setup uses ordinary editor selection transactions. Do not alter
 * evidence/history policy to make a source-free compaction journey grow. */
export function collapseFollowonsEditorSelections(views: readonly Pick<EditorView, 'state' | 'dispatch'>[]) {
  let selectedBefore = 0;
  for (const view of views) {
    if (view.state.selection.ranges.some(range => !range.empty)) {
      selectedBefore++;
      view.dispatch({ selection: { anchor: view.state.selection.main.head } });
    }
  }
  if (views.some(view => view.state.selection.ranges.some(range => !range.empty)))
    throw new Error('Source-free follow-on warmups still have selected editor content');
  return { editorCount: views.length, selectedBefore, selectedAfter: 0 };
}
