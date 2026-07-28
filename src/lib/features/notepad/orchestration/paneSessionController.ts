import type { SearchItem } from '$lib/types/semantic';
import type { NoteDraftState, NoteKey, NotepadState } from '$lib/features/notepad/state/noteStore';
import {
  getNavigationPaneId as selectNavigationPaneId
} from '$lib/features/notepad/workspace/paneRoles';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import {
  getPaneIdsWithCapability,
  paneHasCapability
} from '$lib/features/notepad/workspace/paneCapabilities';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';

export type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';

export interface PaneSessionControllerParams<TPaneId extends string> {
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocumentSession: (paneId: TPaneId) => NoteDraftState;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneDocumentSession: (paneId: TPaneId, document: NoteDraftState) => unknown;
}

export function searchItemMatchesSplitSource(
  item: SearchItem,
  path: string | null,
  id: string | null
) {
  const itemPath = item.notePath ?? null;
  const itemId = item.noteId ?? null;
  if (path && itemPath) {
    return path === itemPath;
  }

  if (!path && !itemPath) {
    return (id ?? null) === (itemId ?? null);
  }

  return false;
}

export function paneCommandNoteLabel(note: NoteDraftState | null | undefined) {
  if (!note) {
    return 'Untitled note';
  }

  const trimmed = note.working.title.trim();
  if (trimmed) {
    return trimmed;
  }

  const path = getDocumentPath(note);
  if (path) {
    return path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled note';
  }

  return 'Untitled note';
}

export function paneCommandPreviousNoteLabel(item: SearchItem | null) {
  return item ? item.fileName?.trim() || item.notePath || 'Recent note' : null;
}

export function findPaneCommandPreviousItem(
  recentNotes: SearchItem[],
  source: NoteDraftState | null | undefined
) {
  const path = source ? getDocumentPath(source) : null;
  const id = source ? getDocumentNoteId(source) : null;

  for (const item of recentNotes) {
    if (searchItemMatchesSplitSource(item, path, id)) {
      continue;
    }

    return item;
  }

  return null;
}

export function createPaneSessionController<TPaneId extends string>(
  params: PaneSessionControllerParams<TPaneId>
) {
  function getVisiblePaneIds() {
    return params.getPaneOrder();
  }

  function getEditorPaneIds() {
    return getPaneIdsWithCapability(
      getVisiblePaneIds(),
      params.getPaneKind,
      'edit-document'
    );
  }

  function getNavigationPaneId() {
    return selectNavigationPaneId({
      paneOrder: getVisiblePaneIds(),
      activePaneId: params.getActivePaneId(),
      getPaneKind: params.getPaneKind
    });
  }

  function getPaneIdsForDocument(document: NoteDraftState) {
    return getVisiblePaneIds().filter(
      (paneId) =>
        paneHasCapability(
          params.getPaneKind(paneId),
          'edit-document'
        ) &&
        params.getPaneDocumentSession(paneId).key === document.key
    );
  }

  function getNextPaneId(paneId: TPaneId = params.getActivePaneId(), direction: 1 | -1 = 1) {
    const paneOrder = params.getPaneOrder();
    if (paneOrder.length < 2) {
      return null;
    }

    const currentIndex = paneOrder.indexOf(paneId);
    if (currentIndex === -1) {
      return paneOrder[0] ?? null;
    }

    const nextIndex = (currentIndex + direction + paneOrder.length) % paneOrder.length;
    return paneOrder[nextIndex] ?? null;
  }

  function activatePane(paneId: TPaneId) {
    return params.activatePaneSession(paneId);
  }

  function setPaneDocument(paneId: TPaneId, document: NoteDraftState) {
    return params.setPaneDocumentSession(paneId, document);
  }

  return {
    activatePane,
    getEditorPaneIds,
    getNavigationPaneId,
    getNextPaneId,
    getPaneIdsForDocument,
    getVisiblePaneIds,
    setPaneDocument
  };
}

export function getSplitSourceNote<TPaneId extends string>(
  state: NotepadState<TPaneId>,
  sourceKey: NoteKey | null
) {
  return sourceKey ? state.notesByKey[sourceKey] : null;
}
