import { tick } from 'svelte';
import {
  editorLocationFromRecent,
  loadPersistedChatLocation,
  locationDisplayLabel,
  locationsEqual,
  notepadLocationMru,
  type LocationHistoryEntry,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';
import { setPaneChatConversationId } from '$lib/features/notepad/state/noteStore';
import type {
  NoteDraftState,
  NotepadState
} from '$lib/features/notepad/state/noteStore';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { SearchItem } from '$lib/types/semantic';

export interface LocationHistoryControllerDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneCommandMode: () => 'start' | 'split' | null;
  getPaneCommandSourcePaneId: () => TPaneId | null;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneKind: (paneId: TPaneId, kind: 'editor' | 'chat') => void;
  saveCursorPosition: (document: NoteDraftState) => void;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  loadRecentNotes: () => Promise<SearchItem[]> | SearchItem[];
  openNotePath: (
    path: string | null,
    options: {
      noteId?: string | null;
      focusEditorAfterOpen?: boolean;
      revealEditorAfterOpen?: boolean;
    }
  ) => Promise<void>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  focusPaneAfterShortcut: (paneId: TPaneId) => void | Promise<void>;
}

export function createLocationHistoryController<TPaneId extends string>(
  deps: LocationHistoryControllerDeps<TPaneId>
) {
  const locationMru = notepadLocationMru;
  let suppressLocationTouch = false;
  let epoch = 0;
  let epochListener: ((value: number) => void) | null = null;

  function bumpEpoch() {
    epoch += 1;
    epochListener?.(epoch);
  }

  function setLocationHistoryEpochListener(
    listener: ((value: number) => void) | null
  ) {
    epochListener = listener;
    listener?.(epoch);
  }

  function capturePaneLocation(paneId: TPaneId): NavLocation | null {
    const pane = deps.state.panesById[paneId];
    const document = deps.getPaneDocument(paneId);
    if (pane.kind === 'chat') {
      return {
        kind: 'chat',
        conversationId: pane.chatConversationId,
        contextNoteId: document.currentNoteId,
        contextNotePath: document.currentNotePath
      };
    }
    if (!document.currentNoteId && !document.currentNotePath) return null;
    return {
      kind: 'editor',
      noteId: document.currentNoteId,
      notePath: document.currentNotePath
    };
  }

  function blurFocusedPaneTitle(paneId: TPaneId) {
    const input = deps.getPaneTitleInput(paneId);
    if (input && document.activeElement === input) input.blur();
  }

  async function captureRestorablePaneLocation(
    paneId: TPaneId
  ): Promise<NavLocation | null> {
    const current = capturePaneLocation(paneId);
    if (current || deps.getPaneKind(paneId) !== 'editor') return current;
    const note = deps.getPaneDocument(paneId);
    if (note.title.trim() === '' && note.bodyMarkdown.trim() === '') return null;
    deps.saveCursorPosition(note);
    deps.cancelPendingAutosave(note);
    await deps.enqueueSave(note);
    return capturePaneLocation(paneId);
  }

  function touchCurrentLocation(paneId = deps.getActivePaneId()) {
    if (suppressLocationTouch) return;
    const current = capturePaneLocation(paneId);
    if (!current) return;
    locationMru.touch(paneId, current);
    bumpEpoch();
  }

  function touchLocation(paneId: TPaneId, location: NavLocation | null) {
    if (suppressLocationTouch || !location) return;
    locationMru.touch(paneId, location);
    bumpEpoch();
  }

  async function ensureLocationMruSeeded(paneId: TPaneId) {
    if (locationMru.isSeeded(paneId)) return;
    const recentNotes = await deps.loadRecentNotes();
    if (locationMru.isSeeded(paneId)) return;

    const seeded = recentNotes
      .map((item) =>
        editorLocationFromRecent({
          noteId: item.noteId,
          notePath: item.notePath
        })
      )
      .filter((location): location is NavLocation => location !== null);
    const persistedChat = await loadPersistedChatLocation();
    if (persistedChat) seeded.unshift(persistedChat);
    const changed = locationMru.seedMissing(paneId, seeded);
    if (changed) bumpEpoch();
  }

  async function restoreLocation(paneId: TPaneId, location: NavLocation) {
    suppressLocationTouch = true;
    try {
      deps.activatePaneSession(paneId);
      if (location.kind === 'editor') {
        await deps.openNotePath(location.notePath, {
          noteId: location.noteId,
          focusEditorAfterOpen: true,
          revealEditorAfterOpen: true
        });
        return;
      }

      locationMru.rememberChat(paneId, location);
      const document = deps.getPaneDocument(paneId);
      const needsContextNote =
        (location.contextNoteId || location.contextNotePath) &&
        (document.currentNoteId !== location.contextNoteId ||
          document.currentNotePath !== location.contextNotePath);
      if (needsContextNote) {
        await deps.openNotePath(location.contextNotePath, {
          noteId: location.contextNoteId,
          focusEditorAfterOpen: false
        });
      }

      setPaneChatConversationId(
        deps.state,
        paneId,
        location.conversationId
      );
      if (deps.getPaneKind(paneId) !== 'chat') {
        deps.setPaneKind(paneId, 'chat');
        await tick();
        await deps.paneLifecycle.ensurePaneEditors();
        deps.updateSelectedRelatedText();
      }
      await tick();
      await deps.focusPaneAfterShortcut(paneId);
    } finally {
      suppressLocationTouch = false;
      bumpEpoch();
    }
  }

  async function goToPreviousLocation(paneId = deps.getActivePaneId()) {
    deps.activatePaneSession(paneId);
    blurFocusedPaneTitle(paneId);
    const current = await captureRestorablePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    const previous = locationMru.previousExcluding(paneId, current);
    if (!previous) {
      if (deps.getPaneKind(paneId) === 'chat') {
        deps.setPaneKind(paneId, 'editor');
        await tick();
        await deps.paneLifecycle.ensurePaneEditors();
        deps.updateSelectedRelatedText();
        bumpEpoch();
        await tick();
        await deps.focusPaneAfterShortcut(paneId);
      }
      return;
    }
    touchLocation(paneId, current);
    await restoreLocation(paneId, previous);
  }

  function findPaneCommandReferencePaneId(targetPaneId: TPaneId): TPaneId {
    if (deps.getPaneCommandMode() !== 'split') return targetPaneId;
    const sourcePaneId = deps.getPaneCommandSourcePaneId();
    if (
      sourcePaneId &&
      sourcePaneId !== targetPaneId &&
      deps.getPaneOrder().includes(sourcePaneId)
    ) {
      return sourcePaneId;
    }
    return (
      deps.getPaneOrder().find((paneId) => paneId !== targetPaneId) ??
      targetPaneId
    );
  }

  async function resolvePreviousLocationForPaneCommand(targetPaneId: TPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    await ensureLocationMruSeeded(referencePaneId);
    return locationMru.previousExcluding(
      referencePaneId,
      capturePaneLocation(referencePaneId)
    );
  }

  function peekPreviousLocationForPaneCommand(targetPaneId: TPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    return locationMru.previousExcluding(
      referencePaneId,
      capturePaneLocation(referencePaneId)
    );
  }

  function paneCommandPreviousLocationLabel(targetPaneId: TPaneId) {
    const previous = peekPreviousLocationForPaneCommand(targetPaneId);
    return previous ? locationDisplayLabel(previous) : null;
  }

  function paneCommandCurrentLocationLabel(targetPaneId: TPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    const current = capturePaneLocation(referencePaneId);
    return current ? locationDisplayLabel(current) : 'Untitled note';
  }

  function peekLocationHistory(
    paneId = deps.getActivePaneId()
  ): LocationHistoryEntry[] {
    return locationMru.historyExcluding(paneId, capturePaneLocation(paneId));
  }

  async function listLocationHistory(
    paneId = deps.getActivePaneId()
  ): Promise<LocationHistoryEntry[]> {
    const current = capturePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    const settled = capturePaneLocation(paneId) ?? current;
    return locationMru.historyExcluding(paneId, settled);
  }

  async function openLocationFromHistory(location: NavLocation) {
    const paneId = deps.getActivePaneId();
    const current = capturePaneLocation(paneId);
    if (current && locationsEqual(current, location)) return;
    touchLocation(paneId, current);
    await restoreLocation(paneId, location);
  }

  function removeLocation(location: NavLocation) {
    locationMru.remove(location);
    bumpEpoch();
  }

  function adoptClosedLocation(
    paneId: TPaneId,
    remainingPaneId: TPaneId,
    location: NavLocation | null
  ) {
    locationMru.adoptClosedLocation(paneId, remainingPaneId, location);
    bumpEpoch();
  }

  return {
    bumpLocationHistoryEpoch: bumpEpoch,
    setLocationHistoryEpochListener,
    capturePaneLocation,
    blurFocusedPaneTitle,
    touchCurrentLocation,
    touchLocation,
    ensureLocationMruSeeded,
    restoreLocation,
    goToPreviousLocation,
    findPaneCommandReferencePaneId,
    resolvePreviousLocationForPaneCommand,
    peekPreviousLocationForPaneCommand,
    paneCommandPreviousLocationLabel,
    paneCommandCurrentLocationLabel,
    peekLocationHistory,
    listLocationHistory,
    openLocationFromHistory,
    removeLocation,
    adoptClosedLocation,
    isTouchSuppressed: () => suppressLocationTouch
  };
}
