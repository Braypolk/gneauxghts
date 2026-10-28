import { getShortcutBindingParts } from '#lib/keyboardShortcuts.svelte.js';

// Follows the search behavior in VS Code's KeybindingsEditorModel:
// https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/preferences/browser/keybindingsEditorModel.ts
// Implemented for our single-keystroke bindings: split on spaces/+, match every
// term within one binding, recognize modifier labels, and quote for exact match.
const aliases: Record<string, string> = {
  cmd: 'meta', command: 'meta', meta: 'meta', '⌘': 'meta', win: 'meta', windows: 'meta', super: 'meta',
  ctrl: 'ctrl', control: 'ctrl', '⌃': 'ctrl',
  alt: 'alt', option: 'alt', opt: 'alt', '⌥': 'alt',
  shift: 'shift', '⇧': 'shift',
  esc: 'escape', return: 'enter', spacebar: 'space',
  arrowup: 'up', '↑': 'up', arrowdown: 'down', '↓': 'down',
  arrowleft: 'left', '←': 'left', arrowright: 'right', '→': 'right',
  '+': 'plus',
};
const modifiers = new Set(['meta', 'ctrl', 'alt', 'shift']);
const normalize = (word: string) => aliases[word.toLowerCase()] ?? word.toLowerCase();

function bindingWords(query: string): string[] {
  if (query === '+') return ['plus'];
  return query.replace(/([⌘⌃⌥⇧])/g, ' $1 ')
    .replace(/\+\s*\+/g, ' plus ')
    .split(/[\s+]+/).filter(Boolean).map(normalize);
}

/** Text search and keybinding search are alternatives, as in VS Code. */
export function matchesKeyboardShortcutSearch(query: string, binding: string, textFields: readonly string[]): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  const exact = search.startsWith('"') && search.endsWith('"') && search.length > 1;
  const unquoted = search.replace(/^"|"$/g, '').trim();
  if (!exact && textFields.some(field => {
    const text = field.toLowerCase();
    return unquoted.split(/\s+/).every(word => text.includes(word));
  })) return true;
  if (!binding) return false;

  const words = bindingWords(unquoted);
  if (!words.length) return false;
  const parts = getShortcutBindingParts(binding).map(normalize);
  const key = parts.find(part => !modifiers.has(part)) ?? '';
  const keyLabels = key ? [key, binding.split('+').at(-1)!.toLowerCase()] : [];
  const bindingModifiers = parts.filter(part => modifiers.has(part));
  const keyWords = words.filter(word => !modifiers.has(word));
  if (!words.every(word => modifiers.has(word) ? bindingModifiers.includes(word)
    : word === key || (!exact && word.length > 1 && keyLabels.some(label => label.length > 1 && label.includes(word))))) return false;
  return !exact || (keyWords.length === (key ? 1 : 0) && bindingModifiers.every(modifier => words.includes(modifier)));
}
