import { describe, expect, it, vi } from 'vitest';
import {
  createLocationMruStore,
  editorLocationFromRecent,
  loadPersistedChatLocation,
  locationsEqual,
  persistChatLocation,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

const noteA: NavLocation = {
  kind: 'editor',
  noteId: 'a',
  notePath: '/vault/A.md'
};
const noteB: NavLocation = {
  kind: 'editor',
  noteId: 'b',
  notePath: '/vault/B.md'
};
const chatA: NavLocation = {
  kind: 'chat',
  conversationId: 'conv-a',
  contextNoteId: 'a',
  contextNotePath: '/vault/A.md'
};
const chatFresh: NavLocation = {
  kind: 'chat',
  conversationId: null,
  contextNoteId: 'a',
  contextNotePath: '/vault/A.md'
};

describe('locationMru', () => {
  it('touches move-to-front with dedupe and cap', () => {
    const mru = createLocationMruStore<'p1'>();
    mru.touch('p1', noteA);
    mru.touch('p1', noteB);
    mru.touch('p1', noteA);
    expect(mru.list('p1')).toEqual([noteA, noteB]);
  });

  it('supports note↔note Cmd+L toggle semantics', () => {
    const mru = createLocationMruStore<'p1'>();
    mru.seedIfEmpty('p1', [noteB]);

    // On note A, Cmd+L → previous B, touch A, restore B
    let current: NavLocation = noteA;
    let previous = mru.previousExcluding('p1', current);
    expect(previous).toEqual(noteB);
    mru.touch('p1', current);
    current = previous!;

    // On note B, Cmd+L → previous A, touch B, restore A
    previous = mru.previousExcluding('p1', current);
    expect(previous).toEqual(noteA);
    mru.touch('p1', current);
    current = previous!;
    expect(current).toEqual(noteA);

    previous = mru.previousExcluding('p1', current);
    expect(previous).toEqual(noteB);
  });

  it('supports note↔chat Cmd+L toggle semantics', () => {
    const mru = createLocationMruStore<'p1'>();

    // Leave note A for chat
    mru.touch('p1', noteA);
    let current: NavLocation = chatA;

    // Cmd+L from chat → note A
    let previous = mru.previousExcluding('p1', current);
    expect(previous).toEqual(noteA);
    mru.touch('p1', current);
    current = previous!;
    expect(current).toEqual(noteA);

    // Cmd+L from note A → same chat
    previous = mru.previousExcluding('p1', current);
    expect(previous).toEqual(chatA);
    mru.touch('p1', current);
    current = previous!;
    expect(current).toEqual(chatA);
  });

  it('treats all chat locations as one MRU slot', () => {
    expect(
      locationsEqual(chatFresh, {
        kind: 'chat',
        conversationId: null,
        contextNoteId: 'other',
        contextNotePath: '/vault/Other.md'
      })
    ).toBe(true);
    expect(locationsEqual(chatA, chatFresh)).toBe(true);

    const mru = createLocationMruStore<'p1'>();
    mru.touch('p1', chatFresh);
    mru.touch('p1', chatA);
    expect(mru.list('p1')).toEqual([chatA]);
  });

  it('seeds only when empty and skips non-restorable editor rows', () => {
    const mru = createLocationMruStore<'p1'>();
    const empty = editorLocationFromRecent({ noteId: null, notePath: null });
    expect(empty).toBeNull();
    mru.seedIfEmpty('p1', [noteB, noteA]);
    expect(mru.list('p1')).toEqual([noteB, noteA]);

    mru.seedIfEmpty('p1', [noteA]);
    expect(mru.list('p1')).toEqual([noteB, noteA]);
  });

  it('keeps location lists per pane', () => {
    const mru = createLocationMruStore<'p1' | 'p2'>();
    mru.touch('p1', noteA);
    mru.touch('p2', noteB);
    expect(mru.previousExcluding('p1', null)).toEqual(noteA);
    expect(mru.previousExcluding('p2', null)).toEqual(noteB);
  });

  it('reinjects lastChat when the MRU list no longer contains chat', () => {
    const mru = createLocationMruStore<'p1'>();
    mru.rememberChat('p1', chatA);
    mru.touch('p1', noteA);
    mru.touch('p1', noteB);

    expect(mru.list('p1')).toEqual([noteB, noteA]);
    expect(mru.historyExcluding('p1', noteB)).toEqual([
      { location: noteA, label: 'A' },
      { location: chatA, label: 'Thought partner' }
    ]);
  });

  it('hides chat in history only while chat is current', () => {
    const mru = createLocationMruStore<'p1'>();
    mru.touch('p1', noteA);
    mru.touch('p1', chatA);

    expect(mru.historyExcluding('p1', chatA)).toEqual([{ location: noteA, label: 'A' }]);
    expect(mru.historyExcluding('p1', noteA).some((entry) => entry.location.kind === 'chat')).toBe(
      true
    );
  });

  it('historyExcluding skips the current location and keeps chat rows', () => {
    const mru = createLocationMruStore<'p1'>();
    mru.touch('p1', noteA);
    mru.touch('p1', chatA);
    mru.touch('p1', noteB);

    expect(mru.historyExcluding('p1', noteB)).toEqual([
      { location: chatA, label: 'Thought partner' },
      { location: noteA, label: 'A' }
    ]);
  });

  it('persists and reloads a chat conversation pointer via backend', async () => {
    invokeMock.mockReset();

    invokeMock.mockResolvedValueOnce(undefined);
    await persistChatLocation(chatA);
    expect(invokeMock).toHaveBeenCalledWith('set_last_chat_location', {
      conversationId: 'conv-a',
      contextNoteId: 'a',
      contextNotePath: '/vault/A.md'
    });

    invokeMock.mockResolvedValueOnce({
      conversationId: 'conv-a',
      contextNoteId: 'a',
      contextNotePath: '/vault/A.md'
    });
    expect(await loadPersistedChatLocation()).toEqual(chatA);

    invokeMock.mockClear();
    await persistChatLocation(chatFresh);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

