export type SplitChoice = 'current' | 'previous' | 'new';
export type SplitPickerMode = 'split' | 'start';

const SPLIT_CHOICES: readonly SplitChoice[] = ['current', 'previous', 'new'];
const SPLIT_OPTION_IDS: Readonly<Record<SplitChoice, string>> = {
  current: 'split-choice-current',
  previous: 'split-choice-previous',
  new: 'split-choice-new'
};

function getEnabledIndexes(hasPrevious: boolean): readonly number[] {
  return hasPrevious ? [0, 1, 2] : [0, 2];
}

export function getSplitChoiceByIndex(
  highlightedIndex: number,
  hasPrevious: boolean
): SplitChoice | null {
  const choice = SPLIT_CHOICES[highlightedIndex];
  if (!choice) {
    return null;
  }

  if (choice === 'previous' && !hasPrevious) {
    return null;
  }

  return choice;
}

export function getNextSplitChoiceIndex(
  highlightedIndex: number,
  direction: 1 | -1,
  hasPrevious: boolean
): number {
  const indexes = getEnabledIndexes(hasPrevious);
  const currentPosition = indexes.indexOf(highlightedIndex);
  const basePosition = currentPosition >= 0 ? currentPosition : 0;
  return indexes[(basePosition + direction + indexes.length) % indexes.length] ?? 0;
}

export function getSplitChoiceForShortcut(key: string, hasPrevious: boolean): SplitChoice | null {
  const shortcutIndex = Number(key);
  if (!Number.isInteger(shortcutIndex) || shortcutIndex < 1 || shortcutIndex > 3) {
    return null;
  }

  return getSplitChoiceByIndex(shortcutIndex - 1, hasPrevious);
}

export function getSplitOptionId(choice: SplitChoice): string {
  return SPLIT_OPTION_IDS[choice];
}
