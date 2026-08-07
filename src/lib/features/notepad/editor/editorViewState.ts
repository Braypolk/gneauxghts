import { logDevError } from '$lib/logDevError';

export interface CursorPosition {
  anchor: number;
  head: number;
}

/**
 * Where a note was left off in a pane: the selection plus the scroller offset.
 * Scroll is tracked separately from the cursor because a reader can scroll far
 * from the cursor, and reopening at the cursor would lose their place.
 */
export interface EditorViewState extends CursorPosition {
  /** Scroller offset in px. Absent in entries written before scroll tracking. */
  scrollTop?: number;
}

interface StoredViewStateEntry extends EditorViewState {
  updatedAtMillis: number;
}

const STORAGE_KEY = 'gneauxghts:notepad-cursors:v1';
const MAX_STORED_ENTRIES = 200;
const DEFAULT_PANE_SCOPE = 'default';
const NOTE_ID_PREFIX = 'note-id:';

function getStorageKey(notePath: string, paneId: string | null = null) {
  return `${paneId ?? DEFAULT_PANE_SCOPE}::${notePath}`;
}

function getStorageKeyForNoteId(noteId: string, paneId: string | null = null) {
  return `${paneId ?? DEFAULT_PANE_SCOPE}::${NOTE_ID_PREFIX}${noteId}`;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isStoredViewStateEntry(value: unknown): value is StoredViewStateEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<StoredViewStateEntry>;
  return (
    typeof entry.anchor === 'number' &&
    Number.isFinite(entry.anchor) &&
    typeof entry.head === 'number' &&
    Number.isFinite(entry.head) &&
    typeof entry.updatedAtMillis === 'number' &&
    Number.isFinite(entry.updatedAtMillis)
  );
}

function readStoredScrollTop(entry: StoredViewStateEntry) {
  return typeof entry.scrollTop === 'number' && Number.isFinite(entry.scrollTop)
    ? Math.max(0, entry.scrollTop)
    : undefined;
}

function readStoredViewStateMap() {
  if (!canUseStorage()) {
    return new Map<string, StoredViewStateEntry>();
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return new Map<string, StoredViewStateEntry>();
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return new Map<string, StoredViewStateEntry>();
    }

    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, StoredViewStateEntry] => isStoredViewStateEntry(entry[1])
    );

    return new Map(entries);
  } catch (error) {
    logDevError('Failed to read stored editor view state', error);
    return new Map<string, StoredViewStateEntry>();
  }
}

function writeStoredViewStateMap(viewStateMap: Map<string, StoredViewStateEntry>) {
  if (!canUseStorage()) {
    return;
  }

  const prunedEntries = Array.from(viewStateMap.entries())
    .sort((left, right) => right[1].updatedAtMillis - left[1].updatedAtMillis)
    .slice(0, MAX_STORED_ENTRIES);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(prunedEntries)));
  } catch (error) {
    logDevError('Failed to persist editor view state', error);
  }
}

function findBestViewStateEntry(
  viewStateMap: Map<string, StoredViewStateEntry>,
  notePath: string,
  paneId: string | null,
  noteId: string | null
) {
  const exactEntry = viewStateMap.get(getStorageKey(notePath, paneId));
  if (exactEntry) {
    return exactEntry;
  }

  if (noteId) {
    const noteIdScopedEntry = viewStateMap.get(getStorageKeyForNoteId(noteId, paneId));
    if (noteIdScopedEntry) {
      return noteIdScopedEntry;
    }
  }

  const defaultScopeEntry = viewStateMap.get(getStorageKey(notePath));
  if (defaultScopeEntry) {
    return defaultScopeEntry;
  }

  if (noteId) {
    const noteIdDefaultScopeEntry = viewStateMap.get(getStorageKeyForNoteId(noteId));
    if (noteIdDefaultScopeEntry) {
      return noteIdDefaultScopeEntry;
    }
  }

  const legacyEntry = viewStateMap.get(notePath);
  if (legacyEntry) {
    return legacyEntry;
  }

  const scopedSuffix = `::${notePath}`;
  let latestScopedEntry: StoredViewStateEntry | null = null;

  for (const [storedKey, entry] of viewStateMap.entries()) {
    if (!storedKey.endsWith(scopedSuffix)) {
      continue;
    }

    if (!latestScopedEntry || entry.updatedAtMillis > latestScopedEntry.updatedAtMillis) {
      latestScopedEntry = entry;
    }
  }

  if (noteId) {
    const noteIdScopedSuffix = `::${NOTE_ID_PREFIX}${noteId}`;
    for (const [storedKey, entry] of viewStateMap.entries()) {
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

export function loadEditorViewState(
  notePath: string | null,
  paneId: string | null = null,
  noteId: string | null = null
): EditorViewState | null {
  if (!notePath) {
    return null;
  }

  const viewStateMap = readStoredViewStateMap();
  const entry = findBestViewStateEntry(viewStateMap, notePath, paneId, noteId);
  if (!entry) {
    return null;
  }

  const scrollTop = readStoredScrollTop(entry);

  return {
    anchor: entry.anchor,
    head: entry.head,
    ...(scrollTop === undefined ? {} : { scrollTop })
  };
}

export function saveEditorViewState(
  notePath: string | null,
  viewState: EditorViewState | null,
  paneId: string | null = null,
  noteId: string | null = null
) {
  if (!notePath || !viewState) {
    return;
  }

  const viewStateMap = readStoredViewStateMap();
  const scrollTop =
    typeof viewState.scrollTop === 'number' && Number.isFinite(viewState.scrollTop)
      ? Math.max(0, viewState.scrollTop)
      : undefined;
  const entry: StoredViewStateEntry = {
    anchor: viewState.anchor,
    head: viewState.head,
    ...(scrollTop === undefined ? {} : { scrollTop }),
    updatedAtMillis: Date.now()
  };
  viewStateMap.set(getStorageKey(notePath, paneId), entry);
  if (noteId) {
    viewStateMap.set(getStorageKeyForNoteId(noteId, paneId), entry);
  }
  writeStoredViewStateMap(viewStateMap);
}
