import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import InlineCitation from './inline-citation.svelte';

it('renders current excerpt and revision evidence as an inspectable citation', () => {
  const { body } = render(InlineCitation, { props: {
    citation: {
      id: 'revision:r1', kind: 'note', label: 'Current title', noteId: 'n1', notePath: 'Current.md',
      sectionLabel: null, startLine: null, excerpt: 'Current excerpt',
      revision: { noteId: 'n1', revisionId: 'r1', atMillis: 1000, source: 'editor', currentExcerpt: 'Current excerpt' }
    }, index: 1
  } });
  expect(body).toContain('<button');
  expect(body).toContain('Current title');
  expect(body).toContain('Revision');
  expect(body).toContain('editor');
  expect(body).toContain('Current excerpt');
  expect(body).not.toContain('href=');
});
