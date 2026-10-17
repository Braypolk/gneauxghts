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
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  externalDocumentSnapshotFromCommittedNote,
  dispatchDocumentExternalSync,
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
import { readNoteSession } from '../session/session';
import {
  acquireDocumentPublicationAdmission,
  assertDocumentMutationAdmitted,
  DocumentPublicationBlocked,
  isDocumentPublicationActive
} from './documentPublicationAdmission';

export interface AgentPublicationTarget { noteId: string | null; path: string }
export interface AgentPublicationReceipt extends AgentPublicationTarget {
  markdown: string;
  commitWarning?: CommittedMutationWarning;
}
export interface AgentPublicationLease {
  adopt(receipt: AgentPublicationReceipt): Promise<'adopted' | 'notOpen' | 'conflict'>;
  captureCanonical(): Promise<void>;
  /** An unacknowledged native settlement keeps the owner protected. */
  retainUntilSettled(): void;
}

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
  publicationAdmissionChanged?: (active: boolean) => void;
  readPublicationSession?: typeof readNoteSession;
  isWorkspaceOperationPending?: () => boolean;
}

/**
 * Owns synchronization between the document model and its shared editor root.
 * Saved baseline, live Markdown, and undo history remain distinct facts; this
 * boundary applies operation-specific adoption policy across them.
 */
export function createDocumentEditingService<TPaneId extends string>(
  deps: DocumentEditingServiceDeps<TPaneId>
) {
  let retainedPublicationRelease: (() => void) | null = null;

  async function withAgentPublication<T>(
    target: AgentPublicationTarget,
    effect: (lease: AgentPublicationLease) => Promise<T>
  ): Promise<T> {
    const matchesTarget = (document: NoteDraftState) =>
      Boolean(target.noteId && getDocumentNoteId(document) === target.noteId) || getDocumentPath(document) === target.path;
    const targets = Object.values(deps.state.documentsByHandle).filter(matchesTarget);
    const identities = targets.map(document => ({ document, noteId: getDocumentNoteId(document), path: getDocumentPath(document) }));
    const requireReady = () => {
      if (deps.isWorkspaceOperationPending?.()) throw new DocumentPublicationBlocked('Wait for the current workspace operation to finish.');
      for (const captured of identities) {
        const { document } = captured;
        if (deps.state.documentsByHandle[document.handle] !== document ||
          getDocumentNoteId(document) !== captured.noteId || getDocumentPath(document) !== captured.path ||
          !documentHasCleanBuffer(document) || documentHasUnresolvedConflict(document) ||
          deps.isTitleEditing(document) ||
          deps.isApplyingProgrammaticUpdate(document) ||
          !['idle', 'saving'].includes(document.operation.kind)) {
          throw new DocumentPublicationBlocked('Save or resolve the existing editor changes before applying this mutation.');
        }
        const root = documentRegistry.get(document.handle)?.resources()?.runtime;
        if (root && root.markdown !== getDocumentMarkdown(document)) throw new DocumentPublicationBlocked('The live editor and saved document differ.');
      }
    };
    requireReady();
    const admission = acquireDocumentPublicationAdmission(deps.state, targets);
    const releaseRoots: Array<() => void> = [];
    let retained = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const releaseRoot of releaseRoots.reverse()) releaseRoot();
      admission.release();
      retainedPublicationRelease = null;
      deps.publicationAdmissionChanged?.(false);
    };
    try {
      // Freeze before awaiting pending writes; their canonical adoption may finish.
      for (const document of targets) {
        const runtime = documentRegistry.ensure(document.handle);
        releaseRoots.push(runtime.acquirePublicationLease());
        runtime.clearSaveTimer();
      }
      deps.publicationAdmissionChanged?.(true);
      await Promise.all(targets.map(document => documentRegistry.get(document.handle)!.getSaveQueue()));
      requireReady();
      if (targets.some(document => document.operation.kind !== 'idle')) throw new DocumentPublicationBlocked('An editor operation has not settled.');
      return await effect({
        retainUntilSettled() { retained = true; retainedPublicationRelease = release; },
        async captureCanonical() {
          for (const captured of identities) {
            if (!captured.noteId || !captured.path) continue;
            try {
              const current = await (deps.readPublicationSession ?? readNoteSession)(captured.noteId, captured.path);
              dispatchDocumentExternalSync(captured.document, { type: 'externalCaptured', external: {
                kind: 'snapshot', source: 'watcher', document: externalDocumentSnapshotFromCommittedNote(current)
              } });
            } catch (error) {
              // Settlement without a canonical observation must not expose a stale baseline to autosave.
              retained = true; retainedPublicationRelease = release; throw error;
            }
          }
        },
        async adopt(receipt) {
          if (released || receipt.path !== target.path || (target.noteId && receipt.noteId !== target.noteId)) {
            throw new DocumentPublicationBlocked('The committed target differs from publication admission.');
          }
          if (!targets.length) return 'notOpen';
          const current = await (deps.readPublicationSession ?? readNoteSession)(receipt.noteId, receipt.path);
          if (current.noteId !== receipt.noteId || current.path !== receipt.path || current.markdown !== receipt.markdown) {
            for (const document of targets) dispatchDocumentExternalSync(document, {
              type: 'externalCaptured', external: {
                kind: 'snapshot', source: 'watcher', document: externalDocumentSnapshotFromCommittedNote(current)
              }
            });
            return 'conflict';
          }
          requireReady();
          for (const document of targets) admission.adopt(document, () => {
            adoptCommittedDocument(deps.state, document, { ...current, commitWarning: receipt.commitWarning });
            resetCommittedRuntime(document, current.markdown);
          });
          refreshDerivedViews();
          return 'adopted';
        }
      });
    } finally { if (!retained) release(); }
  }

  /** Host calls this only after joining native owner/effect settlement. */
  function releaseSettledAgentPublication() { retainedPublicationRelease?.(); }

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
    assertDocumentMutationAdmitted(document);
    adoptCommittedDocument(deps.state, document, committed);
    // A Version Restore is an authored boundary even when only unmanaged
    // properties changed and the rendered body is byte-identical.
    resetCommittedRuntime(document, committed.markdown);
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return { kind: 'adopted', document };
  }

  function adoptCleanExternalRefresh(
    document: NoteDraftState,
    committed: NoteSession
  ) {
    assertDocumentMutationAdmitted(document);
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
    assertDocumentMutationAdmitted(document);
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
    deps.scheduleAutosave(document);
    deps.clearRecentlyForgotten();
    deps.clearSelectedRelatedText();
    refreshDerivedViews();
    return result;
  }

  function resolveUsingExternal(
    document: NoteDraftState,
    conflictId: number
  ) {
    assertDocumentMutationAdmitted(document);
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

    if (markdown.trim() !== '') {
      deps.clearRecentlyForgotten();
    }
    deps.scheduleAutosave(document);
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
    if (autosave) {
      deps.scheduleAutosave(document);
    }
    deps.scheduleSearch();
    deps.scheduleRelated(immediateRelated ? { immediate: true } : undefined);
    return changed;
  }

  function updateTags(document: NoteDraftState, tags: string[]): boolean {
    if (document.working.tagsError) return false;
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
    withAgentPublication,
    isAgentPublicationActive: () => isDocumentPublicationActive(deps.state),
    releaseSettledAgentPublication,
    captureSave,
    adoptSavedResult,
    adoptVersionRestore,
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
