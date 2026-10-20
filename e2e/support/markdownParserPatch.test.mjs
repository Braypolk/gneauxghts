import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../../package.json', import.meta.url));
const markdownPath = createRequire(require.resolve('@codemirror/lang-markdown')).resolve('@lezer/markdown');
const commonPath = createRequire(markdownPath).resolve('@lezer/common');
// Recorded from unmodified @lezer/markdown 1.6.4 with GFM, before applying the patch.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/markdownMarkerTrees.json', import.meta.url), 'utf8'));

function signature(tree) {
  let result = '';
  tree.iterate({
    enter(node) { result += `${node.name}[${node.from},${node.to}](`; },
    leave() { result += ')'; }
  });
  return result;
}

function opaqueParser(markdown, common) {
  const property = new common.NodeProp({ perNode: true });
  const parser = markdown.parser.configure({ defineNodes: ['Opaque'] });
  const type = parser.nodeSet.types.find(type => type.name === 'Opaque');
  // A custom parseInline provider may return an opaque tree. Exercise the
  // actual block parser's marker merge without relying on inline delimiter
  // resolution, which only collects ordinary Element instances in 1.6.4.
  parser.parseInline = (text, offset) => {
    const tree = new common.Tree(type, [], [], text.length, [[property, 'retained']]);
    return [new markdown.InlineContext(parser, text, offset).elt(tree, offset)];
  };
  return { parser, property };
}

for (const entry of ['import', 'require']) {
  const markdown = entry === 'import' ? await import(pathToFileURL(markdownPath.replace(/index\.cjs$/, 'index.js'))) : require(markdownPath);
  const common = entry === 'import' ? await import(pathToFileURL(commonPath.replace(/index\.cjs$/, 'index.js'))) : require(commonPath);
  for (const fixture of fixtures) test(`${entry}: retains marker nesting and positions in ${fixture.name}`, () => {
    const parser = markdown.parser.configure(markdown.GFM);
    assert.equal(signature(parser.parse(fixture.doc)), fixture.tree);
  });

  test(`${entry}: preserves opaque inline trees and their per-node properties`, () => {
    const { parser, property } = opaqueParser(markdown, common);
    const doc = '> before {first\n> second} **after**\n';
    const tree = parser.parse(doc);
    const paragraph = tree.topNode.getChild('Blockquote').getChild('Paragraph');
    assert.equal(signature(tree), 'Document[0,36](Blockquote[0,35](QuoteMark[0,1]()Paragraph[2,35](Opaque[2,35]())))');
    assert.equal(paragraph.getChild('Opaque').prop(property), 'retained');
  });

  test(`${entry}: incremental edits agree with fresh trees across quote and inline boundaries`, () => {
    const parser = markdown.parser.configure(markdown.GFM);
    let doc = '> > **alpha\n> > beta** [link\n> > label](target)\n> > `code\n> > span`\n';
    let tree = parser.parse(doc);
    for (const edit of [
      { find: 'beta', insert: 'changed' },
      { find: '**alpha', insert: 'alpha' },
      { find: '> > label', insert: '> label' },
      { find: 'target', insert: 'new-target' },
      { find: '`code', insert: '**code' },
      { find: 'span`', insert: 'span**' }
    ]) {
      const from = doc.indexOf(edit.find);
      assert(from >= 0);
      const to = from + edit.find.length;
      const next = doc.slice(0, from) + edit.insert + doc.slice(to);
      const fragments = common.TreeFragment.applyChanges(common.TreeFragment.addTree(tree), [{ fromA: from, toA: to, fromB: from, toB: from + edit.insert.length }]);
      tree = parser.parse(next, fragments);
      assert.equal(signature(tree), signature(parser.parse(next)));
      doc = next;
    }
  });

  test(`${entry}: bounds array-shifting work for a long quote with inline emphasis`, () => {
    const lines = 2000;
    const doc = '> > quoted **bold** text\n'.repeat(lines);
    // Count moved array tails during the actual parse instead of imposing a
    // machine-dependent timing limit. Leave room for linear parser bookkeeping.
    const splice = Array.prototype.splice;
    let shifted = 0, tree;
    Array.prototype.splice = function (start, deleteCount, ...items) {
      const from = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
      const removed = Math.max(0, Math.min(deleteCount ?? this.length - from, this.length - from));
      if (items.length !== removed) shifted += this.length - from - removed;
      return Reflect.apply(splice, this, arguments);
    };
    try { tree = markdown.parser.parse(doc); }
    finally { Array.prototype.splice = splice; }
    let quoteMarks = 0, emphasis = 0;
    tree.iterate({ enter(node) {
      if (node.name === 'QuoteMark') quoteMarks++;
      if (node.name === 'StrongEmphasis') emphasis++;
    } });
    assert.equal(tree.length, doc.length);
    assert.equal(quoteMarks, 2 * lines);
    assert.equal(emphasis, lines);
    assert(shifted <= lines * 10, `Parser shifted ${shifted} array elements for ${lines} lines`);
  });
}
