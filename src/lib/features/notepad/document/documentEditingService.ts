import { DocumentBody } from './documentBody';
import {
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
  isDocumentOperationCurrent,
  resolveConflictUsingExternal,
  restoreTransientDraftToDocument,
  updateDocumentMarkdown,
  updateDocumentBody,
  updateDocumentTitle,
  updateDocumentTags,
  tagsEqual,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  externalDocumentSnapshotFromCommittedNote,
  dispatchDocumentExternalSync,
  type NoteDraftState,
  type DocumentWorkingContent
} from './documentState';
import type { ForgottenNote, TagEdit } from '#lib/features/notepad/session/session.js';
import type { NoteSession } from '#lib/features/notepad/model/types.js';
import type { DraftBackup, DraftContent } from '../recovery/draftBackup';
import {
  adoptCommittedDocument,
  findOpenDocument,
  synchronizeDocumentCanonicalLookup,
  type NotepadState
} from '#lib/features/notepad/state/noteStore.js';
import { documentRegistry } from './documentRegistry';
import type { CommittedMutationWarning } from '#lib/contracts/committedMutation.js';
import { readNoteSession } from '../session/session';
import {
  acquireDocumentPublicationAdmission,
  assertDocumentMutationAdmitted,
  DocumentPublicationBlocked,
  isDocumentPublicationActive
} from './documentPublicationAdmission';

export interface AgentPublicationTarget { noteId: string | null; path: string; destinationPath?: string }
export interface AgentPublicationReceipt {
  noteId: string | null;
  path: string;
  markdown: string;
  commitWarning?: CommittedMutationWarning;
}
export interface AgentPublicationLease {
  /** Reconciliation may freeze dirty buffers; a new effect still requires a clean editor. */
  assertMutationReady(): void;
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
  readonly body: DocumentBody;
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
    body: DocumentBody
  ) => void;
  clearRecentlyForgotten: () => void;
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
  let retainedPublication: { key: string; run<T>(effect: (lease: AgentPublicationLease) => Promise<T>): Promise<T> } | null = null;

  async function withAgentPublication<T>(
    target: AgentPublicationTarget,
    effect: (lease: AgentPublicationLease) => Promise<T>
  ): Promise<T> {
    return withPublicationLease(target, effect, false);
  }

  async function withAgentPublicationReconciliation<T>(target: AgentPublicationTarget, effect: (lease: AgentPublicationLease) => Promise<T>) {
    if (!target.noteId || !target.destinationPath) throw new DocumentPublicationBlocked('Reconciled rename admission requires both locations and the retained note identity.');
    return withPublicationLease(target, effect, true);
  }

  async function withPublicationLease<T>(
    target: AgentPublicationTarget,
    effect: (lease: AgentPublicationLease) => Promise<T>,
    reconciling: boolean
  ): Promise<T> {
    const targetKey = JSON.stringify([target.noteId, target.path, target.destinationPath ?? null]);
    if (retainedPublication) {
      if (!reconciling || retainedPublication.key !== targetKey) throw new DocumentPublicationBlocked();
      return retainedPublication.run(effect);
    }
    const matchesTarget = (document: NoteDraftState) =>
      Boolean(target.noteId && getDocumentNoteId(document) === target.noteId) ||
      getDocumentPath(document) === target.path ||
      Boolean(target.destinationPath && getDocumentPath(document) === target.destinationPath);
    const targets = Object.values(deps.state.documentsByHandle).filter(matchesTarget);
    const identities = targets.map(document => ({ document, noteId: getDocumentNoteId(document), path: getDocumentPath(document) }));
    const hasReadyBuffer = (document: NoteDraftState) => {
      const root = documentRegistry.get(document.handle)?.resources()?.runtime;
      return documentHasCleanBuffer(document) && !documentHasUnresolvedConflict(document) &&
        !deps.isTitleEditing(document) && !deps.isApplyingProgrammaticUpdate(document) &&
        ['idle', 'saving'].includes(document.operation.kind) &&
        (!root || root.body.equals(document.working.body));
    };
    const requireReady = () => {
      if (!reconciling && deps.isWorkspaceOperationPending?.()) throw new DocumentPublicationBlocked('Wait for the current workspace operation to finish.');
      for (const captured of identities) {
        const { document } = captured;
        if (deps.state.documentsByHandle[document.handle] !== document ||
          getDocumentNoteId(document) !== captured.noteId || getDocumentPath(document) !== captured.path ||
          (!reconciling && !hasReadyBuffer(document))) {
          throw new DocumentPublicationBlocked('Save or resolve the existing editor changes before applying this mutation.');
        }
      }
    };
    requireReady();
    const admission = acquireDocumentPublicationAdmission(deps.state, targets);
    const releaseRoots: Array<() => void> = [];
    let retained = false;
    let released = false;
    let enteredEffect = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const releaseRoot of releaseRoots.reverse()) releaseRoot();
      admission.release();
      retainedPublicationRelease = null;
      retainedPublication = null;
      deps.publicationAdmissionChanged?.(false);
    };
    const lease: AgentPublicationLease = {
      assertMutationReady() {
        requireReady();
        if (deps.isWorkspaceOperationPending?.() || targets.some(document => !hasReadyBuffer(document) || document.operation.kind !== 'idle')) {
          throw new DocumentPublicationBlocked('Save or resolve the existing editor changes before applying this mutation.');
        }
      },
      retainUntilSettled() {
        retained = true;
        retainedPublicationRelease = release;
        retainedPublication = { key: targetKey, run: runEffect };
      },
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
            lease.retainUntilSettled(); throw error;
          }
        }
      },
      async adopt(receipt) {
        if (released || receipt.path !== (target.destinationPath ?? target.path) || (target.noteId && receipt.noteId !== target.noteId)) {
          if (target.destinationPath && !released) lease.retainUntilSettled();
          throw new DocumentPublicationBlocked('The committed target differs from publication admission.');
        }
        // Destination buffers are protected by the lease, but a different
        // identity must never be turned into the renamed source document.
        const adoptionTargets = target.destinationPath
          ? targets.filter(document => getDocumentNoteId(document) === target.noteId)
          : targets;
        if (!adoptionTargets.length) return 'notOpen';
        let current: NoteSession;
        try { current = await (deps.readPublicationSession ?? readNoteSession)(receipt.noteId, receipt.path); }
        catch (error) { if (target.destinationPath) lease.retainUntilSettled(); throw error; }
        const matchesReceipt = current.noteId === receipt.noteId && current.path === receipt.path && current.markdown === receipt.markdown;
        if (!matchesReceipt && !target.destinationPath) {
          for (const document of adoptionTargets) dispatchDocumentExternalSync(document, {
            type: 'externalCaptured', external: {
              kind: 'snapshot', source: 'watcher', document: externalDocumentSnapshotFromCommittedNote(current)
            }
          });
          return 'conflict';
        }
        if (current.noteId !== receipt.noteId || current.path !== receipt.path) {
          lease.retainUntilSettled();
          throw new DocumentPublicationBlocked('The renamed note could not be located under its committed identity.');
        }
        requireReady();
        let conflict = false;
        for (const document of adoptionTargets) admission.adopt(document, () => {
          const preserveWorking = Boolean(target.destinationPath && (!matchesReceipt || !hasReadyBuffer(document)));
          const untouchedTitle = !deps.isTitleEditing(document) && document.working.title === document.savedBaseline?.content.title;
          if (preserveWorking) {
            const root = documentRegistry.get(document.handle)?.resources()?.runtime;
            if (root && !root.body.equals(document.working.body)) updateDocumentBody(document, root.body);
          }
          adoptCommittedDocument(deps.state, document, { ...current, commitWarning: receipt.commitWarning }, { preserveWorking });
          if (preserveWorking) {
            if (untouchedTitle) updateDocumentTitle(document, current.title);
            dispatchDocumentExternalSync(document, { type: 'externalCaptured', external: {
              kind: 'snapshot', source: 'watcher', document: externalDocumentSnapshotFromCommittedNote(current)
            } });
            conflict = true;
          }
          // A filename-only effect leaves pane selections and shared Undo
          // intact; it does not publish a new authored content state.
          if (!target.destinationPath) resetCommittedRuntime(document, document.working.body);
        });
        refreshDerivedViews();
        return conflict ? 'conflict' : 'adopted';
      }
    };
    async function runEffect<TResult>(effect: (lease: AgentPublicationLease) => Promise<TResult>): Promise<TResult> {
      retained = false;
      let ready = false;
      try { requireReady(); ready = true; return await effect(lease); }
      catch (error) { if (reconciling && !ready) lease.retainUntilSettled(); throw error; }
      finally { if (!retained) release(); }
    }
    try {
      // Freeze before awaiting pending writes; their canonical adoption may finish.
      for (const document of targets) {
        const runtime = documentRegistry.ensure(document.handle);
        releaseRoots.push(runtime.acquirePublicationLease());
        runtime.clearSaveTimer();
      }
      deps.publicationAdmissionChanged?.(true);
      const saves = await Promise.allSettled(targets.map(document => documentRegistry.get(document.handle)!.getSaveQueue()));
      for (const save of saves) {
        // A queued save can be refused by this lease, or an already-started
        // save can fail its native location guard after the earlier move.
        // Both have settled; read-only proof still needs to locate that move.
        if (save.status === 'rejected' && !reconciling) throw save.reason;
      }
      requireReady();
      if (targets.some(document => document.operation.kind !== 'idle' &&
        !(reconciling && document.operation.kind === 'failed' && document.operation.failedOperation === 'saving'))) {
        throw new DocumentPublicationBlocked('An editor operation has not settled.');
      }
      enteredEffect = true;
      return await runEffect(effect);
    } catch (error) {
      if (reconciling && !enteredEffect) lease.retainUntilSettled();
      throw error;
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
    body: DocumentBody
  ) {
    documentRegistry
      .get(document.handle)
      ?.resources()
      ?.runtime.adoptCommittedBody(body);
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
    assertDocumentMutationAdmitted(document);
    const body = document.working.body;
    return {
      document,
      operationToken: document.operation.token,
      revision: document.operation.revision,
      title: getDocumentTitle(document),
      body,
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
      !document.working.body.equals(capture.body) ||
      getDocumentNoteId(document) !== capture.noteId ||
      getDocumentPath(document) !== capture.path ||
      deps.isTitleEditing(document);
    const previousBody = document.working.body;
    adoptCommittedDocument(deps.state, document, committed, {
      preserveWorking,
      preserveTags: preserveWorking && !tagsEqual(document.working.tags, capture.tags)
    });
    if (document.savedBaseline?.content.body.equals(capture.body)) {
      document.savedBaseline.content.body = capture.body;
    }
    if (!document.working.body.equals(previousBody)) {
      resetCommittedRuntime(
        document,
        document.working.body
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
    resetCommittedRuntime(document, document.working.body);
    deps.clearRecentlyForgotten();
    refreshDerivedViews();
    return { kind: 'adopted', document };
  }

  function adoptCleanExternalRefresh(
    document: NoteDraftState,
    committed: NoteSession
  ) {
    assertDocumentMutationAdmitted(document);
    const previousBody = document.working.body;
    adoptCommittedDocument(deps.state, document, committed);
    if (!document.working.body.equals(previousBody)) {
      resetCommittedRuntime(
        document,
        document.working.body
      );
    }
    deps.clearRecentlyForgotten();
    refreshDerivedViews();
    return document;
  }

  function restoreTransientForgotten(
    document: NoteDraftState,
    forgotten: ForgottenNote
  ) {
    return restoreTransientContent(document, {
      title: forgotten.title,
      ...(forgotten.tags ? { tags: [...forgotten.tags] } : {}),
      ...(forgotten.tagsError ? { tagsError: forgotten.tagsError } : {}),
      body: DocumentBody.fromMarkdown(forgotten.bodyMarkdown)
    }, {
      noteId: forgotten.currentNoteId,
      path: forgotten.currentNotePath
    });
  }

  function restoreRecoveryDraft(document: NoteDraftState, backup: DraftBackup) {
    assertDocumentMutationAdmitted(document);
    const noteId = getDocumentNoteId(document), path = getDocumentPath(document);
    if (backup.sourceNoteId ? noteId !== backup.sourceNoteId : noteId || path || backup.sourcePath) {
      throw new Error('Recovery requires the original note or an empty never-saved draft.');
    }
    if (document.operation.kind !== 'idle' || deps.isTitleEditing(document) ||
      document.canonicalCollision || documentHasUnresolvedConflict(document)) {
      throw new Error('Finish the current editor operation before recovering work.');
    }
    const matches = (saved: DraftContent, content: DocumentWorkingContent) =>
      saved.title === content.title && content.body.equals(DocumentBody.fromMarkdown(saved.markdown)) &&
      tagsEqual(saved.tags, content.tags) && (saved.tagsError ?? null) === (content.tagsError ?? null);
    // A save may have committed just before the interruption. Do not replay it.
    if (matches(backup, document.working)) return;
    if (!documentHasCleanBuffer(document)) throw new Error('Save or resolve current edits before recovering earlier work.');
    const baseline = document.savedBaseline;
    if (backup.sourceNoteId && !baseline) throw new Error('The original saved note must be opened before recovery.');
    const warning = document.publication.warning;
    const changed = Boolean(backup.sourceNoteId && (!backup.baseline || !baseline || !matches(backup.baseline, baseline.content)));
    const result = restoreTransientDraftToDocument(document, {
      title: backup.title, body: DocumentBody.fromMarkdown(backup.markdown), tags: [...backup.tags],
      ...(backup.tagsError ? { tagsError: backup.tagsError } : {})
    }, { noteId, path });
    document.savedBaseline = baseline;
    document.publication.warning = warning;
    synchronizeDocumentCanonicalLookup(deps.state, document);
    restoreTransientRuntime(document, document.working.body.toMarkdown());
    if (changed && baseline) dispatchDocumentExternalSync(document, {
      type: 'externalCaptured', external: { kind: 'snapshot', source: 'recovery',
        document: { content: baseline.content, identity: baseline.identity, savedBaseline: baseline } }
    });
    // Uncertain/changed saved bases require the ordinary conflict choice first.
    if (!changed) deps.scheduleAutosave(document);
    deps.clearRecentlyForgotten();
    refreshDerivedViews();
    return result;
  }

  function restoreTransientContent(document: NoteDraftState, content: DocumentWorkingContent,
    identity: { noteId: string | null; path: string | null }) {
    assertDocumentMutationAdmitted(document);
    const result = restoreTransientDraftToDocument(document, content, identity);
    synchronizeDocumentCanonicalLookup(deps.state, document);
    restoreTransientRuntime(document, document.working.body.toMarkdown());
    deps.scheduleAutosave(document);
    deps.clearRecentlyForgotten();
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
    await applyToRuntime(document.working.body.toMarkdown());
    if (document.operation.revision !== appliedRevision) {
      // The first effect waited behind a pane operation while a newer edit
      // became canonical. Reconcile the runtime to that newer model instead
      // of allowing the queued replacement to win afterward.
      await applyToRuntime(document.working.body.toMarkdown());
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
    body: DocumentBody
  ): boolean {
    // Programmatic editor replacements update the model at their orchestration
    // boundary. Their CodeMirror callback is only an acknowledgement and must
    // not publish an intermediate model state before that boundary commits.
    if (deps.isApplyingProgrammaticUpdate(document)) {
      return false;
    }

    const changed = updateDocumentBody(document, body);
    if (changed) {
      deps.resetPaneCommandAfterBodyInput(paneId, body);
    }

    if (body.hasContent()) {
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
    withAgentPublicationReconciliation,
    isAgentPublicationActive: () => isDocumentPublicationActive(deps.state),
    releaseSettledAgentPublication,
    captureSave,
    adoptSavedResult,
    adoptVersionRestore,
    adoptCleanExternalRefresh,
    restoreTransientForgotten,
    restoreRecoveryDraft,
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
