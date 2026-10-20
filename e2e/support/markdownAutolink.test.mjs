import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Autolink as reference } from './fixtures/markdownAutolinkReference.mjs';

const require = createRequire(new URL('../../package.json', import.meta.url));
const path = createRequire(require.resolve('@codemirror/lang-markdown')).resolve('@lezer/markdown');
const signature = tree => {
  const result = [];
  tree.iterate({ enter(node) { result.push([node.name, node.from, node.to]); } });
  return result;
};
for (const entry of ['import', 'require']) {
  const markdown = entry === 'import' ? await import(pathToFileURL(path.replace(/index\.cjs$/, 'index.js'))) : require(path);
  const parser = markdown.parser.configure(markdown.GFM);
  const original = parser.configure(reference);
  test(`${entry}: autolinks preserve ASCII, Unicode and punctuation boundaries`, () => {
    const urls = ['www.example.com', 'https://example.com/a(b))', 'http://example.com/a?b&amp;',
      'a.b+c-d_e@example.com.', 'mailto:a@example.com', 'xmpp:a@example.com/resource@x',
      'https://bad_domain.example/a', 'www.a.b:8080/a!', 'WWW.example.com',
      'https://example.com/é', 'x'.repeat(101) + '@example.com'];
    const boundaries = ['', ' ', '\n', 'é', '中', '💡', '_', '9', 'A', 'z', '-', '.', '+', '(', '[', '*', '\\', '&'];
    let urlNodes = 0;
    for (const prefix of boundaries) for (const url of urls) {
      const doc = `> > ${prefix}${url} **bold**\n> continued [label](${url})\n\n`;
      const actual = signature(parser.parse(doc));
      assert.deepEqual(actual, signature(original.parse(doc)), JSON.stringify({ prefix, url }));
      urlNodes += actual.filter(node => node[0] === 'URL').length;
    }
    // Every possible UTF-16 preceding character, including lone surrogates.
    // Inline offsets differ from local string indices in actual paragraphs.
    for (let code = 0; code <= 0xffff; code++) {
      const text = String.fromCharCode(code) + 'a@example.com';
      const serialize = elements => JSON.stringify(elements);
      assert.equal(serialize(parser.parseInline(text, 17)), serialize(original.parseInline(text, 17)), `boundary U+${code.toString(16)}`);
    }
    assert(urlNodes > 100, 'Fixture must contain recognized autolinks');
  });
  test(`${entry}: ordinary quote text avoids per-character word regex checks`, () => {
    const oldTest = RegExp.prototype.test;
    let checks = 0;
    RegExp.prototype.test = function (text) {
      if (this.source === '\\w') checks++;
      return oldTest.call(this, text);
    };
    let tree;
    try { tree = parser.parse('> > quoted **bold** text\n'.repeat(2000)); }
    finally { RegExp.prototype.test = oldTest; }
    assert.equal(signature(tree).filter(node => node[0] === 'StrongEmphasis').length, 2000);
    assert.equal(checks, 0, `Ran ${checks} single-character word regex checks`);
  });
}
