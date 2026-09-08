# Editing Window release validation

This report records the separate release gate for [ADR 0007](../adr/0007-retain-editor-history-at-editing-window-boundaries.md) and [issue 42](../../.scratch/note-timelines/issues/42-validate-editing-window-storage-and-release.md). The [previous Note Timeline report](note-timeline-release-validation.md) and its measurements remain unchanged. **Release acceptance is complete for the measured scope below.** The integrated production default captures ordinary editor saves in Editing Windows; test-only historical fixtures retain their explicit legacy policy. [Machine-readable evidence](editing-window-release-measurements.json) preserves every run log, parsed measurements, fixture manifest, and failed attempt.

## Reproduce

Run every build and suite sequentially, with no other frontend generator, compiler, browser/native suite, or timed fixture run in progress. Native services use ports 1430 and 4445. Unlock the macOS console and keep the native app visible for paint measurements; the harness checks actual document visibility and never overrides it. Do not write any repository file during browser/native/timed runs, because even a documentation write can reload Vite.

```sh
cargo test --release --manifest-path src-tauri/Cargo.toml release_window_matched_writes -- --ignored --nocapture
python3 scripts/timeline_fixture.py window-create
python3 scripts/timeline_fixture.py check --cache "$TMPDIR/gneauxghts-window-fixture"
python3 scripts/timeline_fixture.py run
pnpm check
python3 -O -B -m unittest discover -s scripts/tests -v
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:timeline:scale:render
pnpm test:e2e:native
node e2e/support/buildNative.mjs --release
GNEAUXGHTS_E2E_OPTIMIZED=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/editing-windows.spec.ts
python3 scripts/timeline_fixture.py native
python3 scripts/timeline_fixture.py native --cache "$TMPDIR/gneauxghts-window-fixture"
```

The legacy master is `gneauxghts-production-scale-v1`: 100,000 revisions, 1,000 notes, and 10,000 revisions on its 64 KiB hot note. It is never relabeled or rebuilt for this change. The separately sealed `gneauxghts-editing-window-v1` master contains 95 revisions on three notes: one creation plus twelve windows from 3,600 changed 1 KiB saves, and two 1 MiB notes each containing one creation plus forty windows from 120 saves. Counts exclude creation when reporting windows. Its app-data manifest records the exact note identities, input counts, content geometry, and kind. Hash verification, SQL integrity, immutable master checks, and path-only clone relocation apply to both kinds. A create action rejects a cache holding the other policy.

The Rust fixture injects a continuous clock into the production runtime. Each counted window receives exactly 300 distinct saves at 1,000 ms admission spacing, then invokes the same due-window callback used by the native worker. Assertions inspect private retained/pending counts before and after the deadline without causing an early public evidence boundary. They reconstruct the exact endpoint and verify at most 64 unreferenced terminal receipts plus retained endpoints/creation. Generation never inserts fabricated revision rows.

## Matched write method and interpretation

Each policy gets a fresh isolated vault for each geometry/edit pair: repetitive or deterministic random ASCII, small first-line changes or full replacements, 1 MiB, one creation followed by the same 128 changed production save commands. Content generation is outside timing. The old writer is selected only by historical unit fixtures or the E2E-only `GNEAUXGHTS_E2E_LEGACY_HISTORY=1` override; it is absent from shipped binaries. Both policies use durable intent preparation, real canonical Markdown writes, the production codec, and required catalog work. Semantic indexing/events are disabled in Rust measurements.

Snapshots before edits, with the window pending, after sealing, and after clean close report revision/window/intent/receipt counts, compressed retained/pending payloads, allocated index pages (`dbstat`), main/WAL/SHM file lengths, and freelist bytes. File lengths are sampled between commands; short-lived WAL contents can be checkpointed and truncated before sampling. Zero WAL length does not mean zero WAL writes. Reclaimable bytes are physical pages available for reuse, not additional readable history.

Measured save and seal latency is actual elapsed write cost through the full command. It includes full-file canonical publication and durable SQLite work. **Cumulative device-write bytes, fsync counts, and write amplification are unmeasured.** Consequently this report claims reduced permanent retained growth and reports latency; it does not infer reduced device I/O from fewer rows or smaller payloads. The `_cold` Rust measurements construct a fresh AppState after clean close in the same process; filesystem/OS caches remain warm. They are recovery/attestation startup observations, not OS-cold or crash benchmarks.

## Native method

The production-default native journey verifies real editor autosaves remain pending, History Mode entry seals one net revision, intermediate prose is absent, interval display/naming work, two editor panes return with selection/focus, and complete restore resets undo. A separate 1 MiB journey changes the first line twelve times using editor input, waits for each real one-second autosave, and advances an E2E-only continuous-clock offset midway. The production worker handles that deadline; later entry seals the second window. A continuous animation-frame sampler spans every autosave and the deadline. Timestamped input, canonical-save acknowledgments, clock advancement, and verification of the finalized revision establish the sampled interval. Frame gaps capture stalls during work even when no per-input sample is pending. Input-to-two-frames and input-to-canonical-save timings remain separate observations, with the debounce intentionally included in the latter.

Optimized native fixture journeys use actual Rust, Tauri IPC, native WebKit, the production frontend served by preview, visible/focused windows, and two animation frames after ready DOM. Five warm samples per entry/page/diff make p95 the maximum. Legacy and windowed masters have separate labeled journeys; the legacy writer override preserves its historical per-save synthetic workload. Rust deep reconstruction/restore-preview checks use twenty samples, with 1,000 ms budgets; warm native entry/paging/diff retain 250 ms budgets. Save/seal/startup observations carry no invented performance budget.

## Results

The counted fixture produced **one editor revision from 300 saves**, then **twelve from 3,600 saves**. Pending windows and unresolved intentions were zero after each deadline; terminal receipts grew from 66 after the first window to 77 after twelve, bounded by retained endpoints plus the 64-receipt retry horizon. The separate native fixture holds 92 editor windows plus three creations, not 3,840 individual editor revisions.

Matched 128-save workloads (creation included in retained payload bytes):

| 1 MiB workload | Legacy save p50 / p95 | Window save p50 / p95 | Window seal | Retained payload legacy → window |
| --- | ---: | ---: | ---: | ---: |
| Repetitive small edit | 25.61 / 28.01 ms | 25.16 / 27.67 ms | 4.77 ms | 7,166 → 264 B |
| Repetitive full replacement | 27.02 / 28.80 ms | 25.05 / 27.13 ms | 4.81 ms | 27,155 → 264 B |
| Random small edit | 24.05 / 25.11 ms | 26.01 / 28.21 ms | 5.97 ms | 1,267,867 → 630,611 B |
| Random full replacement | 29.54 / 32.03 ms | 27.17 / 36.93 ms | 10.44 ms | 81,351,127 → 1,261,252 B |

Every matched case retained 129 revisions with the legacy writer versus two with windows, and 129 versus 66 terminal receipts. A repetitive full-replacement workload alternates changed repeated characters but also updates its first line; its even endpoint is only a small net transition. Random replacements change their whole endpoint. These endpoint geometries explain the different retained payloads.

Reduced retained payload does not guarantee a smaller allocated database immediately. Random small edits allocated 2,895,872 B legacy versus 3,391,488 B windowed, including 1,048,576 versus 2,318,336 B reclaimable pages left by full publication/pending payloads. Allocated indexes were approximately 280 KiB legacy versus 192 KiB windowed. Main/WAL/SHM and every baseline/pending/sealed/closed snapshot are recorded in the machine-readable evidence. Median save latency remains about 24–30 ms because canonical publication still processes the full file; random small-edit saves are slower with windows, and random full-replacement save p95 is also higher despite a lower median. No blanket save-speed or device-I/O reduction is claimed.

Fresh AppState first-page observations after clean close were 10.21–12.32 ms windowed versus 98.51–183.49 ms legacy on these small matched vaults. These are single cached-process observations, separate from warm interaction budgets.

Frontend: 800 tests across 123 files passed. Rust: 534 unit tests plus 16 architecture checks passed, with six opt-in release diagnostics excluded from the ordinary suite. Shared contracts are included in those suites. `pnpm check` reports zero errors/warnings; fixture checks under `python3 -O` pass all six tests. Browser: eleven journeys pass; isolated 1 MiB fixture-to-paint rendering measured 68.6 ms, excluding Rust/IPC. Native lifecycle (three), explicitly historical timeline (four), the production-default editing/restore and sustained-input journeys (two), and both optimized fixture journeys (one each) pass. The final three native runs executed sequentially after the user unlocked macOS, with scoped display-sleep prevention and no repository writes. Earlier locked-console attempts remain failed/invalid measurements in the evidence.

The legacy disposable clone passed every backend budget and its preparation-failure/retry, restart, clear, and bounded-compaction checks. Warm p95: 64 KiB paging 53.63 ms, diff 17.40 ms, deep reconstruction 8.31 ms, restore preview 9.37 ms; 1 MiB paging 77.87 ms, diff 64.28 ms, restore preview 62.47 ms. First access including attestation was 1,541 ms and clean-close restart first page 1,214 ms (single observations, separate from warm budgets). The sealed legacy master passed its hash check again after clone disposal.

The new fixture's 1 MiB backend p95 spans repetitive/random notes: paging 30.41/30.81 ms, diff 17.23/17.61 ms, reconstruction 13.21/13.70 ms, and restore preview 14.77/15.90 ms. Twenty samples per case passed their existing 250/1,000 ms gates.

## Retained failures and corrections

Initial compilation and fixture-export attempts, a concurrency failure, a frontend capability fitness failure, a browser label-count failure, and native harness/product failures remain in the new machine-readable run evidence. The concurrency regression now runs ten recovery/save races; immediate SQLite transactions avoid the observed deferred snapshot upgrade failure. Copied clean-closed SQLite fixtures now use immutable read-only validation when no live WAL exists. The corrected frontend test counts duplicate labels within the timeline because the selected summary legitimately repeats one. Native attempts exposed a real rapid History reentry request dropped during async workspace restoration; the same session now waits for its exit completion, with success/failure and multiple-entry regression coverage. Back readiness and the E2E-only inspection bridge were corrected separately. Later bounded diagnostics identified a locked macOS console as the cause of hidden visibility and zero animation frames; unlocking restored real paint without overriding visibility APIs. One native attempt was invalidated by a Vite reload caused by a repository write; subsequent timed/native runs prohibit all repository writes. Page paint readiness requires the retained record count to increase and the live timeline to report aria-busy=false, including the final page where the button disappears.

## Native results and acceptance

Five warm samples per operation passed the existing 250 ms native budget, including Rust, IPC, ready DOM, and two animation frames. Paging required an increased retained record count and a non-busy live timeline; the 41-revision window fixture also asserted all rows after its final page.

| Native fixture / note | Entry p95 | Page p95 | Diff p95 |
| --- | ---: | ---: | ---: |
| Legacy 100,000-revision vault, 64 KiB / 10,000-revision note | 105 ms | 61 ms | 33 ms |
| Legacy vault plus 1 MiB / 129-revision note | 212 ms | 84 ms | 95 ms |
| Window fixture, repetitive 1 MiB / 41 revisions | 193 ms | 109 ms | 61 ms |
| Window fixture, random 1 MiB / 41 revisions | 187 ms | 106 ms | 64 ms |

The sustained 1 MiB editing run recorded **725 animation frames across 15.051 seconds**, including twelve real canonical autosaves and production-worker deadline finalization. Timestamped events place clock advancement between inputs seven and eight; the retained deadline revision was verified before the sampler ended, and History entry then sealed the second window. Continuous frame gaps were p50 **17 ms**, p95 **49 ms**, maximum **156 ms**. Input-to-two-frames was p50 **147 ms**, p95/maximum **171 ms**. Input-to-canonical-save was p50 **1,256 ms**, p95/maximum **1,259 ms**, including the one-second debounce. These observations expose occasional frame stalls and do not claim uninterrupted 60 fps. Save/seal/startup and sustained-input observations carry no invented numeric budget.

The preserved master fixtures passed hash and integrity checks after their disposable native runs. Independent final Standards and Spec reviews have no actionable findings. The identity-scope, missing interval evidence, Activity/close locking, and rapid History reentry findings have regression fixes. All required available correctness/storage/native gates now pass, so issue 42 is complete and the integrated production policy is accepted within the limitations below. No permanent per-save dual writer or production capture-disable option remains.

## Limits

Measured hardware is the available arm64 macOS desktop only. Slower-machine, Windows/Linux native execution, packaged-asset startup, physical power loss, OS-cold cache behavior, device I/O, a combined 1 MiB/10,000-window note, and full-replacement native rendering are not covered. These are limitations, not passing measurements. Current-content citation/failure/restart/migration/clear correctness is separately exercised by the Rust/frontend/contract suites.
