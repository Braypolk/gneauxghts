import { describe, expect, it } from 'vitest';
import {
  getNextPaneCommandIndex,
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  getPaneCommandShortcutLabel
} from '$lib/features/notepad/paneCommandPicker';

describe('paneCommandPicker', () => {
  it('keeps fixed slot labels in start mode', () => {
    expect(getPaneCommandShortcutLabel(1, 'start')).toBe('1');
    expect(getPaneCommandShortcutLabel(2, 'start')).toBe('2');
    expect(getPaneCommandForShortcut('1', true, 'start')).toBe('previous');
    expect(getPaneCommandForShortcut('2', true, 'start')).toBe('thoughtPartner');
    expect(getPaneCommandForShortcut('3', true, 'start')).toBeNull();
  });

  it('keeps fixed slot labels in split mode', () => {
    expect(getPaneCommandShortcutLabel(1, 'split')).toBe('1');
    expect(getPaneCommandShortcutLabel(2, 'split')).toBe('2');
    expect(getPaneCommandShortcutLabel(3, 'split')).toBe('3');
    expect(getPaneCommandForShortcut('1', true, 'split')).toBe('current');
    expect(getPaneCommandForShortcut('2', true, 'split')).toBe('previous');
    expect(getPaneCommandForShortcut('3', true, 'split')).toBe('thoughtPartner');
  });

  it('keeps previous on slot 1 in start mode when unavailable', () => {
    expect(getPaneCommandShortcutLabel(1, 'start')).toBe('1');
    expect(getPaneCommandShortcutLabel(2, 'start')).toBe('2');
    expect(getPaneCommandForShortcut('1', false, 'start')).toBeNull();
    expect(getPaneCommandForShortcut('2', false, 'start')).toBe('thoughtPartner');
  });

  it('keeps previous on slot 2 in split mode when unavailable', () => {
    expect(getPaneCommandForShortcut('1', false, 'split')).toBe('current');
    expect(getPaneCommandForShortcut('2', false, 'split')).toBeNull();
    expect(getPaneCommandForShortcut('3', false, 'split')).toBe('thoughtPartner');
  });

  it('defaults start mode to typing at index 0', () => {
    expect(getPaneCommandChoiceByIndex(0, true, 'start')).toBe('typing');
    expect(getPaneCommandShortcutLabel(0, 'start')).toBeNull();
    expect(getNextPaneCommandIndex(0, 1, true, 'start')).toBe(1);
    expect(getNextPaneCommandIndex(0, 1, false, 'start')).toBe(2);
    expect(getNextPaneCommandIndex(0, -1, true, 'start')).toBe(2);
  });

  it('defaults split mode to typing at index 0', () => {
    expect(getPaneCommandChoiceByIndex(0, true, 'split')).toBe('typing');
    expect(getPaneCommandShortcutLabel(0, 'split')).toBeNull();
    expect(getNextPaneCommandIndex(0, 1, true, 'split')).toBe(1);
    expect(getNextPaneCommandIndex(0, 1, false, 'split')).toBe(1);
    expect(getNextPaneCommandIndex(1, 1, true, 'split')).toBe(2);
    expect(getNextPaneCommandIndex(0, -1, true, 'split')).toBe(3);
  });
});
