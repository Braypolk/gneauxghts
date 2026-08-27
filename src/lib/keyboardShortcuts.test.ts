import { describe, expect, it } from 'vitest';

import {
  defaultKeyboardShortcutBindings,
  formatShortcutBinding,
  getEffectiveDefaultKeyboardShortcutBinding,
  getEffectiveKeyboardShortcutBinding,
  getKeyboardShortcutConflicts,
  keyboardShortcutMatchesEvent
} from './keyboardShortcuts.svelte';

function keyboardEvent(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
  > = {}
) {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers
  } as KeyboardEvent;
}

describe('editor link shortcut', () => {
  it('uses Cmd+K on macOS and Ctrl+K elsewhere', () => {
    expect(
      keyboardShortcutMatchesEvent(
        keyboardEvent('k', { metaKey: true }),
        'editorLink',
        defaultKeyboardShortcutBindings,
        'MacIntel'
      )
    ).toBe(true);
    expect(
      keyboardShortcutMatchesEvent(
        keyboardEvent('k', { ctrlKey: true }),
        'editorLink',
        defaultKeyboardShortcutBindings,
        'Win32'
      )
    ).toBe(true);
  });

  it('formats the same effective binding shown by shortcut labels', () => {
    expect(
      formatShortcutBinding(
        getEffectiveKeyboardShortcutBinding(
          'editorLink',
          defaultKeyboardShortcutBindings,
          'Linux x86_64'
        )
      )
    ).toBe('Ctrl + K');
    expect(
      formatShortcutBinding(getEffectiveDefaultKeyboardShortcutBinding('editorLink', 'Win32'))
    ).toBe('Ctrl + K');
  });

  it('detects conflicts against the bindings that actually run on the platform', () => {
    const bindings = {
      ...defaultKeyboardShortcutBindings,
      editorBold: 'Ctrl+k'
    };

    expect(getKeyboardShortcutConflicts(bindings, 'Win32').editorLink).toContain('editorBold');
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').editorLink).not.toContain(
      'editorBold'
    );
  });

  it('lets a custom remapping win on every platform', () => {
    const remapped = {
      ...defaultKeyboardShortcutBindings,
      editorLink: 'Alt+l'
    };
    expect(
      keyboardShortcutMatchesEvent(
        keyboardEvent('l', { altKey: true }),
        'editorLink',
        remapped,
        'Win32'
      )
    ).toBe(true);
    expect(
      keyboardShortcutMatchesEvent(
        keyboardEvent('k', { ctrlKey: true }),
        'editorLink',
        remapped,
        'Win32'
      )
    ).toBe(false);
  });
});
