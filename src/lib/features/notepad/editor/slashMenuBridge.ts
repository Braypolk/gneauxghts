import type { EditorView } from '@codemirror/view';
import { createEditorMenuBridge } from '$lib/features/notepad/editor/editorMenuBridge';
import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';

const bridge = createEditorMenuBridge<SlashMenuSnapshot>();

export const bindSlashMenuViewToPane = bridge.bindViewToPane;
export const unbindSlashMenuView = bridge.unbindView;
export const getPaneIdForSlashMenuView = bridge.getPaneIdForView;
export const setSlashMenuListener = bridge.setListener;

export function emitSlashMenuUpdate(view: EditorView, snapshot: SlashMenuSnapshot) {
  bridge.emitUpdate(view, snapshot);
}
