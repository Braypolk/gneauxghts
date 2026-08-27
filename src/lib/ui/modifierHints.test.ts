import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modifierHints } from './modifierHints.svelte';

describe('modifierHints', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    modifierHints.reset();
  });

  afterEach(() => {
    modifierHints.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reveals hints only after a deliberate modifier hold', () => {
    modifierHints.handleKeydown({ key: 'Meta', repeat: false } as KeyboardEvent);
    vi.advanceTimersByTime(219);
    expect(modifierHints.visible).toBe(false);

    vi.advanceTimersByTime(1);
    expect(modifierHints.visible).toBe(true);
  });

  it('cancels a short press and hides on release', () => {
    modifierHints.handleKeydown({ key: 'Control', repeat: false } as KeyboardEvent);
    modifierHints.handleKeyup({ key: 'Control' } as KeyboardEvent);
    vi.runAllTimers();

    expect(modifierHints.visible).toBe(false);
  });
});
