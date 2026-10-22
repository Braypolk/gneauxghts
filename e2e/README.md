# End-to-end testing

The end-to-end gate has browser and native test layers without changing the application state-machine boundaries.

## Interactive agent verification

Use `pnpm agent:serve` and `pnpm agent:session` for persistent headless Chrome
sessions, snapshots, assertion evidence, traces and test export. Follow the
[agent verification workflow](../docs/agents/ui-verification.md) for setup,
replay with `pnpm agent:test`, and cleanup. Every suite uses WDIO 10; the
`e2e/agent` workspace organizes the interactive workflow. Both browser paths
use the same in-memory app fixture.

## Fast browser layer

Run:

```bash
pnpm test:e2e:browser
```

This starts an owned Vite server on port 1421 (override with `GNEAUXGHTS_E2E_BROWSER_PORT`) with `VITE_E2E_BROWSER=true`, installs a deterministic in-browser implementation of Tauri IPC, and drives the real Svelte application in Chrome through ordinary WebDriver. The fixture is development-only and is inert in normal development and release builds.

Chrome runs headless by default with a 1440×1000 initial window size, so browser
tests do not open desktop windows or take focus. Specs can still resize the window
to test narrower layouts. Failure screenshots are still captured. To watch a browser test while
debugging, explicitly opt in:

```bash
GNEAUXGHTS_E2E_HEADED=1 pnpm test:e2e:browser
```

Ordinary frontend, support, Python and Rust tests also run without desktop
windows. Native Tauri tests run the real app in the background by default. On
macOS, the E2E executable prevents application activation and initially orders
its window behind other windows, including after process restarts. Background
WebKit throttling is disabled in the E2E build. This is native background
automation, not a headless app or a simulated focus state; ordinary app builds
keep their normal presentation.

Dedicated tests that assert actual OS focus or focused paint require explicit
`GNEAUXGHTS_E2E_FOREGROUND=1` and otherwise fail before launching the app.
Do not enable this flag automatically: arrange a separate desktop session or
obtain permission to interrupt the current desktop. The headed browser flag
does not change native behavior. Hiding/minimizing a focus or paint check does
not establish that its assertions passed.

Covered regressions:

- Initial app bootstrap through the same Svelte workspace used in Tauri.
- Repeated note A / note B switching with assertions that editor documents never cross-contaminate.
- Note → chat → note lifecycle with scroll restoration.

Use this layer for note operations, Pi chat rendering, pane transitions, settings, and external-sync UI states when backend behavior can be deterministic.

## Native Tauri layer

Run:

```bash
pnpm test:e2e:native
```

The command builds the debug binary with the `e2e-wdio` Cargo feature, immediately copies it into `src-tauri/target/e2e/debug/` with a hash/profile manifest, starts Vite at `http://127.0.0.1:1430` with `VITE_E2E_NATIVE=true`, and drives the real macOS Tauri window through the embedded WebDriver provider. The deterministic background smoke specs (lifecycle, command/event transport, images and Pi native/publication/compaction/adapters) run as separate WebDriver invocations so restart/window-state mutations cannot leak between them. Each invocation gets a temporary app-data directory, documents directory, vault, and Keychain service namespace, then removes its filesystem fixture. The E2E app uses a separate bundle identifier, and the WebDriver Rust plugins and permissions are excluded from ordinary builds without `e2e-wdio`. Native focus IPC is denied by default; its permission is added only when the E2E process starts with explicit foreground opt-in. The lifecycle spec verifies that denial, and background scenarios check native focus after each test.

The local `nativeTauriService.mjs` launcher owns the pinned process, admits only its embedded driver listener, and cleans up the process and fixture. It replaces `@wdio/tauri-service`; tests use standard promise-returning `browser.execute` and the app’s real IPC, without service-side mocking or command overrides. Native backend logs are retained when `outputDir` is configured.

Native coverage across the background and explicit foreground lanes:

- Real application startup through the embedded driver.
- Stable window geometry across embedded WebDriver reconnection (this does not restart the native process).
- Promise resolution/rejection through the embedded WebDriver and real native IPC.
- Real note edits through capture, paged History Mode, deterministic diff, complete Version Restore, and exact editor scroll/selection restoration.
- Real external file deletion through the watcher adapter, Missing Note discovery, incremental retained-history loading, collision-safe recovery, and continued editing.
- Corrupt-store reset, forgotten-note recovery, restart, and selection, diff, and restore of the recovered timeline.

The native command first runs the shared TypeScript and Rust timeline-contract fixture checks. Its fault and watcher-flush helpers are compiled only by the `e2e-wdio` feature; ordinary builds without `e2e-wdio` do not expose them. The deterministic watcher flush consumes the real temporary-vault filesystem state at the same adapter boundary used by OS notifications, avoiding platform event-delivery timing in the assertion path.

Keep this suite focused. Add native cases only for behavior that depends on real window state, filesystem persistence, OS events, restart durability, or Tauri plugins.

### Giant quoted paragraphs

After building the native artifact, run the parser-patch regression against
50,000 nested quote lines in actual production panes:

```sh
GNEAUXGHTS_E2E_FOREGROUND=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/markdown-marker-merge.spec.ts
```

This measurement requires the authorized foreground lane so animation frames
advance. It checks all quote/emphasis ranges, syntax-changing edits from both
pane positions, and sibling selection/scroll preservation. Optional
`MARKDOWN_NATIVE_OUTPUT` saves ten timed edits after five warmups, without a
machine-dependent latency gate. Foreground/window and source-editor focus are
admitted after fixture preparation, outside timing; a focus loss during timing
still rejects the samples. Run sequentially with other native checks and
benchmarks. The visible-Markdown and foreground cursor suites cover appearance,
concealment, remount, caret geometry and WebKit selection separately.

### Image delivery measurements

The native smoke lane checks asset protocol admission, encoded paths, replacement
refresh and real editor loading of large and multiple raster images. For latency
measurements, obtain permission to take desktop focus, build the native E2E app,
then run this separately from other tests or benchmarks:

```sh
GNEAUXGHTS_E2E_FOREGROUND=1 IMAGE_LOADING_OUTPUT=/tmp/image-loading.json pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/image-loading.spec.ts
```

This collects five fresh loads per scenario with deterministic distinct pixels:
one 24 MiB raster, sixteen 0.75 MiB rasters, and a nearly 1 MiB Markdown note
with a 24 MiB raster. It requires focus before and after each sample. Fixture
generation and writes are untimed; OS file caches remain warm. Completion means
all mounted images report `complete` and nonzero `naturalWidth`; timer gaps are a responsiveness
proxy, not physical paint or input latency. No machine-specific latency budget
is imposed on routine smoke tests. `IMAGE_LOADING_BASELINE=1` accepts data URLs
when comparing an explicitly restored pre-migration loader and pinned binary.

### Synchronous paragraph diagnostics

`markdown-synchronous-paragraph.spec.ts` is an opt-in foreground comparison of the
unchanged GFM autolink recognizer and its installed ASCII boundary guard. Set
`MARKDOWN_SYNCHRONOUS_NATIVE_OUTPUT=/tmp/synchronous-native.json` and use the owned
`runNativeSpecs` runner with `GNEAUXGHTS_E2E_FOREGROUND=1`. It checks actual app-dialect
syntax and embedded mounts, then requests baseline/candidate/baseline giant edits
and queued typing at 200ms/80ms intervals for one and two panes. Each independent
phase validates focus/visibility before and after timing, full quote/emphasis
ranges, sibling selection/scroll and typed text. Focus interruptions reject the
phase; other failures stop the invocation to avoid overlapping async work. These
are dispatch/RAF observations without machine-dependent time gates, not physical
key-to-display measurements. Run sequentially with builds, checks and other timing.

### First-visible window bounds

Build with `node e2e/support/buildNative.mjs`, then run a native Vite server in
another terminal with `pnpm exec vite --strictPort --host 127.0.0.1 --port 1430`.
On an available, unlocked macOS display, explicitly run
`GNEAUXGHTS_E2E_FOREGROUND=1 node e2e/support/windowRestore.mjs`.
The probe launches fresh processes with disposable saved window states and
samples WindowServer every 5 ms from process creation through two seconds after
the window appears. Every observed visible frame must have the final bounds.
It covers smaller/larger saved sizes, saved position, reopening despite a saved
hidden flag, and a first launch with no saved state. It catches both default-size
flashes and AppKit's opening animation before WebDriver could connect. Sampling
does not establish that no shorter-than-5-ms frame exists. The probe kills only
its own fixture processes and does not test clean-exit persistence.

## Ordinary Pi acceptance

`piChatNative.spec.ts`, `piChatPublication.spec.ts`, `piChatEditing.spec.ts`,
`piChatCreation.spec.ts`, `piChatCompaction.spec.ts` and `piChatAdapters.spec.ts`
exercise ordinary chat against the deterministic provider in
`support/piProviderFixture.mjs`. They use actual Pi Harness, native storage,
authority, transport, citations and NoteTimeline publication. The provider is a
fixture; these checks make no live-model claim. `piChatLocal.spec.ts` is the
separate live local-model lane. Every native suite writes only its generated
fixture vault and starts on the ordinary `/` route.

`piChatHosted.spec.ts` is the opt-in live OpenAI lane, pinned to `gpt-6-luna`.
With `OPENAI_API_KEY` supplied to the debug native process, run
`GNEAUX_PI_HOSTED_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs hosted`.
It exercises the original Edit check / 45-minute walk request through native
search, read, review, publication and citation navigation, plus an explicitly empty
first-page cursor followed by real native pagination tokens. It uses a generated
vault, leaves the user's Settings/Keychain untouched and makes billable OpenAI
requests. Credentials must stay in the process environment, never reports or files.

`piChatHosted.spec.ts` and `piChatLocalTools.spec.ts` register the same shared
`piToolAcceptance.ts` journeys: search/read/edit with review and fresh citation
navigation, four-page search with exact continuation tokens, and root-note creation
with full-content review and a fresh canonical citation. Run the local equivalents
with `GNEAUX_PI_LOCAL_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs live` (also
includes the existing local streaming/read check). Reports distinguish provider
and flow. Hosted uses Pi's preferred strict JSON Schema sampling; the local
OpenAI-compatible server retains normal schema validation without claiming strict
sampling support.

`piChatSubscription.spec.ts` runs those same three journeys with a ChatGPT
subscription and asserts that the selected method stays `chatgpt` throughout.
After `node e2e/support/buildNative.mjs`, run
`GNEAUX_PI_SUBSCRIPTION_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs subscription`.
The first run opens Pi's browser consent flow; finish Continue with ChatGPT in
that browser within five minutes. The harness starts login once and polls only
its nonsecret completion status. Later runs reuse the separate E2E Keychain
account. A rebuilt development executable can trigger a fresh macOS Keychain
access dialog. The opt-in harness keeps that app and dialog alive for up to a
day so a later human approval remains usable; inference deadlines stay bounded.
For development rebuilds on macOS, set `APPLE_SIGNING_IDENTITY` to an installed
certificate, or save its public selector locally as
`{"identity":"<certificate SHA-1 fingerprint>"}` in the gitignored
`.gneauxghts-signing.local.json` at the repository root. Apple Development and
stable local development certificates are supported; private keys stay in Keychain.
`buildNative.mjs` signs and verifies the executable before pinning its hash,
with a stable test-app identifier. Without a certificate, changed executables
can request Keychain access again; the native session cache removes redundant
reads within the same process but cannot grant trust to a different executable.
Release bundles use Tauri's normal signing/notarization configuration. No Keychain
ACLs are broadened, and ad-hoc signing is not accepted as a stable identity.

`pnpm tauri dev` uses the same development certificate selector and signs each
rebuilt executable before launch through Cargo's target runner. The runner execs
the app, preserving Tauri's stop/rebuild process lifecycle. A custom Tauri
`--runner` is rejected when development signing is enabled. The local selector
applies only to development and native tests; release signing still requires
the normal explicit release credentials.

The model defaults to `gpt-6-luna`; `GNEAUX_PI_SUBSCRIPTION_MODEL` can
select another model offered by the account. Requests consume ChatGPT plan usage
and never fall back to an API key. Set `GNEAUX_PI_ACCEPTANCE_OUTPUT` to an existing
directory to retain sanitized journey reports. The support suite also runs Pi's
actual refresh implementation against an isolated token-response fixture to
verify rotation and required subscription permission without live tokens.

The editing journey uses model-issued `read_note`/`edit_note` calls, the public Pi
edit factory, visible approve/discard review and native publication. It covers
stale bases, cancellation, independent write permission, explicitly disabled
review and Always-to-Temporary policy changes. Add `GNEAUX_PI_PROCESS_RESTART=1`
when running `piChatEditing.spec.ts` to include a real process relaunch while an
edit awaits review, followed by exactly one committed tool result.

The creation journey uses model-issued `create_note`, explicit creation permission,
a full-content review with the exact destination, and create-only native publication.
It covers independent operation grants, fresh citations, discard/Stop, late
destination collisions and no suffixed copies. `GNEAUX_PI_PROCESS_RESTART=1` adds
restart before approval and after publication, preserving one identity and receipt.
Native Rust publication tests also fault before the effect and after commit but
before acknowledgement.

The deterministic Pi specs run by default in the native smoke lane without extra
acceptance flags. Only live-model checks require opt-in; use
`GNEAUX_PI_COMPACTION_LOCAL=1` to run compaction against the configured local model
instead of its deterministic provider.

The browser fixture uses an actual Pi Harness with MemoryStorage and a synthetic
provider for presentation journeys. Its native-boundary mocks retain settings,
composer drafts and explicit source navigation, with no retired ChatApi commands.
It is available only with both development mode and `VITE_E2E_BROWSER=true`.

## Default automated gate

```bash
pnpm check
pnpm test
pnpm test:timeline:fixture:checks
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:e2e:native
```

`pnpm test` runs the Node support checks once, then all frontend Vitest tests. `pnpm check` remains part of
the gate: it checks typed application access as well as Svelte and E2E sources.
`pnpm test:support` runs dependency-free Node checks for disposable fixture
containment, native binary admission, owned server admission/cancellation and bounded
WebDriver transport; the Python fixture checks are separate. The server checks bind
disposable localhost ports. `.github/workflows/tests.yml` runs the ordinary
frontend/types/Node/Python and Rust gates; graphical and live-provider lanes require
the corresponding environment and remain explicit.
Run `pnpm test:build:artifacts` when changing Rust build profiles or artifact
handling; it deliberately performs repeated Cargo builds on macOS. Live-provider
and large-history release probes below remain opt-in and are not part of this gate.
Complete native focus, History and paint verification additionally requires the
foreground lane on an available desktop; the background gate does not claim
those focus/paint checks passed.

## Execution lanes

`pnpm test:e2e:native:list` lists the deterministic smoke files without building
or launching the app. `pnpm test:e2e:native:run` runs exactly those files in fresh
background invocations. Search focus, pane motion, populated chat motion, dock
outline and the History/Editing Window journeys that assert editor focus are
retained in `node e2e/support/nativeSuite.mjs foreground`.
The foreground and measurement lanes require explicit
`GNEAUXGHTS_E2E_FOREGROUND=1`. The measurement lane retains the Editing Window
scenarios. `node e2e/support/nativeSuite.mjs live --list` lists the actual local
model Pi lane. Provider-dependent checks and native windows remain explicit.

Browser scenarios reset local/session storage on an inert same-origin page before
mounting the application. The strict backend rejects unknown commands and note
identities. Retained chat presentation checks observe Pi history and submissions.

All managed Vite launchers require a per-process identity response and stop only
the process group they started. An occupied port is an admission failure. Native
process/scale/restart runners share bounded transport and listener inspection;
their fault timing and durability assertions remain scenario-specific.

## Scenario ownership

| Scenario | Browser | Native |
| --- | --- | --- |
| Note switching isolation | Primary | Smoke only |
| External edit conflict choices and stale completions | Primary | Filesystem event smoke |
| Note/chat scroll and pane lifecycle | Primary | Window integration smoke |
| Pi streaming, queue, Stop, new attempt and reopen | Presentation | Native and live acceptance |
| App restart and window geometry | Not applicable | Primary |
| Note Timeline capture, paging, diff, restore, and editor-state return | Fixture coverage | Primary |
| Missing Note deletion, retained-history paging, and safe recovery | Fixture coverage | Primary |
| Corrupt reset and forgotten recovery across restart | Fixture coverage | Primary |

Future cases should extend the app-owned IPC fixture or a native temp-vault fixture. They should use the document and pane owners, actual Pi Harness, and ordinary external-sync seams.

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
GNEAUXGHTS_E2E_FOREGROUND=1 GNEAUXGHTS_SCALE_NATIVE_BINARY="$PWD/src-tauri/target/e2e/release/gneauxghts" python3 scripts/timeline_fixture.py native-scale --cache /tmp/gneauxghts-current-scale-100k
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
GNEAUXGHTS_E2E_FOREGROUND=1 \
GNEAUXGHTS_SCALE_NATIVE_BINARY="$PWD/src-tauri/target/e2e/release/gneauxghts" \
GNEAUXGHTS_CITATION_SELECTIONS=/tmp/gneauxghts-citation-context-50-evidence/selections-10k.json \
node e2e/support/currentScaleNative.mjs <canonical-disposable-clone>
```

This invokes the real citation navigation binding after evidence delivery;
exact command-count assertions live in session and delivered-citation browser
tests. The native runner checks target, bounded DOM, adjacent pages, workspace
return and visible/focused final frames, then stops its owned app, server and
scoped caffeinate. Run fixtures sequentially without source edits/heavy checks.


### Pane animation

`pane-animation.spec.ts` in the browser suite samples real pane widths during
opening and closing, including either close side, narrow/wide windows, Related,
chat, reduced motion and interruption. It asserts intermediate geometry,
consistent direction and stable cleanup rather than a fixed frame count.
It also checks activation during entrance; the chat suite checks that a direct
chat split neither mounts a temporary editor nor republishes unchanged insets.

For the native WebKit check, build with `node e2e/support/buildNative.mjs`, then
run `GNEAUXGHTS_E2E_FOREGROUND=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/pane-animation.spec.ts`.
It uses the isolated native fixture, explicitly shows/focuses its window, and
records frame intervals and widths for both close directions. Keep the desktop
unlocked and avoid concurrent builds or benchmarks during this measurement.

Populated chat restoration is covered by `browser/chat-pane-animation.spec.ts`
and `native/chat-pane-animation.spec.ts`. Histories are seeded through public Pi
operations after validating the disposable vault. These checks retain mounted
editors, normal picker selection and latest-message positioning; they do not write
legacy SQLite chat tables. Run browser and native suites sequentially because
both Vite servers generate shared SvelteKit files.

The retired activity, exact-passage, research, promotion, context-selection and
latency suites belong to historical evaluation. They are no longer executable
acceptance lanes. iOS simulator acceptance lives under `scripts/pi-chat/`; its
status is recorded in the rebuild tracker, independently of desktop evidence.
