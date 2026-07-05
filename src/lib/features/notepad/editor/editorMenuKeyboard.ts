import type { EditorMenuGroupWithItems } from '$lib/features/notepad/editor/editorMenuModel';

export function consumeMenuKeyEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function clampMenuHoverIndex(index: number, size: number) {
  return Math.max(0, Math.min(index, Math.max(0, size - 1)));
}

export function stepMenuHoverIndex(hoverIndex: number, direction: 'up' | 'down', size: number) {
  return clampMenuHoverIndex(hoverIndex + (direction === 'down' ? 1 : -1), size);
}

export function stepMenuHoverGroup(
  hoverIndex: number,
  direction: 'left' | 'right',
  groups: readonly EditorMenuGroupWithItems[]
): number | null {
  const group = groups.find(
    (candidate) => hoverIndex >= candidate.range[0] && hoverIndex < candidate.range[1]
  );
  if (!group) {
    return null;
  }

  const groupIndex = groups.indexOf(group);
  const nextGroup = direction === 'left' ? groups[groupIndex - 1] : groups[groupIndex + 1];
  if (!nextGroup) {
    return null;
  }

  return direction === 'left' ? nextGroup.range[1] - 1 : nextGroup.range[0];
}
