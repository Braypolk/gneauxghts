export type ListNavigationMode = 'keyboard' | 'pointer';
export type ListSelectionDirection = -1 | 1;

export interface ListSelectionState {
  activeIndex: number;
  navigationMode: ListNavigationMode;
}

export interface ListSelectionOptions {
  optionCount: number;
  isOptionDisabled?: (index: number) => boolean;
  fallbackIndex?: number;
}

export function getSelectableListIndexes({
  optionCount,
  isOptionDisabled
}: ListSelectionOptions): number[] {
  const indexes: number[] = [];

  for (let index = 0; index < optionCount; index += 1) {
    if (!isOptionDisabled?.(index)) {
      indexes.push(index);
    }
  }

  return indexes;
}

export function getNextListSelectionIndex(
  currentIndex: number,
  direction: ListSelectionDirection,
  options: ListSelectionOptions
): number {
  const selectableIndexes = getSelectableListIndexes(options);

  if (selectableIndexes.length === 0) {
    return options.fallbackIndex ?? 0;
  }

  const currentPosition = selectableIndexes.indexOf(currentIndex);
  if (currentPosition < 0) {
    return selectableIndexes[0] ?? options.fallbackIndex ?? 0;
  }

  return selectableIndexes[
    (currentPosition + direction + selectableIndexes.length) % selectableIndexes.length
  ] ?? selectableIndexes[0] ?? options.fallbackIndex ?? 0;
}

export function moveListSelection(
  state: ListSelectionState,
  direction: ListSelectionDirection,
  options: ListSelectionOptions
): ListSelectionState {
  return {
    activeIndex: getNextListSelectionIndex(state.activeIndex, direction, options),
    navigationMode: 'keyboard'
  };
}

export function pointListSelection(
  index: number,
  options: ListSelectionOptions
): ListSelectionState | null {
  if (index < 0 || index >= options.optionCount || options.isOptionDisabled?.(index)) {
    return null;
  }

  return {
    activeIndex: index,
    navigationMode: 'pointer'
  };
}
