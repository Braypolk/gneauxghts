import type { EditorView } from '@codemirror/view';
import { createEditorMenuBridge } from '$lib/features/notepad/editor/editorMenuBridge';
import type { SelectionMenuSnapshot } from '$lib/features/notepad/editor/selectionMenu';

const bridge = createEditorMenuBridge<SelectionMenuSnapshot>();

export const bindSelectionMenuViewToPane = bridge.bindViewToPane;
export const unbindSelectionMenuView = bridge.unbindView;
export const getPaneIdForSelectionMenuView = bridge.getPaneIdForView;
export const setSelectionMenuListener = bridge.setListener;

export function emitSelectionMenuUpdate(view: EditorView, snapshot: SelectionMenuSnapshot) {
  bridge.emitUpdate(view, snapshot);
}
