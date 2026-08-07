import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComposerDraftPersistence,
  resetComposerDraftCacheForTests
} from './composerDraftPersistence';

function harness(stored: Record<string, string> = {}) {
  const drafts = new Map<string, string>(Object.entries(stored));
  const applied: string[] = [];
  const setDraft = vi.fn(async (slot: string, body: string) => {
    if (body === '') {
      drafts.delete(slot);
      return;
    }
    drafts.set(slot, body);
  });
  const getDraft = vi.fn(async (slot: string) => drafts.get(slot) ?? '');

  const persistence = createComposerDraftPersistence({
    getDraft,
    setDraft,
    applyDraft: (body) => applied.push(body),
    saveDelayMs: 100
  });

  return { persistence, drafts, applied, getDraft, setDraft };
}

describe('composer draft persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetComposerDraftCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetComposerDraftCacheForTests();
  });

  it('restores the unsent text stored for a slot', async () => {
    const h = harness({ 'pane:left': 'half a thought' });

    await h.persistence.openSlot('pane:left');

    expect(h.applied).toEqual(['half a thought']);
  });

  it('keeps each conversation its own unsent text across a switch', async () => {
    const h = harness();

    await h.persistence.openSlot('conversation:a');
    h.persistence.record('draft for a');
    await vi.advanceTimersByTimeAsync(100);

    await h.persistence.openSlot('conversation:b');
    h.persistence.record('draft for b');
    await vi.advanceTimersByTimeAsync(100);

    expect(h.drafts.get('conversation:a')).toBe('draft for a');
    expect(h.drafts.get('conversation:b')).toBe('draft for b');

    h.applied.length = 0;
    await h.persistence.openSlot('conversation:a');
    expect(h.applied).toEqual(['draft for a']);
  });

  it('flushes unsaved text before leaving a slot', async () => {
    const h = harness();

    await h.persistence.openSlot('conversation:a');
    h.persistence.record('typed then switched');
    await h.persistence.openSlot('conversation:b');

    expect(h.drafts.get('conversation:a')).toBe('typed then switched');
  });

  it('coalesces keystrokes into a single write', async () => {
    const h = harness();

    await h.persistence.openSlot('pane:left');
    h.persistence.record('t');
    h.persistence.record('th');
    h.persistence.record('thought');
    await vi.advanceTimersByTimeAsync(100);

    expect(h.setDraft).toHaveBeenCalledTimes(1);
    expect(h.drafts.get('pane:left')).toBe('thought');
  });

  it('drops the stored draft once the composer is emptied', async () => {
    const h = harness({ 'pane:left': 'stale' });

    await h.persistence.openSlot('pane:left');
    h.persistence.record('');
    await vi.advanceTimersByTimeAsync(100);

    expect(h.drafts.has('pane:left')).toBe(false);
  });

  it('lets keystrokes win over a stored draft that arrives late', async () => {
    const h = harness({ 'pane:left': 'stored' });
    const pending: Array<(body: string) => void> = [];
    h.getDraft.mockImplementation(
      () => new Promise<string>((resolve) => pending.push(resolve))
    );

    const opening = h.persistence.openSlot('pane:left');
    h.persistence.record('typed while loading');
    pending.forEach((resolve) => resolve('stored'));
    await opening;

    expect(h.applied).toEqual([]);
  });

  it('ignores the empty wipe that races with an in-flight restore', async () => {
    const h = harness({ 'pane:left': 'half a thought' });
    const pending: Array<(body: string) => void> = [];
    h.getDraft.mockImplementation(
      () => new Promise<string>((resolve) => pending.push(resolve))
    );

    const opening = h.persistence.openSlot('pane:left');
    // Composer clears draft to '' before openSlot finishes; that must not win.
    h.persistence.record('');
    pending.forEach((resolve) => resolve('half a thought'));
    await opening;

    expect(h.applied).toEqual(['half a thought']);
  });

  it('ignores a stored draft for a slot the composer already left', async () => {
    const h = harness({ 'conversation:a': 'a text', 'conversation:b': 'b text' });
    const first = h.persistence.openSlot('conversation:a');
    const second = h.persistence.openSlot('conversation:b');
    await Promise.all([first, second]);

    expect(h.applied).toEqual(['b text']);
  });

  it('clears both slots when a draft graduates into a conversation', async () => {
    const h = harness();

    await h.persistence.openSlot('pane:left');
    h.persistence.record('becomes the first message');
    await vi.advanceTimersByTimeAsync(100);

    h.persistence.resetSlot('conversation:new');
    await vi.advanceTimersByTimeAsync(0);

    expect(h.drafts.has('pane:left')).toBe(false);
    expect(h.drafts.has('conversation:new')).toBe(false);
    expect(h.persistence.peekSlot()).toBe('conversation:new');
  });

  it('abandons a pending write when the user starts over', async () => {
    const h = harness();

    await h.persistence.openSlot('pane:left');
    h.persistence.record('abandoned');
    h.persistence.resetSlot('pane:left');
    await vi.advanceTimersByTimeAsync(100);

    expect(h.drafts.has('pane:left')).toBe(false);
  });

  it('saves the last keystrokes when the composer is torn down', async () => {
    const h = harness();

    await h.persistence.openSlot('pane:left');
    h.persistence.record('unsaved at unmount');
    h.persistence.dispose();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.drafts.get('pane:left')).toBe('unsaved at unmount');
  });

  it('restores a draft after dispose even if the vault write is still pending', async () => {
    const drafts = new Map<string, string>();
    const applied: string[] = [];
    const pendingWrites: Array<() => void> = [];
    const setDraft = vi.fn(
      (slot: string, body: string) =>
        new Promise<void>((resolve) => {
          pendingWrites.push(() => {
            if (body === '') drafts.delete(slot);
            else drafts.set(slot, body);
            resolve();
          });
        })
    );
    const getDraft = vi.fn(async (slot: string) => drafts.get(slot) ?? '');

    const first = createComposerDraftPersistence({
      getDraft,
      setDraft,
      applyDraft: () => {},
      saveDelayMs: 100
    });
    await first.openSlot('pane:left');
    first.record('still typing');
    first.dispose();

    const second = createComposerDraftPersistence({
      getDraft,
      setDraft,
      applyDraft: (body) => applied.push(body),
      saveDelayMs: 100
    });
    await second.openSlot('pane:left');

    expect(applied).toEqual(['still typing']);
    pendingWrites.forEach((resolve) => resolve());
  });

  it('does nothing before a slot is opened', () => {
    const h = harness();

    h.persistence.record('nowhere to put this');

    expect(h.setDraft).not.toHaveBeenCalled();
  });
});
