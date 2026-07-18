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
    return left.conversationId === right.conversationId;
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

export function createLocationMruStore<TPaneId extends string>() {
  const lists = new Map<TPaneId, NavLocation[]>();

  function listFor(paneId: TPaneId): NavLocation[] {
    let list = lists.get(paneId);
    if (!list) {
      list = [];
      lists.set(paneId, list);
    }
    return list;
  }

  function touch(paneId: TPaneId, location: NavLocation): void {
    if (!isRestorableLocation(location)) {
      return;
    }
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
    const list = listFor(paneId);
    for (const entry of list) {
      if (!current || !locationsEqual(entry, current)) {
        return entry;
      }
    }
    return null;
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
  }

  function clearAll(): void {
    lists.clear();
  }

  return {
    touch,
    previousExcluding,
    seedIfEmpty,
    list,
    clear,
    clearAll
  };
}

export type LocationMruStore<TPaneId extends string> = ReturnType<
  typeof createLocationMruStore<TPaneId>
>;
