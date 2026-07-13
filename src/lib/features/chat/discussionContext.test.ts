import { describe, expect, it } from 'vitest';
import { formatDiscussionDraft, mergeDiscussionDraft } from './discussionContext';

describe('formatDiscussionDraft', () => {
  it('preserves multiline selections as one Markdown blockquote', () => {
    expect(formatDiscussionDraft('first line\nsecond line', 'Working note')).toBe(
      'Help me think through this passage from “Working note”:\n\n> first line\n> second line'
    );
  });

  it('omits an empty note title', () => {
    expect(formatDiscussionDraft('an idea')).toBe(
      'Help me think through this passage:\n\n> an idea'
    );
  });

  it('adds another selected passage after an existing composer draft', () => {
    expect(mergeDiscussionDraft('My question', '> selected context')).toBe(
      'My question\n\n> selected context'
    );
  });
});
