# Native Pi validation

2026-10-15. Implementation checkpoint **`833c933`**, branch
`codex/pi-durable-native-prototype`; baseline `c9d949f`, storage seam `d96eff8`,
bridge checkpoint `6847349`. Durable/AI/Chord are exactly 1.3.0. No upstream patch.
Evidence reports carry native IDs, committed receipts and disposable paths;
[results](results.md) separates successful slice acceptance from missing parity.

## Environment and isolation

Apple Silicon macOS 26.6.2, Xcode 27.0 (27A266a), Simulator SDK 27.0. Dedicated
simulator `FBAC4D90-9149-4B49-B40D-EA5B90B7069C` (`Gneauxghts Pi Prototype`,
iPhone 17 Pro, iOS 26.4.1). Installed runtimes include 18.5, 26.1 and 26.4/26.4.1;
27.0 is absent. The ordinary simulator and ordinary app were not altered.

Selection requires Rust `pi-prototype` and frontend `VITE_PI_PROTOTYPE=true`.
Bundle ID `com.braypolkinghorne.gneauxghts.pi-prototype`, separate Keychain service,
forced synthetic vault: desktop app-data `PROTOTYPE-wipe-me/vault`, iOS Documents
`PROTOTYPE-wipe-me`. Pi and effect-receipt databases have explicit disposable
names. Desktop uses the existing background embedded WebDriver. Original checkout
and ordinary vault/credentials were read-only. No live provider was called.

UI gates operate the existing chat and retained CodeMirror editor with automated
DOM clicks, input events and EditorView dispatch. Screenshots were inspected.
These establish real native webview integration; they do not establish physical
touch/keyboard, accessibility, hardware suspension or resource acceptance.

## Observed matrix

| Check | Desktop | iOS simulator | Evidence/limit |
| --- | --- | --- | --- |
| Actual webview → IPC → upstream SQLite storage | Pass | Pass | Native facade; no browser database/server |
| Callback rollback, queued competing read, stale transaction rejection | Pass | Pass | Native facade probes on both launches |
| Pi submission/committed history/document receipt reopen | Pass | Pass | New submission plus prior-process `done` receipt |
| Responses and compatible Chat | Pass | Pass | Native SSE chunks/tool progress; final text withheld until admission; split tool args, canonical read, admitted citation, follow-up, cancellation, partial failure |
| Model create/update | Pass | Pass | Domain probe; staged create survives failed generation; update requires real NoteTimeline publication |
| Existing chat and retained editor UI | Pass | Pass | [Desktop report](evidence/desktop-review.json), [simulator report](evidence/ios-review.json) |
| Edit body/title/hunks, switch queued reviews, checkpoint/relaunch | Pass | Pass | Real CodeMirror bytes and title restored; automatic title-derived destination persisted |
| UI Keep/Discard and duplicate Keep | Pass | Pass | Native receipt binds edited bytes and identity; dismissed review creates no note |
| Direct Save | Pass | Pass | Deterministic preview/stage, origin dedup; no model call in Save implementation; targeted append/heading parity absent |
| Two sessions, concurrent Keep, malformed/stale checkpoint, settled callback | Pass | Pass | Domain probe; no proposal leakage; one accepted outcome |
| Canonical target changed before Keep | Pass | Pass | Conflict, newer checkpoint, another explicit Keep |
| Access changed before publication/final answer; citation exclusion navigation | Pass | Pass | Native current grants/exclusions plus Pi current access rechecked |
| Native crash after intent/publication/receipt, before Pi result | Pass | Not injected | Desktop [fault proof](evidence/faults.json), one canonical file and NoteTimeline publication receipt per accepted identity |
| In-flight model termination and explicit Retry | Pass | Not separately injected | SIGKILL; no automatic request on restart; exactly one new inference on explicit Retry |
| Process termination with pending edited review | SIGKILL pass | simctl terminate pass | Distinguish abrupt desktop death from simulator termination |
| Background/foreground | Background harness | Pass | Settings app foregrounded then prototype; same submission ID, no fresh network admission |
| Generic ChatService shadow state | Zero rows | Zero rows | [Desktop counts](evidence/desktop-no-shadow-state.json), [simulator counts](evidence/ios-no-shadow-state.json) |
| Dirty-editor update/failing checkpoint UI injection | Shared workflow tests only | Shared workflow tests only | Pi-specific full native matrix not established |
| Rename/edit current evidence while waiting; retained revision navigation | Not established | Not established | Current evidence is hash-validated; historical adapter explicitly rejects navigation |
| Raw tool-intent crash before staging | Not separately injected | Not separately injected | Staged-model failure and accepted native intent crashes are covered |
| Long sessions/compaction, late conversational refinement | Not implemented | Not implemented | Compaction declined; no refinement tool |
| Physical device/live provider | Unverified | Unverified | No authorized physical device/credentials used |

Reports: [desktop screenshot](evidence/desktop-review.png),
[phone screenshot](evidence/ios-review.png). Earlier protocol/storage evidence is
retained as [desktop bridge](evidence/desktop-bridge.json) and
[simulator bridge](evidence/ios-bridge.json), rather than substituted for UI gates.

## Recovery proof

`fault-gate` aborts only the disposable fixture-enabled native process at three
bounded points: immediately after persisting an accepted native intent, after
NoteTimeline publishes Markdown, and after the native receipt before returning
to Pi. Each relaunch restores the same approved Pi task, reconciles/replays, and
settles the review. A read-only SQLite/file verifier confirms exactly one effect
row, one canonical file carrying the Note Identity and one NoteTimeline publication
receipt. Duplicate Keep returns that same identity/receipt.

A fourth gate kills an in-flight slow native request. Relaunch exposes an error
outcome and makes no second request for that unique prompt. Calling the existing
Retry adapter then makes exactly one fresh inference and completes. Native
provider fixtures reject Authorization headers. Safe review staging uses a Pi
transaction/origin key; canonical publication is never performed by the model
proposal tool itself.

This is bounded synthetic acceptance, not exhaustive disk-failure testing.
Hard disk-full/COMMIT failure, native lease expiry under mobile suspension,
physical memory pressure and simulator publication-abort boundaries remain
unverified. Native constraint/owner rollback tests do not establish those cases.

## Existing checks

[Selected check output](evidence/checks.txt):

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- Five affected Vitest files: **72 tests pass**, including ChatApi, chat proposals,
  proposal orchestration/state machine and title interaction.
- Native facade unit probes: **2 pass** (constraint rollback and revoked owner).
- Existing native Save/promotion tests: **6 pass**.
- Existing NoteTimeline publication tests: **3 pass**, plus exclusive creation:
  **1 pass**. Existing default architecture fitness: **21 pass**.
- Default frontend `pnpm build`: pass. Default Rust path compiles with the
  architecture gate. No default runtime or production architecture assertion was
  relaxed for the prototype.

The iOS build emits existing `legacy_jina` unused-mut and non-E2E `e2e_background`
dead-code warnings. No Pi compile error remains. No performance/resource benefit
is claimed.

## SDK/runtime preflight and startup findings

Stock Tauri iOS CLI failed before Rust compilation because cargo-mobile2 compares
the newest SDK Version (27.0) with installed simulator runtime versions. Xcode's
actual destination discovery accepts the dedicated 26.4.1 simulator.
[Upstream source](https://github.com/tauri-apps/cargo-mobile2/blob/dev/src/apple/target.rs)
was inspected in a read-only temporary checkout.

The runner compiles the same Rust library with `pi-prototype,tauri/custom-protocol`
and embedded frontend, then uses an ignored copy of the generated Xcode project
whose redundant Rust shell phase uses that completed library. Xcode retains its
compile/link/resources/signing and targets the actual dedicated simulator. No
Tauri, Pi, SDK or runtime was patched. This is a retained harness cost; it does not
claim stock CLI compatibility on this host.

An initial iOS startup failed the existing immediate-Documents-child vault policy.
The prototype now uses Documents/PROTOTYPE-wipe-me inside its own bundle container;
no policy bypass was added. WKWebView's compatibility UA says `iPhone OS 18_7`;
actual runtime identity comes from simctl/Xcode.

Initial real UI failures also found two adapter/driver issues: repeating every
pending-proposal event on every commit caused checkpoint churn, and a no-op
checkpoint acknowledged an unstored next version. The observer now emits newly
committed proposal IDs once and no-op returns the stored version. Review titles
were read-only in the existing view model; Pi-only builds permit editing. The
phone driver now switches between actual editor and chat controls instead of
requiring the desktop strip to stay mounted. Final desktop and simulator reruns
pass those paths.

## Reproduction and exact local artifacts

Use [README](README.md) and the single task-runner entry point. Desktop gate builds
its feature/identity before launching; simulator gate can build or reuse an
explicit `PI_PROTOTYPE_IOS_APP`.

- Final desktop: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-gate-2LiqS0/desktop-gate.json`.
- Simulator: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-gate-faMNdi/ios-gate.json`.
- Four faults: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-NiMdIS/fault-gate.json`.
- Simulator build: `/private/tmp/gneauxghts-pi-ios-review-build-2.log`.
- Desktop/simulator logs: `/private/tmp/gneauxghts-pi-desktop-ui-final.log`, `/private/tmp/gneauxghts-pi-ios-ui-2.log`.
- Fault log: `/private/tmp/gneauxghts-pi-faults-final.log`.

Selected reports/screenshots/check summaries are committed; raw synthetic request
bodies and disposable databases stay at those temporary roots. Generated Xcode
projects, runtime libraries, binaries and databases are not committed.

For a future authorized physical gate: build the same isolated bundle for the
explicit device with normal developer signing, repeat pending-review edits and
restart, then background/lock during native streaming and checkpointing, resume,
and test termination/relaunch. Capture device/runtime IDs, native receipt counts
and memory/network behavior. Use synthetic sources first and existing credentials
only when separately authorized. This experiment did not perform that gate.
