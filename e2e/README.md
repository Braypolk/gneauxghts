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
- Stable first-painted window geometry after a real WebDriver session restart, guarding against the restore-growth regression.
- Availability of the debug-only Tauri automation bridge.
- Real note edits through capture, paged History Mode, deterministic diff, complete Version Restore, and exact editor scroll/selection restoration.
- Real external file deletion through the watcher adapter, Missing Note discovery, incremental retained-history loading, collision-safe recovery, and continued editing.
- Corrupt-store reset, forgotten-note recovery, restart, and selection, diff, and restore of the recovered timeline.

The native command first runs the shared TypeScript and Rust timeline-contract fixture checks. Its fault and watcher-flush helpers are compiled only by the `e2e-wdio` feature; ordinary builds without `e2e-wdio` do not expose them. The deterministic watcher flush consumes the real temporary-vault filesystem state at the same adapter boundary used by OS notifications, avoiding platform event-delivery timing in the assertion path.

Keep this suite focused. Add native cases only for behavior that depends on real window state, filesystem persistence, OS events, restart durability, or Tauri plugins.

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
