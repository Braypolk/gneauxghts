import { get, writable } from 'svelte/store';

type ModifierToken = 'Meta' | 'Ctrl' | 'Alt' | 'Shift';
type ShortcutGroupId = 'navigation' | 'workspace' | 'search' | 'editor';

export type KeyboardShortcutId =
  | 'navNote'
  | 'navList'
  | 'navSettings'
  | 'splitWorkspace'
  | 'closePane'
  | 'switchPane'
  | 'goToPreviousNote'
  | 'toggleRelatedPanel'
  | 'rememberCurrentNote'
  | 'searchCurrent'
  | 'searchAll'
  | 'recentNote1'
  | 'recentNote2'
  | 'recentNote3'
  | 'recentNote4'
  | 'recentNote5'
  | 'recentNote6'
  | 'recentNote7'
  | 'recentNote8'
  | 'recentNote9'
  | 'recentTask1'
  | 'recentTask2'
  | 'recentTask3'
  | 'recentTask4'
  | 'recentTask5'
  | 'recentTask6'
  | 'recentTask7'
  | 'recentTask8'
  | 'recentTask9'
  | 'editorUndo'
  | 'editorRedo'
  | 'editorRedoAlternate'
  | 'editorInsertBelow'
  | 'editorMoveLineUp'
  | 'editorMoveLineDown'
  | 'editorCutLine'
  | 'editorHardBreak'
  | 'editorIndentList'
  | 'editorOutdentList';

export interface KeyboardShortcutDefinition {
  id: KeyboardShortcutId;
  label: string;
  description: string;
  group: ShortcutGroupId;
  defaultBinding: string;
}

export interface KeyboardShortcutGroup {
  id: ShortcutGroupId;
  label: string;
  description: string;
}

export type KeyboardShortcutBindings = Record<KeyboardShortcutId, string>;

interface ParsedShortcutBinding {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEYBOARD_SHORTCUTS_STORAGE_KEY = 'gneauxghts.keyboard-shortcuts';
const MODIFIER_ORDER: ModifierToken[] = ['Meta', 'Ctrl', 'Alt', 'Shift'];
const NAMED_KEY_TOKENS = new Set([
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]);
const MODIFIER_ONLY_CODES = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight']);

export const keyboardShortcutGroups = [
  {
    id: 'navigation',
    label: 'Navigation',
    description: 'Move around app sections.'
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Pane layout and note actions.'
  },
  {
    id: 'search',
    label: 'Search & Recents',
    description: 'Search focus and recent-item jumps.'
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Editing commands inside note body.'
  }
] as const satisfies readonly KeyboardShortcutGroup[];

const shortcutDefinitionsBase = [
  {
    id: 'navNote',
    label: 'Go to Note',
    description: 'Open note view.',
    group: 'navigation',
    defaultBinding: 'Meta+1'
  },
  {
    id: 'navList',
    label: 'Go to List',
    description: 'Open list view.',
    group: 'navigation',
    defaultBinding: 'Meta+2'
  },
  {
    id: 'navSettings',
    label: 'Open Settings',
    description: 'Open settings screen.',
    group: 'navigation',
    defaultBinding: 'Meta+,'
  },
  {
    id: 'splitWorkspace',
    label: 'Split Workspace',
    description: 'Open second pane picker.',
    group: 'workspace',
    defaultBinding: 'Meta+/'
  },
  {
    id: 'closePane',
    label: 'Close Active Pane',
    description: 'Close current split pane.',
    group: 'workspace',
    defaultBinding: 'Meta+w'
  },
  {
    id: 'switchPane',
    label: 'Switch Active Pane',
    description: 'Move focus to other pane.',
    group: 'workspace',
    defaultBinding: 'Ctrl+Tab'
  },
  {
    id: 'goToPreviousNote',
    label: 'Go to Previous Note',
    description: 'Open the note you had open immediately before this one.',
    group: 'workspace',
    defaultBinding: 'Meta+l'
  },
  {
    id: 'toggleRelatedPanel',
    label: 'Toggle Related Panel',
    description: 'Show or hide related notes.',
    group: 'workspace',
    defaultBinding: 'Meta+r'
  },
  {
    id: 'rememberCurrentNote',
    label: 'New Idea',
    description: 'Save the current note if needed, then start a fresh note.',
    group: 'workspace',
    defaultBinding: 'Meta+s'
  },
  {
    id: 'searchCurrent',
    label: 'Search Current Note',
    description: 'Focus search in current note scope.',
    group: 'search',
    defaultBinding: 'Meta+f'
  },
  {
    id: 'searchAll',
    label: 'Search All Notes',
    description: 'Focus search in all-notes scope.',
    group: 'search',
    defaultBinding: 'Meta+Shift+f'
  },
  {
    id: 'editorUndo',
    label: 'Undo',
    description: 'Undo last editor change.',
    group: 'editor',
    defaultBinding: 'Meta+z'
  },
  {
    id: 'editorRedo',
    label: 'Redo',
    description: 'Redo editor change.',
    group: 'editor',
    defaultBinding: 'Meta+y'
  },
  {
    id: 'editorRedoAlternate',
    label: 'Redo (Alternate)',
    description: 'Alternate redo binding.',
    group: 'editor',
    defaultBinding: 'Meta+Shift+z'
  },
  {
    id: 'editorInsertBelow',
    label: 'Insert Block Below',
    description: 'Insert new block below current block.',
    group: 'editor',
    defaultBinding: 'Meta+Enter'
  },
  {
    id: 'editorMoveLineUp',
    label: 'Move Block Up',
    description: 'Move current block upward.',
    group: 'editor',
    defaultBinding: 'Alt+ArrowUp'
  },
  {
    id: 'editorMoveLineDown',
    label: 'Move Block Down',
    description: 'Move current block downward.',
    group: 'editor',
    defaultBinding: 'Alt+ArrowDown'
  },
  {
    id: 'editorCutLine',
    label: 'Cut Current Block',
    description: 'Cut whole block when selection is empty.',
    group: 'editor',
    defaultBinding: 'Meta+x'
  },
  {
    id: 'editorHardBreak',
    label: 'Insert Hard Break',
    description: 'Insert line break without splitting block.',
    group: 'editor',
    defaultBinding: 'Shift+Enter'
  },
  {
    id: 'editorIndentList',
    label: 'Indent List Item',
    description: 'Indent selected list item.',
    group: 'editor',
    defaultBinding: 'Tab'
  },
  {
    id: 'editorOutdentList',
    label: 'Outdent List Item',
    description: 'Outdent selected list item.',
    group: 'editor',
    defaultBinding: 'Shift+Tab'
  }
] as const satisfies readonly KeyboardShortcutDefinition[];

const recentNoteDefinitions = Array.from({ length: 9 }, (_, index) => {
  const slot = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: `recentNote${slot}` as const,
    label: `Open Recent Note ${slot}`,
    description: `Open recent note slot ${slot} from search bar.`,
    group: 'search',
    defaultBinding: `Ctrl+${slot}`
  } satisfies KeyboardShortcutDefinition;
});

const recentTaskDefinitions = Array.from({ length: 9 }, (_, index) => {
  const slot = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: `recentTask${slot}` as const,
    label: `Open Recent Task ${slot}`,
    description: `Open recent task slot ${slot} from search bar.`,
    group: 'search',
    defaultBinding: `Ctrl+Shift+${slot}`
  } satisfies KeyboardShortcutDefinition;
});

export const keyboardShortcutDefinitions = [
  ...shortcutDefinitionsBase,
  ...recentNoteDefinitions,
  ...recentTaskDefinitions
] as const satisfies readonly KeyboardShortcutDefinition[];

export const keyboardShortcutDefinitionsById = keyboardShortcutDefinitions.reduce(
  (accumulator, definition) => {
    accumulator[definition.id] = definition;
    return accumulator;
  },
  {} as Record<KeyboardShortcutId, KeyboardShortcutDefinition>
);

export const defaultKeyboardShortcutBindings = keyboardShortcutDefinitions.reduce(
  (accumulator, definition) => {
    accumulator[definition.id] = definition.defaultBinding;
    return accumulator;
  },
  {} as KeyboardShortcutBindings
);

export const keyboardShortcutBindings = writable<KeyboardShortcutBindings>(
  readStoredKeyboardShortcutBindings()
);

export function getShortcutDefinition(id: KeyboardShortcutId) {
  return keyboardShortcutDefinitionsById[id];
}

export function getDefaultKeyboardShortcutBinding(id: KeyboardShortcutId) {
  return defaultKeyboardShortcutBindings[id];
}

export function getKeyboardShortcutBinding(id: KeyboardShortcutId) {
  return get(keyboardShortcutBindings)[id];
}

export function setKeyboardShortcutBinding(id: KeyboardShortcutId, binding: string) {
  const normalizedBinding = normalizeShortcutBinding(binding);
  keyboardShortcutBindings.update((current) => {
    const next = {
      ...current,
      [id]: normalizedBinding
    };
    persistKeyboardShortcutBindings(next);
    return next;
  });
}

export function resetKeyboardShortcutBinding(id: KeyboardShortcutId) {
  setKeyboardShortcutBinding(id, defaultKeyboardShortcutBindings[id]);
}

export function resetAllKeyboardShortcuts() {
  const next = { ...defaultKeyboardShortcutBindings };
  keyboardShortcutBindings.set(next);
  persistKeyboardShortcutBindings(next);
}

export function isKeyboardShortcutCustomized(
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = get(keyboardShortcutBindings)
) {
  return bindings[id] !== defaultKeyboardShortcutBindings[id];
}

export function getShortcutBindingParts(binding: string): string[] {
  const parsed = parseShortcutBinding(binding);
  if (!parsed) return ['Disabled'];

  const parts: string[] = [];
  if (parsed.metaKey) parts.push('Cmd');
  if (parsed.ctrlKey) parts.push('Ctrl');
  if (parsed.altKey) parts.push('Option');
  if (parsed.shiftKey) parts.push('Shift');
  parts.push(formatShortcutKey(parsed.key));
  return parts;
}

export function formatShortcutBinding(binding: string) {
  return getShortcutBindingParts(binding).join(' + ');
}

export function recordShortcutBindingFromEvent(event: KeyboardEvent) {
  const key = getEventKeyToken(event);
  if (!key) {
    return null;
  }

  return normalizeShortcutBinding(
    [...buildModifierTokens(event), key].join('+')
  );
}

export function keyboardShortcutMatchesEvent(
  event: KeyboardEvent,
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = get(keyboardShortcutBindings)
) {
  return shortcutBindingMatchesEvent(event, bindings[id]);
}

export function shortcutBindingMatchesEvent(event: KeyboardEvent, binding: string) {
  const parsed = parseShortcutBinding(binding);
  if (!parsed) {
    return false;
  }

  const eventKey = getEventKeyToken(event);
  if (!eventKey) {
    return false;
  }

  return (
    parsed.key === eventKey &&
    parsed.metaKey === event.metaKey &&
    parsed.ctrlKey === event.ctrlKey &&
    parsed.altKey === event.altKey &&
    parsed.shiftKey === event.shiftKey
  );
}

export function usesNativeCutShortcut(
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = get(keyboardShortcutBindings)
) {
  const binding = bindings[id];
  return binding === 'Meta+x' || binding === 'Ctrl+x';
}

export function getKeyboardShortcutConflicts(
  bindings: KeyboardShortcutBindings = get(keyboardShortcutBindings)
) {
  const idsByBinding = new Map<string, KeyboardShortcutId[]>();

  for (const definition of keyboardShortcutDefinitions) {
    const binding = bindings[definition.id];
    if (!binding) {
      continue;
    }

    const ids = idsByBinding.get(binding) ?? [];
    ids.push(definition.id);
    idsByBinding.set(binding, ids);
  }

  return keyboardShortcutDefinitions.reduce(
    (accumulator, definition) => {
      const ids = idsByBinding.get(bindings[definition.id]) ?? [];
      accumulator[definition.id] = ids.filter((id) => id !== definition.id);
      return accumulator;
    },
    {} as Record<KeyboardShortcutId, KeyboardShortcutId[]>
  );
}

function normalizeShortcutBinding(binding: string) {
  if (binding.trim() === '') {
    return '';
  }

  const parsed = parseShortcutBinding(binding);
  if (!parsed) {
    return '';
  }

  const parts = [];
  if (parsed.metaKey) parts.push('Meta');
  if (parsed.ctrlKey) parts.push('Ctrl');
  if (parsed.altKey) parts.push('Alt');
  if (parsed.shiftKey) parts.push('Shift');
  parts.push(parsed.key);
  return parts.join('+');
}

export function parseShortcutBinding(binding: string): ParsedShortcutBinding | null {
  if (binding.trim() === '') {
    return null;
  }

  const tokens = binding
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const key = tokens.at(-1);
  if (!key || MODIFIER_ORDER.includes(key as ModifierToken)) {
    return null;
  }

  const modifiers = new Set(tokens.slice(0, -1));
  for (const modifier of modifiers) {
    if (!MODIFIER_ORDER.includes(modifier as ModifierToken)) {
      return null;
    }
  }

  return {
    key: normalizeKeyToken(key),
    metaKey: modifiers.has('Meta'),
    ctrlKey: modifiers.has('Ctrl'),
    altKey: modifiers.has('Alt'),
    shiftKey: modifiers.has('Shift')
  };
}

function buildModifierTokens(event: KeyboardEvent): ModifierToken[] {
  const modifiers: ModifierToken[] = [];
  if (event.metaKey) modifiers.push('Meta');
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return modifiers;
}

function getEventKeyToken(event: Pick<KeyboardEvent, 'code' | 'key'>) {
  if ('code' in event && MODIFIER_ONLY_CODES.has(event.code)) {
    return null;
  }

  if (NAMED_KEY_TOKENS.has(event.key)) {
    return event.key;
  }

  switch (event.key) {
    case ' ':
      return 'Space';
    default:
      if (event.key.length === 1) {
        return normalizePrintableKey(event.key);
      }
      return null;
  }
}

export function formatShortcutKey(key: string) {
  if (key.length === 1) {
    return /^[a-z]$/.test(key) ? key.toUpperCase() : key;
  }

  switch (key) {
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'Space':
      return 'Space';
    default:
      return key;
  }
}

function normalizeKeyToken(key: string) {
  if (NAMED_KEY_TOKENS.has(key)) {
    return key;
  }

  if (/^Key[A-Z]$/.test(key)) {
    return key.slice(3).toLowerCase();
  }

  if (/^Digit[0-9]$/.test(key)) {
    return key.slice(5);
  }

  switch (key) {
    case 'Slash':
      return '/';
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backslash':
      return '\\';
    case 'Backquote':
      return '`';
    default:
      if (key.length === 1) {
        return normalizePrintableKey(key);
      }
      return key;
  }
}

function normalizePrintableKey(key: string) {
  return /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
}

function readStoredKeyboardShortcutBindings(): KeyboardShortcutBindings {
  if (!isBrowser()) {
    return { ...defaultKeyboardShortcutBindings };
  }

  const raw = window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
  if (!raw) {
    return { ...defaultKeyboardShortcutBindings };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<KeyboardShortcutId, string>>;
    const next = { ...defaultKeyboardShortcutBindings };

    for (const definition of keyboardShortcutDefinitions) {
      const value = parsed[definition.id];
      if (typeof value !== 'string') {
        continue;
      }

      next[definition.id] = normalizeShortcutBinding(value);
    }

    return next;
  } catch {
    return { ...defaultKeyboardShortcutBindings };
  }
}

function persistKeyboardShortcutBindings(bindings: KeyboardShortcutBindings) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify(bindings));
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
