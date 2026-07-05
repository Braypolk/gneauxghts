import type { EditorMenuGroup, EditorMenuOption } from '$lib/features/notepad/editor/blockTypes';

export interface EditorMenuItemWithIndex extends EditorMenuOption {
  index: number;
}

export interface EditorMenuGroupWithItems {
  key: string;
  label: string;
  range: readonly [number, number];
  items: EditorMenuItemWithIndex[];
}

export interface EditorMenuModel {
  groups: EditorMenuGroupWithItems[];
  size: number;
}

export function buildEditorMenuModel(
  groups: readonly EditorMenuGroup[],
  filter = ''
): EditorMenuModel {
  const normalizedFilter = filter.trim().toLowerCase();
  const nextGroups: EditorMenuGroupWithItems[] = [];
  let index = 0;

  for (const group of groups) {
    const items = group.items
      .filter((item) => {
        if (normalizedFilter === '') {
          return true;
        }
        return item.label.toLowerCase().includes(normalizedFilter);
      })
      .map((item) => ({
        ...item,
        index: index++
      }));

    if (items.length === 0) {
      continue;
    }

    nextGroups.push({
      key: group.key,
      label: group.label,
      range: [items[0].index, items[items.length - 1].index + 1],
      items
    });
  }

  return {
    groups: nextGroups,
    size: index
  };
}
