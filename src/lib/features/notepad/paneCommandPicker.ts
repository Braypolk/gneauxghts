import { getNextListSelectionIndex } from '$lib/ui/listSelection';

export type PaneCommandChoice = 'typing' | 'current' | 'previous' | 'thoughtPartner';
export type PaneCommandMode = 'split' | 'start';

export interface PaneCommandOption {
  choice: PaneCommandChoice;
  label: string;
  description: string;
}

/** Shared copy and ordering for every surface that offers pane commands. */
export const PANE_COMMAND_OPTIONS: Readonly<Record<PaneCommandChoice, PaneCommandOption>> = {
  typing: { choice: 'typing', label: 'Open blank pane', description: 'Start typing in a new pane' },
  current: { choice: 'current', label: 'Open Current Note', description: 'Open this note in the new pane' },
  previous: { choice: 'previous', label: 'Open Previous Note', description: 'Open your previous note in the new pane' },
  thoughtPartner: { choice: 'thoughtPartner', label: 'Open Thought partner', description: 'Open AI chat alongside this thought' }
};

export const PANE_COMMAND_SPLIT_OPTIONS = [
  PANE_COMMAND_OPTIONS.typing,
  PANE_COMMAND_OPTIONS.current,
  PANE_COMMAND_OPTIONS.previous,
  PANE_COMMAND_OPTIONS.thoughtPartner
] as const;

const PANE_COMMAND_OPTION_IDS: Readonly<Record<PaneCommandChoice, string>> = {
  typing: 'pane-command-typing',
  current: 'pane-command-current',
  previous: 'pane-command-previous',
  thoughtPartner: 'pane-command-thought-partner'
};

export const PANE_COMMAND_TYPING_INDEX = 0;

export const PANE_COMMAND_START_INDEX = {
  previous: 1,
  thoughtPartner: 2
} as const;

export const PANE_COMMAND_SPLIT_INDEX = {
  current: 1,
  previous: 2,
  thoughtPartner: 3
} as const;

function getPaneCommandOptionCount(mode: PaneCommandMode): number {
  return mode === 'split' ? 4 : 3;
}

function isPaneCommandIndexDisabled(
  index: number,
  hasPrevious: boolean,
  mode: PaneCommandMode
): boolean {
  return getPaneCommandChoiceByIndex(index, hasPrevious, mode) === null;
}

export function isHiddenPaneCommandIndex(highlightedIndex: number): boolean {
  return highlightedIndex === PANE_COMMAND_TYPING_INDEX;
}

export function getPaneCommandChoiceByIndex(
  highlightedIndex: number,
  hasPrevious: boolean,
  mode: PaneCommandMode = 'split'
): PaneCommandChoice | null {
  if (highlightedIndex === PANE_COMMAND_TYPING_INDEX) {
    return 'typing';
  }

  if (mode === 'start') {
    if (highlightedIndex === PANE_COMMAND_START_INDEX.previous) {
      return hasPrevious ? 'previous' : null;
    }
    if (highlightedIndex === PANE_COMMAND_START_INDEX.thoughtPartner) {
      return 'thoughtPartner';
    }
    return null;
  }

  if (highlightedIndex === PANE_COMMAND_SPLIT_INDEX.current) {
    return 'current';
  }
  if (highlightedIndex === PANE_COMMAND_SPLIT_INDEX.previous) {
    return hasPrevious ? 'previous' : null;
  }
  if (highlightedIndex === PANE_COMMAND_SPLIT_INDEX.thoughtPartner) {
    return 'thoughtPartner';
  }

  return null;
}

export function getNextPaneCommandIndex(
  highlightedIndex: number,
  direction: 1 | -1,
  hasPrevious: boolean,
  mode: PaneCommandMode = 'split'
): number {
  return getNextListSelectionIndex(highlightedIndex, direction, {
    optionCount: getPaneCommandOptionCount(mode),
    isOptionDisabled: (index) => isPaneCommandIndexDisabled(index, hasPrevious, mode),
    fallbackIndex: PANE_COMMAND_TYPING_INDEX
  });
}

function getChoiceIndexForShortcut(
  shortcutIndex: number,
  mode: PaneCommandMode
): number | null {
  if (mode === 'split') {
    if (shortcutIndex === 1) return PANE_COMMAND_SPLIT_INDEX.current;
    if (shortcutIndex === 2) return PANE_COMMAND_SPLIT_INDEX.previous;
    if (shortcutIndex === 3) return PANE_COMMAND_SPLIT_INDEX.thoughtPartner;
    return null;
  }

  if (shortcutIndex === 1) return PANE_COMMAND_START_INDEX.previous;
  if (shortcutIndex === 2) return PANE_COMMAND_START_INDEX.thoughtPartner;
  return null;
}

/** Fixed slot label for each visible row — stable across enabled/disabled states. */
export function getPaneCommandShortcutLabel(
  choiceIndex: number,
  mode: PaneCommandMode
): string | null {
  const shortcutIndex =
    mode === 'split'
      ? choiceIndex === PANE_COMMAND_SPLIT_INDEX.current
        ? 1
        : choiceIndex === PANE_COMMAND_SPLIT_INDEX.previous
          ? 2
          : choiceIndex === PANE_COMMAND_SPLIT_INDEX.thoughtPartner
            ? 3
            : null
      : choiceIndex === PANE_COMMAND_START_INDEX.previous
        ? 1
        : choiceIndex === PANE_COMMAND_START_INDEX.thoughtPartner
          ? 2
          : null;

  return shortcutIndex === null ? null : String(shortcutIndex);
}

export function getPaneCommandForShortcut(
  key: string,
  hasPrevious: boolean,
  mode: PaneCommandMode = 'split'
): PaneCommandChoice | null {
  const shortcutIndex = Number(key);
  if (!Number.isInteger(shortcutIndex) || shortcutIndex < 1) {
    return null;
  }

  const choiceIndex = getChoiceIndexForShortcut(shortcutIndex, mode);
  if (choiceIndex === null) {
    return null;
  }

  return getPaneCommandChoiceByIndex(choiceIndex, hasPrevious, mode);
}

export function getPaneCommandOptionId(choice: PaneCommandChoice): string {
  return PANE_COMMAND_OPTION_IDS[choice];
}
