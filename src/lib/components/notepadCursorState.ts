export interface NotepadCursorPosition {
  anchor: number;
  head: number;
}

interface StoredCursorEntry extends NotepadCursorPosition {
  updatedAtMillis: number;
}

const STORAGE_KEY = 'gneauxghts:notepad-cursors:v1';
const MAX_STORED_CURSORS = 200;

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

export function loadNotepadCursorPosition(notePath: string | null) {
  if (!notePath) {
    return null;
  }

  const entry = readStoredCursorMap().get(notePath);
  if (!entry) {
    return null;
  }

  return {
    anchor: entry.anchor,
    head: entry.head
  };
}

export function saveNotepadCursorPosition(
  notePath: string | null,
  position: NotepadCursorPosition | null
) {
  if (!notePath || !position) {
    return;
  }

  const cursorMap = readStoredCursorMap();
  cursorMap.set(notePath, {
    anchor: position.anchor,
    head: position.head,
    updatedAtMillis: Date.now()
  });
  writeStoredCursorMap(cursorMap);
}
