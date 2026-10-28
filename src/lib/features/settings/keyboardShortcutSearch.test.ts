import { describe, expect, it } from 'vitest';
import { matchesKeyboardShortcutSearch } from './keyboardShortcutSearch';

const matches = (query: string, binding = 'Meta+Shift+Enter', fields = ['Open Result in Split', 'searchOpenInSplit', 'Default']) =>
  matchesKeyboardShortcutSearch(query, binding, fields);

describe('keyboard shortcut search', () => {
  it.each(['cmd+shift', 'cmd shift', 'CMD + SHIFT', 'shift cmd', 'command shift', 'meta+shift', '⌘⇧', ' cmd   shift '])
    ('matches every requested modifier within a binding: %s', query => {
      expect(matches(query)).toBe(true);
      expect(matches(query, 'Meta+Enter')).toBe(false);
      expect(matches(query, 'Alt+Shift+Enter')).toBe(false);
      expect(matches(query, 'Meta+Ctrl+Shift+Enter')).toBe(true);
    });

  it('keeps alternatives separate and follows custom assignments', () => {
    const alternatives = ['Meta+Enter', 'Alt+Shift+Enter'];
    expect(alternatives.some(binding => matches('cmd shift', binding))).toBe(false);
    expect(matches('cmd shift', '')).toBe(false);
    expect(matches('ctrl shift', 'Ctrl+Shift+Enter')).toBe(true);
    expect(matches('cmd shift', 'Ctrl+Shift+Enter')).toBe(false);
  });

  it.each([
    ['option return', 'Alt+Enter'], ['alt+enter', 'Alt+Enter'], ['⌥ enter', 'Alt+Enter'],
    ['control shift z', 'Ctrl+Shift+z'], ['⌃⇧z', 'Ctrl+Shift+z'],
    ['ctrl up', 'Ctrl+ArrowUp'], ['ctrl arrowup', 'Ctrl+ArrowUp'], ['ctrl ↑', 'Ctrl+ArrowUp'],
    ['cmd esc', 'Meta+Escape'], ['cmd space', 'Meta+Space'], ['cmd f2', 'Meta+F2'],
    ['+', 'Shift+Plus'], ['shift++', 'Shift+Plus'], ['shift + +', 'Shift+Plus'], ['shift plus', 'Shift+Plus'],
    ['cmd+\\', 'Meta+Backslash'], ['cmd /', 'Meta+/'], ['arrow', 'Ctrl+ArrowUp'],
  ])('finds keys and aliases: %s', (query, binding) => {
    expect(matches(query, binding)).toBe(true);
  });

  it('matches named keys partially but single-letter keys exactly', () => {
    expect(matches('cmd ent')).toBe(true);
    expect(matches('cmd e')).toBe(false);
    expect(matches('cmd enter x')).toBe(false);
    expect(matches('cmd shift nonsense')).toBe(false);
  });

  it('matches quoted complete bindings without extra or missing modifiers', () => {
    expect(matches('"cmd shift enter"')).toBe(true);
    expect(matches('"cmd+shift+enter"')).toBe(true);
    expect(matches('"shift command enter"')).toBe(true);
    expect(matches('"cmd shift"')).toBe(false);
    expect(matches('"cmd enter"')).toBe(false);
    expect(matches('"cmd shift enter"', 'Meta+Ctrl+Shift+Enter')).toBe(false);
    expect(matches('"Open Result in Split"')).toBe(false);
  });

  it('finds modifier-only hold assignments, including exact searches', () => {
    expect(matches('option', 'Alt')).toBe(true);
    expect(matches('cmd+shift', 'Meta+Shift')).toBe(true);
    expect(matches('"cmd shift"', 'Meta+Shift')).toBe(true);
    expect(matches('"cmd"', 'Meta+Shift')).toBe(false);
    expect(matches('cmd shift enter', 'Meta+Shift')).toBe(false);
  });

  it('preserves command, category and source searches, including separated words', () => {
    expect(matches('open split')).toBe(true);
    expect(matches('searchopen')).toBe(true);
    expect(matches('default')).toBe(true);
    expect(matches('editor', '', ['Editor'])).toBe(true);
    expect(matches('Open Result in Split', '')).toBe(true);
    expect(matches('does not exist')).toBe(false);
    expect(matches('')).toBe(true);
    expect(matches('   ', '')).toBe(true);
  });
});
