import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ChatMarkdown from './ChatMarkdown.svelte';

describe('ChatMarkdown', () => {
  it('renders semantic prose and a dedicated code surface', () => {
    const body = render(ChatMarkdown, {
      props: {
        source: '**Answer**\n\n```ts\nconst value = 42;\n```'
      }
    }).body;

    expect(body).toContain('class="gn-markdown-surface"');
    expect(body).toContain('<strong>Answer</strong>');
    expect(body).toContain('class="chat-code-block"');
    expect(body).toContain('data-markdown-code-language="ts"');
    expect(body).toContain('>ts</span>');
    expect(body).toContain('const value = 42;');
  });

  it('marks streaming content as busy', () => {
    const body = render(ChatMarkdown, {
      props: { source: 'Partial', streaming: true }
    }).body;

    expect(body).toContain('data-streaming="true"');
    expect(body).toContain('aria-busy="true"');
  });
});
