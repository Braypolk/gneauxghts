import {
  applySessionSnapshotToDocument,
  updateDocumentMarkdown,
  updateDocumentTitle,
  type NoteDraftState
} from './documentState';
import type { SessionSnapshot } from '$lib/features/notepad/session/session';

export interface DocumentEditingServiceDeps<TPaneId extends string> {
  isApplyingProgrammaticUpdate: (document: NoteDraftState) => boolean;
  shouldSuppressAutosave: (document: NoteDraftState) => boolean;
  resetPaneCommandAfterBodyInput: (
    paneId: TPaneId,
    nextMarkdown: string
  ) => void;
  clearRecentlyForgotten: () => void;
  scheduleAutosave: (document: NoteDraftState) => void;
  scheduleSearch: () => void;
  scheduleRelated: (options?: { immediate?: boolean }) => void;
}

/**
 * Coordinates the persistable note projection with editor-driven mutations.
 * CodeMirror remains the canonical live document; this service is the sole
 * place where interaction code advances the note operation revision.
 */
export function createDocumentEditingService<TPaneId extends string>(
  deps: DocumentEditingServiceDeps<TPaneId>
) {
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

  async function applySnapshot(
    document: NoteDraftState,
    snapshot: SessionSnapshot,
    applyMarkdownToRuntime: (markdown: string) => Promise<void>,
    {
      preserveDraft = false,
      autosave = false,
      scheduleDerived = true,
      immediateRelated = true
    }: {
      preserveDraft?: boolean;
      autosave?: boolean;
      scheduleDerived?: boolean;
      immediateRelated?: boolean;
    } = {}
  ) {
    const { titleChanged, markdownChanged } =
      applySessionSnapshotToDocument(document, snapshot, {
        preserveWorking: preserveDraft
      });
    if (markdownChanged) {
      await applyRuntimeAtCurrentRevision(
        document,
        applyMarkdownToRuntime
      );
    }
    if (
      autosave &&
      !deps.shouldSuppressAutosave(document)
    ) {
      deps.scheduleAutosave(document);
    }
    if (scheduleDerived) {
      deps.scheduleSearch();
      deps.scheduleRelated(
        immediateRelated ? { immediate: true } : undefined
      );
    }
    return { titleChanged, markdownChanged };
  }

  function updateTitle(document: NoteDraftState, title: string): boolean {
    return updateDocumentTitle(document, title);
  }

  return {
    recordUserEdit,
    replaceMarkdown,
    applySnapshot,
    updateTitle
  };
}

export type DocumentEditingService<TPaneId extends string> = ReturnType<
  typeof createDocumentEditingService<TPaneId>
>;
