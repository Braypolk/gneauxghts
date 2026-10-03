import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { imageWidthChanges, parseImageEmbeds, resolveImageAssetName } from './imageEmbedParser';
function resize(text: string, width: number | null) {
  const image = parseImageEmbeds(text)[0];
  return EditorState.create({ doc: text }).update({ changes: imageWidthChanges(image, width) }).newDoc.toString();
}
describe('authored image syntax', () => {
  it('parses Markdown, wiki, dimensions, encoded names and references in document order', () => {
    const text = '![Citrus|200](2020%20Citrus.png "A title")\n\n![[assets/sub/shot.png|100x80]]\n\n![alt|120][photo]\n\n[photo]: <assets/folder/a%20b.png> "title"';
    const refs = parseImageEmbeds(text);
    expect(refs).toHaveLength(3);
    expect(refs.map(ref => [ref.assetName, ref.target.width, ref.target.height])).toEqual([
      ['2020 Citrus.png', 200, null], ['sub/shot.png', 100, 80], ['folder/a b.png', 120, null]
    ]);
  });
  it('does not render fenced, indented, inline code, escaped syntax or comments', () => {
    const text = '```\n![[fenced.png]]\n```\n\n    ![indent](i.png)\n\n`![[inline.png]]` \\![[escaped.png]] %% ![[comment.png]] %%\n\n<!-- ![[html.png]] -->\n\n> ![real](real.png)';
    expect(parseImageEmbeds(text).map(ref => ref.assetName)).toEqual(['real.png']);
  });
  it('patches only a size suffix and preserves titles, encoding and unrelated text', () => {
    const original = 'prefix ![Citrus|200](<2020%20Citrus.png> "A title") suffix';
    expect(resize(original, 450)).toBe(original.replace('|200', '|450'));
    expect(resize(original, null)).toBe(original.replace('|200', ''));
    expect(resize('![[assets/sub/a.png|100x80]]', 250)).toBe('![[assets/sub/a.png|250]]');
  });
  it('preserves a collapsed reference target when adding a width', () => {
    const original = '![photo][]\n\n[photo]: a.png';
    expect(resize(original, 100)).toBe('![photo|100][photo]\n\n[photo]: a.png');
  });
  it.each(['../a.png', '/a.png', 'assets/../a.png', 'a%2f..%2fb.png', 'https://example.test/a.png', 'C:\\a.png', 'a%ZZ.png'])('rejects unsafe destination %s', name => {
    expect(resolveImageAssetName(name)).toBeNull();
  });
  it('decodes exactly once', () => { expect(resolveImageAssetName('a%2520b.png')).toBe('a%20b.png'); });
});

describe('reference and comment edge cases', () => {
  it('preserves sized collapsed and shortcut reference destinations on reset', () => {
    for (const source of ['![photo|100][]', '![photo|100]']) {
      const text = `${source}\n\n[photo|100]: a.png`;
      const next = resize(text, null);
      expect(next).toBe('![photo][photo|100]\n\n[photo|100]: a.png');
      expect(parseImageEmbeds(next)[0].assetName).toBe('a.png');
    }
  });
  it('excludes comments spanning blank lines and ignores comment marks inside code', () => {
    expect(parseImageEmbeds('%%\n\n![[hidden.png]]\n\n%%\n\n![[visible.png]]').map(ref => ref.assetName)).toEqual(['visible.png']);
    expect(parseImageEmbeds('`%%`\n\n![[visible.png]]').map(ref => ref.assetName)).toEqual(['visible.png']);
  });
  it('keeps escaped label pipes literal', () => {
    expect(parseImageEmbeds('![name\\|100](a.png)')[0].target.width).toBeNull();
  });
});
