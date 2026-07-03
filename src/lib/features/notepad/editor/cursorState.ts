import { logDevError } from '$lib/logDevError';

export interface CursorPosition {
  anchor: number;
  head: number;
}

interface StoredCursorEntry extends CursorPosition {
  updatedAtMillis: number;
}

const STORAGE_KEY = 'gneauxghts:notepad-cursors:v1';
const MAX_STORED_CURSORS = 200;
const DEFAULT_PANE_CURSOR_SCOPE = 'default';
const NOTE_ID_PREFIX = 'note-id:';

function getCursorStorageKey(notePath: string, paneId: string | null = null) {
  return `${paneId ?? DEFAULT_PANE_CURSOR_SCOPE}::${notePath}`;
}

function getCursorStorageKeyForNoteId(noteId: string, paneId: string | null = null) {
  return `${paneId ?? DEFAULT_PANE_CURSOR_SCOPE}::${NOTE_ID_PREFIX}${noteId}`;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isStoredCursorEntry(value: unknown): value is StoredCursorEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<StoredCursorEntry>;
  return (
    typeof entry.anchor === 'number' &&
    Number.isFinite(entry.anchor) &&
    typeof entry.head === 'number' &&
    Number.isFinite(entry.head) &&
    typeof entry.updatedAtMillis === 'number' &&
    Number.isFinite(entry.updatedAtMillis)
  );
}

function readStoredCursorMap() {
  if (!canUseStorage()) {
    return new Map<string, StoredCursorEntry>();
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return new Map<string, StoredCursorEntry>();
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return new Map<string, StoredCursorEntry>();
    }

    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, StoredCursorEntry] => isStoredCursorEntry(entry[1])
    );

    return new Map(entries);
  } catch (error) {
    logDevError('Failed to read stored cursor positions', error);
    return new Map<string, StoredCursorEntry>();
  }
}

function writeStoredCursorMap(cursorMap: Map<string, StoredCursorEntry>) {
  if (!canUseStorage()) {
    return;
  }

  const prunedEntries = Array.from(cursorMap.entries())
    .sort((left, right) => right[1].updatedAtMillis - left[1].updatedAtMillis)
    .slice(0, MAX_STORED_CURSORS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(prunedEntries)));
  } catch (error) {
    logDevError('Failed to persist cursor positions', error);
  }
}

function findBestCursorEntry(
  cursorMap: Map<string, StoredCursorEntry>,
  notePath: string,
  paneId: string | null,
  noteId: string | null
) {
  const exactEntry = cursorMap.get(getCursorStorageKey(notePath, paneId));
  if (exactEntry) {
    return exactEntry;
  }

  if (noteId) {
    const noteIdScopedEntry = cursorMap.get(getCursorStorageKeyForNoteId(noteId, paneId));
    if (noteIdScopedEntry) {
      return noteIdScopedEntry;
    }
  }

  const defaultScopeEntry = cursorMap.get(getCursorStorageKey(notePath));
  if (defaultScopeEntry) {
    return defaultScopeEntry;
  }

  if (noteId) {
    const noteIdDefaultScopeEntry = cursorMap.get(getCursorStorageKeyForNoteId(noteId));
    if (noteIdDefaultScopeEntry) {
      return noteIdDefaultScopeEntry;
    }
  }

  const legacyEntry = cursorMap.get(notePath);
  if (legacyEntry) {
    return legacyEntry;
  }

  const scopedSuffix = `::${notePath}`;
  let latestScopedEntry: StoredCursorEntry | null = null;

  for (const [storedKey, entry] of cursorMap.entries()) {
    if (!storedKey.endsWith(scopedSuffix)) {
      continue;
    }

    if (!latestScopedEntry || entry.updatedAtMillis > latestScopedEntry.updatedAtMillis) {
      latestScopedEntry = entry;
    }
  }

  if (noteId) {
    const noteIdScopedSuffix = `::${NOTE_ID_PREFIX}${noteId}`;
    for (const [storedKey, entry] of cursorMap.entries()) {
      if (!storedKey.endsWith(noteIdScopedSuffix)) {
        continue;
      }

      if (!latestScopedEntry || entry.updatedAtMillis > latestScopedEntry.updatedAtMillis) {
        latestScopedEntry = entry;
      }
    }
  }

  return latestScopedEntry;
}

export function loadCursorPosition(
  notePath: string | null,
  paneId: string | null = null,
  noteId: string | null = null
) {
  if (!notePath) {
    return null;
  }

  const cursorMap = readStoredCursorMap();
  const entry = findBestCursorEntry(cursorMap, notePath, paneId, noteId);
  if (!entry) {
    return null;
  }

  return {
    anchor: entry.anchor,
    head: entry.head
  };
}

export function saveCursorPosition(
  notePath: string | null,
  position: CursorPosition | null,
  paneId: string | null = null,
  noteId: string | null = null
) {
  if (!notePath || !position) {
    return;
  }

  const cursorMap = readStoredCursorMap();
  const entry: StoredCursorEntry = {
    anchor: position.anchor,
    head: position.head,
    updatedAtMillis: Date.now()
  };
  cursorMap.set(getCursorStorageKey(notePath, paneId), entry);
  if (noteId) {
    cursorMap.set(getCursorStorageKeyForNoteId(noteId, paneId), entry);
  }
  writeStoredCursorMap(cursorMap);
}
