import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector';
import test from 'node:test';

const require = createRequire(new URL('../../package.json', import.meta.url));
const languagePath = require.resolve('@codemirror/lang-markdown');
const markdownPath = createRequire(languagePath).resolve('@lezer/markdown');
const commonPath = createRequire(markdownPath).resolve('@lezer/common');
const htmlPath = createRequire(languagePath).resolve('@codemirror/lang-html');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/mixedParserTrees.json', import.meta.url), 'utf8'));
function signature(tree) {
  let result = '';
  tree.iterate({ enter(node) { result += `${node.name}[${node.from},${node.to}](`; }, leave() { result += ')'; } });
  return result;
}
function mounts(tree, common) {
  const result = [], cursor = tree.cursor(common.IterMode.IgnoreMounts);
  do {
    const mount = cursor.node.prop(common.NodeProp.mounted);
    if (mount) result.push({ from: cursor.from, to: cursor.to, tree: signature(mount.tree), overlay: mount.overlay?.map(range => ({ from: range.from, to: range.to })) ?? null });
  } while (cursor.next());
  return result;
}
for (const entry of ['import', 'require']) {
  const load = path => entry === 'import' ? import(pathToFileURL(path.replace(/index\.cjs$/, 'index.js'))) : require(path);
  const [markdown, common, html] = await Promise.all([load(markdownPath), load(commonPath), load(htmlPath)]);
  const parser = markdown.parser.configure([markdown.GFM, markdown.parseCode({
    htmlParser: html.htmlLanguage.parser, codeParser: () => html.htmlLanguage.parser
  })]);
  for (const fixture of fixtures) test(`${entry}: preserves mixed mounts and incremental syntax in ${fixture.name}`, () => {
    let doc = fixture.doc, tree = parser.parse(doc);
    assert.equal(signature(tree), fixture.tree);
    assert.deepEqual(mounts(tree, common), fixture.mounts);
    for (const [find, insert] of fixture.edits) {
      const from = doc.indexOf(find);
      assert(from >= 0);
      const to = from + find.length, next = doc.slice(0, from) + insert + doc.slice(to);
      const fragments = common.TreeFragment.applyChanges(common.TreeFragment.addTree(tree), [
        { fromA: from, toA: to, fromB: from, toB: from + insert.length }
      ]);
      tree = parser.parse(next, fragments);
      const fresh = parser.parse(next);
      assert.equal(signature(tree), signature(fresh));
      assert.deepEqual(mounts(tree, common), mounts(fresh, common));
      doc = next;
    }
  });

  test(`${entry}: partial buffered quotes resume embedded parsing after shifted edits`, () => {
    let doc = 'prefix\n\n' + '> **bold** text\n'.repeat(250) + '> <b>inside</b>\n' +
      '> **bold** text\n'.repeat(250) + '\n```html\n<i>code</i>\n```\n\ntail';
    const partial = parser.startParse(doc);
    partial.stopAt(Math.floor(doc.length / 4));
    let tree;
    while (!(tree = partial.advance())) { /* Complete the requested partial tree. */ }
    tree = parser.parse(doc, common.TreeFragment.addTree(tree, [], true));
    assert.deepEqual(mounts(tree, common), mounts(parser.parse(doc), common));
    assert(mounts(tree, common).length >= 3);
    for (const [find, insert] of [['prefix', 'longer prefix before the quote'], ['<b>inside</b>', '<em>changed</em>'], ['> **bold** text', '> altered']]) {
      const from = doc.indexOf(find), to = from + find.length;
      const next = doc.slice(0, from) + insert + doc.slice(to);
      const fragments = common.TreeFragment.applyChanges(common.TreeFragment.addTree(tree), [
        { fromA: from, toA: to, fromB: from, toB: from + insert.length }
      ]);
      tree = parser.parse(next, fragments);
      const fresh = parser.parse(next);
      assert.equal(signature(tree), signature(fresh));
      assert.deepEqual(mounts(tree, common), mounts(fresh, common));
      doc = next;
    }
  });

  test(`${entry}: buffered nodes do not trigger fruitless mixed-parser identity searches`, async (t) => {
    const parser = markdown.parser.configure({ wrap: common.parseMixed(() => null) });
    const lines = 2000, doc = '> > quoted **bold** text\n'.repeat(lines) + '\noutside';
    const tree = parser.parse(doc), pos = Math.floor(doc.length / 4);
    const changed = doc.slice(0, pos) + 'x' + doc.slice(pos + 1);
    const fragments = common.TreeFragment.applyChanges(common.TreeFragment.addTree(tree), [
      { fromA: pos, toA: pos + 1, fromB: pos, toB: pos + 1 }
    ]);
    const session = new Session(); session.connect();
    const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params,
      (error, result) => error ? reject(error) : resolve(result)));
    let next, coverage;
    try {
      await post('Profiler.enable');
      await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      next = parser.parse(changed, fragments);
      coverage = await post('Profiler.takePreciseCoverage');
    } finally { await post('Profiler.stopPreciseCoverage'); session.disconnect(); }
    assert.equal(signature(next), signature(parser.parse(changed)));
    const modulePath = entry === 'import' ? commonPath.replace(/index\.cjs$/, 'index.js') : commonPath;
    const script = coverage.result.find(script => script.url === pathToFileURL(modulePath).href);
    const check = script?.functions.find(fn => fn.functionName === 'checkSide');
    assert(check && check.ranges[0].count > 0, 'Actual tree-side coverage missing');
    const calls = check.ranges[0].count;
    t.diagnostic(`${entry}: ${calls} tree-side checks for ${doc.length} characters`);
    assert(calls <= doc.length, `Made ${calls} tree-side checks for ${doc.length} characters`);
  });
}
