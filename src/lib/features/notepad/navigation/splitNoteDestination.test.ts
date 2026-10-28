import { describe, expect, it } from 'vitest';
import { hasSplitDiscoveryDestination, hasSplitNoteDestination } from './splitNoteDestination';

describe('discovery split destinations', () => {
  it('allows recent Thought partner with or without a saved conversation or context', () => {
    for (const conversationId of [null, 'retained-chat']) {
      expect(hasSplitDiscoveryDestination({ label: 'Thought partner', location: {
        kind: 'chat', conversationId, contextNoteId: null, contextNotePath: null
      } })).toBe(true);
    }
    expect(hasSplitDiscoveryDestination({ notePath: null })).toBe(false);
  });
  it('keeps unsaved or blank-path results out of the saved-note split action even with an identity', () => {
    for (const notePath of [null, '', '  ']) {
      const result = { noteId: 'retained-draft', notePath };
      expect(hasSplitNoteDestination(result)).toBe(false);
      expect(hasSplitNoteDestination({ label: 'Draft', location: { kind: 'editor', ...result } })).toBe(false);
    }
  });

  it('allows saved search and related notes and editor history, while keeping chat history separate', () => {
    expect(hasSplitNoteDestination({ notePath: '/vault/saved.md' })).toBe(true);
    expect(hasSplitNoteDestination({ label: 'Saved', location: { kind: 'editor', noteId: 'saved', notePath: '/vault/saved.md' } })).toBe(true);
    expect(hasSplitNoteDestination({ label: 'Chat', location: { kind: 'chat', conversationId: 'chat', contextNoteId: 'saved', contextNotePath: '/vault/saved.md' } })).toBe(false);
  });

  it('uses passage paths independently of the media ranking discriminator', () => {
    const savedPassage = { kind: 'passage', noteId: 'saved', notePath: '/vault/saved.md' };
    const draftPassage = { kind: 'passage', noteId: 'draft', notePath: null };
    expect(hasSplitNoteDestination(savedPassage)).toBe(true);
    expect(hasSplitNoteDestination(draftPassage)).toBe(false);
  });
});
