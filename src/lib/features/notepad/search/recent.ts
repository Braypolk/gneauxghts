import type { SearchItem } from '$lib/types/semantic';

export async function loadLatestCollection<T>(
  isLatest: () => boolean,
  load: () => Promise<T[]>,
  apply: (items: T[]) => void,
  reset: () => void,
  errorLabel: string
) {
  try {
    const items = await load();

    return {
      items,
      applyIfLatest() {
        if (!isLatest()) {
          return false;
        }

        apply(items);
        return true;
      }
    };
  } catch (error) {
    if (isLatest()) {
      reset();
    }

    console.error(errorLabel, error);
    return {
      items: [] as T[],
      applyIfLatest() {
        return false;
      }
    };
  }
}

export async function getIndexedRecentItem<T>(
  index: number,
  items: T[],
  forceReload: boolean,
  refresh: () => Promise<T[]>
) {
  const nextItems = forceReload || !items[index] ? await refresh() : items;
  return nextItems[index];
}

export async function runRecentSelection<T>(
  item: T | undefined,
  open: (item: T) => Promise<void>,
  errorLabel: string
) {
  if (!item) {
    return;
  }

  try {
    await open(item);
  } catch (error) {
    console.error(errorLabel, error);
  }
}

export async function openRecentNoteItem(
  note: SearchItem,
  {
    clearSearch,
    handleSearchResultSelect,
    openNotePath
  }: {
    clearSearch: () => void;
    handleSearchResultSelect: (result: SearchItem) => Promise<void>;
    openNotePath: (notePath: string) => Promise<void>;
  }
) {
  clearSearch();

  if (!note.notePath) {
    await handleSearchResultSelect(note);
    return;
  }

  await openNotePath(note.notePath);
}
