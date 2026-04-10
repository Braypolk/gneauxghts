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

function getCursorStorageKey(notePath: string, paneId: string | null = null) {
  return `${paneId ?? DEFAULT_PANE_CURSOR_SCOPE}::${notePath}`;
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
  } catch {
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
  } catch {
    // Ignore storage failures and leave cursor restoration disabled for this write.
  }
}

export function loadCursorPosition(notePath: string | null, paneId: string | null = null) {
  if (!notePath) {
    return null;
  }

  const cursorMap = readStoredCursorMap();
  const entry =
    cursorMap.get(getCursorStorageKey(notePath, paneId)) ??
    cursorMap.get(notePath);
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
  paneId: string | null = null
) {
  if (!notePath || !position) {
    return;
  }

  const cursorMap = readStoredCursorMap();
  cursorMap.set(getCursorStorageKey(notePath, paneId), {
    anchor: position.anchor,
    head: position.head,
    updatedAtMillis: Date.now()
  });
  writeStoredCursorMap(cursorMap);
}
