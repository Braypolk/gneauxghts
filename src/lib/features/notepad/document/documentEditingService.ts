import {
  applySnapshotToNote,
  updateNoteDraftMarkdown,
  updateNoteDraftTitle,
  type NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import type { SessionSnapshot } from '$lib/features/notepad/session/session';

export interface DocumentEditingServiceDeps<TPaneId extends string> {
  isApplyingExternalContent: (document: NoteDraftState) => boolean;
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
  function applyMarkdownProjection(
    document: NoteDraftState,
    markdown: string
  ): boolean {
    const previousRevision = document.operationRevision;
    updateNoteDraftMarkdown(document, markdown);
    return document.operationRevision !== previousRevision;
  }

  function recordUserEdit(
    paneId: TPaneId,
    document: NoteDraftState,
    markdown: string
  ): boolean {
    const changed = applyMarkdownProjection(document, markdown);
    if (changed) {
      deps.resetPaneCommandAfterBodyInput(paneId, markdown);
    }

    if (deps.isApplyingExternalContent(document)) {
      return changed;
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
    applyToRuntime: () => Promise<void>,
    {
      autosave = true,
      immediateRelated = true
    }: { autosave?: boolean; immediateRelated?: boolean } = {}
  ): Promise<boolean> {
    const changed = applyMarkdownProjection(document, markdown);
    await applyToRuntime();
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
    applyMarkdownToRuntime: () => Promise<void>,
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
    const previousTitle = document.title;
    const previousMarkdown = document.bodyMarkdown;
    applySnapshotToNote(document, snapshot, { preserveDraft });

    const titleChanged = document.title !== previousTitle;
    const markdownChanged =
      document.bodyMarkdown !== previousMarkdown;
    if (titleChanged || markdownChanged) {
      document.operationRevision += 1;
    }
    if (markdownChanged) {
      await applyMarkdownToRuntime();
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
    const previousRevision = document.operationRevision;
    updateNoteDraftTitle(document, title);
    return document.operationRevision !== previousRevision;
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
