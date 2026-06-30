import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';
import { focusInputAtEnd } from '$lib/features/notepad/navigation/navigation';

export interface PaneCommandGroupDeps<TPaneId extends string, TDocument> {
  getSplitPickerPaneId: () => TPaneId | null;
  getSplitPickerFocusEl: () => HTMLElement | null;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  getPaneEditorRoot: (paneId: TPaneId) => HTMLElement | null;
  getPaneDocument: (paneId: TPaneId) => TDocument;
  flushDocumentEditorSync: (document: TDocument) => void;
  activatePaneSession: (paneId: TPaneId) => unknown;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  scheduleSearchIfNeeded: () => void;
  scheduleRelatedIfNeeded: (options?: { immediate?: boolean }) => void;
}

export function createPaneCommandGroup<TPaneId extends string, TDocument>(
  deps: PaneCommandGroupDeps<TPaneId, TDocument>
) {
  function focusPaneAfterShortcut(paneId: TPaneId, options: { preferTitle?: boolean } = {}) {
    if (deps.getSplitPickerPaneId() === paneId && deps.getSplitPickerFocusEl()) {
      deps.getSplitPickerFocusEl()?.focus({ preventScroll: true });
      return;
    }

    const titleInput = deps.getPaneTitleInput(paneId);
    if (options.preferTitle && titleInput) {
      focusInputAtEnd(titleInput);
      return;
    }

    const cmContent = findCmContentElement(deps.getPaneEditorRoot(paneId));
    if (cmContent instanceof HTMLElement) {
      cmContent.focus({ preventScroll: true });
      return;
    }

    titleInput?.focus();
  }

  function activatePane(paneId: TPaneId) {
    deps.flushDocumentEditorSync(deps.getPaneDocument(paneId));
    deps.activatePaneSession(paneId);
    deps.updateSelectedRelatedText(paneId);
    deps.scheduleSearchIfNeeded();
    deps.scheduleRelatedIfNeeded({ immediate: true });
  }

  return {
    activatePane,
    focusPaneAfterShortcut
  };
}

export type PaneCommandGroup<TPaneId extends string> = ReturnType<
  typeof createPaneCommandGroup<TPaneId, unknown>
>;
