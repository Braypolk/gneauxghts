import type { NotepadState } from '../state/noteStore';
import type { NoteDraftState } from './documentState';

/** Ephemeral admission belongs to the existing document owner, never chat history. */
const workspaces = new WeakMap<NotepadState, symbol>();
const documents = new WeakMap<NoteDraftState, symbol>();
const adopting = new WeakSet<NoteDraftState>();

export class DocumentPublicationBlocked extends Error {
  readonly code = 'editorConflict';
  constructor(message = 'A note publication is settling. Try again when it finishes.') {
    super(message);
    this.name = 'DocumentPublicationBlocked';
  }
}

export function assertDocumentMutationAdmitted(document: NoteDraftState) {
  if (documents.has(document) && !adopting.has(document)) throw new DocumentPublicationBlocked();
}

export function assertWorkspaceMutationAdmitted(state: NotepadState) {
  if (workspaces.has(state)) throw new DocumentPublicationBlocked();
}

export function isDocumentPublicationActive(state: NotepadState) {
  return workspaces.has(state);
}

/** The owner holds this across queue joining, native settlement and adoption. */
export function acquireDocumentPublicationAdmission(state: NotepadState, targets: NoteDraftState[]) {
  assertWorkspaceMutationAdmitted(state);
  const token = Symbol('canonical publication');
  workspaces.set(state, token);
  for (const document of targets) documents.set(document, token);
  let released = false;
  return {
    adopt<T>(document: NoteDraftState, apply: () => T): T {
      if (released || documents.get(document) !== token) throw new DocumentPublicationBlocked('Publication admission is no longer current.');
      adopting.add(document);
      try { return apply(); } finally { adopting.delete(document); }
    },
    release() {
      if (released) return;
      released = true;
      for (const document of targets) if (documents.get(document) === token) documents.delete(document);
      if (workspaces.get(state) === token) workspaces.delete(state);
    }
  };
}
