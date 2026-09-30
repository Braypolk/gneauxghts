# End-to-end testing

The end-to-end gate has two intentionally different test layers without changing the application state-machine boundaries.

## Fast browser layer

Run:

```bash
pnpm test:e2e:browser
```

This starts Vite on port 1421 with `VITE_E2E_BROWSER=true`, installs a deterministic in-browser implementation of Tauri IPC, and lets `@wdio/tauri-service` drive the real Svelte application in Chrome. The fixture is development-only and is inert in normal development and release builds.

Covered regressions:

- Initial app bootstrap through the same Svelte workspace used in Tauri.
- Repeated note A / note B switching with assertions that editor documents never cross-contaminate.
- Note → chat → note lifecycle with scroll restoration.

Use this layer for note operations, proposal projection/review, chat rendering, pane transitions, and external-sync UI states whenever backend behavior can be deterministic.

## Native Tauri layer

Run:

```bash
pnpm test:e2e:native
```

The command builds the debug binary with the `e2e-wdio` Cargo feature, immediately copies it into `src-tauri/target/e2e/debug/` with a hash/profile manifest, starts Vite at `http://127.0.0.1:1430` with `VITE_E2E_NATIVE=true`, and drives the real macOS Tauri window through the embedded WebDriver provider. The lifecycle and timeline specs run as separate WebDriver invocations so restart/window-state mutations cannot leak between them. Each invocation gets a temporary app-data directory, documents directory, vault, and Keychain service namespace, then removes its filesystem fixture. The E2E app uses a separate bundle identifier, and the WebDriver Rust plugins, frontend bridge, and permissions are excluded from ordinary builds without `e2e-wdio`.

Covered checks:

- Real application startup through the embedded driver.
- Stable window geometry across embedded WebDriver reconnection (this does not restart the native process).
- Availability of the debug-only Tauri automation bridge.
- Real note edits through capture, paged History Mode, deterministic diff, complete Version Restore, and exact editor scroll/selection restoration.
- Real external file deletion through the watcher adapter, Missing Note discovery, incremental retained-history loading, collision-safe recovery, and continued editing.
- Corrupt-store reset, forgotten-note recovery, restart, and selection, diff, and restore of the recovered timeline.

The native command first runs the shared TypeScript and Rust timeline-contract fixture checks. Its fault and watcher-flush helpers are compiled only by the `e2e-wdio` feature; ordinary builds without `e2e-wdio` do not expose them. The deterministic watcher flush consumes the real temporary-vault filesystem state at the same adapter boundary used by OS notifications, avoiding platform event-delivery timing in the assertion path.

Keep this suite focused. Add native cases only for behavior that depends on real window state, filesystem persistence, OS events, restart durability, or Tauri plugins.

### First-visible window bounds

Build with `node e2e/support/buildNative.mjs`, then run a native Vite server in
another terminal with `pnpm exec vite --strictPort --host 127.0.0.1 --port 1430`.
On an unlocked macOS display, run `node e2e/support/windowRestore.mjs`.
The probe launches fresh processes with disposable saved window states and
samples WindowServer every 5 ms from process creation through two seconds after
the window appears. Every observed visible frame must have the final bounds.
It covers smaller/larger saved sizes, saved position, reopening despite a saved
hidden flag, and a first launch with no saved state. It catches both default-size
flashes and AppKit's opening animation before WebDriver could connect. Sampling
does not establish that no shorter-than-5-ms frame exists. The probe kills only
its own fixture processes and does not test clean-exit persistence.

## Opt-in local-agent evidence check

`e2e/specs/native/agent-date-evidence.spec.ts` exercises real native ChatService,
AgentRuntime, and model-selected evidence tools against a disposable synthetic
vault. It is skipped unless `GNEAUX_LIVE_NATIVE=1`. Supply an explicit local
endpoint, model, and output artifact; it never chooses a hosted fallback.

After building the native E2E binary, run just this spec:

```sh
GNEAUX_LIVE_NATIVE=1 \
GNEAUX_LIVE_ENDPOINT=http://100.117.20.29:1234/v1 \
GNEAUX_LIVE_MODEL=qwen/qwen3.8-27b \
GNEAUX_LIVE_OUTPUT="$PWD/.scratch/date-handling/native-baseline.json" \
  pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/agent-date-evidence.spec.ts
```

The first question is submitted through the Svelte composer and opens a rendered
current-passage citation. Answers must contain app-constructed durable links, with
no unresolved model references, and retain those links when the conversation is reloaded. Subsequent questions use production chat IPC, followed
by source exclusion and canonical-edit invalidation checks. Retrieval is lexical
for this baseline. Raw answers, tool activity, usage, and citation resolutions
are saved for separate semantic grading; passing execution is not a claim of
answer correctness. Existing deterministic browser tests remain the primary
coverage for chat controller lifecycle behavior.

### Focused bounded research worker

`e2e/specs/native/research-worker.spec.ts` is opt-in with
`GNEAUX_RESEARCH_NATIVE=1` and the same explicit `GNEAUX_LIVE_ENDPOINT`,
`GNEAUX_LIVE_MODEL` and `GNEAUX_LIVE_OUTPUT` variables above. After building the
native artifact, run that spec alone with `pnpm exec wdio run
e2e/wdio.native.conf.ts --spec e2e/specs/native/research-worker.spec.ts`.
`GNEAUXGHTS_CONTEXT_DIAGNOSTICS=1` additionally records assembled request
counters, separating the worker's three executable evidence tools from its
structured result formatter, without recording private worker text.

The real native chat must deliver actually read, validated worker evidence for
current content, retained history and broad discovery. Parent direct retrieval
cannot satisfy those cases. Valid partial delivery remains useful worker evidence
and must keep its coverage limits. A separate excluded-scope case requires an
explicit research failure followed by parent direct evidence. Every admitted
passage resolves through production validation and an excluded canary must never
appear. These model-dependent checks complement deterministic selection,
isolation and budget contracts; one passing run does not guarantee all goals.

## Full Phase 1–3 gate

```bash
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:e2e:native
```

## Scenario ownership

| Scenario | Browser | Native |
| --- | --- | --- |
| Note/proposal switching isolation | Primary | Smoke only |
| External edit conflict choices and stale completions | Primary | Filesystem event smoke |
| Note/chat scroll and pane lifecycle | Primary | Window integration smoke |
| Rig run start/cancel/retry/reopen | Primary | Not required |
| App restart and window geometry | Not applicable | Primary |
| Note Timeline capture, paging, diff, restore, and editor-state return | Fixture coverage | Primary |
| Missing Note deletion, retained-history paging, and safe recovery | Fixture coverage | Primary |
| Corrupt reset and forgotten recovery across restart | Fixture coverage | Primary |

Future cases should extend the app-owned IPC fixture or a native temp-vault fixture. They should not bypass document, pane, chat, proposal, or external-sync controllers.

## Actual native process relaunch

On macOS, with an unlocked display, run these sequentially:

```sh
node e2e/support/buildNative.mjs --release
caffeinate -dimsu node e2e/support/processRelaunch.mjs
```

The runner creates disposable vault/app-data/document directories, owns each
native child directly, and connects to its embedded WebDriver after verifying
listener ownership and the selected vault. Ports 1430 and 4445 must be free.
Feature-only fault hooks acknowledge a unique token and native PID at committed
publication, window, and recovery boundaries, then park until the runner kills
that exact child. Every relaunch creates another native process against the
same fixture. SIGINT/SIGTERM stops admission of new children and cleans up owned
processes. Python 3 with SQLite inspects stable copies of live main/WAL files;
it never opens the interrupted original database or copies data back.

The six cases cover prepared abandonment, publication capture recovery, pending
window finalization, interruption during recovery, committed sealing, and
retained external-state replay before newer disk bytes. Each checks production
history reconstruction, immutable identities, canonical bytes, receipt safety,
and a continued save that survives another actual restart. Logs, snapshots,
fixture directories, failed attempts, and `results.json` remain under the printed
`PROCESS_RELAUNCH_EVIDENCE` directory or its recorded fixture paths. These are
process-interruption tests; they do not establish device power-loss durability.

## Native artifact admission and large histories

`buildNative.mjs` immediately copies its successful E2E feature build into `src-tauri/target/e2e/{debug,release}/` and writes a SHA256 manifest with the exact profile. Native WDIO and process-relaunch runners admit that isolated artifact before spawning anything; ordinary Cargo commands can replace their normal output without changing the copied E2E executable. Admission rejects a wrong profile, changed hash, missing feature markers, or missing manifest. The large-history runner additionally requires an explicit admitted artifact path so its evidence records the exact selected executable. Rebuild with `node e2e/support/buildNative.mjs` (debug) or `--release` (optimized) if admission fails.

Generate current schema-14 large-history masters explicitly; these are lengthy durable workloads:

```sh
python3 scripts/timeline_fixture.py create-scale --notes 1 --cache /tmp/gneauxghts-current-scale-10k
python3 scripts/timeline_fixture.py create-scale --notes 901 --cache /tmp/gneauxghts-current-scale-100k
```

The first shape has one 10,000-revision note. The second has that hot note plus 900 notes with 100 revisions each. Every note is 64 KiB of repetitive Markdown, with two real production saves per Editing Window and a deterministic continuous clock to finalize the real deadline. Masters are sealed, hashed and checked; probes run on disposable path-relocated clones. Do not run generation, backend probes, native paint checks or builds concurrently, and do not edit repository files during timed/native runs.

For a fresh-process backend probe, obtain a clone with `python3 scripts/timeline_fixture.py clone --cache <master>`, set `GNEAUXGHTS_SCALE_RUN` to that returned path, and run `cargo test --release --manifest-path src-tauri/Cargo.toml release_current_scale_probe -- --ignored --nocapture`. The probe verifies all retained history, measures history entry, paging, diff, reconstruction and restore preview at distributed endpoints, and separately logs the full traversal needed to obtain the old-page cursor. OS caches remain warm; process recovery is distinct from native paint.

For native paint on an unlocked desktop, build the optimized E2E artifact and name that admitted copy explicitly:

```sh
node e2e/support/buildNative.mjs --release
GNEAUXGHTS_SCALE_NATIVE_BINARY="$PWD/src-tauri/target/e2e/release/gneauxghts" python3 scripts/timeline_fixture.py native-scale --cache /tmp/gneauxghts-current-scale-100k
```

The runner checks actual visible/focused state at the start and final animation frame, owns its native/Vite PIDs, and verifies its embedded listener and selected disposable vault before any write. Backend page/diff p95 budgets are 250 ms and reconstruction/restore-preview budgets are 1 s; native entry/page/diff have separate 250 ms p95 paint gates. Fixture construction, process startup, full traversal and observed memory have no invented SLA. Probe output records precise workload counts, samples, limitations and failed attempts.


### Direct old-citation context

Use the same admitted current-format clones. Set `GNEAUXGHTS_SCALE_RUN` to the
canonical clone path and run `cargo test --release --manifest-path src-tauri/Cargo.toml release_current_scale_citation_probe -- --ignored --nocapture`.
The probe emits `CITATION_STARTUP`, `CITATION_QUERY_PLAN` and `CITATION_SAMPLES`
JSON lines. Selection and expected-content checks are untimed; requests receive
only the Note/Revision identity and optional opaque context cursor. SQLite
PROFILE counters include actual VM/fullscan/sort work and separate initial
predecessor-index creation from warm reads.

For native citation paint, build the admitted artifact above and supply a JSON
array of hot-note samples for indices 0, 50, 5000 and 9999 (one sample per index)
from `CITATION_SAMPLES`. Preserved arrays are
`/tmp/gneauxghts-citation-context-50-evidence/selections-{10k,100k}.json` and are
also emitted by the citation probe. With the actual desktop unlocked:

```sh
GNEAUXGHTS_SCALE_NATIVE_BINARY="$PWD/src-tauri/target/e2e/release/gneauxghts" \
GNEAUXGHTS_CITATION_SELECTIONS=/tmp/gneauxghts-citation-context-50-evidence/selections-10k.json \
node e2e/support/currentScaleNative.mjs <canonical-disposable-clone>
```

This invokes the real citation navigation binding after evidence delivery;
exact command-count assertions live in session and delivered-citation browser
tests. The native runner checks target, bounded DOM, adjacent pages, workspace
return and visible/focused final frames, then stops its owned app, server and
scoped caffeinate. Run fixtures sequentially without source edits/heavy checks.


### Evidence inspection

Sources and quotation requests use ordinary chat. Every sourced answer offers
Show evidence for exact delivered excerpts, historical/current labels and recorded
timing. The native date-evidence suite includes missing-outcome and explicit-success
cases through that same runtime; citation resolution does not by itself establish
answer quality. There is no source-preview toggle or alternate execution mode.

If the native test ports are occupied, set `GNEAUXGHTS_E2E_PORT` (Vite) for both build and run, and `TAURI_WEBDRIVER_PORT` for the run. Defaults remain 1430 and 4445. Debug artifact admission checks its recorded dev port to prevent loading a different server. For example, build with `GNEAUXGHTS_E2E_PORT=1431 node e2e/support/buildNative.mjs`, then add `GNEAUXGHTS_E2E_PORT=1431 TAURI_WEBDRIVER_PORT=4446` to the test invocation.


### Chat typing responsiveness

After building the native E2E binary, run `GNEAUXGHTS_E2E_CHAT_CONTEXT_DELAY_MS=2000 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/chat-typing.spec.ts` (add matching dev/driver port overrides when used). This opt-in test delays real related-note searches in the E2E-only worker path, types through the Svelte composer, and asserts input-to-paint latency, a single in-flight search and eventual search of the latest draft. It uses a disposable vault, disabled semantic search and no model calls. The normal app build contains no delay/event probe.

### Inventory budget regression

Run `query-inventory.spec.ts` with `GNEAUX_QUERY_NATIVE=1` and
`GNEAUX_INVENTORY_BUDGET=1` plus the existing local endpoint, model and output
variables. It creates nine allowed synthetic notes and an excluded canary, runs
ordinary and quotation-focused inventories, and checks further model work after retrieval,
coverage or explicit budget gaps, passage links, exact current or historical
navigation and persisted reload.
Use an isolated dev/WebDriver port pair for concurrent checkouts.

### Context measurement only

Set `GNEAUXGHTS_CONTEXT_DIAGNOSTICS=1` to record counter-only assembled-request
and reported-usage diagnostics. It does not alter context or output limits.
Run the ignored Rust `live_context_measurement_synthetic_matrix` with the local
endpoint/model variables and an **absolute** `GNEAUX_LIVE_OUTPUT` path. Run
`query-inventory.spec.ts` with `GNEAUX_QUERY_NATIVE=1` and
`GNEAUX_CONTEXT_NATIVE=1` for persisted inventory, tool-evidence and research
measurements. Use the same diagnostics variable for the native app process.

Current chat implementation and archived experiment status are indexed in
[the integration record](../docs/architecture/current-evidence-integration.md). General
structured query routing and terminal inventories have been removed. Evidence
capabilities accept explicit date ranges and return intermediate results for
further tools and synthesis; native inventory checks validate that composition. Historical benchmark reports describe the
code tested at their recorded dates, not additional active runtime pipelines.

### Pane animation

`pane-animation.spec.ts` in the browser suite samples real pane widths during
opening and closing, including either close side, narrow/wide windows, Related,
chat, reduced motion and interruption. It asserts intermediate geometry,
consistent direction and stable cleanup rather than a fixed frame count.
It also checks activation during entrance; the chat suite checks that a direct
chat split neither mounts a temporary editor nor republishes unchanged insets.

For the native WebKit check, build with `node e2e/support/buildNative.mjs`, then
run `pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/pane-animation.spec.ts`.
It uses the isolated native fixture, explicitly shows/focuses its window, and
records frame intervals and widths for both close directions. Keep the desktop
unlocked and avoid concurrent builds or benchmarks during this measurement.

Populated chat restoration is covered by `browser/chat-pane-animation.spec.ts`
and `native/chat-pane-animation.spec.ts`. The native fixture inserts 100 synthetic
messages only after validating the disposable E2E vault root. It verifies complete
history, initial scroll position, incremental rendering, and a generous 150 ms
ceiling for a severe UI-thread stall in the debug build. Rebuild the native E2E
binary after Rust changes. Run browser and native suites sequentially: both Vite
servers generate shared SvelteKit files, which can reload an active browser test.
Run these two native motion specs in separate invocations for fresh fixture
vaults; they use the same fixture note title. Foreground-focus assertions require
the native test window to stay active throughout the run.


### Activity follow-ups with retained history

Build the native E2E binary, then run the actual chat runtime against a local
model using synthetic notes in a disposable vault:

```sh
GNEAUX_ACTIVITY_NATIVE=1 \
GNEAUX_LIVE_ENDPOINT=http://127.0.0.1:1234/v1 \
GNEAUX_LIVE_MODEL=your-loaded-model \
GNEAUX_LIVE_OUTPUT=/tmp/activity-followups.json \
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/activity-followups.spec.ts
```

The fixture records an explicit interval, then changes current status afterward.
Two fresh conversations (override with `GNEAUX_LIVE_REPEATS=1..3`) must acquire
retained change evidence and current-status evidence, finish successfully, exclude
a private canary, and resolve their citations. The first turn goes through the
composer and opens/highlights an actually cited current body passage. A new
related status note is added before a follow-up, which must read it freshly.
A final explicit research request must record a research outcome and read/cite
historical evidence and independently read/cite the newly added current status
through research or direct fallback. In-flight answer events
are saved on the 300-second request deadline; a title citation may navigate
without a body selection and is not used for the highlighting assertion. Review each saved answer against
the included semantic rubric: recorded completion, superseded plans, cancellation,
unchanged old backlog, inferred actions, and disclosed coverage. Passing citation
checks alone does not establish answer quality. Offline evidence-contract tests
cover fixed last-week dates, clock uncertainty, assistant-transcript exclusion,
revoked access, cleared history, partial batches, and read continuations.
