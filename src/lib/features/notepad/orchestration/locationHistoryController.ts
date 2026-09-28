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
import type {
  NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { SearchItem } from '$lib/types/semantic';
import type {
  PaneKind,
  WorkspacePaneState
} from '$lib/features/notepad/workspace/paneTypes';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';
import type {
  PaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import type {
  DocumentDepartureController
} from './documentDepartureController';
import {
  canSetPaneKind,
  paneHasCapability
} from '$lib/features/notepad/workspace/paneCapabilities';

export interface LocationHistoryControllerDeps<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  getPaneState: (
    paneId: TPaneId
  ) => WorkspacePaneState<TPaneId>;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneCommandMode: () => 'start' | 'split' | null;
  getPaneCommandSourcePaneId: () => TPaneId | null;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneKind: (paneId: TPaneId, kind: PaneKind) => Promise<void>;
  /** Null means no authoritative snapshot was loaded. */
  loadRecentNotes: () => Promise<SearchItem[] | null> | SearchItem[] | null;
  openNotePath: (
    path: string | null,
    options: {
      noteId?: string | null;
      currentNoteAlreadySaved?: boolean;
      focusEditorAfterOpen?: boolean;
      revealEditorAfterOpen?: boolean;
    }
  ) => Promise<void>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  focusPaneAfterShortcut: (paneId: TPaneId) => void | Promise<void>;
  documentDeparture: DocumentDepartureController<TPaneId>;
  transitions: PaneNavigationTransitionPipeline<TPaneId>;
}

class LocationRestoreBlockedError extends Error {}

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
    const pane = deps.getPaneState(paneId);
    const document = deps.getPaneDocument(paneId);
    const noteId = getDocumentNoteId(document);
    const notePath = getDocumentPath(document);
    if (pane.kind === 'chat') {
      return {
        kind: 'chat',
        conversationId: pane.chatConversationId,
        contextNoteId: noteId,
        contextNotePath: notePath
      };
    }
    if (!noteId && !notePath) return null;
    return {
      kind: 'editor',
      noteId,
      notePath
    };
  }

  function canRestoreLocation(
    paneId: TPaneId,
    location: NavLocation
  ): boolean {
    if (location.kind === 'editor') return true;
    return canSetPaneKind(
      {
        paneOrder: deps.getPaneOrder(),
        getPaneKind: deps.getPaneKind
      },
      paneId,
      'chat'
    );
  }

  function previousRestorableLocation(
    targetPaneId: TPaneId,
    historyPaneId: TPaneId,
    current: NavLocation | null
  ): NavLocation | null {
    for (const entry of locationMru.historyExcluding(
      historyPaneId,
      current
    )) {
      if (canRestoreLocation(targetPaneId, entry.location)) {
        return entry.location;
      }
    }
    return null;
  }

  function blurFocusedPaneTitle(paneId: TPaneId) {
    const input = deps.getPaneTitleInput(paneId);
    if (input && document.activeElement === input) input.blur();
  }

  async function captureRestorablePaneLocation(
    paneId: TPaneId
  ): Promise<{
    location: NavLocation | null;
    documentSaved: boolean;
  }> {
    const current = capturePaneLocation(paneId);
    if (
      current ||
      !paneHasCapability(
        deps.getPaneKind(paneId),
        'edit-document'
      )
    ) {
      return {
        location: current,
        documentSaved: false
      };
    }
    const note = deps.getPaneDocument(paneId);
    if (
      note.working.title.trim() === '' &&
      note.working.markdown.trim() === ''
    ) {
      return { location: null, documentSaved: false };
    }
    await deps.documentDeparture.prepare(paneId, note, { finalize: false });
    return {
      location: capturePaneLocation(paneId),
      documentSaved: true
    };
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

  /** Keep the thought-partner stack entry pointed at the note now in the editor. */
  function bindChatContextToNote(
    paneId: TPaneId,
    noteId: string | null,
    notePath: string | null
  ) {
    if (locationMru.bindChatContextToNote(paneId, noteId, notePath)) {
      bumpEpoch();
    }
  }

  async function ensureLocationMruSeeded(paneId: TPaneId) {
    if (locationMru.isSeeded(paneId)) return;
    const recentNotes = await deps.loadRecentNotes();
    if (recentNotes === null) return;
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

  async function restoreLocation(
    paneId: TPaneId,
    location: NavLocation,
    {
      currentDocumentAlreadySaved = false
    }: { currentDocumentAlreadySaved?: boolean } = {}
  ) {
    suppressLocationTouch = true;
    try {
      const result = await deps.transitions.execute({
        kind: 'restore-location',
        resolvePane: () =>
          deps.getPaneOrder().includes(paneId)
            ? paneId
            : null,
        guard: () =>
          canRestoreLocation(paneId, location)
            ? { status: 'allow' }
            : {
                status: 'blocked',
                reason:
                  'The target pane cannot restore this chat location.'
              },
        captureHistory:
          location.kind === 'chat'
            ? () => {
                locationMru.rememberChat(
                  paneId,
                  location
                );
              }
            : undefined,
        mutateWorkspace: async () => {
          deps.activatePaneSession(paneId);
          if (location.kind === 'editor') {
            await deps.openNotePath(location.notePath, {
              noteId: location.noteId,
              currentNoteAlreadySaved:
                currentDocumentAlreadySaved,
              focusEditorAfterOpen: true,
              revealEditorAfterOpen: true
            });
            return;
          }

          const document = deps.getPaneDocument(paneId);
          const noteId = getDocumentNoteId(document);
          const notePath = getDocumentPath(document);
          const needsContextNote =
            (location.contextNoteId ||
              location.contextNotePath) &&
            (noteId !== location.contextNoteId ||
              notePath !== location.contextNotePath);
          if (needsContextNote) {
            await deps.openNotePath(
              location.contextNotePath,
              {
                noteId: location.contextNoteId,
                focusEditorAfterOpen: false
              }
            );
          }

          if (
            !paneHasCapability(
              deps.getPaneKind(paneId),
              'host-chat'
            )
          ) {
            await deps.setPaneKind(paneId, 'chat');
          }
          if (!paneHasCapability(deps.getPaneKind(paneId), 'host-chat')) {
            throw new LocationRestoreBlockedError('The target pane rejected the chat location.');
          }
          deps.setPaneConversationId(paneId, location.conversationId);
        },
        ensureEditors: location.kind === 'chat',
        complete:
          location.kind === 'chat'
            ? () => {
                deps.updateSelectedRelatedText();
              }
            : undefined,
        isCurrent: () =>
          deps.getActivePaneId() === paneId,
        focus:
          location.kind === 'chat'
            ? async () => {
                await tick();
                await deps.focusPaneAfterShortcut(paneId);
              }
            : undefined,
        trackLatestForPane: false
      });
      if (result.status === 'failed') {
        if (result.error instanceof LocationRestoreBlockedError) {
          return;
        }
        throw result.error;
      }
    } finally {
      suppressLocationTouch = false;
      bumpEpoch();
    }
  }

  async function goToPreviousLocation(paneId = deps.getActivePaneId()) {
    blurFocusedPaneTitle(paneId);
    const {
      location: current,
      documentSaved
    } = await captureRestorablePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    let previous = previousRestorableLocation(paneId, paneId, current);
    if (!previous) {
      if (
        paneHasCapability(
          deps.getPaneKind(paneId),
          'host-chat'
        )
      ) {
        await deps.setPaneKind(paneId, 'editor');
      }
      return;
    }
    touchLocation(paneId, current);
    while (previous) {
      try {
        await restoreLocation(paneId, previous, {
          currentDocumentAlreadySaved:
            documentSaved
        });
        return;
      } catch (error) {
        if (
          previous.kind !== 'editor' ||
          !(error instanceof Error) ||
          error.message !== 'Missing note path'
        ) {
          throw error;
        }
        removeLocation(previous);
        previous = previousRestorableLocation(
          paneId,
          paneId,
          current
        );
      }
    }
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
    return previousRestorableLocation(
      targetPaneId,
      referencePaneId,
      capturePaneLocation(referencePaneId)
    );
  }

  function peekPreviousLocationForPaneCommand(targetPaneId: TPaneId) {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    return previousRestorableLocation(
      targetPaneId,
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
    if (!canRestoreLocation(paneId, location)) return;
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
    bindChatContextToNote,
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
