# Visible-range Markdown formatting

Completed 2026-10-19 (America/Denver). Scope: presentation work in the production
Markdown ViewPlugin. Inherited worktree changes, including table removal, are
preserved. The immutable draft/full-Markdown callback redesign is deferred.

## Implementation

- Merge overlapping `EditorView.visibleRanges`, seek into each interval, and stop
  traversing siblings after its end. Decorate enclosing syntax once while still
  visiting the distinct descendants in later intervals.
- Clip emitted marks to the windows. Keep touching line decorations at their
  true line starts and keep inline widget/atomic replacement ranges intact.
- Fence/quote line emission intersects the windows before iterating lines.
  Quote markers use the main traversal instead of a recursive scan of the entire
  quote. Redundant identical nested-marker replacements disappear; existing
  paragraph continuation-marker behavior remains unchanged.
- Rebuild for viewport changes as well as document, selection and published-tree
  changes. Decorations and atomic ranges remain owned by each mounted view;
  shared document/runtime ownership and parse/layout readiness are unchanged.
- Retain the ViewPlugin approach: no block widgets or replacement of line breaks.
  Multiline links use their styled source form because replacing the whole link
  with an inline widget can throw CodeMirror's plugin-decoration layout error.
  Existing single-line link appearance is unchanged.

The appearance golden was recorded **before** changing production code. It
compares semantic ranges for seven selections through five windows, including
all existing formatting types. It normalizes redundant identical ranges.

## Reproduce

From the repository root, with the lockfile dependencies installed:

```sh
pnpm exec svelte-kit sync
node scripts/benchmarkMarkdown.mjs before pure
node scripts/benchmarkMarkdown.mjs after pure
GNEAUXGHTS_E2E_BROWSER_PORT=1423 node scripts/benchmarkMarkdown.mjs before mounted
GNEAUXGHTS_E2E_BROWSER_PORT=1423 node scripts/benchmarkMarkdown.mjs after mounted
```

Use `all` instead of `pure`/`mounted` to run both sequentially. The browser runner
needs permission to open a local Vite socket and launch headless Chrome. Run
measurements without other tests/benchmarks competing for CPU. The script briefly
replaces only the five files recorded in `before-source.json` for the `before`
variant and restores the caller's current contents in `finally`. Do not edit
those files concurrently. Git HEAD would be an incorrect baseline because it
does not include inherited worktree changes.

The isolated giant-quote repeat uses the same fixture and sampling rules:

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 MARKDOWN_BENCHMARK_SUFFIX=-quote-repeat \
  MARKDOWN_BENCHMARK_GREP='quote 50000 lines' node scripts/benchmarkMarkdown.mjs before mounted
GNEAUXGHTS_E2E_BROWSER_PORT=1423 MARKDOWN_BENCHMARK_SUFFIX=-quote-repeat \
  MARKDOWN_BENCHMARK_GREP='quote 50000 lines' node scripts/benchmarkMarkdown.mjs after mounted
```

The four primary result JSON files retain every sorted sample and fixture identifier;
two additional JSON files retain the isolated giant-quote repeat.
`before-source.json` retains the exact pre-change production builder/decorators.
Fixtures and measurement code live in:

- `src/lib/features/notepad/markdown/markdownBenchmarkFixtures.ts`
- `src/lib/features/notepad/markdown/markdownPerformance.test.ts`
- `src/lib/e2e/markdownFormattingHarness.ts`
- `e2e/specs/browser/markdown-performance.spec.ts`

### Conditions

Both variants ran sequentially on the same Apple M4 Pro, macOS arm64, Node
v24.2.0, lockfile dependencies (CodeMirror view 6.43.1 with the repository patch),
and headless Chrome 155.0.8059.85. No CPU affinity or power governor was imposed.
These are local samples, not cross-machine performance guarantees.

**Pure decoration:** 1,000 / 10,000 / 50,000 body lines, mixed Markdown / one
enormous fence / one enormous two-level quote. Exactly 40 visible lines per pane
at 25% and (for the second pane) 75% of the document. Parse/state construction and
transaction application are outside timing. Two pre-parsed state variants model
selection changes and tail edits. Five warmups, 30 samples; each sample invokes
the production builder for one or both panes. This measures traversal, decorator
emission, sorting, RangeSet creation and atomic ranges, without DOM or parsing.

**Mounted browser:** same fixture sizes/kinds; real EditorViews with production
Markdown extensions and the real shared EditorDocumentRuntime, one or two
600×800 px editors in a 1440×857 CSS-pixel browser viewport. The measurement uses
a fixed 16 px font / 20 px line height, line wrapping and CodeMirror overscan
(about 91 visible-range lines per pane), without application chrome or scoped
production typography. Other pane plugins (dates, images, block handles and
toolbars) are not installed in this isolated timing harness; application-level
coverage comes from the separate behavioral journeys. Initial full
parsing/mounting/scrolling are outside timing.
Selection updates target only the first pane; edits flow through the runtime to
the root and all attached views. Five warmups, 20 samples per operation.
`dispatch` includes synchronous state updates, parser work, decoration updates,
runtime broadcast and its existing Markdown callback path. `twoFrame` additionally
forces layout and awaits two animation frames. It is a frame-inclusive observation
window, not end-to-end save latency or proof that all background parsing finished.

Medians use the upper middle sample. P95 uses nearest rank. Pure two-pane samples
explicitly rebuild **both** panes; mounted selection changes update just the
invoking pane, matching actual runtime behavior.

## Validation

```sh
pnpm check
pnpm test
GNEAUXGHTS_E2E_BROWSER_PORT=1423 pnpm exec wdio run e2e/wdio.browser.conf.ts \
  --spec e2e/specs/browser/visible-markdown.spec.ts \
  --spec e2e/specs/browser/editor-formatting-load.spec.ts \
  --spec e2e/specs/browser/editor-cursor.spec.ts
```

- `pnpm check`: no Svelte/type diagnostics; E2E TypeScript passes.
- `pnpm test`: 59 support tests and 1,345 Vitest tests pass; one opt-in benchmark
  is skipped in the routine suite.
- Mounted regressions: six new journeys, five existing application readiness
  journeys and 12 existing cursor/selection journeys pass (23 total).
- New journeys cover long fences and nested quotes; true block boundaries;
  offscreen caret context; scrolling; conceal/reveal and selection fills;
  indentation and aliased-link atomic cursor motion; multiline-link layout;
  two panes with different selections/scroll positions; independent formatting;
  passive shared edits and mapped selections; distant syntax changes after fence
  insertion/removal; initially incomplete parsing and settled presentation.

**Follow-up, 2026-10-20:** native macOS/WebKit verification now passes seven
formatting/readiness checks and twelve foreground cursor/selection checks.
Full-app before/after benchmarks and giant-quote CPU profiles are recorded in
[followup-verification.md](followup-verification.md). The original mounted
numbers above remain isolated Chrome measurements. Native performance and iOS
remain unmeasured.

## Remaining size-dependent work

The language parser still owns syntax-tree construction and publication. An edit
inside a giant quote or a changed fence can invalidate syntax far beyond the typed
range. The shared runtime still updates its root, broadcasts edits, maintains
history and materializes full Markdown for its existing callback path. Those
costs are included in mounted dispatch timing and intentionally unchanged here.

Seeking within Lezer's published tree can scan preceding child entries; this is
not a claim of strict O(visible characters) lookup for every possible tree shape.
Ancestor depth and large inline constructs can also add context/child lookup or
source-slicing work. Mark sorting/building now scales with emitted window content;
large visible windows or deeply nested syntax still cost more. No full-note
parse, shared view cache, layout StateField or callback redesign was added.

## Measured results

All values below are medians in milliseconds; arrows are before → after. Raw JSON also records P95 and all samples.

### Pure decoration scaling

| Kind | Body lines | One-pane selection (ms) | Decorations in last pane |
| --- | ---: | ---: | ---: |
| mixed | 1,000 | 0.768 → 0.097 | 2,184 → 90 |
| mixed | 10,000 | 6.880 → 0.050 | 21,818 → 92 |
| mixed | 50,000 | 39.001 → 0.039 | 109,092 → 86 |
| fence | 1,000 | 0.146 → 0.024 | 1,006 → 40 |
| fence | 10,000 | 0.995 → 0.006 | 10,006 → 40 |
| fence | 50,000 | 6.739 → 0.005 | 50,006 → 40 |
| quote | 1,000 | 0.854 → 0.087 | 5,005 → 202 |
| quote | 10,000 | 8.786 → 0.107 | 50,005 → 202 |
| quote | 50,000 | 59.617 → 0.066 | 250,005 → 202 |

### Pure 50,000-line updates

| Kind | One-pane document (ms) | Two-pane selection (ms) | Two-pane document (ms) |
| --- | ---: | ---: | ---: |
| mixed | 38.397 → 0.037 | 77.284 → 0.081 | 77.754 → 0.080 |
| fence | 6.751 → 0.005 | 13.576 → 0.013 | 13.771 → 0.013 |
| quote | 65.273 → 0.065 | 123.567 → 0.135 | 124.321 → 0.137 |

### Mounted browser scaling

Selection dispatch updates only its own pane. Edit dispatch includes root state, parsing and sibling broadcast. Frame-inclusive edits include two animation frames.

| Kind | Body lines | Panes | Selection dispatch (ms) | Edit dispatch (ms) | Frame-inclusive edit (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| mixed | 1,000 | 1 | 3.2 → 0.7 | 5.2 → 1.2 | 33.3 → 33.4 |
| mixed | 10,000 | 1 | 7.7 → 0.3 | 9.1 → 2.1 | 33.3 → 33.3 |
| mixed | 50,000 | 1 | 29.3 → 0.4 | 37.4 → 6.8 | 50.0 → 33.4 |
| mixed | 50,000 | 2 | 32.0 → 0.3 | 77.5 → 12.1 | 83.3 → 33.3 |
| fence | 1,000 | 1 | 1.2 → 0.2 | 2.6 → 0.7 | 33.4 → 33.3 |
| fence | 10,000 | 1 | 2.8 → 0.2 | 6.0 → 1.5 | 33.2 → 33.3 |
| fence | 50,000 | 1 | 6.6 → 0.2 | 10.3 → 3.7 | 33.3 → 33.3 |
| fence | 50,000 | 2 | 6.7 → 0.2 | 19.2 → 5.3 | 33.3 → 33.3 |
| quote | 1,000 | 1 | 3.8 → 0.8 | 9.6 → 7.6 | 33.4 → 33.3 |
| quote | 10,000 | 1 | 10.7 → 0.8 | 62.0 → 57.2 | 96.6 → 85.5 |
| quote | 50,000 | 1 | 45.8 → 0.4 | 544.1 → 500.1 | 573.1 → 740.1 |
| quote | 50,000 | 2 | 45.1 → 0.4 | 842.7 → 756.4 | 1093.0 → 1010.1 |

The giant quote remains expensive to edit even with bounded decorations. At 50,000 lines its one-pane edit dispatch is 544.1 → 500.1 ms; two panes are 842.7 → 756.4 ms. Pure decoration for the edited two-pane quote is 124.321 → 0.137 ms. The difference shows that bounding presentation does not remove the remaining parser/runtime work. No claim of constant-time whole-editor updates is made.

### Isolated giant-quote repeat

The same 50,000-line quote was measured again in separate before/after Chrome launches, with the same warmups, sample counts and operations. No sample was discarded.

| Panes | Operation | Dispatch median, before → after (ms) | Two-frame median, before → after (ms) |
| ---: | --- | ---: | ---: |
| 1 | selection | 45.5 → 0.5 | 50.0 → 33.3 |
| 1 | document | 548.4 → 507.8 | 786.9 → 751.6 |
| 2 | selection | 47.0 → 0.4 | 50.1 → 33.3 |
| 2 | document | 849.7 → 773.6 | 1103.8 → 1027.4 |

In the primary run, one-pane frame-inclusive quote edits worsened (573.1 → 740.1 ms). The repeat baseline itself was 786.9 ms; the repeat after result was 751.6 ms. Thus the frame-inclusive quote-edit result is variable and does not establish a consistent latency improvement or a repeatable regression. The synchronous quote-edit path remains expensive in both variants. The reduction in pure decoration and selection dispatch is consistent across both runs.
