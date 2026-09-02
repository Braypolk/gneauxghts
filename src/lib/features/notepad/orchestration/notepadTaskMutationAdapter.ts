import {
  createOpenDocumentTaskMutationHandler,
  type OpenDocumentTaskMutationDeps
} from '$lib/features/tasks/openDocumentTaskMutation';
import {
  getDocumentNoteId,
  getDocumentPath,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/document/documentState';
import type { NoteSaveSource } from '$lib/features/notepad/session/session';

export interface NotepadTaskMutationAdapterDeps {
  listReferencedNoteKeys: () => NoteKey[];
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  replaceMarkdown: (
    document: NoteDraftState,
    markdown: string,
    applyToRuntime: (markdown: string) => Promise<void>,
    options: { autosave: false }
  ) => Promise<unknown>;
  replaceDocumentContentInPlace: (
    document: NoteDraftState,
    markdown: string
  ) => Promise<unknown>;
  enqueueSave: (
    document: NoteDraftState,
    saveSource?: NoteSaveSource
  ) => Promise<void>;
  prepare?: OpenDocumentTaskMutationDeps['prepare'];
  hashMarkdown?: OpenDocumentTaskMutationDeps['hashMarkdown'];
}

export function findReferencedDocumentByIdentity(
  deps: Pick<
    NotepadTaskMutationAdapterDeps,
    'listReferencedNoteKeys' | 'getNoteByKey'
  >,
  noteId: string,
  notePath: string
) {
  const referenced = deps
    .listReferencedNoteKeys()
    .map(deps.getNoteByKey)
    .filter(
      (document): document is NoteDraftState =>
        document !== null
    );

  return (
    referenced.find(
      (document) => getDocumentNoteId(document) === noteId
    ) ??
    referenced.find(
      (document) => getDocumentPath(document) === notePath
    ) ??
    null
  );
}

/**
 * Adapts the task feature's narrow gateway to notepad document services without
 * exposing workspace or editor internals to the task store.
 */
export function createNotepadTaskMutationHandler(
  deps: NotepadTaskMutationAdapterDeps
) {
  return createOpenDocumentTaskMutationHandler({
    findReferencedDocument: (noteId, notePath) =>
      findReferencedDocumentByIdentity(
        deps,
        noteId,
        notePath
      ),
    replaceMarkdown: (document, markdown) =>
      deps.replaceMarkdown(
        document,
        markdown,
        async (currentMarkdown) => {
          await deps.replaceDocumentContentInPlace(
            document,
            currentMarkdown
          );
        },
        { autosave: false }
      ).then(() => undefined),
    saveDocument: (document) =>
      deps.enqueueSave(document, 'taskAction'),
    prepare: deps.prepare,
    hashMarkdown: deps.hashMarkdown
  });
}
