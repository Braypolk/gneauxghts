import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector';
import test from 'node:test';

const require = createRequire(new URL('../../package.json', import.meta.url));
const path = createRequire(require.resolve('@codemirror/lang-markdown')).resolve('@lezer/markdown');
// Recorded with the marker-merge patch, before inline dispatch was optimized.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/markdownInlineTrees.json', import.meta.url), 'utf8'));
function signature(tree) {
  let result = '';
  tree.iterate({ enter(node) { result += `${node.name}[${node.from},${node.to}](`; }, leave() { result += ')'; } });
  return result;
}
for (const entry of ['import', 'require']) {
  const modulePath = entry === 'import' ? path.replace(/index\.cjs$/, 'index.js') : path;
  const markdown = entry === 'import' ? await import(pathToFileURL(modulePath)) : require(modulePath);
  for (const fixture of fixtures) test(`${entry}: inline dispatch retains ${fixture.name} syntax and positions`, () => {
    const config = [markdown.GFM, markdown.Subscript, markdown.Superscript, markdown.Emoji];
    if (fixture.name === 'disabled') config.push({ remove: ['Emphasis', 'Entity', 'Link', 'Image', 'InlineCode'] });
    assert.equal(signature(markdown.parser.configure(config).parse(fixture.doc)), fixture.tree);
  });

  test(`${entry}: custom replacements of builtin names still run on arbitrary characters`, () => {
    const parser = markdown.parser.configure({ defineNodes: ['Custom'], parseInline: [{
      name: 'Link', parse(cx, next, pos) {
        return next === 113 || next === 233 ? cx.addElement(cx.elt('Custom', pos, pos + 1)) : -1;
      }
    }] });
    assert.equal(signature(parser.parse('q é [label](url)')), 'Document[0,16](Paragraph[0,16](Custom[0,1]()Custom[2,3]()))');
  });

  test(`${entry}: custom precedence and offsets survive ASCII and Unicode dispatch`, () => {
    const calls = [];
    const parser = markdown.parser.configure({ parseInline: [{ name: 'Observe', before: 'Escape',
      parse(_cx, _next, pos) { calls.push(pos); return -1; }
    }] });
    parser.parseInline('é a\\*b &amp;', 7);
    assert.deepEqual(calls, [7, 8, 9, 10, 12, 13, 14]);
  });

  test(`${entry}: quote inline parsing avoids impossible builtin recognizer calls`, async (t) => {
    const session = new Session();
    session.connect();
    const post = (method, params = {}) => new Promise((resolve, reject) => {
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
    });
    const lines = 2000, doc = '> > quoted **bold** text\n'.repeat(lines);
    const builtin = new Set(['Escape', 'Entity', 'InlineCode', 'HTMLTag', 'Emphasis', 'HardBreak', 'Link', 'Image', 'LinkEnd']);
    let coverage, tree;
    try {
      await post('Profiler.enable');
      await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      tree = markdown.parser.parse(doc);
      coverage = await post('Profiler.takePreciseCoverage');
    } finally {
      await post('Profiler.stopPreciseCoverage');
      session.disconnect();
    }
    let markers = 0, emphasis = 0;
    tree.iterate({ enter(node) { if (node.name === 'QuoteMark') markers++; if (node.name === 'StrongEmphasis') emphasis++; } });
    assert.equal(markers, lines * 2);
    assert.equal(emphasis, lines);
    const script = coverage.result.find(script => script.url === pathToFileURL(modulePath).href);
    assert(script, 'Actual parser coverage missing');
    const functions = script.functions.filter(fn => builtin.has(fn.functionName));
    assert(script.functions.some(fn => fn.functionName === 'parseInline' && fn.ranges[0].count > 0), 'Inline loop coverage missing');
    assert(functions.length > 0, 'Builtin recognizer coverage missing');
    const calls = functions.reduce((sum, fn) => sum + fn.ranges[0].count, 0);
    t.diagnostic(`${entry}: ${calls} builtin calls for ${doc.length} characters`);
    // Generous linear bound on useful starts; stock dispatch calls nine
    // recognizers at every ordinary character (397,955 calls for this fixture).
    assert(calls <= doc.length, `Made ${calls} builtin calls for ${doc.length} characters`);
  });
}
