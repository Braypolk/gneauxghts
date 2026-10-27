# Adopt useful capabilities from the upgraded packages

Ready-scope implementation and combined verification completed: 2026-10-21; see the [outcome record](../archive/package-capabilities-2026-10-21.md#integration-result).

This is the actionable follow-up to the [capability report](../../docs/research/upgraded-package-capabilities-2026-10-21.md) and [frontend investigation](../../docs/research/upgraded-frontend-capabilities-2026-10-21.md). The initial planning request covered every item and used parallel investigation. The user then authorized implementation of the ready scope with parallel agents, reserving image work for another chat. The implemented tickets are archived below; image delivery and inspector activation remain in the active issue directory. Watcher diagnostics were subsequently implemented in the [October 27 status-and-guidance slice](../archive/watcher-health-2026-10-27.md). Existing CodeMirror/Lezer upgrades, patch rebases, fixture corrections and the other chat's image work were preserved.

## Intended result

Improve connection explanations, development navigation, performance comparisons and client error presentation. Measure image delivery before changing its transport. Evaluate whether token-aware snippets improve previews that already center on query matches. Adopt small helper cleanups only where they simplify an existing seam. Every remaining capability receives an explicit disposition below; availability alone is not a reason to create a new feature.

The ready status on an experiment means its **bounded experiment** is specified, not that production adoption or later architecture work is decided. A measured no-change conclusion can complete an experiment. The initial scope introduces no new package versions, SQLite schema, Pi scheduler, vault owner or automatic retry policy.

## Implemented scope and active remainder

| Issue | Outcome | Record |
| --- | --- | --- |
| 01 Connection errors | Implemented fixed native categories, safe explicit discovery errors, frontend allowlists and stale-result suppression; three real-native IPC/Settings/Pi acceptance cases passed. | [Archived execution ticket](../archive/package-capabilities-2026-10-21/tickets/01-connection-errors.md) |
| 02 Benchmark comparisons | Implemented capture/compare around all six workloads, complete portable artifacts and compatibility checks; one capture and three comparisons passed. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/02-benchmark-comparisons.md), [measurements](../../docs/research/editor-benchmark-comparisons-2026-10-21.md) |
| 03 Component inspector | Opt-in browser/native stack and production exclusion verified. Native event handling uses explicit DOM events; physical OS chord, button persistence and local editor opening retain documented limits. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/03-component-inspector.md), [workflow](../../docs/development/component-inspector.md) |
| 04 Client error presentation | Implemented synchronous safe hook and plain error page; ten focused tests and three real Kit browser faults pass. Four native WebKit/workspace fault checks also pass. Recovery/root-shell ownership remains deferred. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/04-render-error-recovery.md) |
| 05 Image delivery | Separate image chat owns implementation, measurements and its acceptance; excluded from this chat's implementation. | [Active ticket](issues/05-native-image-delivery.md) |
| 06 Search snippet comparison | Bounded experiment completed; retain existing production previews because Tantivy's Unicode context loses useful text. Sixteen fixtures and ten owner observations passed; interactive comparison inspected. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/06-query-centered-excerpts.md), [findings](../../docs/research/search-excerpt-experiment-2026-10-21.md) |
| 07 Vitest doctor | Completed; retain isolated threads/default workers. Five workers were 31% slower; non-isolated tests failed. Normal and seeded-shuffle isolated suites pass. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/07-vitest-doctor.md), [measurement](../../docs/research/vitest-doctor-2026-10-21.md) |
| 08 Svelte helpers | Typed optional title context adopted. Explicit Related insertion retained because Svelte's server export uses native Map and Node 24.2 lacks the new helper. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/08-svelte-helpers.md) |
| 09 Watcher diagnostics | Implemented 2026-10-27: retained native health in Vault Settings, bounded safe reasons, truthful scan status and revisioned bootstrap/event admission. No retry or fallback scanning. | [Completed outcome](../archive/watcher-health-2026-10-27.md) |
| 10 Conditional mock pilot | One scoped argument-specific fixture adopted with exact ID/path tuples and original controlled promises. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/10-conditional-mocks.md) |
| 11 Lazy regex pilot | Three task-date literal patterns adopted `regex!`; exact semantics retained, with no speed claim. | [Archived ticket](../archive/package-capabilities-2026-10-21/tickets/11-lazy-regex.md) |
| 12 Inspector activation follow-up | `needs-triage`: record the installed button behavior and native driver event omissions; no product/driver patch in this scope. | [Active observation](issues/12-inspector-native-activation.md) |

Archived tickets retain their original plans and chronological comments for context; they are not executable instructions. The [outcome record](../archive/package-capabilities-2026-10-21.md) owns combined acceptance and its current limits.

## Corrections established while planning

1. Ordinary all-notes Search, current-note Search and Pi search already center/crop their previews on query matches. The prefix-only `retrieval_context` path is not a production UI consumer. Issue 06 compares quality with the actual current helper; it does not implement a redundant centering feature or improve an unused API to claim a product win.
2. Kit's child-route failure boundary can remove Notepad and its mounted save handlers. A later save helper returning successfully with no registered handler does not prove dirty state is durable. The root layout is outside that boundary. Issue 04 improves explanation only; recovery is a separate design that must keep authoritative owners alive or establish settlement across teardown.
3. At the planning baseline, Tauri's asynchronous asset handler was not used by the editor data-URL path; the separate image chat owns the later transport migration. Both fingerprint reads and file reads/encoding need attention in the minimal worker experiment. A protocol URL requires scope and different cache accounting; permitted CSP syntax alone is insufficient.
4. Notify's existing periodic reconciliation starts only after successful watcher registration. Callback degradation and initial failure have different guarantees. Issue 09 must not falsely tell the user reconciliation is running after failed registration.
5. Connection metadata probing is intentionally optional. Existing explicit model-list commands are the proper surface for useful Settings failures; changing metadata's `Option` into a fatal error would break compatible servers and retained-capacity behavior.

## Execution coordination retained for integration

**Preparation:** establish a fixed baseline and record the current dirty checkout/lockfile. The previous native pane content-width mismatch was separately tracked and [resolved in a later follow-up](../archive/native-pane-motion-admission.md); the original scope required that it not be hidden, silently absorbed into this effort, or reported as a passing native measurement while unresolved. Preserve the three editor patches and unrelated work. No commit was requested for this implementation turn.

**Original first wave (now implemented except separately owned 05):** 01, 02, 03, 04's diagnostic stage, 05 Stage A and 06's offline comparison have separate production owners and can be developed independently. With six concurrency slots, the integrator may own one stream and delegate the other five. Reserve each issue's listed files to its owner. Share only narrow implementation-independent result types/fixture conventions that are actually necessary; do not delay unrelated work for a generic framework.

**Original second wave (now implemented):** 07 follows the benchmark tooling integration and runs alone. 08 can change Related code independently but merges its root-layout context change after 04. 10 and 11 can be small independent patches or deferred housekeeping. 09 remains a design task until its stated contract is resolved. Conditional production follow-ups for 04/05/06 are created only after their respective evidence/design gates.

| Shared resource or file | Coordination rule |
| --- | --- |
| `package.json`, `vite.config.js`, manifests/lockfiles | Integrator owns shared edits; no dependency changes for this effort. 02 scripts are additive; inspector uses the existing opt-in; 07 changes config only if justified. |
| `src/routes/+layout.svelte` | 04 initially need not change it. Any later shell-boundary work must be coordinated with 08 and existing restart/background-persistence owners. |
| `src-tauri/src/commands.rs`, `lib.rs`, AppStore/bootstrap/types | Do not expand these shared contracts independently. 05 should use the existing worker helper without changing it; 09's eventual health contract requires one coordinated owner. |
| Browser fixture/backend and native launcher/config | Integrator reviews shared additions. Prefer issue-local fixtures and existing harness capabilities; no blanket successful command fallback. |
| Browser sessions | Unique session names/ports and owned-process cleanup under [UI verification](../../docs/agents/ui-verification.md). Browser journeys can run separately where resources permit. |
| Native foreground app and all performance measurement | One owner at a time. Serialize inspector native checks, render faults, native image measurements, benchmark comparisons and doctor runs. Simultaneous measurement invalidates comparisons. |

No broad worktree switch or competing checkout reset was required. Native builds and measurement baselines must identify the actual tested source/binary graph. Independent coding does not imply simultaneous foreground or benchmark execution.

## Verification plan

Each ticket lists focused acceptance. During implementation, run its narrow meaningful checks before integrating, retain failures and fixes, and report real versus mocked/native coverage honestly. Use deterministic custom DNS/loopback failures for networking, synthetic canonical notes/images and disposable vaults; no private vault data, live credentials or paid providers are needed.

After integrating the selected ready implementations, run `pnpm check`, build, support tests and the full frontend unit suite once on the combined tree. Run applicable Rust unit and architecture tests for changed native seams. Run the full maintained browser suite, agent replay and native smoke for combined functional acceptance, plus the focused native focus/image/error journeys actually changed. Re-run broader suites after new changes or failures justify them, not on an arbitrary repetition schedule.

Performance acceptance is separate: record baseline/candidate source and binary identity, runtime/hardware, fixture hashes, sample distributions and cache state; alternate comparable runs on a quiet machine. Node benchmark success cannot establish native input, paint or focus behavior. Preserve justified existing skips and explicitly identify unavailable platform checks. Do not turn one machine's timing into an architectural SLA or overwrite baselines automatically.

Combined results and explicit skips/verification limits are recorded in the [implementation outcome](../archive/package-capabilities-2026-10-21.md#integration-result). This plan does not establish acceptance beyond those recorded results.

## Coverage of the remaining capability inventory

These dispositions complete the scope audit. Deferred capabilities have a concrete reopening condition and change outline; they are not hidden implementation tasks in the ready queue.

| Capability | Plan / disposition |
| --- | --- |
| CodeMirror selection-history availability | Defer new UI. If Back/Forward Selection is requested, define per-pane selection history separately from the shared document undo root; specify keyboard/menu behavior, cross-pane edits and history invalidation before adopting `canUndoSelection`/`canRedoSelection`. Ordinary Undo menu state uses the existing document owner and older depth APIs. |
| Bulk folding optimization | No current folding-extension consumer. If actual code folding is requested, use CodeMirror folding extensions and test nested folds, edit/undo behavior, persistence policy and large fold sets. Do not attach a folding speed claim to custom marker hiding. |
| Lezer `Line.markers` and emphasis delimiter hooks | Defer until a multiline block/callout or specific emphasis behavior is requested. Plan that syntax, then implement through current extension composition with fresh/incremental tree parity and existing patch/native-performance gates. No Markdown dialect change in this effort. |
| Tantivy new queries, sorting, generated tie-breakers/JIT | Defer without a product query/filter/sort requirement. Specify fields, accepted query syntax and stable identity-based ordering first; do not substitute random segment-local tie-breakers for rebuild-stable Note Identity ordering. Experimental JIT/aggregations have no identified requirement. |
| Tokio `AbortOnDrop` | Defer broad task changes. For a demonstrated disposable-observer leak, identify that task's existing owner, prove drop cancellation is desired, then add a guard with disposal tests. Keep Pi tasks, native request drains, watcher stop/join and shutdown settlement explicit. No known orphan-task bug justifies a sweep. |
| base64 SIMD | Included as a measured nested alternative in 05, with alphabet/padding parity and cfg fallback; not an independent global migration. |
| Floating UI layout viewport | Keep visible-viewport behavior. If a reproduced zoom/keyboard placement defect appears, compare layout viewport on that consumer only, preserving pane bounds and safe areas; verify mobile keyboard/zoom and native WebKit before adoption. |
| Svelte native select `defaultValue` | Existing selects are controlled. Use it only for a future uncontrolled/resettable form with explicit reset semantics; do not change saved settings behavior to exercise an API. |
| Bits RadioGroup autocomplete | No current consumer. Add it when a real RadioGroup/form requirement exists and test autofill/keyboard/accessibility on that form. Existing native HTML Select controls are not Bits Select consumers. |
| Bits focus/Calendar/Tooltip/Collapsible/LinkPreview fixes | Already delivered through the upgrade where those primitives are used. Preserve current behavior tests; no extra feature implementation. Do not claim a ZonedDateTime-specific fix for calendar-date-only state. |
| WDIO sessions, snapshots, evidence, export/replay and paused-worker debug | Already implemented/documented. Use them for these tickets; do not build a duplicate agent harness. |
| WDIO AI `act`/`extract` | Defer pending an explicit provider/model/cost and target-flow choice. A future bounded trial must use disposable data, assert outcomes, review/eject deterministic commands and prove runner/BiDi compatibility before CI integration. No service installation or credentials in this effort. |
| Vitest filesystem module cache | Already enabled by default. Observe it in 02/07; do not add a redundant enable switch. |
| Vitest Browser Trace View | Retain WDIO for current browser/native evidence. Reopen only for a demonstrated component-testing gap, then compare harness ownership/cost before adding another browser runner. |
| Vite/Rolldown chunking and experimental dev bundling | Current migration/chunk groups already adopted. For a measured build/startup bottleneck, profile the existing graph and change one partition/bundling setting with asset/build/native startup validation. No speculative additional chunk splitting. |
| Tauri driver logical geometry/resize, channel delivery and macOS restart fixes | Upgrade benefits/fixture corrections already present. Use native regression acceptance; no separate implementation project. |
| Tauri core exit, portable directories, fullscreen/Glass and resource disposal | Keep current coordinated restart and path owners. Future quit/portable-mode/presentation requirements need their own UI/lifetime/persistence design; disposal syntax also needs actual WebView support and resource scope. Do not remove process support or relocate app data as cleanup. |
| Tailwind/date/icons/merge, image copy, Markdown parsing, compression/archive/hash/serialization/loader maintenance | Automatic fixes or no identified feature need for actual usage. Retain existing semantic/format fixtures; no new image format, Markdown dialect, patch-publication owner or generic utility rewrite. |
| Retained SQLite/compiler/syn/TypeScript and current Pi/Chord | Not newly unlocked capabilities of these upgrades. Separate version migrations remain outside this plan; preserve their current decisions and local patches. |

## Current disposition

All ready work assigned to this chat has an implementation or bounded no-change experiment result. Its historical tickets are outside the executable backlog; combined verification completed with the documented skips and limits. Image delivery belongs to the other chat, watcher diagnostics was subsequently completed in the October 27 status-and-guidance slice, and the inventory above records reopening conditions for deferred capabilities. The later cohesion audit found one stale Settings callback; its correction, two browser regressions and follow-up checks are recorded in the outcome. The user authorized committing the capability scope after that correction; unrelated editor upgrades and separately owned image changes are excluded.
