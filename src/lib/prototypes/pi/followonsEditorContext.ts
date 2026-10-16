import type { EditorView } from '@codemirror/view';
import { nextEditorFrame } from '$lib/features/notepad/editor/editorPresentation';

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

/** Yield twice for selection effects, even when native frames are suspended.
 * This verifies the retained selection; it does not attest a physical paint. */
export async function settleFollowonsEditorSelections(views: readonly Pick<EditorView, 'state' | 'dispatch'>[]) {
  const setup = collapseFollowonsEditorSelections(views);
  await nextEditorFrame();
  await nextEditorFrame();
  if (views.some(view => view.state.selection.ranges.some(range => !range.empty)))
    throw new Error('Editor selection changed before source-free warmups');
  return setup;
}
