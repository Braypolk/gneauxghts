import { focusInputAtEnd } from '$lib/features/notepad/navigation/navigation';

export interface PaneCommandGroupDeps<TPaneId extends string, TDocument> {
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  focusPaneEditor: (paneId: TPaneId) => boolean;
  focusPaneChat: (paneId: TPaneId) => boolean;
  activatePaneSession: (paneId: TPaneId) => unknown;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  scheduleSearchIfNeeded: () => void;
  scheduleRelatedIfNeeded: (options?: { immediate?: boolean }) => void;
}

export function createPaneCommandGroup<TPaneId extends string, TDocument>(
  deps: PaneCommandGroupDeps<TPaneId, TDocument>
) {
  function focusPaneAfterShortcut(paneId: TPaneId, options: { preferTitle?: boolean } = {}) {
    const titleInput = deps.getPaneTitleInput(paneId);
    if (options.preferTitle && titleInput) {
      focusInputAtEnd(titleInput);
      return;
    }

    if (deps.focusPaneEditor(paneId)) return;

    if (deps.focusPaneChat(paneId)) return;

    titleInput?.focus();
  }

  function activatePane(paneId: TPaneId) {
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
