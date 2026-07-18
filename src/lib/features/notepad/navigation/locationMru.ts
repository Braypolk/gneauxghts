import { invoke } from '@tauri-apps/api/core';

export const MAX_LOCATION_MRU = 20;

export type NavLocation =
  | { kind: 'editor'; noteId: string | null; notePath: string | null }
  | {
      kind: 'chat';
      conversationId: string | null;
      contextNoteId: string | null;
      contextNotePath: string | null;
    };

export function isRestorableLocation(location: NavLocation): boolean {
  if (location.kind === 'editor') {
    return Boolean(location.noteId || location.notePath);
  }
  // Chat is always restorable (including a fresh thought-partner with no conversation yet).
  return true;
}

export function locationsEqual(left: NavLocation, right: NavLocation): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'editor' && right.kind === 'editor') {
    if (left.noteId && right.noteId) {
      return left.noteId === right.noteId;
    }
    return left.notePath !== null && left.notePath === right.notePath;
  }
  if (left.kind === 'chat' && right.kind === 'chat') {
    // One thought-partner slot per pane: keep the latest conversation details on touch.
    return true;
  }
  return false;
}

export function editorLocationFromRecent(item: {
  noteId: string | null;
  notePath: string | null;
}): NavLocation | null {
  if (!item.noteId && !item.notePath) {
    return null;
  }
  return {
    kind: 'editor',
    noteId: item.noteId,
    notePath: item.notePath
  };
}

export function locationDisplayLabel(location: NavLocation): string {
  if (location.kind === 'chat') {
    return 'Thought partner';
  }
  if (location.notePath) {
    return location.notePath.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled note';
  }
  return 'Untitled note';
}

/** History rows for the command bar / previous-location UI (excludes current). */
export type LocationHistoryEntry = {
  location: NavLocation;
  label: string;
};

export type ChatNavLocation = Extract<NavLocation, { kind: 'chat' }>;

type PersistedLastChat = {
  conversationId: string;
  contextNoteId: string | null;
  contextNotePath: string | null;
};

/** Legacy browser key from the temporary localStorage prototype. */
const LEGACY_CHAT_STORAGE_KEY = 'gneauxghts:last-chat-location:v1';

function loadLegacyLocalStorageChat(): ChatNavLocation | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ChatNavLocation>;
    if (parsed.kind !== 'chat' || typeof parsed.conversationId !== 'string' || !parsed.conversationId) {
      return null;
    }
    return {
      kind: 'chat',
      conversationId: parsed.conversationId,
      contextNoteId: typeof parsed.contextNoteId === 'string' ? parsed.contextNoteId : null,
      contextNotePath: typeof parsed.contextNotePath === 'string' ? parsed.contextNotePath : null
    };
  } catch {
    return null;
  }
}

function clearLegacyLocalStorageChat(): void {
  try {
    window.localStorage?.removeItem(LEGACY_CHAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Load the last thought-partner pointer from app SQLite state (same store as recent notes). */
export async function loadPersistedChatLocation(): Promise<ChatNavLocation | null> {
  try {
    const row = await invoke<PersistedLastChat | null>('get_last_chat_location');
    if (row?.conversationId) {
      clearLegacyLocalStorageChat();
      return {
        kind: 'chat',
        conversationId: row.conversationId,
        contextNoteId: row.contextNoteId ?? null,
        contextNotePath: row.contextNotePath ?? null
      };
    }
  } catch {
    // Fall through to legacy migration.
  }

  const legacy = loadLegacyLocalStorageChat();
  if (legacy) {
    await persistChatLocation(legacy);
    clearLegacyLocalStorageChat();
    return legacy;
  }
  return null;
}

/** Persist the thought-partner pointer into app SQLite state. */
export async function persistChatLocation(location: ChatNavLocation): Promise<void> {
  if (!location.conversationId) {
    return;
  }
  try {
    await invoke('set_last_chat_location', {
      conversationId: location.conversationId,
      contextNoteId: location.contextNoteId,
      contextNotePath: location.contextNotePath
    });
  } catch {
    // In-memory MRU still works if persistence fails.
  }
}

export function createLocationMruStore<TPaneId extends string>() {
  const lists = new Map<TPaneId, NavLocation[]>();
  /** Survives MRU reordering quirks: once visited, chat stays available for Recent. */
  const lastChatByPane = new Map<TPaneId, ChatNavLocation>();

  function listFor(paneId: TPaneId): NavLocation[] {
    let list = lists.get(paneId);
    if (!list) {
      list = [];
      lists.set(paneId, list);
    }
    return list;
  }

  function rememberChat(paneId: TPaneId, location: NavLocation): void {
    if (location.kind !== 'chat') {
      return;
    }
    lastChatByPane.set(paneId, location);
    void persistChatLocation(location);
  }

  function touch(paneId: TPaneId, location: NavLocation): void {
    if (!isRestorableLocation(location)) {
      return;
    }
    rememberChat(paneId, location);
    const list = listFor(paneId);
    const next = list.filter((entry) => !locationsEqual(entry, location));
    next.unshift(location);
    if (next.length > MAX_LOCATION_MRU) {
      next.length = MAX_LOCATION_MRU;
    }
    lists.set(paneId, next);
  }

  function previousExcluding(
    paneId: TPaneId,
    current: NavLocation | null
  ): NavLocation | null {
    for (const entry of historyLocations(paneId, current)) {
      return entry;
    }
    return null;
  }

  function historyLocations(
    paneId: TPaneId,
    current: NavLocation | null
  ): NavLocation[] {
    const list = listFor(paneId);
    const entries: NavLocation[] = [];
    for (const location of list) {
      if (current && locationsEqual(location, current)) {
        continue;
      }
      entries.push(location);
    }

    // Keep thought partner visible in Recent after note↔note navigation even if
    // a transient MRU snapshot dropped it. Hide it only while chat is current.
    const lastChat = lastChatByPane.get(paneId);
    if (
      lastChat &&
      !(current && locationsEqual(lastChat, current)) &&
      !entries.some((entry) => entry.kind === 'chat')
    ) {
      entries.push(lastChat);
    }

    return entries;
  }

  function historyExcluding(
    paneId: TPaneId,
    current: NavLocation | null
  ): LocationHistoryEntry[] {
    return historyLocations(paneId, current).map((location) => ({
      location,
      label: locationDisplayLabel(location)
    }));
  }

  function seedIfEmpty(paneId: TPaneId, locations: NavLocation[]): void {
    const list = listFor(paneId);
    if (list.length > 0) {
      return;
    }
    const seeded: NavLocation[] = [];
    for (const location of locations) {
      if (!isRestorableLocation(location)) {
        continue;
      }
      if (seeded.some((entry) => locationsEqual(entry, location))) {
        continue;
      }
      // Seed into in-memory lastChat only; location is already persisted in SQLite.
      if (location.kind === 'chat') {
        lastChatByPane.set(paneId, location);
      }
      seeded.push(location);
      if (seeded.length >= MAX_LOCATION_MRU) {
        break;
      }
    }
    lists.set(paneId, seeded);
  }

  function list(paneId: TPaneId): readonly NavLocation[] {
    return listFor(paneId);
  }

  function clear(paneId: TPaneId): void {
    lists.delete(paneId);
    lastChatByPane.delete(paneId);
  }

  function clearAll(): void {
    lists.clear();
    lastChatByPane.clear();
  }

  return {
    touch,
    rememberChat,
    previousExcluding,
    historyExcluding,
    seedIfEmpty,
    list,
    clear,
    clearAll
  };
}

/**
 * Session-scoped MRU shared across Notepad remounts (route key changes / HMR).
 * Pane note state already lives at module scope; location history should too.
 */
export const notepadLocationMru = createLocationMruStore<string>();

export type LocationMruStore<TPaneId extends string> = ReturnType<
  typeof createLocationMruStore<TPaneId>
>;
