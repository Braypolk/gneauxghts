import { describe, expect, it } from 'vitest';
import { extractProposalFence, parseChatProposalEdits } from './chatProposalParse';

describe('chatProposalParse', () => {
  it('extracts a gneauxghts-proposal fence', () => {
    const content = `Here is a draft.\n\n\`\`\`gneauxghts-proposal\n{"newMarkdown":"Hi"}\n\`\`\`\n`;
    expect(extractProposalFence(content)).toBe('{"newMarkdown":"Hi"}');
  });

  it('parses the live edits protocol', () => {
    const edits = parseChatProposalEdits(
      `\`\`\`gneauxghts-proposal
{
  "edits": [
    { "kind": "replace", "oldText": "Hello", "newText": "Hi" },
    { "kind": "insert", "newText": "\\nWorld", "contextAfter": "Hi" }
  ]
}
\`\`\``,
      'Hello'
    );
    expect(edits).toEqual([
      { kind: 'replace', oldText: 'Hello', newText: 'Hi' },
      { kind: 'insert', newText: '\nWorld', contextAfter: 'Hi' }
    ]);
  });

  it('parses edits nested under a changes entry', () => {
    const edits = parseChatProposalEdits(
      `\`\`\`proposal
{
  "changes": [
    {
      "kind": "updateNote",
      "edits": [{ "kind": "replace", "oldText": "A", "newText": "B" }]
    }
  ]
}
\`\`\``,
      'A'
    );
    expect(edits).toEqual([{ kind: 'replace', oldText: 'A', newText: 'B' }]);
  });

  it('converts legacy full-body proposals to a trusted whole-body replace', () => {
    const edits = parseChatProposalEdits(
      '```gneauxghts-proposal\n{"kind":"updateNote","newTitle":"N","newMarkdown":"Next"}\n```',
      'Base'
    );
    expect(edits).toEqual([{ kind: 'replace', oldText: 'Base', newText: 'Next' }]);
  });

  it('converts legacy changes-array full-body updates using base markdown', () => {
    const edits = parseChatProposalEdits(
      `\`\`\`gneauxghts-proposal
{
  "changes": [
    { "kind": "updateNote", "newTitle": "A", "newMarkdown": "One" },
    { "kind": "createNote", "suggestedTitle": "B", "markdown": "Two" }
  ]
}
\`\`\``,
      'Old body'
    );
    expect(edits).toEqual([{ kind: 'replace', oldText: 'Old body', newText: 'One' }]);
  });

  it('uses a newline base when converting empty legacy bodies', () => {
    const edits = parseChatProposalEdits(
      '```proposal\n{"newMarkdown":"Body"}\n```',
      ''
    );
    expect(edits).toEqual([{ kind: 'replace', oldText: '\n', newText: 'Body' }]);
  });

  it('returns null when no fence is present', () => {
    expect(parseChatProposalEdits('Just a normal reply.', 'Base')).toBeNull();
  });

  it('returns null for invalid JSON or empty edits', () => {
    expect(parseChatProposalEdits('```proposal\n{not-json}\n```', 'Base')).toBeNull();
    expect(
      parseChatProposalEdits('```gneauxghts-proposal\n{"edits":[]}\n```', 'Base')
    ).toBeNull();
  });
});
