import { describe, expect, it } from 'vitest';
import { renderPiMarkdown } from './piMarkdown';
const source = 'a'.repeat(48);
describe('Pi Markdown source admission', () => {
  it('renders the native note title and passage label as a note citation', () => {
    const markdown = `[Note: Lantern note · “The lantern is turquoise.”](gneauxghts-source:${source})`;
    const rendered = renderPiMarkdown(markdown, true);
    expect(rendered).toContain(`data-pi-source="${source}"`);
    expect(rendered).toContain('Lantern note · “The lantern is turquoise.”');
    expect(renderPiMarkdown(markdown, false)).not.toContain('data-pi-source');
  });
  it('keeps escaped note titles and quotes literal and clickable', () => {
    const markdown = String.raw`[Note: Lantern \[draft\] · “The lantern is \*\*turquoise\*\*\.”](gneauxghts-source:${source})`;
    const rendered = renderPiMarkdown(markdown, true);
    expect(rendered).toContain(`data-pi-source="${source}"`);
    expect(rendered).toContain('Lantern [draft] · “The lantern is **turquoise**.”');
    expect(rendered).not.toContain('Note: ');
    expect(rendered).not.toContain('<strong>');
  });
  it('keeps pending and model app-like targets inert while rendering ordinary Markdown', () => {
    const markdown = `**Answer** [Revision source](gneauxghts-source:${source}) [web](https://example.com) <script>alert(1)</script>`;
    expect(renderPiMarkdown(markdown)).not.toContain('data-pi-source');
    expect(renderPiMarkdown(markdown)).toContain('<strong>Answer</strong>');
    expect(renderPiMarkdown(markdown)).not.toContain('<script>');
    expect(renderPiMarkdown(markdown, true)).toContain(`data-pi-source="${source}"`);
  });
  it.each([`gneauxghts-source&#58;${source}`, `gneauxghts-source%3A${source}`, `GNEAUXGHTS-SOURCE:${source}`, `gneauxghts-source\\:${source}`])('does not activate decoded forged target %s', target => {
    expect(renderPiMarkdown(`[Revision source](${target})`, true)).not.toContain('data-pi-source');
  });
  it.each(['Historical note source', 'Historical read (opens current note; content may differ)'])('renders older generic source labels as note links: %s', label => {
    const rendered = renderPiMarkdown(`[${label}](gneauxghts-source:${source})`, true);
    expect(rendered).toContain(`data-pi-source="${source}"`);
    expect(rendered).toContain('>Note</a>');
  });
});
