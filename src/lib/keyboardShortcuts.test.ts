import { afterEach, describe, expect, it, vi } from 'vitest';
import { restartLifecycle } from '#lib/app/restartLifecycle.svelte.js';

import {
  defaultKeyboardShortcutBindings,
  formatShortcutBinding,
  getEffectiveDefaultKeyboardShortcutBinding,
  getEffectiveKeyboardShortcutBinding,
  getEffectiveKeyboardShortcutBindings,
  getKeyboardShortcutConflicts,
  keyboardShortcutMatchesEvent,
  keyboardShortcutModifiersMatchEvent,
  keyboardShortcuts,
  keyboardShortcutDefinitions,
  parseShortcutBinding,
  isKeyboardShortcutCustomized,
  recordShortcutBindingFromEvent,
  resolveStoredKeyboardShortcutBindings,
  resetAllKeyboardShortcuts,
  resetKeyboardShortcutBinding,
  setKeyboardShortcutBindings
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

describe('history shortcut', () => {
  it('defaults to Cmd+Shift+H and honors a custom binding', () => {
    const event = keyboardEvent('H', { metaKey: true, shiftKey: true });
    expect(keyboardShortcutMatchesEvent(event, 'showHistory')).toBe(true);
    const remapped = { ...defaultKeyboardShortcutBindings, showHistory: ['Alt+h'] };
    expect(keyboardShortcutMatchesEvent(event, 'showHistory', remapped)).toBe(false);
    expect(keyboardShortcutMatchesEvent(
      keyboardEvent('h', { altKey: true }), 'showHistory', remapped
    )).toBe(true);
  });

  it('does not admit a global shortcut while restart owns workspace departure', () => {
    const event = keyboardEvent('H', { metaKey: true, shiftKey: true });
    restartLifecycle.observeBackendPreparing();
    try {
      expect(keyboardShortcutMatchesEvent(event, 'showHistory')).toBe(false);
    } finally {
      restartLifecycle.workspaceMutationsBlocked = false;
      restartLifecycle.phase = 'idle';
    }
  });
});

describe('multiple keybindings', () => {
  afterEach(() => { resetAllKeyboardShortcuts(); keyboardShortcuts.recording = false; });

  it('migrates old remaps and disabled bindings, merging both old Redo commands', () => {
    const bindings = resolveStoredKeyboardShortcutBindings({
      showHistory: 'Alt+h', navNote: '', editorRedo: 'Ctrl+r', editorRedoAlternate: 'Alt+r'
    });
    expect(bindings.showHistory).toEqual(['Alt+h']);
    expect(bindings.navNote).toEqual([]);
    expect(bindings.editorRedo).toEqual(['Ctrl+r', 'Alt+r']);
    expect(bindings.searchOpenInSplit).toEqual(['Alt+Enter', 'Meta+Shift+Enter']);
    expect(resolveStoredKeyboardShortcutBindings({ editorRedoAlternate: '' }).editorRedo).toEqual(['Meta+y']);
    expect(resolveStoredKeyboardShortcutBindings({ editorRedo: '' }).editorRedo).toEqual(['Meta+Shift+z']);
  });

  it('round-trips arrays, including removal of every binding, without reviving defaults', () => {
    const bindings = resolveStoredKeyboardShortcutBindings({
      editorRedo: [], editorRedoAlternate: 'Alt+r', showHistory: ['Shift+Alt+h', 'Alt+Shift+h', 'Alt+j'], navNote: 7
    });
    expect(bindings.editorRedo).toEqual([]);
    expect(bindings.showHistory).toEqual(['Alt+Shift+h', 'Alt+j']);
    expect(bindings.navNote).toEqual(defaultKeyboardShortcutBindings.navNote);
    expect(resolveStoredKeyboardShortcutBindings(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings);
  });

  it('preserves explicit bindings that differ from platform defaults even when they equal Mac defaults', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    try {
      for (const [id, binding, defaults] of [
        ['editorTransposeChars', 'Ctrl+t', []],
        ['editorSplitLine', 'Ctrl+o', []],
        ['editorLink', 'Meta+k', ['Ctrl+k']]
      ] as const) {
        expect(getEffectiveKeyboardShortcutBindings(id)).toEqual(defaults);
        setKeyboardShortcutBindings(id, [binding]);
        expect(isKeyboardShortcutCustomized(id)).toBe(true);
        expect(getEffectiveKeyboardShortcutBindings(id)).toEqual([binding]);
        const reloaded = resolveStoredKeyboardShortcutBindings(JSON.parse(JSON.stringify(keyboardShortcuts.bindings)));
        expect(getEffectiveKeyboardShortcutBindings(id, reloaded, 'Win32')).toEqual([binding]);
        resetKeyboardShortcutBinding(id);
        expect(isKeyboardShortcutCustomized(id)).toBe(false);
        expect(getEffectiveKeyboardShortcutBindings(id)).toEqual(defaults);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('ignores platform override markers for malformed or missing assignments', () => {
    for (const raw of [undefined, [7], ['Ctrl+t', null]]) {
      const bindings = resolveStoredKeyboardShortcutBindings({ editorTransposeChars: raw,
        explicitPlatformOverrides: ['editorTransposeChars', 'unknown'] });
      expect(getEffectiveKeyboardShortcutBindings('editorTransposeChars', bindings, 'Win32')).toEqual([]);
      expect(isKeyboardShortcutCustomized('editorTransposeChars', bindings)).toBe(false);
    }
  });

  it('dispatches all alternatives and honors replacement and disable', () => {
    setKeyboardShortcutBindings('showHistory', ['Alt+h', 'Ctrl+h']);
    expect(keyboardShortcutMatchesEvent(keyboardEvent('h', { altKey: true }), 'showHistory')).toBe(true);
    expect(keyboardShortcutMatchesEvent(keyboardEvent('h', { ctrlKey: true }), 'showHistory')).toBe(true);
    expect(keyboardShortcutMatchesEvent(keyboardEvent('h', { metaKey: true, shiftKey: true }), 'showHistory')).toBe(false);
    setKeyboardShortcutBindings('showHistory', []);
    expect(keyboardShortcutMatchesEvent(keyboardEvent('h', { altKey: true }), 'showHistory')).toBe(false);
  });

  it('uses the configured search split modifiers for clicks', () => {
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'searchOpenInSplit')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ metaKey: true, shiftKey: true }, 'searchOpenInSplit')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ metaKey: true }, 'searchOpenInSplit')).toBe(false);
    setKeyboardShortcutBindings('searchOpenInSplit', ['Ctrl+Enter']);
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'searchOpenInSplit')).toBe(false);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true }, 'searchOpenInSplit')).toBe(true);
    setKeyboardShortcutBindings('searchOpenInSplit', []);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true }, 'searchOpenInSplit')).toBe(false);
  });

  it('assigns the held split preview independently from search result splitting', () => {
    expect(defaultKeyboardShortcutBindings.showSplitOptions).toEqual(['Alt', 'Meta+Shift']);
    expect(formatShortcutBinding('Alt')).toBe('Option');
    expect(formatShortcutBinding('Meta+Shift')).toBe('Cmd + Shift');
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'showSplitOptions')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ metaKey: true, shiftKey: true }, 'showSplitOptions')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ metaKey: true }, 'showSplitOptions')).toBe(false);
    setKeyboardShortcutBindings('showSplitOptions', ['Ctrl+Shift']);
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'showSplitOptions')).toBe(false);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true, shiftKey: true }, 'showSplitOptions')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'searchOpenInSplit')).toBe(true);
    expect(resolveStoredKeyboardShortcutBindings(JSON.parse(JSON.stringify(keyboardShortcuts.bindings))).showSplitOptions).toEqual(['Ctrl+Shift']);
    setKeyboardShortcutBindings('showSplitOptions', []);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true, shiftKey: true }, 'showSplitOptions')).toBe(false);
    expect(resolveStoredKeyboardShortcutBindings({}).showSplitOptions).toEqual(['Alt', 'Meta+Shift']);
  });

  it('records modifier-only combinations only for hold assignments', () => {
    const option = { ...keyboardEvent('Alt', { altKey: true }), code: 'AltLeft' };
    const cmdShift = { ...keyboardEvent('Shift', { metaKey: true, shiftKey: true }), code: 'ShiftLeft' };
    expect(recordShortcutBindingFromEvent(option)).toBeNull();
    expect(recordShortcutBindingFromEvent(option, { modifiersOnly: true })).toBe('Alt');
    expect(recordShortcutBindingFromEvent(cmdShift, { modifiersOnly: true })).toBe('Meta+Shift');
    expect(recordShortcutBindingFromEvent(keyboardEvent('k', { ctrlKey: true }), { modifiersOnly: true })).toBeNull();
    expect(keyboardShortcutMatchesEvent(option, 'showSplitOptions')).toBe(false);
    setKeyboardShortcutBindings('showSplitOptions', ['Alt', 'Meta+Enter']);
    expect(keyboardShortcuts.bindings.showSplitOptions).toEqual(['Alt']);
    setKeyboardShortcutBindings('editorBold', ['Meta', 'Ctrl+b']);
    expect(keyboardShortcuts.bindings.editorBold).toEqual(['Ctrl+b']);
  });

  it('requires the exact modifier set for held previews, including custom bindings', () => {
    for (let mask = 0; mask < 16; mask++) {
      const event = { metaKey: !!(mask & 1), ctrlKey: !!(mask & 2), altKey: !!(mask & 4), shiftKey: !!(mask & 8) };
      expect(keyboardShortcutModifiersMatchEvent(event, 'showSplitOptions'), `modifier mask ${mask}`).toBe(mask === 4 || mask === 9);
    }
    setKeyboardShortcutBindings('showSplitOptions', ['Ctrl+Shift']);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true, shiftKey: true }, 'showSplitOptions')).toBe(true);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true, shiftKey: true, metaKey: true }, 'showSplitOptions')).toBe(false);
    expect(keyboardShortcutModifiersMatchEvent({ ctrlKey: true, shiftKey: true, altKey: true }, 'showSplitOptions')).toBe(false);
  });

  it('requires exact search split modifiers for clicks and keys, including custom bindings', () => {
    for (const [bindings, allowed] of [
      [['Alt+Enter', 'Meta+Shift+Enter'], [4, 9]],
      [['Ctrl+Enter'], [2]]
    ] as const) {
      setKeyboardShortcutBindings('searchOpenInSplit', [...bindings]);
      for (let mask = 0; mask < 16; mask++) {
        const modifiers = { metaKey: !!(mask & 1), ctrlKey: !!(mask & 2), altKey: !!(mask & 4), shiftKey: !!(mask & 8) };
        const matches = (allowed as readonly number[]).includes(mask);
        expect(keyboardShortcutModifiersMatchEvent(modifiers, 'searchOpenInSplit'), `click mask ${mask}`).toBe(matches);
        expect(keyboardShortcutMatchesEvent(keyboardEvent('Enter', modifiers), 'searchOpenInSplit'), `key mask ${mask}`).toBe(matches);
      }
    }
  });

  it('rejects extra modifiers on every registered keybinding', () => {
    for (const { id } of keyboardShortcutDefinitions) {
      const bindings = defaultKeyboardShortcutBindings[id];
      for (const binding of bindings) {
        const parsed = parseShortcutBinding(binding)!;
        if (!parsed.key) continue;
        const { key, ...modifiers } = parsed;
        const event = keyboardEvent(key === 'Plus' ? '+' : key === 'Space' ? ' ' : key, modifiers);
        const configured = { ...defaultKeyboardShortcutBindings, [id]: [binding] };
        const command = id;
        expect(keyboardShortcutMatchesEvent(event, command, configured, 'MacIntel'), binding).toBe(true);
        for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
          if (parsed[modifier]) continue;
          expect(keyboardShortcutMatchesEvent({ ...event, [modifier]: true }, command, configured, 'MacIntel'), `${binding} + ${modifier}`).toBe(false);
        }
      }
    }
  });

  it('suppresses every registered command and pointer alternative during recording', () => {
    keyboardShortcuts.recording = true;
    expect(keyboardShortcutMatchesEvent(keyboardEvent('2', { metaKey: true }), 'navNote')).toBe(false);
    expect(keyboardShortcutModifiersMatchEvent({ altKey: true }, 'searchOpenInSplit')).toBe(false);
  });

  it('ignores IME processing keys even before the browser marks composition active', () => {
    setKeyboardShortcutBindings('navNote', ['Alt+n']);
    const processing = { ...keyboardEvent('Process', { altKey: true }), code: 'KeyN', keyCode: 229 };
    expect(keyboardShortcutMatchesEvent(processing, 'navNote')).toBe(false);
    expect(recordShortcutBindingFromEvent(processing)).toBeNull();
  });

  it('records function keys and shifted plus and matches their runtime events', () => {
    const f2 = { ...keyboardEvent('F2'), code: 'F2' };
    expect(recordShortcutBindingFromEvent(f2)).toBe('F2');
    expect(keyboardShortcutMatchesEvent(f2, 'historyRename')).toBe(true);
    const plus = { ...keyboardEvent('+', { shiftKey: true }), code: 'Equal' };
    expect(recordShortcutBindingFromEvent(plus)).toBe('Shift+Plus');
    expect(keyboardShortcutMatchesEvent(plus, 'mapZoomIn')).toBe(true);
  });

  it('checks every alternative for conflicts without treating different workspaces as conflicts', () => {
    const bindings = { ...defaultKeyboardShortcutBindings, editorBold: ['Alt+b', 'Meta+Shift+z'] };
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').editorRedo).toContain('editorBold');
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').historyExit).not.toContain('imageViewerClose');
  });

  it('warns about global search and selected-image collisions without conflating the image viewer', () => {
    const bindings = { ...defaultKeyboardShortcutBindings, editorBold: ['Meta+f', 'Meta+c'] };
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').editorBold).toEqual(expect.arrayContaining(['searchCurrent', 'imageCopySource']));
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').imageReset).not.toContain('imageViewerReset');
  });

  it('matches base punctuation defaults when Shift or Option changes the emitted character', () => {
    const bracket = { ...keyboardEvent('|', { metaKey: true, shiftKey: true }), code: 'Backslash' };
    expect(keyboardShortcutMatchesEvent(bracket, 'editorMatchingBracket', defaultKeyboardShortcutBindings, 'MacIntel')).toBe(true);
    const indent = { ...keyboardEvent('«', { metaKey: true, altKey: true }), code: 'Backslash' };
    expect(keyboardShortcutMatchesEvent(indent, 'editorIndentSelection', defaultKeyboardShortcutBindings, 'MacIntel')).toBe(true);
    expect(keyboardShortcutMatchesEvent({ ...bracket, shiftKey: false }, 'editorMatchingBracket', defaultKeyboardShortcutBindings, 'MacIntel')).toBe(false);
  });
});

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
      editorBold: ['Ctrl+k']
    };

    expect(getKeyboardShortcutConflicts(bindings, 'Win32').editorLink).toContain('editorBold');
    expect(getKeyboardShortcutConflicts(bindings, 'MacIntel').editorLink).not.toContain(
      'editorBold'
    );
  });

  it('lets a custom remapping win on every platform', () => {
    const remapped = {
      ...defaultKeyboardShortcutBindings,
      editorLink: ['Alt+l']
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
