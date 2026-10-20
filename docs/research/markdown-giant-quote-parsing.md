# Markdown parsing delays in giant quotes

Initially investigated 2026-10-20 on main `9aad697f`, with production code, installed packages and the lockfile unchanged during that investigation. Parser candidates were loaded in a temporary application copy. The marker merge was subsequently integrated as a pinned dependency patch; [integration, regression coverage and native verification](../../.scratch/archive/visible-range-markdown/marker-merge-integration.md) record the shipping change. Prototype results below remain historical.

## Diagnosis

The previous full-app profiles attribute 92–93% of sampled CPU to live language parsing, including 50–57% self time in `injectMarks`. Viewport decoration building accounts for under 0.1%; main's image inventory fix has removed the former image reparses from this fixture. See [the main integration measurements](../../.scratch/archive/visible-range-markdown/main-integration.md).

Three costs remain:

1. **Repeated array insertion.** Lezer merges quote/list markers into inline elements using `splice` for each marker. With many markers interspersed among emphasis nodes, every insertion shifts the remaining elements. This explains the strongly superlinear growth on the giant quote with bold text.
2. **A paragraph is a large, synchronous unit.** The 50,000 quoted lines form one paragraph. An edit invalidates that leaf; `advance()` collects it, parses inline syntax, and injects markers before returning. CodeMirror checks its work deadline between calls, so its 20 ms budget cannot interrupt this paragraph. The prototype's edited giant paragraph still took roughly 115 ms in one parser step in the Node spot check.
3. **Independent root and pane parsers.** `documentRoot()` installs `createMarkdownBaseExtensions()`, which includes Markdown language support. Each pane has its own language state too. `dispatchFromPane()` updates the root and broadcasts to panes. This multiplies the expensive parsing; it does not imply history or pane ownership is incorrect. Removing unnecessary language work from the history root is a separate, unmeasured candidate.

Local owning sources: `editorDocumentRuntime.ts` (`documentRoot`, `dispatchFromPane`), `editorShortcuts.ts` (`createMarkdownBaseExtensions`), installed `@lezer/markdown` (`BlockContext.advance`, `finishLeaf`, `injectMarks`), and installed `@codemirror/language` (`LanguageState.apply`, `ParseContext.work`).

## Experiments

A diagnostic stable merge appends emitted elements and markers to an output array instead of inserting into the middle of a growing array. It retains the original nesting conditions and recursive handling. This is a prototype of the sibling merge, not a claim that every nested multiline case is now linear: repeated recursive copying for markers inside one large inline element remains possible.

The prototype preserved ordered node names and absolute ranges on 1,000 seeded randomized CommonMark/GFM documents, including nested quotes/lists and multiline emphasis, code, and links. All nine large ablation fixtures also matched stock trees; incremental results matched fresh parses. These checks do not establish equality of all node properties, all custom-extension behavior, or full CommonMark conformance.

The direct-parse controls removed emphasis without changing line length, or inserted paragraph boundaries every 25 lines. Both avoided the severe giant-single-paragraph/bold interaction. Breaking the paragraph also reduced incremental work to small blocks. These are diagnostic controls; inserting blank lines into authored notes would change their semantics and is not a proposed fix.

The real Svelte application benchmark used the existing 50,000-line two-level quote with bold text, one or two panes, five warmups, and 20 recorded edits. Initial parsing/mounting/scrolling and fixture debounce settling were excluded from timing. This was a temporary copy of main with only the parser module selected by Vite alias; the production custom extensions and Table removal stayed configured. Node 24.2.0, Apple M4 Pro, headless Chrome 155, 1440×857 CSS viewport, existing CodeMirror versions and typography. These are development-browser measurements, not release or native WebKit results.

| Parser | Panes | Dispatch median | Dispatch P95 | Dispatch + two frames median |
| --- | ---: | ---: | ---: | ---: |
| stock | 1 | 590.8 ms | 664.6 ms | 811.2 ms |
| stock | 2 | 829.6 ms | 912.6 ms | 1107.8 ms |
| linear | 1 | 277.9 ms | 301.0 ms | 393.7 ms |
| linear | 2 | 387.9 ms | 408.5 ms | 518.5 ms |
| upstream-1.8.1 | 1 | 534.6 ms | 2487.9 ms | 783.2 ms |
| upstream-1.8.1 | 2 | 828.1 ms | 3505.1 ms | 1076.3 ms |

The marker-merge prototype reduced median edit dispatch by **53.0% with one pane and 53.2% with two panes** against the stock parser in this experiment. It remains visibly slow. Selection-only medians stayed between 1.6 and 2.4 ms across these runs; two-frame selection observations stayed around 33 ms.

The latest upstream version did not remove the giant-quote stall. Its median was about 535/828 ms for one/two panes, and it had multi-second tail samples. Those samples do not by themselves establish a general release regression. The original combined upstream run passed the one-pane case but timed out during two-pane work; the standalone two-pane retry passed. The timed-out case later wrote rows, which were explicitly excluded from the table. The table uses the successful one-pane case and fresh successful two-pane retry.

The prototype passed 23 existing browser checks: six visible-Markdown cases, five formatting-load cases, and twelve caret/selection cases. Both giant-quote profiling fixtures passed. The additional split-image inventory fixture timed out; a stock-parser control is recorded below. Native macOS/WebKit was not run for this experimental parser. These are investigation results, not shipping verification.

New prototype CPU profiles sampled fifteen edits per pane count at a requested 1 ms interval, including five warmups. `injectMarks` self time fell to 0.21% / 0.39% of sampled time for one/two panes. Language parsing remained approximately 89% inclusive; `parseInline` was 24–25% self, `finishLeaf` 18–19% self, and GFM Autolink's inline parser approximately 13% self. Those percentages have a different total than the earlier stock profiles and do not predict latency by themselves. The unprofiled benchmark table is the evidence for the dispatch improvement.

The same split-image inventory fixture also timed out at 60 seconds with the unmodified 1.6.4 parser alias in the temporary copy; both failure screenshot hooks reported a closed WebDriver connection. The cause remains unresolved. This control prevents attributing that failure to the merge, but it also means this fixture is not validated for the prototype. It passed on actual main in the previous integration run; that earlier result is not substituted for prototype verification.


## Recommended implementation order

1. **Make the marker merge efficient while preserving syntax.** This is the smallest change with demonstrated application benefit. Keep nested quote markers in their existing inline parents; do not flatten them onto the quote block. Use the repository's package-patch mechanism if an appropriate upstream release does not exist. Before shipping, test long multiline inline containers, `TreeElement` handling, custom syntax, grammar fixtures, incremental parity, native WebKit appearance/caret behavior, and ordinary-note performance.
2. **Audit language extensions on the history root.** Determine which root consumers actually require syntax trees. If none do, retain canonical text/history ownership while avoiding a parser there; validate shared undo/redo, root publication, selection, remount, and split-pane behavior. This has not been benchmarked and should not be assigned a predicted percentage improvement.
3. **Re-profile, then address the remaining long parser step.** Resumable paragraph/inline parsing could reduce worst pauses without changing note bytes, but requires retained delimiter/context state. Arbitrarily splitting by line can break multiline emphasis, links, and code. Worker parsing and shared parse ownership are larger architecture changes, not drop-in scheduler settings.

An upgrade to 1.8.1 should be assessed separately for its useful many-block reuse fix; the measurements below determine its effect on this specific giant quote. Neither changing the scheduler timeout nor merely bounding decorations solves an uninterruptible paragraph step.

## Reproducing the parser probe

The retained [historical diagnostic probe](diagnostics/markdown-parser-merge.probe.mjs) reads the installed dependency and writes original/experimental ESM copies into a fresh temporary directory. It never patches installed dependencies. It requires an unpatched 1.6.4 checkout and now refuses to label the integrated patched parser as a stock baseline. Use the integrated regression/full-app commands above for current verification. To reproduce the earlier comparison from an unpatched checkout, supply an extracted upstream package:

```sh
# From the repository root, after extracting the official @lezer/markdown 1.8.1 tarball:
node docs/research/diagnostics/markdown-parser-merge.probe.mjs \
  /tmp/gneauxghts-upstream-markdown-1.8.1/dist/index.js \
  > .scratch/archive/visible-range-markdown/parser-merge-probe.json
```

Full-app runs used the existing `markdown-full-app-performance.spec.ts` and a temporary Vite alias for `@lezer/markdown`; source and generated Vite caches lived under `/tmp/gneauxghts-parser-app-probe`. Alias targets were copies of installed 1.6.4, that same version with only the marker merge changed, or unmodified 1.8.1. Dependency import paths were redirected to the existing compatible common/highlight modules. Initial temporary-copy startup failed because generated SvelteKit files were missing; after synchronization and isolating generated directories, all reported runs started successfully. Failed setup attempts are not included in timing results.

Raw benchmark JSON, probe results, and CPU evidence remain local and ignored under `.scratch/archive/visible-range-markdown/`; generated application copies remain temporary. The report and diagnostic source are the retained investigation artifacts.

# Upstream investigation

Investigated 2026-10-20 against the public npm registry, current first-party sources, release history, issue listings, and maintainer discussions. The following source investigation accompanies the isolated application experiments above.

## Findings

**An upstream performance improvement exists, but it addresses a different shape of document.** The installed `@lezer/markdown` is 1.6.4. The current npm release is **1.8.1**, published **2026-10-19 at 17:39:13 UTC**. Its changelog includes improved reuse of groups of syntax nodes during incremental parsing. The current development branch and the released package both identify themselves as 1.8.1. [npm release metadata](https://registry.npmjs.org/@lezer%2fmarkdown), [current package metadata](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/package.json), [changelog](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/CHANGELOG.md).

The release contains maintainer commit `03d2bc11a5d9925a3e46ab492197e549f086b80a`. It reuses anonymous grouping nodes around unchanged **blocks**, avoiding a traversal proportional to the number of individual blocks. Its regression fixtures use many separate `blah\n\n` paragraphs and repeated paragraph appends. It bounds reused grouping size to prevent increasingly unbalanced trees. These are valuable improvements for notes with many independent paragraphs. The application fixture, however, has 50,000 quote lines forming one paragraph. **Inference:** this change should not remove the measured cost of reconstructing that changed paragraph. A version comparison is still worthwhile. [Maintainer implementation and tests](https://code.haverbeke.berlin/lezer/markdown/commit/03d2bc11a5d9925a3e46ab492197e549f086b80a).

**The exact `injectMarks` hotspot remains present upstream.** In 1.8.1, `injectMarks` still copies the element array and repeatedly calls `splice` while merging quote/list markers into the inline tree. This is unchanged in the aspect implicated by the local profile. Many insertions before remaining inline elements imply repeated shifting; the cumulative cost can grow quadratically in the number of sibling elements/markers. This is an algorithmic inference from the code, supported by the application's existing profile, rather than a maintainer-confirmed diagnosis. [Current parser source, function `injectMarks`](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/src/markdown.ts).

**A small editor time budget cannot preempt one expensive parser step.** The current CodeMirror language package is 6.13.1; the application uses 6.12.3. Its scheduler still requests 20 milliseconds of work for document changes, calls `parse.advance()`, and checks the deadline afterward. `takeTree()` can also synchronously finish a partial tree. The parser's `advance()` collects a paragraph and `finishLeaf()` performs inline parsing and marker injection before returning. Thus reducing a scheduler budget alone cannot interrupt that work. Current language changelog entries after 6.12.3 concern folding-range construction and stream-parser packaging, not a fix for this giant-paragraph case. [Language source](https://code.haverbeke.berlin/codemirror/language/src/branch/main/src/language.ts), [language changelog](https://code.haverbeke.berlin/codemirror/language/src/branch/main/CHANGELOG.md), [npm latest metadata](https://registry.npmjs.org/@codemirror%2flanguage/latest).

The parser source still accumulates leaf content, parses the complete inline section, then injects markers. Reuse happens at block boundaries. **Inference:** an edit inside one enormous paragraph invalidates the containing leaf even if most lines are unchanged. Making decorations viewport-bounded does not change this grammar-level unit of work. [Current parser source, `advance`, `finishLeaf`, and `reuseFragment`](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/src/markdown.ts).

## Existing approaches and their relevance

| Approach | Existing upstream evidence | Fit for this application |
| --- | --- | --- |
| Upgrade Markdown to 1.8.1 | Released grouping-node reuse fix | Low-cost experiment and likely improvement for many-block notes. Does not replace the `injectMarks` loop. Check custom extensions, removed tables, and emphasis/link behavior changes. |
| Merge markers without repeated array insertion | Exact loop is still present in 1.8.1 | Most focused candidate for the measured hotspot. Prototype a stable merge and compare complete tree structure and positions, including nested/cross-line syntax and `TreeElement` cases. No exact upstream fix found. |
| Smaller incremental blocks or resumable inline work | Current parser processes a paragraph as one leaf | Could bound remaining pauses after the merge fix. A parser architecture change: arbitrary line splitting changes multiline Markdown semantics. Requires retained delimiter/context state and careful incremental parity. |
| Debounce parsing | Previously discussed with the maintainer | Not an existing configuration solution. Highlighting, folding, bracket matching, and other state consumers expect a current tree during updates. |
| Run parsing in a Web Worker | Previously considered by the maintainer | Main-thread responsiveness can improve, but Lezer's shared object trees and synchronous state integration make this a substantial coordination/serialization change. No drop-in upstream worker option was found. |
| Replace the parser with an mdast-based adapter | A public Lezer adapter exists | That adapter explicitly recommends `@lezer/markdown` for incremental performance. A full-document HTML/AST parser benchmark is not evidence of faster editor updates with custom syntax and incremental trees. |

The maintainer's discussion of synchronous parsing explains why simply debouncing it carries significant complexity: several editor features depend on the syntax tree whenever state updates. This is an architectural constraint rather than proof that debouncing could never work in a custom integration. [Language parser/syntax tree performance and debouncing](https://discuss.codemirror.net/t/language-parser-syntax-tree-performance-and-debouncing/3976).

Likewise, the maintainer has explained that Lezer's trees share object structure and that moving them across workers complicates both transfer and coordination. CodeMirror's normal “background parsing” is cooperative main-thread work; it should not be mistaken for a separate Web Worker. [Parsing scheduling discussion](https://discuss.codemirror.net/t/some-thoughts-and-requests-about-how-cm6-schedules-parsing/3045), [worker-isolated state discussion](https://discuss.codemirror.net/t/codemirror-6-web-worker-isolated-state/2788).

The existing alternative `lezer-mdast-markdown` produces Lezer trees from the mdast ecosystem, but its own documentation recommends the current Lezer Markdown packages when incremental performance is needed. It is not established as a remedy for this latency. [Alternative adapter documentation](https://github.com/Sec-ant/lezer-mdast-markdown).

An earlier maintainer answer also confirms that quote markers can legitimately occur inside paragraph nodes because Lezer trees must have properly nested ranges. A replacement merge must preserve that nesting; attaching all quote marks directly to the blockquote would change expected structure. [QuoteMark parent discussion](https://discuss.codemirror.net/t/quotemarks-parent-in-lezer-markdown/7533).

## Upstream follow-up options

1. Compare 1.6.4 and 1.8.1 on both the giant single-paragraph quote and a many-paragraph control, using full tree-position parity checks and incremental edits.
2. Prototype a marker merge without repeated `splice`, retaining the existing parser configuration and paragraph semantics. Compare baseline versus prototype on quote-heavy, inline-heavy, multiline-span, custom-extension, and ordinary-note cases. Record both fresh parse time and edited-paragraph time.
3. If the focused merge produces a repeatable benefit, verify it in one- and two-pane full-app benchmarks, then native macOS/WebKit. Treat Node parser timings as diagnosis rather than app latency predictions.
4. Re-profile the remaining latency before considering shared parser ownership, resumable paragraph parsing, or workers. Those approaches have larger consistency and integration costs.

If reporting upstream, send a small reproducible bug and measurements. PR68 was closed without merging its submitted patch; the maintainer implemented a different version and explicitly stated a policy against accepting LLM-generated contributions. Respect that contribution policy. No issue or message has been sent as part of this research. [PR68 discussion](https://code.haverbeke.berlin/lezer/markdown/pulls/68).

## Search limits and reproducibility

The old GitHub repositories were archived in April 2026 and point to the new first-party forge. Cached GitHub sources stopped at 1.6.3 and therefore are unsuitable for checking current fixes. The web browsing tool returned HTTP403 for some current forge URLs, so current sources, public issue API, npm registry metadata, and the release tarball were read directly over HTTPS. [Archived GitHub repository and migration notice](https://github.com/lezer-parser/markdown).

The Markdown repository's public issue listings, its current `injectMarks` implementation, changelog, and related maintainer discussions did not reveal an existing fix for this exact repeated-insertion hotspot. This is a bounded search, not proof that no external fork implements a solution.

The unmodified public npm tarball was extracted to `/tmp/gneauxghts-upstream-markdown-1.8.1/` for the parent's isolated comparison. It requires `@lezer/common ^1.5.0` and `@lezer/highlight ^1.0.0`. No repository files, installed dependencies, lockfile, or running application were modified by this research agent.
