import {
  dispatchDocumentExternalSync,
  getDocumentMarkdown,
  resolveConflictUsingExternal,
  type NoteDraftState
} from './documentState';
import { isDocumentExternalConflictCurrent } from './documentExternalSyncMachine';
import type {
  PaneEditorOperationResult
} from '$lib/features/notepad/pane/paneEditorLifecycle';

export interface DocumentConflictControllerDeps {
  replaceDocumentContentInPlace: (
    document: NoteDraftState,
    markdown: string
  ) => Promise<PaneEditorOperationResult>;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  refreshDerivedViews?: () => void;
}

/**
 * Coordinates explicit conflict choices. The document state module owns the
 * transitions; this controller owns their editor, persistence and clipboard
 * effects.
 */
export function createDocumentConflictController(
  deps: DocumentConflictControllerDeps
) {
  async function keepMyEdits(document: NoteDraftState) {
    if (
      document.externalSync.kind !== 'conflict' ||
      document.externalSync.phase !== 'awaitingChoice'
    ) {
      return false;
    }
    if (
      !dispatchDocumentExternalSync(document, {
        type: 'keepWorking',
        conflictId: document.externalSync.conflictId
      })
    ) {
      return false;
    }
    await deps.enqueueSave(document);
    return true;
  }

  async function loadDiskVersion(document: NoteDraftState) {
    if (
      document.externalSync.kind !== 'conflict' ||
      document.externalSync.phase !== 'awaitingChoice'
    ) {
      return false;
    }
    const conflict = document.externalSync;
    const conflictId = conflict.conflictId;
    const originalMarkdown = getDocumentMarkdown(document);
    const originalRevision = document.operation.revision;
    const targetMarkdown =
      conflict.external.kind === 'snapshot'
        ? conflict.external.document.content.markdown
        : originalMarkdown;
    if (
      !dispatchDocumentExternalSync(document, {
        type: 'beginApplyingExternal',
        conflictId
      })
    ) {
      return false;
    }
    const result = await deps.replaceDocumentContentInPlace(
      document,
      targetMarkdown
    );

    if (result !== 'applied') {
      // An in-place editor replacement can have synchronously fanned out
      // before its pane session later discovers that the pane became stale.
      // Reapply the live model value so a partial fanout cannot survive.
      if (
        result === 'stale' &&
        getDocumentMarkdown(document) !== targetMarkdown
      ) {
        await deps.replaceDocumentContentInPlace(
          document,
          getDocumentMarkdown(document)
        );
      }
      dispatchDocumentExternalSync(document, {
        type: 'externalApplyFailed',
        conflictId
      });
      return false;
    }

    // A concurrent edit or conflict choice wins. In that case the editor
    // already reported the newer model value through its normal callback.
    if (
      !isDocumentExternalConflictCurrent(
        document.externalSync,
        conflictId,
        'applyingExternal'
      ) ||
      document.operation.revision !== originalRevision
    ) {
      if (getDocumentMarkdown(document) !== targetMarkdown) {
        await deps.replaceDocumentContentInPlace(
          document,
          getDocumentMarkdown(document)
        );
      }
      dispatchDocumentExternalSync(document, {
        type: 'externalApplyFailed',
        conflictId
      });
      return false;
    }
    if (
      !resolveConflictUsingExternal(document, conflictId)
    ) {
      return false;
    }
    deps.refreshDerivedViews?.();
    return true;
  }

  async function copyMyEdits(document: NoteDraftState) {
    await deps.copyText(getDocumentMarkdown(document));
  }

  return {
    keepMyEdits,
    loadDiskVersion,
    copyMyEdits
  };
}

export type DocumentConflictController = ReturnType<
  typeof createDocumentConflictController
>;
