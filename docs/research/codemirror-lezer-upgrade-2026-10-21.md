# CodeMirror / Lezer upgrade research — 2026-10-21

Registry metadata, published distribution code and tagged upstream changelogs were rechecked for this upgrade. This report records source evidence, the implemented patch rebases and measured acceptance below.

## Versions and compatibility

Upgrade the three pinned editor dependencies together: `@codemirror/view` **6.43.1 → 6.43.15**, `@lezer/common` **1.5.2 → 1.5.3**, and transitive `@lezer/markdown` **1.6.4 → 1.8.1**. These are the registry's latest stable versions. View and Markdown were published October 19; common September 24. The new releases declare no new Node engine or peer requirement. View requires state `^6.7.0`; Markdown requires common `^1.5.0` and highlight `^1.0.0`; the existing state 6.7.6 and highlight 1.2.5 satisfy these. [View metadata](https://registry.npmjs.org/@codemirror%2fview), [common metadata](https://registry.npmjs.org/@lezer%2fcommon), [Markdown metadata](https://registry.npmjs.org/@lezer%2fmarkdown).

All other direct CodeMirror/Lezer dependencies are already current. Their tagged changelogs and registry latest tags were checked, so they need no speculative version bump:

| Dependency | Installed / latest | Latest release's relevant change |
| --- | --- | --- |
| `@codemirror/commands` | 6.11.1 | Makes line-boundary commands bidi-aware. |
| `@codemirror/lang-markdown` | 6.5.2 | Prevents continuation/newline commands deleting pieces of lazily continued paragraphs. |
| `@codemirror/language` | 6.13.1 | Explicitly declares its streamparser dependency. |
| `@codemirror/language-data` | 6.5.2 | Uses the dedicated Jinja language package and recognizes additional XQuery extensions. |
| `@codemirror/search` | 6.7.2 | Refocuses an existing go-to-line dialog. |
| `@codemirror/state` | 6.7.6 | Associates `changeByRange` cursors with their inserted text. |
| `@lezer/highlight` | 1.2.5 | Fixes equally specific added highlighting rules not applying. |

Sources: tagged [commands](https://code.haverbeke.berlin/codemirror/commands/src/tag/6.11.1/CHANGELOG.md), [lang-markdown](https://code.haverbeke.berlin/codemirror/lang-markdown/src/tag/6.5.2/CHANGELOG.md), [language](https://code.haverbeke.berlin/codemirror/language/src/tag/6.13.1/CHANGELOG.md), [language-data](https://github.com/codemirror/language-data/blob/6.5.2/CHANGELOG.md), [search](https://code.haverbeke.berlin/codemirror/search/src/tag/6.7.2/CHANGELOG.md), [state](https://code.haverbeke.berlin/codemirror/state/src/tag/6.7.6/CHANGELOG.md), [highlight](https://code.haverbeke.berlin/lezer/highlight/src/tag/1.2.5/CHANGELOG.md). Registry latest values were read from the corresponding package metadata endpoints.

Keep exact patched versions, override versions and `patchedDependencies` keys synchronized. One shared editor/parser graph preserves the existing patch boundary; do not remove overrides merely because the upgrades fit dependency ranges.

## Changelog changes that matter here

**View:** the intervening patch releases fix DOM/tile corruption, widget updates, composition reuse, Safari coordinate/selection behavior, scrolling while content or scaling changes, repeated VoiceOver announcements, and scroll clipping by parents. Version 6.43.15 additionally fixes a selection race when scrolling is delivered before pending input events. These directly justify exercising native editing and focus. The notes list fixes rather than a major API migration; however, 6.43.13 deprecates `visualLineSide` and changes it to return the logical line side. Cursor acceptance should therefore include wrapped/bidi boundaries instead of assuming unchanged visual movement semantics. [Tagged view changelog](https://code.haverbeke.berlin/codemirror/view/src/tag/6.43.15/CHANGELOG.md).

**Common:** 1.5.3 avoids repeatedly scanning the same nodes in large mixed-language trees. Its traversal now excludes buffered nodes in the old structure. This is related to our performance patch, but is not the same optimization. [Tagged common changelog](https://code.haverbeke.berlin/lezer/common/src/tag/1.5.3/CHANGELOG.md), [mixed-parser implementation](https://code.haverbeke.berlin/lezer/common/src/tag/1.5.3/src/mix.ts).

**Markdown:** 1.8.1 reuses entire groups of syntax nodes incrementally, a useful improvement for notes with many blocks. Earlier releases correct partial strong/emphasis matching and malformed fragment reuse; 1.8.1 also changes tab-separated ATX headings, raw textarea handling, inline comments, blank-line list boundaries and escaped link targets. These are intentional parser behavior changes, so frozen 1.6.4 fixtures must be assessed against an unmodified 1.8.1 control when they differ. The grouping optimization does not establish that giant single-paragraph quotes are faster; measure that workload separately. [Tagged Markdown changelog](https://code.haverbeke.berlin/lezer/markdown/src/tag/1.8.1/CHANGELOG.md), [prior giant-quote investigation](markdown-giant-quote-parsing.md).

## Reapply all three local patches

| Patch | Exact upstream finding | Rebase requirement |
| --- | --- | --- |
| View native focus | Published 6.43.15 `enforceCursorAssoc()` still returns only for active composition before collapsing/modifying DOM selection. | Keep `!this.view.hasFocus` alongside the composition guard in both ESM and CommonJS. The native search-focus test remains the acceptance gate for WebKit focus theft after a deferred measure. |
| Common mixed-tree traversal | Published 1.5.3 `StructureCursor.hasNode(cursor)` still calls `moveTo(cursor.from)` before checking whether the queried cursor has a standalone tree. | Retain the early `if (!cursor.tree) return false` in both module formats. Preserve the new upstream `ExcludeBuffers` traversal improvement as well. |
| Markdown parsing cost | Published 1.8.1 still loops over every inline parser at each position, repeatedly splices markers into the sibling array, and uses a previous-character regex in Autolink. | Reapply all existing hunks: identity-based dispatch buckets for known built-ins, append-based marker merge, and equivalent ASCII previous-character checks. Preserve custom/replaced parser order, non-ASCII dispatch, marker nesting/ranges, opaque tree properties and new emphasis behavior. |

These conclusions were checked against the exact public npm tarballs as well as tagged source. Source links: [view selection writer](https://code.haverbeke.berlin/codemirror/view/src/tag/6.43.15/src/docview.ts), [common traversal](https://code.haverbeke.berlin/lezer/common/src/tag/1.5.3/src/mix.ts), [Markdown parser/merge](https://code.haverbeke.berlin/lezer/markdown/src/tag/1.8.1/src/markdown.ts), [Markdown extensions](https://code.haverbeke.berlin/lezer/markdown/src/tag/1.8.1/src/extension.ts). Published artifacts: [view](https://registry.npmjs.org/@codemirror/view/-/view-6.43.15.tgz), [common](https://registry.npmjs.org/@lezer/common/-/common-1.5.3.tgz), [Markdown](https://registry.npmjs.org/@lezer/markdown/-/markdown-1.8.1.tgz).

## Useful capabilities and acceptance

Markdown 1.7 exposes `Line.markers` to multiline block parsers; 1.8 exports the emphasis delimiter definitions so extensions can override emphasis behavior. These may help future custom Markdown syntax. Neither requires changing the app's current dialect during this maintenance upgrade. The strongest immediate benefit is group reuse plus the accumulated editor correctness fixes. [Tagged Markdown changelog](https://code.haverbeke.berlin/lezer/markdown/src/tag/1.8.1/CHANGELOG.md).

Retain the existing parser source/bundled regression checks, compare against unmodified target-version parsing where necessary, and run native search focus, marker merge, visible Markdown and cursor acceptance. Measure both the giant quoted paragraph and ordinary/many-block controls using the existing full-app performance lane; use the same fixture and measurement method before/after. Unit benchmarks alone cannot prove native focus or WebKit paint responsiveness. Existing removal gates and reproducibility limits are documented in [patches/README.md](../../patches/README.md) and the [giant-quote investigation](markdown-giant-quote-parsing.md).


## Implementation and acceptance

Updated view to **6.43.15**, common to **1.5.3** and Markdown to **1.8.1**, with
matching exact direct pins, workspace overrides, patch keys and lockfile entries.
All other direct editor packages were already current. A final recursive
installed-graph inventory checked **48 CodeMirror/Lezer packages**, including
language-parser transitives, against each package's public npm `/latest` metadata:
all are current after these three changes. Their exact installed/latest versions
are retained with the measurement evidence. The three patch files were
rebased against the exact new npm distributions in both ESM and CommonJS. Their
added/removed code lines are identical to the previous patches; upstream context
and offsets changed. Common's new `ExcludeBuffers` optimization remains intact.
The unrelated Pi patch is unchanged. A frozen installation succeeds without new
release-age exceptions; the existing optional `runed/kit` Kit 2 peer warning is
unchanged.

Native verification exposed stale WDIO fixture assumptions left over from the
older embedded driver. Version 1.5.0's `set_window_rect` uses logical pixels, so
multiplying by Retina scale requested an 834-pixel viewport instead of 417. The
three affected fixtures now request logical sizes. The wrapped-focus test also
waits two animation frames after **clearing search**, allowing SearchBar's
intentional next-frame focus callback to finish before the following editor-focus
scenario. It still transfers focus before CodeMirror's deferred cursor measure
and asserts both repeated search ownership and exact wrapped-position insertion.
All original focus assertions remain. The application has no `visualLineSide`
usage, so its upstream deprecation requires no call-site migration; existing
wrapped-cursor and native range-selection acceptance was retained. Dock sampling normalizes an absent failure
field from the native JSON transport's `null` representation before checking it.

The broad browser run exposed two additional fixture-timing defects. The narrow
split-search case typed while the scope-change callback restored the old caret,
producing `ha noteAlp` instead of `Alpha note`. That fixture now waits two RAFs
after changing scope and asserts the exact query before admitting a result. The
dock continuity sampler mixed an initial `performance.now()` timestamp with later
RAF timestamps, allowing a negative first interval and a negative movement limit
even for zero movement. Its pre-click baseline now comes from a RAF too. All
movement, first-paint, geometry and opacity bounds remain unchanged. These are
test admission/sampling corrections; no production application source changed.

### Matched performance observations

The before graph was view/common/Markdown **6.43.1/1.5.2/1.6.4**; the after graph
was **6.43.15/1.5.3/1.8.1**. Both retained their local patches. Application source,
fixtures, Vitest version and production editor extensions were unchanged. Runs
were sequential with no competing builds or source edits during measurements.
The comparison uses the existing full-app WDIO specs rather than historical
benchmark-script source restoration. Selected raw samples, environment geometry
and all document-operation controls are retained in the
[measurement evidence](codemirror-lezer-upgrade-2026-10-21-measurements.json).

The full Chrome matrix passes all **18 cases**: mixed Markdown, giant fences and
giant quotes at 1,000/10,000/50,000 lines in one/two panes. Each case measures
selection and document edits with five warmups and twenty recorded samples.
Selected 50,000-line document-edit medians from that first matched matrix:

| Fixture | Panes | Dispatch before → after (ms) | Forced layout + two RAF before → after (ms) |
| --- | --- | --- | --- |
| Mixed blocks | 1 | 8.6 → 4.7 | 33.4 → 33.5 |
| Mixed blocks | 2 | 14.5 → 8.0 | 33.3 → 33.3 |
| Giant fence | 1 | 2.5 → 5.2 | 33.4 → 33.3 |
| Giant fence | 2 | 6.1 → 6.2 | 33.3 → 33.3 |
| Giant quote | 1 | 68.9 → 70.2 | 82.2 → 140.6 |
| Giant quote | 2 | 139.2 → 141.1 | 211.1 → 214.5 |

The one-pane Chrome quote frame difference prompted a targeted repeat on the
upgrade, then a controlled restore of the previous patched graph with the same
current application and fixture code. Upgrade repeat: **68.9 ms dispatch / 138.1
ms two-frame median**; previous-version repeat: **70.0 / 140.9 ms**. Two-pane repeat:
upgrade **141.1 / 215.6 ms**, previous **138.5 / 210.0 ms**. Thus the first low
82.2-ms baseline frame median did not reproduce; repeated old/new measurements
are similar. The upgrade was restored through a frozen install and Kit sync after
the control experiment. Do not present the first comparison as a new 71% frame
regression or discard it silently. Smaller/fence dispatch samples vary by a few
milliseconds; these observations are not a universal speed guarantee.

Actual foreground macOS WebKit passes the giant-quote checks in **both panes**,
including 100,000 quote markers, 50,000 strong-emphasis spans, syntax-changing
edits from either pane, and preserved sibling selection/scroll. Native uses a
disposable vault and five warmups plus ten recorded samples:

| Panes | Dispatch median / p95 before → after (ms) | Two-RAF median / p95 before → after (ms) |
| --- | --- | --- |
| 1 | 61 / 66 → 58 / 70 | 67 / 130 → 67 / 131 |
| 2 | 118 / 121 → 114 / 118 | 134 / 250 → 132 / 238 |

Native results show no material regression on this workload. Mixed-block Chrome
dispatch improves in the measured matrix, consistent with upstream group reuse;
the giant single-paragraph path remains expensive, especially with two panes.
These are dispatch/forced-layout/RAF observations on one machine, not hardware
paint timings, sustained-typing latency or an SLA. No machine-specific time gate
was added.

### Verification

- Frozen installation, production build and `pnpm check` pass; Svelte reports zero
  errors and warnings. The build retains its existing large-chunk advisory.
- Parser patch regressions: **66 passed** across Autolink, dispatch buckets,
  marker merge and mixed-parser reuse, in both module formats. Frozen syntax
  fixtures, custom parser ordering, opaque properties, incremental/mount parity
  and deterministic work bounds pass unchanged. A separate published-target
  control compares patched versus unmodified Markdown 1.8.1 for eight fixtures
  in both module formats (16 fixture/format cases): tab headings, raw textarea,
  inline comments, list blank lines, escaped link targets, emphasis, quote markers
  and 500 mixed blocks. Fresh trees, incremental target parity and incremental
  versus fresh trees all match.
- `pnpm test`: **130 support checks and 1,396 frontend tests pass**, with the one
  existing frontend skip. Vitest benchmarks: both files / all six workloads pass.
- Browser coverage: the full **65-spec** run completed with **380 passed tests,
  40 existing opt-in skips and two fixture failures** described above. After
  correcting only those fixtures, both complete affected specs pass in fresh
  runs: split-search **14/14**, workspace dock **29/29**. The other 63 specs were
  already green on the same application/dependency graph. Current browser
  coverage therefore passes across the full run plus focused replays; a second
  uninterrupted full-suite run was not performed.
- Agent replay: **one test passes**. Background native smoke: **nine specs / 45
  tests pass**, including editing/creation restart cases, without skips. Reused
  the admitted pinned Rust E2E binary against the upgraded Vite frontend; Rust
  sources and dependency graph are unchanged.
- Rust library checks: **652 passed, 19 existing ignores**; architecture fitness:
  **19 passed**. Python fixture checks: **16 passed** with ResourceWarning treated
  as an error. E2E TypeScript also passes after all fixture corrections.
- Foreground native wrapped-cursor focus: **three fresh invocations, two tests
  each**, pass after the fixture corrections. Native editor cursor: **12 pass**;
  visible Markdown: **7 pass**; dock outline: **2 pass**; giant quote: **2 pass**.

### Existing native pane-motion failure

An additional foreground `pane-animation.spec.ts` check fails at
`expectContinuousMotion` (`paneMotion.ts:234`): sampled content width differs from
final width by **319 pixels**, where the assertion allows one. The exact failure
reproduces on the previous patched dependency graph from `84fea1a4` with identical
application code and corrected logical fixture dimensions. It is not introduced
by this dependency upgrade. No product motion change or relaxed assertion is
included. The existing pane-animation validation already acknowledges live text
reflow during width animation. A local `needs-triage` issue records reproduction
and acceptance at `.scratch/pane-animation/issues/04-native-content-width-baseline.md`.
This additional native spec must not be reported as passing.


### Review and cleanup

Standards and Spec review against `84fea1a4` plus the untracked replacement
patches found no introduced correctness or repository-standard issues. All three
editor patches retain identical added/removed code in both module formats;
active package files contain no retired patch keys. Fixture corrections preserve
behavioral, geometry and timing assertions rather than relaxing their bounds.
The additional native pane-width failure remains explicitly outside the passing
acceptance, with its old-version reproduction recorded above.

All owned browser, agent, native Vite and embedded-driver listeners were closed
after verification (ports 1421, 1423, 1430 and 4457). `git diff --check` passes.

### Final integration verification — 2026-10-21

Rechecked the remaining editor and image changes together against `7c11ad70`.
Independent Standards and Spec reviews found no actionable issues. A frozen
install succeeds, and all three rebased patches still have identical added and
removed code to their previous versions in both module formats.

- `pnpm check`: zero errors or warnings, including E2E TypeScript.
- `pnpm test`: **139 support checks and 1,418 frontend tests pass**, with the
  existing one frontend skip.
- Five affected browser specs pass **68 tests**: image interactions (12), image
  inventory/split (1), editor cursor (12), split search (14), workspace dock (29).
- A freshly built and pinned disposable native app passes **18 tests in six
  specs**: image interactions (1), asset protocol (3), image loading (3), visible
  Markdown (7), foreground wrapped-cursor search focus (2) and giant quotes (2).
- Deterministic agent replay passes both tests, including the image skeleton
  regression. Production build passes with the existing chunk-size advisory.
- `pnpm bench`: both files and all six workloads pass. Vitest reports module
  export-getter overhead in several workloads, so these timings are not used
  to claim an upgrade speedup; the foreground full-app comparison remains the
  relevant evidence.

The foreground giant-quote rerun uses five warmups and ten recorded edits per
pane count. One pane: dispatch median/p95 **59/65 ms**, two-RAF **67/133 ms**;
two panes: dispatch **119/128 ms**, two-RAF **133/254 ms**. Both verify 100,000
quote markers, 50,000 strong-emphasis spans and syntax-changing edits with
selection/scroll continuity. Raw samples are included under
`finalIntegrationNative` in the linked measurement JSON. These current-version
observations are consistent with the earlier matched comparison; they are not
a new controlled old/new experiment or a latency guarantee.

The known native pane-motion width failure above remains open and is excluded
from this passing acceptance. Native/browser fixtures still emit their existing
ResizeObserver or unsupported-Pi-command diagnostics; no assertion was relaxed
to suppress them.
