import { describe, expect, it } from 'vitest';
import {
  getNextPaneCommandIndex,
  PANE_COMMAND_SPLIT_OPTIONS,
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  getPaneCommandShortcutLabel
} from '$lib/features/notepad/paneCommandPicker';

describe('paneCommandPicker', () => {
  it('defines the shared split choices in their numbered order', () => {
    expect(PANE_COMMAND_SPLIT_OPTIONS.map((option) => option.choice)).toEqual([
      'typing',
      'current',
      'previous',
      'thoughtPartner'
    ]);
  });

  it('maps fixed shortcut slots in each picker mode', () => {
    expect([1, 2].map((slot) => getPaneCommandShortcutLabel(slot, 'start'))).toEqual(['1', '2']);
    expect(['1', '2', '3'].map((key) => getPaneCommandForShortcut(key, true, 'start'))).toEqual([
      'previous',
      'thoughtPartner',
      null
    ]);

    expect([1, 2, 3].map((slot) => getPaneCommandShortcutLabel(slot, 'split'))).toEqual([
      '1',
      '2',
      '3'
    ]);
    expect(['1', '2', '3'].map((key) => getPaneCommandForShortcut(key, true, 'split'))).toEqual([
      'current',
      'previous',
      'thoughtPartner'
    ]);
  });

  it('disables the previous-note slot without shifting other shortcuts', () => {
    expect(getPaneCommandForShortcut('1', false, 'start')).toBeNull();
    expect(getPaneCommandForShortcut('2', false, 'start')).toBe('thoughtPartner');
    expect(getPaneCommandForShortcut('1', false, 'split')).toBe('current');
    expect(getPaneCommandForShortcut('2', false, 'split')).toBeNull();
    expect(getPaneCommandForShortcut('3', false, 'split')).toBe('thoughtPartner');
  });

  it('navigates enabled start-mode choices with typing as the fallback', () => {
    expect(getPaneCommandChoiceByIndex(0, true, 'start')).toBe('typing');
    expect(getNextPaneCommandIndex(0, 1, true, 'start')).toBe(1);
    expect(getNextPaneCommandIndex(0, 1, false, 'start')).toBe(2);
    expect(getNextPaneCommandIndex(0, -1, true, 'start')).toBe(2);
  });

  it('navigates all split-mode choices', () => {
    expect(getPaneCommandChoiceByIndex(0, true, 'split')).toBe('typing');
    expect(getNextPaneCommandIndex(0, 1, true, 'split')).toBe(1);
    expect(getNextPaneCommandIndex(0, 1, false, 'split')).toBe(1);
    expect(getNextPaneCommandIndex(1, 1, true, 'split')).toBe(2);
    expect(getNextPaneCommandIndex(0, -1, true, 'split')).toBe(3);
  });
});
