import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ChainOfThought from './chain-of-thought.svelte';

describe('activity read links', () => {
  it('shows named read destinations and escaped passage previews independently of answer citations', () => {
    const { body } = render(ChainOfThought, { props: {
      open: true,
      onOpenCitation: () => undefined,
      steps: [{ id: 'read', type: 'tool', callId: 'read', name: 'read_notes', title: 'Read selected passages', status: 'success',
        outputSummary: 'Read 2 passages from 1 note', readSources: [
          { id: 'first', kind: 'note', label: 'Launch <plan>', noteId: 'launch', notePath: 'Launch.md', sectionLabel: null, startLine: null, excerpt: 'Approved <script>bad()</script>',
            passage: { id: 'first', noteId: 'launch', contentHash: 'hash', location: 'body', start: 0, end: 8, excerpt: 'Approved', revisions: [] } },
          { id: 'second', kind: 'note', label: 'Launch <plan>', noteId: 'launch', notePath: 'Launch.md', sectionLabel: null, startLine: null, excerpt: 'Deployment starts Tuesday.' }
        ] }]
    } });
    expect(body).toContain('Notes and passages read');
    expect(body).toContain('Open Launch &lt;plan>, read passage');
    expect(body).toContain('Deployment starts Tuesday.');
    expect(body).toContain('&lt;script>bad()&lt;/script>');
    expect(body).not.toContain('<script>bad()');
  });
});
