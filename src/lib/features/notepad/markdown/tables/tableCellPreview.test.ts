import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createMarkdownLanguage } from '../markdownLanguage';
import { renderTableCellPreview } from './tableCellPreview';
import { markdownTables } from './tableModel';

function preview(value: string) {
  const state = EditorState.create({
    doc: `| Header |\n| --- |\n| ${value} |`, extensions: createMarkdownLanguage()
  });
  return renderTableCellPreview(state, markdownTables(state)[0].rows[1].cells[0]);
}

describe('table cell inline previews', () => {
  it('renders highlights with nested formatting and formatting around highlights', () => {
    expect(preview('==**bright** and `code`==')).toBe('<span class="cm-gn-highlight"><strong>bright</strong> and <code>code</code></span>');
    expect(preview('**bold ==bright==**')).toBe('<strong>bold <span class="cm-gn-highlight">bright</span></strong>');
    expect(preview('==one== and ==two==')).toBe('<span class="cm-gn-highlight">one</span> and <span class="cm-gn-highlight">two</span>');
    expect(preview('===literal===')).toBe('=<span class="cm-gn-highlight">literal=</span>');
  });

  it.each(['\\==literal==', '`==code==`', '==unclosed', '== spaced =='])('keeps non-highlight syntax literal: %s', value => {
    expect(preview(value)).not.toContain('cm-gn-highlight');
  });

  it('keeps highlighted HTML escaped and images passive while rendering links', () => {
    expect(preview('==<img src=x onerror=alert(1)>==')).toBe('<span class="cm-gn-highlight">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(preview('==[label](https://example.com)== ![image](https://example.com/image.png)')).toBe('<span class="cm-gn-highlight"><span class="cm-gn-link-styled" data-link-from="23" data-link-to="51" title="https://example.com"><span class="cm-gn-link-tooltip">https://example.com</span>label</span></span> image');
  });

  it('styles comment content as literal text without rendering links or nested formatting', () => {
    expect(preview('%%**private** [[Note]] ==text==%%')).toBe('<span class="cm-gn-comment">**private** [[Note]] ==text==</span>');
    expect(preview('%%<script>secret</script>%%')).toBe('<span class="cm-gn-comment">&lt;script&gt;secret&lt;/script&gt;</span>');
    for (const source of ['\\%%literal%%', '`%%code%%`', '%%unclosed']) {
      expect(preview(source)).not.toContain('cm-gn-comment');
    }
  });

  it('renders note targets and escaped table aliases without losing canonical source offsets', () => {
    expect(preview('[[Beta note]]')).toBe('<span class="gn-wikilink" data-wikilink-target="Beta note" data-wikilink-from="21" data-wikilink-to="34" title="Cmd/Ctrl-click to open note">[[Beta note]]</span>');
    expect(preview('[[Beta note#Section\\|Alias]]')).toBe('<span class="gn-wikilink" data-wikilink-target="Beta note#Section|Alias" data-wikilink-from="21" data-wikilink-to="49" title="Cmd/Ctrl-click to open note">[[Alias]]</span>');
    expect(preview('\\[[literal]] `[[code]]`')).not.toContain('gn-wikilink');
  });

  it('retains source ranges for repeated destinations, formatted labels and encoded URLs', () => {
    const html = preview('[**one**](https://example.com/a?x=1&amp;y=2) [two](https://example.com/a?x=1&amp;y=2)');
    expect(html.match(/class="cm-gn-link-styled"/g)).toHaveLength(2);
    expect(html).toContain('<strong>one</strong>');
    expect(html).toContain('data-link-from="21"');
    expect(html).toContain('data-link-from="66"');
    expect(html).toContain('title="https://example.com/a?x=1&amp;y=2"');
    expect(preview('[unsafe](javascript:alert(1))')).not.toContain('cm-gn-link-styled');
    expect(preview('`[literal](https://example.com)`')).not.toContain('cm-gn-link-styled');
  });
});
