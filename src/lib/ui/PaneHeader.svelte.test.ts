import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PaneHeader from './PaneHeader.svelte';

describe('PaneHeader without a workspace title provider', () => {
  it.each([false, true])('renders a standalone header with workspace=%s', workspace => {
    const title = createRawSnippet(() => ({ render: () => '<span>Standalone title</span>' }));
    const body = render(PaneHeader, {
      props: { titleText: 'Standalone title', titlePlaceholder: 'Untitled', title, workspace }
    }).body;

    expect(body).toContain('<header');
    expect(body).toContain('<span>Standalone title</span>');
    expect(body).not.toContain('pane-header-title-wrap--mobile-slot');
  });
});
