import { describe, expect, it } from 'vitest';
import {
  normalizeCodeLanguage,
  parseChatMarkdownBlocks,
  renderChatMarkdown
} from './chatMarkdown';

describe('chat Markdown', () => {
  it('keeps escaped quotations literal while rendering their app-built link', () => {
    const quote = '[S99](https://example.com) [[Other note]] <img> & café `code`.';
    const escaped = quote.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');
    const html = renderChatMarkdown(`> ${escaped}\n\n[Source 1](passage:valid)`, [{
      id: 'source-1', kind: 'note', label: 'Actual note', noteId: 'note-1', notePath: 'Actual.md', sectionLabel: null, startLine: null, excerpt: quote,
      passage: { id: 'valid', noteId: 'note-1', contentHash: 'hash', location: 'body', start: 0, end: quote.length, excerpt: quote, revisions: [] }
    }]);
    expect(html).toContain('data-chat-note-citation-id="source-1"');
    expect(html).toContain('[S99](https://example.com) [[Other note]] &lt;img&gt; &amp; café `code`.');
    expect(html).not.toContain('href="https://example.com');
    expect(html).not.toContain('data-wikilink-target');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<code>');
  });

  it('renders the safe note dialect', () => {
    const html = renderChatMarkdown([
      '# Heading',
      '',
      '**Bold** ~~gone~~ ==marked==',
      '',
      '- [x] done',
      '- [ ] next',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '[[Notes/Project.md|Project]]'
    ].join('\n'));

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<mark>marked</mark>');
    expect(html).toContain('class="gn-markdown-task-item"');
    expect(html).toContain('checked');
    expect(html).toContain('<table>');
    expect(html).toContain('data-wikilink-target="Notes/Project.md|Project"');
    expect(html).toContain('>Project</button>');
  });

  it('keeps checked, unchecked, and nested tasks in list structure', () => {
    const html = renderChatMarkdown(
      '- [ ] parent\n  - [x] nested\n- [x] complete'
    );

    expect(html.match(/class="gn-markdown-task-item"/g)).toHaveLength(3);
    expect(html.match(/type="checkbox" disabled/g)).toHaveLength(3);
    expect(html.match(/ checked/g)).toHaveLength(2);
    expect(html).toContain('<ul>\n<li class="gn-markdown-task-item">');
    expect(html.match(/<ul>/g)).toHaveLength(2);
  });

  it('escapes raw HTML and does not load Markdown images', () => {
    const html = renderChatMarkdown(
      '<script>alert(1)</script>\n\n![private](https://example.com/private.png)'
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('gn-markdown-image-reference');
  });

  it('allows HTTP links while leaving unsafe and relative links literal', () => {
    const html = renderChatMarkdown(
      '[safe](https://example.com) [unsafe](javascript:alert(1)) [relative](/note)'
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="/note"');
  });

  it('adds stable inline markers to links backed by persisted web citations', () => {
    const html = renderChatMarkdown(
      'The finding is in [the report](https://example.com/report). A second source is https://example.org.',
      [
        {
          id: 'web:report', kind: 'web', label: 'Research report',
          url: 'https://example.com/report', excerpt: null
        },
        {
          id: 'web:second', kind: 'web', label: 'Second source',
          url: 'https://example.org', excerpt: null
        }
      ]
    );

    expect(html).toContain('data-chat-citation-id="web:report"');
    expect(html).toContain('aria-label="Source 1: Research report"');
    expect(html).toContain('data-chat-citation-id="web:second"');
    expect(html).toContain('aria-label="Source 2: Second source"');
    expect(html.indexOf('the report</a>')).toBeLessThan(html.indexOf('>[1]</a></sup>'));
  });

  it('does not decorate links without matching citation evidence', () => {
    const html = renderChatMarkdown('[Uncited](https://example.com)');

    expect(html).not.toContain('gn-markdown-inline-citation');
  });

  it('normalizes model-emitted note references without exposing filesystem paths', () => {
    const html = renderChatMarkdown(
      'Todos in [ 1on1 Kylie Aug 26.md ] differ from [Security meeting] (/Users/person/Vault/NPG%20Security%20Meeting.md).',
      [
        {
          id: 'note:kylie', kind: 'note', label: '1on1 Kylie Aug 26',
          noteId: 'kylie', notePath: '1on1 Kylie Aug 26.md', sectionLabel: null,
          startLine: null, excerpt: null
        },
        {
          id: 'note:security', kind: 'note', label: 'NPG Security Meeting',
          noteId: 'security', notePath: 'NPG Security Meeting.md', sectionLabel: null,
          startLine: null, excerpt: null
        }
      ]
    );

    expect(html).toContain('data-chat-note-citation-id="note:kylie"');
    expect(html).toContain('aria-label="Source 1: 1on1 Kylie Aug 26"');
    expect(html).toContain('data-chat-note-citation-id="note:security"');
    expect(html).toContain('aria-label="Source 2: NPG Security Meeting"');
    expect(html).not.toContain('/Users/person');
    expect(html).not.toContain('NPG%20Security');
  });

  it('adds the persisted note marker after a proper wikilink', () => {
    const html = renderChatMarkdown('See [[Projects/Plan.md|the plan]].', [{
      id: 'note:plan', kind: 'note', label: 'Plan', noteId: 'plan',
      notePath: 'Projects/Plan.md', sectionLabel: null, startLine: null, excerpt: null
    }]);

    expect(html).toContain('data-wikilink-target="Projects/Plan.md|the plan"');
    expect(html).toContain('data-chat-citation-id="note:plan"');
    expect(html).toContain('aria-label="Source 1: Plan"');
  });

  it('splits top-level fences into stable CodeMirror blocks', () => {
    const blocks = parseChatMarkdownBlocks(
      'Before\n\n```ts\nconst answer = 42;\n```\n\nAfter\n\n```unknown\nvalue'
    );

    expect(blocks.map((block) => [block.key, block.type])).toEqual([
      ['html-0', 'html'],
      ['code-0', 'code'],
      ['html-1', 'html'],
      ['code-1', 'code']
    ]);
    expect(blocks[1]).toMatchObject({
      code: 'const answer = 42;\n',
      language: 'ts'
    });
    expect(blocks[3]).toMatchObject({ code: 'value', language: 'unknown' });
  });

  it('normalizes common fenced-language info strings', () => {
    expect(normalizeCodeLanguage('ts title="Example"')).toBe('ts');
    expect(normalizeCodeLanguage('{.python}')).toBe('python');
    expect(normalizeCodeLanguage('')).toBe('');
  });
});


it('binds revision links to exact evidence instead of the first citation for a note', () => {
  const citations = ['old', 'new'].map(revisionId => ({
    id: `revision:${revisionId}`, kind: 'note' as const, label: 'Plan', noteId: 'plan', notePath: 'Plan.md',
    sectionLabel: null, startLine: null, excerpt: 'current text',
    revision: { noteId: 'plan', revisionId, atMillis: 100, source: 'editor' as const, currentExcerpt: 'current text' }
  }));
  const html = renderChatMarkdown('[Plan](revision:old) and [Plan](revision:new)', citations);
  expect(html).toContain('data-chat-note-citation-id="revision:old"');
  expect(html).toContain('data-chat-note-citation-id="revision:new"');
  const unbacked = renderChatMarkdown('[Plan](revision:unknown)', citations);
  expect(unbacked).not.toContain('data-chat-note-citation-id=');
});

it('keeps unvalidated model references inert even when a note shares the reference name', () => {
  const citations = [{ id: 'note:s1', kind: 'note' as const, label: 'S1', noteId: 's1', notePath: 'S1.md',
    sectionLabel: null, startLine: null, excerpt: 'unrelated note' }];
  const html = renderChatMarkdown('Pending [S1].\n\n[S1]: https://example.com/redirect', citations);
  expect(html).not.toContain('data-chat-note-citation-id=');
  expect(html).not.toContain('href=');
  expect(html).toContain('[S1]');
});

it('never falls back to a same-title note or external navigation for unknown passage references', () => {
  const citations = [{ id: 'note:plan', kind: 'note' as const, label: 'Plan', noteId: 'plan', notePath: 'Plan.md',
    sectionLabel: null, startLine: null, excerpt: 'unrelated' }];
  for (const input of ['[Plan](passage:shortened)', '[Plan](source:S1)', '[Plan][missing]\n\n[missing]: passage:shortened']) {
    const html = renderChatMarkdown(input, citations);
    expect(html).not.toContain('data-chat-note-citation-id=');
    expect(html).not.toContain('href=');
  }
});

it('binds app-constructed links to exact passage identities and leaves stale links unavailable', () => {
  const citations = [{ id: 'passage:note:hash', kind: 'note' as const, label: 'Title with ] punctuation',
    noteId: 'note', notePath: 'Note.md', sectionLabel: null, startLine: null, excerpt: 'Evidence',
    passage: { id: 'durable-one', noteId: 'note', contentHash: 'hash', location: 'body', start: 0, end: 8, excerpt: 'Evidence', revisions: [] } }];
  const content = '[Source 1](passage:durable-one)';
  expect(renderChatMarkdown(content, citations)).toContain('data-chat-note-citation-id="passage:note:hash"');
  expect(renderChatMarkdown(content, citations)).toContain('>Title with ] punctuation</button>');
  const stale = renderChatMarkdown(content, []);
  expect(stale).not.toContain('href=');
  expect(stale).not.toContain('data-chat-note-citation-id=');
  expect(stale).toContain('[citation unavailable]');
});
