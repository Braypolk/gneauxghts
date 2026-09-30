import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ChatCitation } from '../types';
import EvidenceSource from './EvidenceSource.svelte';

function note(): Extract<ChatCitation, { kind: 'note' }> {
  return {
    id: 'passage:p1', kind: 'note', label: 'Project', noteId: 'n1', notePath: 'Project.md',
    sectionLabel: null, startLine: null, excerpt: 'Fallback context',
    passage: { id: 'p1', noteId: 'n1', contentHash: 'hash', location: 'body', start: 0, end: 12,
      excerpt: '<script>unsafe()</script> [fake](https://example.test)\n- [ ] Follow up', revisions: [] }
  };
}
const body = (citation: ChatCitation) => render(EvidenceSource, { props: { citation, index: 1 } }).body;

describe('Answer evidence', () => {
  it('shows the admitted excerpt literally instead of interpreting source markup or fallback context', () => {
    const html = body(note());
    expect(html).toContain('Current note passage');
    expect(html).toContain('&lt;script>unsafe()&lt;/script>');
    expect(html).toContain('[fake](https://example.test)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://example.test"');
    expect(html).not.toContain('Fallback context');
  });

  it('distinguishes historical removals and uncertain recording time from current status', () => {
    const citation = note();
    citation.passage!.historical = {
      revisionId: 'change', contentRevisionId: 'before', changeKind: 'removed', source: 'editor',
      timeEvidence: { kind: 'editingWindow', version: 1, firstWallMillis: 20, lastWallMillis: 10,
        minWallMillis: 10, maxWallMillis: 20, clockDiscontinuity: true }
    };
    const html = body(citation);
    expect(html).toContain('Historical removal · not current status');
    expect(html).toContain('Recorded timing is uncertain (clock changed)');
    expect(html).not.toContain('Current note passage');
  });

  it('does not label baseline knowledge as an introduction date', () => {
    const citation = note();
    citation.passage!.revisions = [{ noteId: 'n1', revisionId: 'baseline', atMillis: 1000,
      source: 'baselineInitialization', currentExcerpt: 'Evidence',
      timeEvidence: { kind: 'knownSince', knownSinceMillis: 1000 } }];
    expect(body(citation)).toContain('introduction date unknown');
  });
});
