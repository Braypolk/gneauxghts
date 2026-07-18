import { describe, expect, it } from 'vitest';
import {
  createLocationMruStore,
  editorLocationFromRecent,
  locationsEqual,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';

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

  it('treats chat locations equal by conversation id, including null', () => {
    expect(
      locationsEqual(chatFresh, {
        kind: 'chat',
        conversationId: null,
        contextNoteId: 'other',
        contextNotePath: '/vault/Other.md'
      })
    ).toBe(true);
    expect(locationsEqual(chatA, chatFresh)).toBe(false);
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
});
