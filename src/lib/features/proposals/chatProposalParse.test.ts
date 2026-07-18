import { describe, expect, it } from 'vitest';
import {
  extractProposalFence,
  parseChatProposalDrafts,
  resolveChatProposalDrafts
} from './chatProposalParse';

describe('chatProposalParse', () => {
  it('extracts a gneauxghts-proposal fence', () => {
    const content = `Here is a draft.\n\n\`\`\`gneauxghts-proposal\n{"newMarkdown":"Hi"}\n\`\`\`\n`;
    expect(extractProposalFence(content)).toBe('{"newMarkdown":"Hi"}');
  });

  it('parses shorthand context-note updates', () => {
    const drafts = parseChatProposalDrafts(
      '```proposal\n{"newTitle":"T","newMarkdown":"Body"}\n```'
    );
    expect(drafts).toEqual([
      { kind: 'updateNote', path: null, newTitle: 'T', newMarkdown: 'Body' }
    ]);
  });

  it('parses a changes array with create + update', () => {
    const drafts = parseChatProposalDrafts(`\`\`\`gneauxghts-proposal
{
  "changes": [
    { "kind": "updateNote", "newTitle": "A", "newMarkdown": "One" },
    { "kind": "createNote", "suggestedTitle": "B", "markdown": "Two" }
  ]
}
\`\`\``);
    expect(drafts).toHaveLength(2);
    expect(drafts?.[0]?.kind).toBe('updateNote');
    expect(drafts?.[1]?.kind).toBe('createNote');
  });

  it('resolves hashes from context note markdown', async () => {
    const drafts = parseChatProposalDrafts(
      '```gneauxghts-proposal\n{"kind":"updateNote","newTitle":"N","newMarkdown":"Next"}\n```'
    );
    expect(drafts).not.toBeNull();
    const resolved = await resolveChatProposalDrafts(drafts!, {
      path: '/vault/Note.md',
      title: 'Note',
      lastSavedMarkdown: 'Base'
    }, async (markdown) => `hash:${markdown}`);

    expect(resolved).toEqual({
      changes: [
        {
          kind: 'updateNote',
          path: '/vault/Note.md',
          baseContentHash: 'hash:Base',
          newTitle: 'N',
          newMarkdown: 'Next'
        }
      ],
      baseMarkdownByPath: { '/vault/Note.md': 'Base' }
    });
  });

  it('returns null when no fence is present', () => {
    expect(parseChatProposalDrafts('Just a normal reply.')).toBeNull();
  });
});
