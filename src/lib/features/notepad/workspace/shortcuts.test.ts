import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceShortcutHandler, type WorkspaceShortcutDeps } from './shortcuts';
import { resetAllKeyboardShortcuts, setKeyboardShortcutBindings } from '#lib/keyboardShortcuts.svelte.js';

type PaneId = 'primary' | 'secondary';

function shortcutEvent(key: string, shiftKey = false): KeyboardEvent {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey,
    repeat: false,
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent;
}

function createDeps() {
  const deps: WorkspaceShortcutDeps<PaneId> = {
    getPaneOrder: () => ['primary'],
    getActivePaneId: () => 'primary',
    getPaneTitleInput: () => null,
    openThoughtPartner: vi.fn().mockResolvedValue(undefined),
    showHistory: vi.fn().mockResolvedValue(undefined),
    openSplitPaneOptions: vi.fn().mockResolvedValue(undefined),
    openNewChatInSplit: vi.fn().mockResolvedValue(undefined),
    openPreviousNoteInSplit: vi.fn().mockResolvedValue(undefined),
    closePane: vi.fn().mockResolvedValue(undefined),
    switchActivePane: vi.fn().mockResolvedValue(undefined),
    startNewNoteFlow: vi.fn().mockResolvedValue(undefined),
    toggleRelatedPanel: vi.fn(),
    togglePinCurrentNote: vi.fn(),
    goToPreviousLocation: vi.fn(),
    focusPaneAfterShortcut: vi.fn(),
    handlePaneCommandGlobalKeydown: () => false,
    handleWikilinkKeydown: () => false
  };
  return deps;
}

describe('workspace shortcuts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAllKeyboardShortcuts();
  });

  it.each([
    ['openThoughtPartner', 'openThoughtPartner'],
    ['showHistory', 'showHistory'],
    ['openSplitPaneOptions', 'openSplitPaneOptions'],
    ['openNewChatInSplit', 'openNewChatInSplit'],
    ['openPreviousNoteInSplit', 'openPreviousNoteInSplit'],
    ['closePane', 'closePane'],
    ['switchPane', 'switchActivePane'],
    ['rememberCurrentNote', 'startNewNoteFlow'],
    ['toggleRelatedPanel', 'toggleRelatedPanel'],
    ['togglePinCurrentNote', 'togglePinCurrentNote'],
    ['goToPreviousNote', 'goToPreviousLocation'],
  ] as const)('dispatches alternatives and disables %s without rebuilding the handler', async (id, action) => {
    vi.stubGlobal('document', { activeElement: null });
    const deps = createDeps();
    if (id === 'closePane' || id === 'switchPane') deps.getPaneOrder = () => ['primary', 'secondary'];
    const handle = createWorkspaceShortcutHandler(deps);
    setKeyboardShortcutBindings(id, ['F10', 'F11']);
    for (const key of ['F10', 'F11']) {
      await handle({ key, code: key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    }
    expect(deps[action]).toHaveBeenCalledTimes(2);
    setKeyboardShortcutBindings(id, []);
    await handle({ key: 'F10', code: 'F10', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(deps[action]).toHaveBeenCalledTimes(2);
  });

  it('opens the thought partner in the current pane with Cmd+T', async () => {
    const deps = createDeps();
    const event = shortcutEvent('t');

    await createWorkspaceShortcutHandler(deps)(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(deps.openThoughtPartner).toHaveBeenCalledOnce();
  });

  it.each([
    ['h', 'showHistory'],
    ['n', 'openSplitPaneOptions'],
    ['t', 'openNewChatInSplit'],
    ['l', 'openPreviousNoteInSplit']
  ] as const)('routes Cmd+Shift+%s to %s', async (key, action) => {
    const deps = createDeps();
    const event = shortcutEvent(key, true);

    await createWorkspaceShortcutHandler(deps)(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(deps[action]).toHaveBeenCalledOnce();
  });

  it('opens the previous location in the current pane with Cmd+L', async () => {
    const deps = createDeps();
    const event = shortcutEvent('l');

    await createWorkspaceShortcutHandler(deps)(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(deps.goToPreviousLocation).toHaveBeenCalledOnce();
  });

  it('toggles the current note pin with Cmd+P', async () => {
    const deps = createDeps();
    const event = shortcutEvent('p');

    await createWorkspaceShortcutHandler(deps)(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(deps.togglePinCurrentNote).toHaveBeenCalledOnce();
  });

  it('commits a focused title draft before Cmd+L changes the pane document', async () => {
    const calls: string[] = [];
    const titleInput = {
      blur: vi.fn(() => calls.push('blur'))
    } as unknown as HTMLInputElement;
    const deps = createDeps();
    deps.getPaneTitleInput = () => titleInput;
    deps.goToPreviousLocation = vi.fn(() => {
      calls.push('navigate');
    });
    vi.stubGlobal('document', { activeElement: titleInput });

    await createWorkspaceShortcutHandler(deps)(shortcutEvent('l'));

    expect(titleInput.blur).toHaveBeenCalledOnce();
    expect(calls).toEqual(['blur', 'navigate']);
  });
});
