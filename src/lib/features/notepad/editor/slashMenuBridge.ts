import type { EditorView } from '@codemirror/view';
import type { SlashMenuSnapshot } from '$lib/features/notepad/editor/slashMenu';

const viewToPaneId = new WeakMap<EditorView, string>();

export function bindSlashMenuViewToPane(view: EditorView, paneId: string) {
  viewToPaneId.set(view, paneId);
}

export function unbindSlashMenuView(view: EditorView) {
  viewToPaneId.delete(view);
}

export function getPaneIdForSlashMenuView(view: EditorView): string | undefined {
  return viewToPaneId.get(view);
}

type Listener = (view: EditorView, snapshot: SlashMenuSnapshot) => void;

let listener: Listener | null = null;

export function setSlashMenuListener(fn: Listener | null) {
  listener = fn;
}

export function emitSlashMenuUpdate(view: EditorView, snapshot: SlashMenuSnapshot) {
  listener?.(view, snapshot);
}
