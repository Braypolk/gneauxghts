import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Diagnostic prototype only: installed packages and application code stay unchanged.
// Run from the repo root, passing an extracted upstream dist/index.js for comparison.
const repo = process.cwd();
if (!process.argv[2]) throw new Error('Usage: node docs/research/diagnostics/markdown-parser-merge.probe.mjs /path/to/upstream/dist/index.js');
const upstreamPath = resolve(process.argv[2]);
const temporary = mkdtempSync(join(tmpdir(), 'gneauxghts-parser-merge-'));
const modulePath = name => join(temporary, `${name}.mjs`);
const require = createRequire(`${repo}/package.json`);
const sourcePath = createRequire(require.resolve('@codemirror/lang-markdown')).resolve('@lezer/markdown');
const markdownRequire = createRequire(sourcePath);
let source = readFileSync(sourcePath.replace(/index\.cjs$/, 'index.js'), 'utf8');
for (const name of ['@lezer/common', '@lezer/highlight']) {
  source = source.replace(`from '${name}'`, `from '${pathToFileURL(markdownRequire.resolve(name).replace(/index\.cjs$/, 'index.js'))}'`);
}
const start = source.indexOf('function injectMarks(elements, marks) {');
const end = source.indexOf('\n// These are blocks', start);
assert(start > 0 && end > start);
assert(source.slice(start, end).includes('elts.splice(eI++, 0, mark);'),
  'Historical probe requires unpatched @lezer/markdown 1.6.4; use the integrated parser regressions and full-app benchmarks after applying the patch.');
const linear = `function injectMarks(elements, marks) {
    if (!marks.length) return elements;
    if (!elements.length) return marks;
    let elts = elements.slice(), result = [], eI = 0;
    for (let mark of marks) {
        while (eI < elts.length && elts[eI].to < mark.to) result.push(elts[eI++]);
        if (eI < elts.length && elts[eI].from < mark.from) {
            let e = elts[eI];
            if (e instanceof Element)
                elts[eI] = new Element(e.type, e.from, e.to, injectMarks(e.children, [mark]));
        } else result.push(mark);
    }
    while (eI < elts.length) result.push(elts[eI++]);
    return result;
}`;
writeFileSync(modulePath('original'), source);
writeFileSync(modulePath('linear'), source.slice(0, start) + linear + source.slice(end));
const original = await import(pathToFileURL(modulePath('original')).href);
const patched = await import(pathToFileURL(modulePath('linear')).href);
let upstreamSource = readFileSync(upstreamPath, 'utf8');
for (const name of ['@lezer/common', '@lezer/highlight']) {
  upstreamSource = upstreamSource.replace(`from '${name}'`, `from '${pathToFileURL(markdownRequire.resolve(name).replace(/index\.cjs$/, 'index.js'))}'`);
}
writeFileSync(modulePath('upstream'), upstreamSource);
const upstream = await import(pathToFileURL(modulePath('upstream')).href);
const { TreeFragment } = await import(pathToFileURL(markdownRequire.resolve('@lezer/common').replace(/index\.cjs$/, 'index.js')));
function signature(tree) {
  const hash = createHash('sha256');
  tree.iterate({ enter(node) { hash.update(`${node.name}:${node.from}:${node.to};`); } });
  return hash.digest('hex');
}
let seed = 1729;
function rand(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
const atoms = ['text', '**bold**', '*emphasis*', '`code`', '[a](b)', '![a](b)', '<i>hi</i>', 'a\\*b', '~~strike~~', '***nested***', '[a\n> > b](c)', '*a\n> > b*', '`a\n> > b`', '[x]', '---', '## heading', ''];
let parity = 0;
for (const gfm of [false, true]) {
  const parsers = [original, patched].map(mod => gfm ? mod.parser.configure(mod.GFM) : mod.parser);
  for (let i = 0; i < 500; i++) {
    const doc = Array.from({ length: 1 + rand(100) }, () => `${'> '.repeat(rand(5))}${rand(5) === 0 ? '- ' : ''}${atoms[rand(atoms.length)]} ${atoms[rand(atoms.length)]}\n${rand(12) === 0 ? '\n' : ''}`).join('');
    assert.equal(signature(parsers[0].parse(doc)), signature(parsers[1].parse(doc)), `parity ${gfm}:${i}`);
    parity++;
  }
}
const rows = [];
for (const lines of [1000, 10000, 50000]) {
  for (const variant of ['original', 'noInlineEmphasis', 'paragraphBreaks']) {
    const doc = variant === 'noInlineEmphasis' ? '> > quoted   bold   text\n'.repeat(lines)
      : variant === 'paragraphBreaks' ? Array.from({length: lines}, (_, i) => '> > quoted **bold** text\n' + (i % 25 === 24 ? '> >\n' : '')).join('')
      : '> > quoted **bold** text\n'.repeat(lines);
    let expected;
    for (const [name, parser] of [['stock', original.parser], ['linear', patched.parser], ['upstream-1.8.1', upstream.parser]]) {
      const samples = [];
      let tree;
      for (let i = 0; i < 7; i++) {
        const before = performance.now(); tree = parser.parse(doc);
        if (i >= 2) samples.push(performance.now() - before);
      }
      const sig = signature(tree);
      if (!expected) expected = sig; else assert.equal(sig, expected);
      samples.sort((a,b) => a-b);
      const at = Math.floor(doc.length / 4) + 5;
      const changed = doc.slice(0, at) + 'x' + doc.slice(at + 1);
      const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [{fromA:at,toA:at+1,fromB:at,toB:at+1}]);
      const parse = parser.startParse(changed, fragments);
      let advances = 0, maxAdvanceMs = 0, totalMs = 0, done;
      do { const before = performance.now(); done = parse.advance(); const ms = performance.now()-before; maxAdvanceMs = Math.max(maxAdvanceMs,ms); totalMs += ms; advances++; } while (!done);
      assert.equal(signature(done), signature(parser.parse(changed)));
      rows.push({lines,variant,parser:name,medianMs:samples[2],samplesMs:samples,incremental:{totalMs,maxAdvanceMs,advances}});
    }
  }
}
console.log(JSON.stringify({description:'Isolated Node parser prototype. No installed dependency changed. Names and positions compared across full trees; no production/custom-extension or native-app verification.',runtime:process.version,randomizedParityFixtures:parity,warmups:2,samples:5,rows},null,2));

rmSync(temporary, { recursive: true, force: true });
