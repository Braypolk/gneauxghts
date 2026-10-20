# Live Markdown snapshots: performance and design investigation

Investigated the current working tree on 2026-10-19. This is analysis and diagnostic evidence; no production behavior was changed. Table removal and unrelated working-tree changes were preserved. Visible-range formatting is being implemented separately.

Historical pre-optimization findings follow. Formatting and image inventory were
subsequently optimized, and the [immutable draft-body migration](../../.scratch/archive/immutable-draft-bodies.md)
implemented the design below. See the [native app comparison](../../.scratch/archive/draft-body-app-benchmark/README.md)
for the measured application benefit. The earlier code descriptions and timings
in this investigation do not describe the current implementation.

## Findings

The document callback constructs a full-body string once per content-changing runtime dispatch. That is avoidable, but it is not the largest adjacent cost found: each pane's image inventory also constructs a full string and synchronously reparses the whole note, including notes without images. Removing only the application callback's string conversion would leave those conversions and full parses in place.

The recommended long-term live-document representation is a shared immutable body value, adopted immediately by the existing document boundary and serialized only for consumers that need a string. That design should include an audit of eager consumers rather than simply replacing a callback parameter with a lazy getter. The measured image inventory path deserves a separate, higher-priority performance correction alongside the existing formatting work.

## What ran before optimization

1. `EditorDocumentRuntime.dispatchFromPane` forwards the edit into its root state, updates the source pane and sibling panes, invalidates `#markdownCache`, and calls `#notifyMarkdownChange` once. The callback evaluates `this.markdown`, which invokes the root document's `toString()` when the cache is empty. [Runtime](../../src/lib/features/notepad/editor/editorDocumentRuntime.ts)
2. The callback passes through the editor lifecycle and `Notepad.svelte` to `DocumentEditingService.recordUserEdit`. It updates `NoteDraftState.working.markdown`, advances operation revision for actual content changes, updates empty-content behavior, and schedules save/search/Related invalidation. The application therefore currently requires an immediately current string-valued draft. [Lifecycle](../../src/lib/features/notepad/editor/editorLifecycleController.ts), [Application callback](../../src/lib/features/notepad/Notepad.svelte), [Editing boundary](../../src/lib/features/notepad/document/documentEditingService.ts), [Draft state](../../src/lib/features/notepad/document/documentState.ts)
3. `imageState` is installed through the ordinary editor extensions. Its per-document inventory calls `parseImageEmbeds(doc.toString())` on creation and each changed document. The parser builds a fresh complete Markdown tree and traverses it for comments, reference definitions and image occurrences. There is no no-image fast path before that parse. Its `WeakMap<Text, …>` shares an inventory only when callers have the same `Text` object; sibling panes construct distinct changed `Text` objects in the measured runtime path. [Image inventory](../../src/lib/features/notepad/images/imageState.ts), [Image parser](../../src/lib/features/notepad/images/imageEmbedParser.ts), [Installed extensions](../../src/lib/features/notepad/editor/editorExtensions.ts)

The runtime string cache is useful: repeated reads of the same version do not reconstruct it, selection-only transactions do not notify, and two panes do not double the application callback. The problem is unnecessary work on each new content version, not a cache miss on every getter call.

## Measurements

The retained [diagnostic source](diagnostics/markdown-snapshots.probe.ts) uses the production runtime, editing service, immutable text implementation and image state field. Views are state-backed stand-ins, not a rendered browser. Save/search/Related scheduling dependencies are no-ops. Formatting view plugins, reactive Svelte effects, DOM/layout, IPC and disk writes are excluded. These numbers are not native typing latency.

The plain-text fixture repeats `Plain note text with enough ordinary prose to resemble a multiline Markdown note.\n\n` and truncates it to the specified number of ASCII characters. It contains no images or image syntax. Samples have four warmups followed by 21 timed operations; the reported median is the middle sample. Runtime tests perform 25 edits including warmups. Separate component and runtime probes are not additive timings.

### Real state-backed dispatch

| Characters | Runtime + editing boundary, one pane, insertion | Same owners with image inventory, one pane | Same owners with image inventories, two panes |
| --- | --- | --- | --- |
| 50,000 | 0.102 ms | 5.449 ms | 10.230 ms |
| 500,000 | 0.251 ms | 50.438 ms | 102.035 ms |
| 2,000,000 | 0.832 ms | 206.117 ms | 407.568 ms |

The image-enabled column was rerun after matching its editing callback to the baseline callback. The repeated measurement still found roughly linear scaling and approximately doubled image-inventory cost for two panes. The point is isolation of this component's cost, not a claimed end-user speedup from a shipped fix.

Instrumenting `Text.prototype.toString` during the dispatch probes counted:

- One pane without image inventory: 25 conversions and 25 callbacks for 25 edits.
- Two panes without image inventory: still 25 conversions and 25 callbacks.
- One pane with image inventory: 50 conversions and 25 callbacks.
- Two panes with image inventories: 75 conversions and 25 callbacks.
- Selection-only dispatches: zero conversions and zero callbacks in the baseline probe.
- Ten subsequent reads of `runtime.markdown`: zero additional conversions after the version was cached.

The two-pane inventory result is supported by the real state-field behavior and conversion counts, not an assumption that every feature runs twice. The baseline same-length replacement probe, reset to the saved body before measuring replacements, was about 0.822 ms at two million characters for one pane. Insertions and replacements are both far cheaper here than the whole-note image reparse.

### Individual consumers

| Operation | 50,000 characters | 500,000 characters | 2,000,000 characters |
| --- | --- | --- | --- |
| `Text.toString()` on a distinct edited text version | 0.018 ms | 0.118 ms | 0.484 ms |
| Two Related-style JSON context keys | 0.046 ms | 0.480 ms | 1.982 ms |
| Existing draft fingerprint (`computeDraftHash`) | 0.063 ms | 0.498 ms | 2.051 ms |
| String equality against a same-length baseline, edit near the end | 0.008 ms | 0.208 ms | 0.596 ms |

JavaScript engines can represent strings as ropes and flatten them later, so the string-construction column does not necessarily include every later allocation/copy cost. No memory profile was collected. GC/JIT noise affected tail samples; these are diagnostic medians, not product budgets.

The current Related store constructs two full-text JSON keys in `update` only when an acquired entry exists. In this UI, acquisition lasts while the Related popup is open; closing it releases the entry. `Notepad.svelte`'s effect visits panes, so the same open document in two panes can repeat the comparison. It is incorrect to attribute this work to every closed-popup keystroke. [Related store](../../src/lib/features/notepad/related/store.svelte.ts), [Popup lifetime and context effect](../../src/lib/features/notepad/Notepad.svelte)

Search obtains the current Markdown after its 120 ms debounce, and avoids requesting a body when there is no query. Its full-body fingerprint runs when a draft-aware search/retrieval request is made, not unconditionally on every edit. Related refresh also fingerprints when requested. Cache that fingerprint per immutable body version where useful; preserve the existing native draft-ref protocol rather than replacing its content hash with an ephemeral revision number. [Search scheduling](../../src/lib/features/notepad/search/store.svelte.ts), [Request consumers](../../src/lib/features/notepad/search/search.ts), [Fingerprint protocol](../../src/lib/features/notepad/search/draftRef.ts)

The current chat adapter synchronizes retained document identity and routes. It explicitly does not feed editor content into model input on every edit. The feature host exposes explicit document snapshots, and task mutation/conflict/copy/navigation paths obtain strings for particular operations. Those are legitimate snapshot boundaries, not evidence of another unconditional per-keystroke chat body copy. [Chat adapter](../../src/lib/features/notepad/orchestration/notepadChatPaneAdapter.ts), [Feature host](../../src/lib/features/notepad/host.ts), [Task preparation](../../src/lib/features/tasks/openDocumentTaskMutation.ts)

## Recommended document design

Keep `NoteDraftState` and `DocumentEditingService` as the open-document owners. Change the live body value they adopt, rather than making application state lag behind an editor timer.

- A body value holds an immutable CodeMirror `Text` (directly or behind a small `DocumentBody` wrapper), with identity/version for invalidation, partial reads, exact equality and a cached string snapshot. CodeMirror already provides structural sharing; do not implement another rope or an indefinitely retained operation log.
- The runtime callback delivers the current immutable body/change information. The document boundary adopts it synchronously, preserving admission and actual-content-change semantics. The runtime retains shared history and panes retain local selections and scroll. A body object is a value, not another mutable document owner.
- Save capture pins a particular immutable body plus title/tags/path/operation data. Serialization is performed for that captured version at the real save boundary, then reused. An unbound `() => runtime.markdown` evaluated after an `await` would read whichever version is current at that later time and is not a safe capture.
- Related invalidation compares document identity/body version and relevant metadata; refreshing reads the captured body's string. A reactive effect that immediately dereferences a lazy string on each body change would defeat the optimization. Search can retain its existing delayed read boundary. Move no-op/clean checks before serialization where applicable.
- Loaded notes and committed native results can seed the body value's string cache. A document remains usable when all editors are unmounted, including when retained by chat; it must not depend on a live pane getter.
- Use content equality for clean/dirty and no-op behavior. `revision !== savedRevision` does not make A → B → A dirty, and a newly allocated body object is not proof of changed authored bytes. Title, tags, identity and saved baseline remain part of the established clean-buffer rule.

This changes frontend live representation. Canonical Markdown files, native save payloads, Note Timeline policy and publication authority need not change. The implementation must follow the existing architecture and adoption invariants because it crosses the live-content seam. [Architecture](../../ARCHITECTURE.md), [Behavior invariants](../architecture/behavior-invariants.md)

### Candidate probe and its limits

A diagnostic-only body wrapper retained `Text`, lazily cached `toString()`, compared bodies with `Text.eq`, and checked non-whitespace content via chunk iteration. It demonstrated:

- 100 reference-only body reads caused zero string conversions.
- Repeated reads of one captured body's string performed one conversion.
- Replacing a separate live-body reference did not change the captured body.
- At two million characters with shared multiline structure, dirty equality took about 0.003 ms and equality after changing back to the original content about 0.007 ms.
- A two-million-character single line still cost about 0.27 ms for dirty equality and 0.41 ms for reverted equality; whitespace-content detection with a non-whitespace character at the very end cost about 0.93 ms. Structural sharing is not a promise of constant-time work for every shape.

These verify properties of the candidate value only. They do not demonstrate that a migrated application preserves all save/adoption/conflict behavior, and they are not an implemented before/after editor benchmark. Preserve whitespace semantics: `length > 0` cannot replace existing `trim() !== ''` behavior.

## Alternatives and priority

| Approach | Assessment |
| --- | --- |
| Debounce the existing model-update callback | Leaves the authoritative draft stale; creates flush/order obligations around save, departure, task operations and publication. Reject. |
| Keep an additional string updated by applying text deltas | Retains a second body representation and large-string construction/comparison; does not remove the underlying size-dependent work. |
| Model keeps a runtime getter with a headless string fallback | Can defer reads, but spreads runtime lifetime/fallback/flush policy into consumers and risks a stale model. Prefer an immutable body value retained by the document owner. |
| Immediately current immutable body with explicit snapshots | Recommended design. Centralizes exact captured versions and avoids unconditional string production while retaining current ownership. |
| Move all of this to a worker | Does not remove redundant work or the need to keep authoritative draft state current. Consider heavy optional processing only after its data boundary is efficient. |

The first priority uncovered here is image inventory: explore an absence-of-image-syntax fast path, then an incrementally maintained inventory that uses available parser state and shares note-level results across panes. Full image inventory has layout and viewer responsibilities, so it cannot simply be dropped outside the viewport. Reference definitions and cross-paragraph comments can affect distant image interpretation and require deliberate invalidation. This is a separate correction from Markdown view decoration and from draft serialization; a safe fast path and its correctness still need implementation and validation.

The immutable body migration remains useful, but measure its direct benefit honestly: these probes do not support claiming that saving the callback's sub-millisecond conversion alone fixes long-note typing. Audit eager consumers during the same migration, especially Related identity comparison and image inventory, and benchmark their contribution separately.

## Correctness coverage and next implementation checks

The six existing suites for runtime, editing adoption, document-state sequences, persistence, Related lifetime and retained chat routing passed: 66 tests. Expected failure-path log messages in persistence tests were not test failures.

A migrated implementation should exercise real owner integration for:

- An edit updates the authoritative draft immediately without flattening it; selection changes do not become content changes.
- Shared undo/redo and independent pane selection/scroll; identical net changes remain no-ops and undo to baseline becomes clean.
- A captured save completes after newer body/title/tag edits and preserves those newer edits, including first-save identity assignment.
- Dirty external-change conflicts, force refresh, task preparation/retry and publication admission use the current exact body.
- Version Restore starts the required shared history root even for a metadata-only replacement with an unchanged body.
- Editor teardown, retained chat routing, recovery, background save, departure and reopening retain the current body without needing a mounted editor.
- Active/closed Related popup and empty/active search query do not accidentally force string creation merely through invalidation.
- Giant single lines, whitespace-only notes, same-length edits near the end, and image-free/image-containing notes with one and two panes.

Mounted/native traces and allocation profiling remain necessary before claiming end-user latency or memory improvements.

## Reproduction

The diagnostic source is retained outside the normal test discovery path. From the repository root, copy it to the indicated temporary editor path so its relative imports resolve, run it, then remove that temporary copy:

This source uses the historical string callback. Run it on the pre-migration
revision `fd9c0ad1` for the callback baseline; the image-inventory timings above
predate that revision's inventory optimization and will not reproduce there.
For the current implementation, use the body probe and native benchmark linked
in the completed migration record instead.

```sh
cp docs/research/diagnostics/markdown-snapshots.probe.ts src/lib/features/notepad/editor/markdownSnapshotDiagnostic.temporary.test.ts
pnpm exec vitest run src/lib/features/notepad/editor/markdownSnapshotDiagnostic.temporary.test.ts
rm src/lib/features/notepad/editor/markdownSnapshotDiagnostic.temporary.test.ts
```

For just the image-inventory comparison, add `-t 'isolates image inventory'`. The complete diagnostic had four passing tests; the image-only rerun had one passing and three intentionally skipped tests. Instrumentation is restored in `finally` blocks. The temporary production-tree copy was removed after measurement.
