import { describe, expect, it } from 'vitest';
import { assertAcknowledgedReview } from './iosTranscriptContract';
import type { ChatProposalDraft } from '$lib/features/chat/types';

describe('iOS acknowledged review relocation assertions', () => {
  const before: ChatProposalDraft = { title: 'Acknowledged title', markdown: 'Exact authored working text', version: 3, path: '/old/vault/Note.md', decisions: [] };
  it('admits only the native mapped display location while retaining working content', () => {
    expect(() => assertAcknowledgedReview(before, { ...before, path: '/new/vault/Note.md' }, '/new/vault/Note.md')).not.toThrow();
  });
  it('rejects stale locations and rewritten acknowledged state', () => {
    for (const change of [{ path: before.path }, { markdown: 'Changed' }, { title: 'Changed' }, { version: 4 }]) {
      expect(() => assertAcknowledgedReview(before, { ...before, path: '/new/vault/Note.md', ...change }, '/new/vault/Note.md')).toThrow('pending review changed');
    }
  });
});
