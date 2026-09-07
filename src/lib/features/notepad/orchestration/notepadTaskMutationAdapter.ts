import {
  createOpenDocumentTaskMutationHandler,
  type OpenDocumentTaskMutationDeps
} from '$lib/features/tasks/openDocumentTaskMutation';
import {
  getDocumentNoteId,
  getDocumentPath,
  type NoteDraftState,
  type DocumentHandle
} from '$lib/features/notepad/document/documentState';

export interface NotepadTaskMutationAdapterDeps {
  listReferencedDocumentHandles: () => DocumentHandle[];
  getDocumentByHandle: (documentHandle: DocumentHandle) => NoteDraftState | null;
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
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  attributeTaskActionSave: (
    document: NoteDraftState,
    expectedMarkdown: string
  ) => (() => void) | void;
  prepare?: OpenDocumentTaskMutationDeps['prepare'];
  hashMarkdown?: OpenDocumentTaskMutationDeps['hashMarkdown'];
}

export function findReferencedDocumentByIdentity(
  deps: Pick<
    NotepadTaskMutationAdapterDeps,
    'listReferencedDocumentHandles' | 'getDocumentByHandle'
  >,
  noteId: string,
  notePath: string
) {
  const referenced = deps
    .listReferencedDocumentHandles()
    .map(deps.getDocumentByHandle)
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
    saveDocument: deps.enqueueSave,
    attributeTaskActionSave: deps.attributeTaskActionSave,
    prepare: deps.prepare,
    hashMarkdown: deps.hashMarkdown
  });
}
