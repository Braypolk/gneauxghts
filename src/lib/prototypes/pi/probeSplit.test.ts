import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import PaneCommandPicker from '$lib/features/notepad/PaneCommandPicker.svelte';
import { openProbeChatSplit } from './probeSplit';

describe('normal workspace probe split controls', () => {
  const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => {
    for (let poll = 0; poll < 4; poll++) { const value = await read(); if (value) return value as NonNullable<T>; }
    throw new Error('Missing visible control');
  };
  it('uses the mobile command picker when the desktop control is hidden', async () => {
    let dialog = false;
    const desktop = { click: vi.fn(), focus: vi.fn() };
    const mobile = { click: vi.fn(() => { dialog = true; }), focus: vi.fn() };
    const option = { click: vi.fn(), focus: vi.fn() };
    const kind = await openProbeChatSplit({ until, pause: async () => undefined,
      visibleButton: label => label === 'Split pane' ? mobile : undefined,
      mobileThoughtPartner: () => dialog ? option : undefined });
    expect(kind).toBe('mobile'); expect(mobile.click).toHaveBeenCalledOnce(); expect(option.click).toHaveBeenCalledOnce();
    expect(desktop.focus).not.toHaveBeenCalled(); expect(mobile.focus).not.toHaveBeenCalled();
  });
  it('focuses the visible desktop control before selecting its normal split action', async () => {
    let focused = false;
    const desktop = { click: vi.fn(), focus: vi.fn(() => { focused = true; }) };
    const action = { click: vi.fn(), focus: vi.fn() };
    const kind = await openProbeChatSplit({ until, pause: async () => undefined,
      visibleButton: label => label === 'Open split pane options' ? desktop : focused && label === 'Split with thought partner' ? action : undefined,
      mobileThoughtPartner: () => { throw new Error('Desktop must not open mobile picker'); } });
    expect(kind).toBe('desktop'); expect(desktop.focus).toHaveBeenCalledOnce(); expect(action.click).toHaveBeenCalledOnce();
  });
  it('uses the real rendered split picker thought partner option contract', () => {
    const body = render(PaneCommandPicker, { props: { mode: 'split', highlightedIndex: 0, currentNoteLabel: 'Synthetic orchard', previousNoteLabel: null,
      previousNoteShortcutLabel: '', onHighlightChange: vi.fn(), onChoose: vi.fn() } }).body;
    expect(body).toContain('data-pane-command="split"');
    expect(body).toContain('id="pane-command-thought-partner"');
    expect(body).toContain('role="option"'); expect(body).toContain('Open thought partner. Press');
  });
});
