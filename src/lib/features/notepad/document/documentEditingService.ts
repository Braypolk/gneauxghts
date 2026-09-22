import {
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
  isDocumentOperationCurrent,
  resolveConflictUsingExternal,
  restoreTransientDraftToDocument,
  updateDocumentMarkdown,
  updateDocumentTitle,
  updateDocumentTags,
  tagsEqual,
  type NoteDraftState
} from './documentState';
import type { ForgottenNote, TagEdit } from '$lib/features/notepad/session/session';
import type { NoteSession } from '$lib/features/notepad/model/types';
import {
  adoptCommittedDocument,
  findOpenDocument,
  synchronizeDocumentCanonicalLookup,
  type NotepadState
} from '$lib/features/notepad/state/noteStore';
import { documentRegistry } from './documentRegistry';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';

export interface DocumentSaveCapture {
  readonly document: NoteDraftState;
  readonly operationToken: number;
  readonly revision: number;
  readonly title: string;
  readonly markdown: string;
  readonly tags: string[];
  readonly tagEdit?: TagEdit;
  readonly noteId: string | null;
  readonly path: string | null;
}

export type VersionRestoreAdoption =
  | { kind: 'adopted'; document: NoteDraftState }
  | { kind: 'notOpen' };

export interface DocumentEditingServiceDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  isApplyingProgrammaticUpdate: (document: NoteDraftState) => boolean;
  shouldSuppressAutosave: (document: NoteDraftState) => boolean;
  isTitleEditing: (document: NoteDraftState) => boolean;
  resetPaneCommandAfterBodyInput: (
    paneId: TPaneId,
    nextMarkdown: string
  ) => void;
  clearRecentlyForgotten: () => void;
  clearSelectedRelatedText: () => void;
  scheduleAutosave: (document: NoteDraftState) => void;
  scheduleSearch: () => void;
  scheduleRelated: (options?: { immediate?: boolean }) => void;
}

/**
 * Owns synchronization between the document model and its shared editor root.
 * Saved baseline, live Markdown, and undo history remain distinct facts; this
 * boundary applies operation-specific adoption policy across them.
 */
export function createDocumentEditingService<TPaneId extends string>(
  deps: DocumentEditingServiceDeps<TPaneId>
) {
  function refreshDerivedViews() {
    deps.scheduleSearch();
    deps.scheduleRelated({ immediate: true });
  }

  function resetCommittedRuntime(
    document: NoteDraftState,
    markdown: string
  ) {
    documentRegistry
      .get(document.handle)
      ?.resources()
      ?.runtime.adoptCommittedMarkdown(markdown);
  }

  function restoreTransientRuntime(
    document: NoteDraftState,
    markdown: string
  ) {
    documentRegistry
      .get(document.handle)
      ?.resources()
      ?.runtime.restoreTransientMarkdown(markdown);
  }

  function captureSave(document: NoteDraftState): DocumentSaveCapture {
    return {
      document,
      operationToken: document.operation.token,
      revision: document.operation.revision,
      title: getDocumentTitle(document),
      markdown: getDocumentMarkdown(document),
      tags: [...(document.working.tags ?? [])],
      ...(!tagsEqual(document.working.tags, document.savedBaseline?.content.tags) ? {
        tagEdit: { previous: [...(document.savedBaseline?.content.tags ?? [])], tags: [...(document.working.tags ?? [])] }
      } : {}),
      noteId: getDocumentNoteId(document),
      path: getDocumentPath(document)
    };
  }

  async function adoptSavedResult(
    capture: DocumentSaveCapture,
    committed: NoteSession
  ): Promise<NoteDraftState | null> {
    const document = capture.document;
    if (
      !isDocumentOperationCurrent(
        document,
        capture.operationToken
      )
    ) {
      return null;
    }
    const preserveWorking =
      document.operation.revision !== capture.revision ||
      getDocumentTitle(document) !== capture.title ||
      !tagsEqual(document.working.tags, capture.tags) ||
      getDocumentMarkdown(document) !== capture.markdown ||
      getDocumentNoteId(document) !== capture.noteId ||
      getDocumentPath(document) !== capture.path ||
      deps.isTitleEditing(document);
    const previousMarkdown = getDocumentMarkdown(document);
    adoptCommittedDocument(deps.state, document, committed, {
      preserveWorking,
      preserveTags: preserveWorking && !tagsEqual(document.working.tags, capture.tags)
    });
    if (getDocumentMarkdown(document) !== previousMarkdown) {
      resetCommittedRuntime(
        document,
        document.working.markdown
      );
    }
    return document;
  }

  async function adoptVersionRestore(
    committed: NoteSession
  ): Promise<VersionRestoreAdoption> {
    if (!committed.noteId) {
      throw new Error(
        'The committed restore returned no Note Identity.'
      );
    }
    const openDocument = findOpenDocument(deps.state, {
      noteId: committed.noteId,
      path: committed.path
    });
    if (!openDocument) {
      return { kind: 'notOpen' };
    }
    const document = openDocument;
    adoptCommittedDocument(deps.state, document, committed);
    // A Version Restore is an authored boundary even when only unmanaged
    // properties changed and the rendered body is byte-identical.
    resetCommittedRuntime(document, committed.markdown);
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return { kind: 'adopted', document };
  }

  async function adoptAcceptedProposal(
    document: NoteDraftState,
    committed: NoteSession,
    committedMarkdown: string,
    commitWarning: CommittedMutationWarning | null
  ) {
    const authoritative = {
      ...committed,
      commitWarning: commitWarning ?? undefined
    };
    const preserveWorking =
      getDocumentMarkdown(document) !== committedMarkdown ||
      getDocumentTitle(document) !== committed.title ||
      !tagsEqual(document.working.tags, document.savedBaseline?.content.tags);
    const previousMarkdown = getDocumentMarkdown(document);
    adoptCommittedDocument(deps.state, document, authoritative, {
      preserveWorking
    });
    if (getDocumentMarkdown(document) !== previousMarkdown) {
      resetCommittedRuntime(
        document,
        document.working.markdown
      );
    }
    if (
      preserveWorking &&
      !deps.shouldSuppressAutosave(document)
    ) {
      deps.scheduleAutosave(document);
    }
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return document;
  }

  async function adoptCleanExternalRefresh(
    document: NoteDraftState,
    committed: NoteSession
  ) {
    const previousMarkdown = getDocumentMarkdown(document);
    adoptCommittedDocument(deps.state, document, committed);
    if (getDocumentMarkdown(document) !== previousMarkdown) {
      resetCommittedRuntime(
        document,
        document.working.markdown
      );
    }
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return document;
  }

  function restoreTransientForgotten(
    document: NoteDraftState,
    forgotten: ForgottenNote
  ) {
    const result = restoreTransientDraftToDocument(document, {
      title: forgotten.title,
      ...(forgotten.tags ? { tags: [...forgotten.tags] } : {}),
      ...(forgotten.tagsError ? { tagsError: forgotten.tagsError } : {}),
      markdown: forgotten.bodyMarkdown
    }, {
      noteId: forgotten.currentNoteId,
      path: forgotten.currentNotePath
    });
    synchronizeDocumentCanonicalLookup(deps.state, document);
    restoreTransientRuntime(document, document.working.markdown);
    if (!deps.shouldSuppressAutosave(document)) {
      deps.scheduleAutosave(document);
    }
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return result;
  }

  function resolveUsingExternal(
    document: NoteDraftState,
    conflictId: number
  ) {
    const resolved = resolveConflictUsingExternal(document, conflictId);
    if (resolved) {
      synchronizeDocumentCanonicalLookup(deps.state, document);
    }
    return resolved;
  }

  async function applyRuntimeAtCurrentRevision(
    document: NoteDraftState,
    applyToRuntime: (markdown: string) => Promise<void>
  ) {
    const appliedRevision = document.operation.revision;
    await applyToRuntime(document.working.markdown);
    if (document.operation.revision !== appliedRevision) {
      // The first effect waited behind a pane operation while a newer edit
      // became canonical. Reconcile the runtime to that newer model instead
      // of allowing the queued replacement to win afterward.
      await applyToRuntime(document.working.markdown);
    }
  }

  function applyMarkdownProjection(
    document: NoteDraftState,
    markdown: string
  ): boolean {
    return updateDocumentMarkdown(document, markdown);
  }

  function recordUserEdit(
    paneId: TPaneId,
    document: NoteDraftState,
    markdown: string
  ): boolean {
    // Programmatic editor replacements update the model at their orchestration
    // boundary. Their CodeMirror callback is only an acknowledgement and must
    // not publish an intermediate model state before that boundary commits.
    if (deps.isApplyingProgrammaticUpdate(document)) {
      return false;
    }

    const changed = applyMarkdownProjection(document, markdown);
    if (changed) {
      deps.resetPaneCommandAfterBodyInput(paneId, markdown);
    }

    const suppressAutosave = deps.shouldSuppressAutosave(document);
    if (!suppressAutosave && markdown.trim() !== '') {
      deps.clearRecentlyForgotten();
    }
    if (!suppressAutosave) {
      deps.scheduleAutosave(document);
    }
    deps.scheduleSearch();
    deps.scheduleRelated();
    return changed;
  }

  async function replaceMarkdown(
    document: NoteDraftState,
    markdown: string,
    applyToRuntime: (markdown: string) => Promise<void>,
    {
      autosave = true,
      immediateRelated = true
    }: { autosave?: boolean; immediateRelated?: boolean } = {}
  ): Promise<boolean> {
    const changed = applyMarkdownProjection(document, markdown);
    await applyRuntimeAtCurrentRevision(
      document,
      applyToRuntime
    );
    if (autosave && !deps.shouldSuppressAutosave(document)) {
      deps.scheduleAutosave(document);
    }
    deps.scheduleSearch();
    deps.scheduleRelated(immediateRelated ? { immediate: true } : undefined);
    return changed;
  }

  function updateTags(document: NoteDraftState, tags: string[]): boolean {
    if (document.working.tagsError || deps.shouldSuppressAutosave(document)) return false;
    const changed = updateDocumentTags(document, tags);
    if (changed) {
      deps.clearRecentlyForgotten();
      deps.scheduleAutosave(document);
      deps.scheduleSearch();
    }
    return changed;
  }

  function updateTitle(document: NoteDraftState, title: string): boolean {
    return updateDocumentTitle(document, title);
  }

  return {
    captureSave,
    adoptSavedResult,
    adoptVersionRestore,
    adoptAcceptedProposal,
    adoptCleanExternalRefresh,
    restoreTransientForgotten,
    resolveUsingExternal,
    recordUserEdit,
    replaceMarkdown,
    updateTitle,
    updateTags
  };
}

export type DocumentEditingService<TPaneId extends string> = ReturnType<
  typeof createDocumentEditingService<TPaneId>
>;
