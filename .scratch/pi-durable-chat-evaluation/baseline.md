# Interactive Pi evaluation: owner and measurement baseline

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

Recorded 2026-10-15 at source revision
`4b5ff2de500db089787b3d7adefb40d99f13a574`, before ticket 02 replacement work.
This is a reproducible comparison protocol and artifact preflight. **Equivalent
old/Pi resource measurements have not yet been captured.** No performance win,
live-provider acceptance or legacy-runtime removal is established by this record.
Use with [ticket 01](../archive/pi-durable-chat-evaluation/issues/01-persistent-isolated-evaluation-app.md) and
[ticket 13](../archive/pi-durable-chat-evaluation/issues/13-replacement-proof-and-evaluation-verdict.md).

## Existing ownership and deletion baseline

The accepted default architecture remains [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md).
The authorized isolated Pi alternative intentionally contradicts its durable
lifecycle choice. It retains the behavior invariants and the canonical
NoteTimeline boundary from ADRs 0002, 0009 and 0011.

| Concern | Default owner | Existing Pi prototype disposition at baseline |
| --- | --- | --- |
| Request acceptance and durable conversations/messages/runs/context | `ChatService`, `chat/admission.rs`, `chat/store.rs` | Pi Harness/SqliteStorage submission and entry records; app presentation/evidence documents |
| Model/tool loop and cancellation | `AgentRunCoordinator`, `AgentRuntime`, `chat/runtime.rs` | Pi tasks; `pi_prototype_transport.rs` performs one HTTP inference per dispatch |
| Pending review/checkpoint/decision | `chat/note_proposals.rs` | App-defined Pi Review documents/tasks and origin/version policy |
| Live editable body/title/hunks, checkpoint-before-switch, adoption | Retained document runtime and proposal review workflow | Retained and used |
| Scope/grants/exclusions, evidence freshness, final source admission | App domain services and citation/structured-answer code | Retained through native adapters; not provided automatically by Pi |
| Canonical Markdown/history publication | `NoteTimeline` | Retained; added native effect intent/receipt adapter reconciles across SQLite/file boundaries |
| Settings/credentials/composer drafts | Native services including `ChatService` domain methods | Retained; native transport/settings still reach `ChatService` |
| Managed transcript publication/import/relocation | `chat/projection.rs`, `recovery.rs`, `relocation.rs` | Missing from prior Pi slice; an omission, not removed machinery |

Literal production removals in the prior experiment: **zero modules, zero
functions**. Bypassing a call path or observing zero generic chat rows does not
prove exclusion. Current `src-tauri/src/lib.rs` still constructs `ChatService`;
native Pi settings/access/publication adapters reference it. Ticket 02 must
establish the retained domain seam and compiler exclusion independently.

The prior [results](../pi-durable-prototype/results.md),
[validation](../pi-durable-prototype/validation.md) and
[owner baseline](../pi-durable-prototype/baseline.md) remain historical slice
evidence at checkpoint `833c933`, baseline `c9d949f`. Their synthetic desktop/iOS
passes and zero shadow rows do not provide comparable latency, memory, listener,
storage-growth or deletion measurements for this phase. Pi Durable/AI/Chord are
each pinned at 1.3.0; no upstream patch is part of this baseline.

## Artifact/environment preflight

Read-only inspection found these local artifacts; no application was launched,
driven, built, stopped or sent an inference request by this baseline work.

| Artifact | Observed digest/identity | Qualification |
| --- | --- | --- |
| Old pinned `src-tauri/target/e2e/debug/gneauxghts` | SHA-256 `8a423c5bff0777cb89994d9871c58d29ed68e18fdcfb887160fe25af5d3327f9` | Matches adjacent `gneauxghts.build.json`, profile `debug`, features `e2e-wdio`; build source revision and served frontend digest unknown |
| Existing `src-tauri/target/debug/gneauxghts` | SHA-256 `8f5c79ba90af825e2562d5e09bd802e15545a50043952dd848b1aed2a8842c15` | Mutable Cargo output; no adjacent manifest proving Pi feature, build revision or frontend bytes; do not treat as a pinned comparison build |
| Current source | `4b5ff2de500db089787b3d7adefb40d99f13a574` plus concurrent dirty/untracked work | Source HEAD is not proof of either binary's build revision |
| Lockfile | SHA-256 `f52f1055ba3be66f0bfaca128e9bb99b42a9e29e64b54fe261e1c1bb76b01094` | Current file, not retrospective build provenance |
| Host | arm64, macOS 26.6.2 (25G83), Darwin 25.6.0; Node v24.2.0; Python 3.13.5 | Current read-only host inspection; Xcode/iOS environment must be recorded again for native gates |

An already-running disposable Pi process (PID 64377, root
`/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-zar0v3`)
was identified by the orchestrator. It was not manipulated or sampled here. Any
later sample from that process is historical/warm; it cannot become cold-startup
evidence. Original vault, ordinary app and ordinary credentials were untouched.

Current metric status for **both equivalent comparison lanes**:

| Metric | Old | Pi |
| --- | --- | --- |
| Cold/warm workspace startup | unknown | unknown |
| Send to rendered first output; committed completion | unknown | unknown |
| Provider transport interval; outside-provider elapsed; post-provider completion | unknown | unknown |
| Stop to settled durable cancellation | unknown | unknown |
| Total/SQLite IPC calls and request/response payload bytes | unknown | unknown |
| Process/renderer RSS and sampled peak | unknown | unknown |
| Retained storage growth; DB row/document/family/retention counters | unknown | unknown |
| Active listeners/watchers after repeated open/switch/close | unknown | unknown |

Empty generated `old/data` and `pi/data` directories currently contain zero
files/bytes. That is fixture preparation, **not app storage or retention evidence**.

## Reproducible generated fixtures and offline capture

New isolated helper:
[`measurement-report.py`](../../scripts/pi-prototype/measurement-report.py).
It builds/launches/drives/kills nothing and calls no provider. It can:

- Generate sealed, identical old/Pi authored-note and short/long conversation
  fixture specifications. The long case has **1,005 submissions / 2,010 messages**,
  exceeding the current `scanSubmissions(..., 1000, ...)` limit. Add a distinct
  1,005-conversation list case when ticket 13 tests the conversation scan cap.
- Snapshot exact binary SHA-256, source HEAD/tracked-diff digest, untracked
  inventory digest/count, helper/lockfile/environment digests and optional frontend
  tree digest. `buildRevisionVerified` remains false: independent build receipts
  must bind the binary to its source, feature list, configuration and frontend.
- Count logical file sizes grouped as SQLite, WAL, SHM, Markdown and other without
  reading file contents or emitting file names. Symlinks/special files are refused.
  Counts are non-atomic snapshots; allocated disk bytes and database rows remain
  unknown. Use stopped/checkpointed snapshots for comparable retained storage.
- Generate a closed counter-only journey template and summarize monotonic timing,
  provider interval union, IPC coverage, sampled process RSS, storage growth and
  numeric listener/document/collection counters. Unknown stays JSON `null` and is
  listed in `unknownMetrics`; incomplete provider capture cannot imply overhead.

Fixtures contain generated prose only. They **do not seed native history** or
invent Note Identities/Revisions. Seed note bytes using the retained note APIs and
conversation turns through each owner's admitted APIs in separate disposable
roots. Verify all 1,005 submissions and early/middle/late navigation before
calling the long case populated. Never transplant a private copied vault into
committable evidence or fill an engine DB directly with invented records.

Run these offline commands from the repository, choosing a fresh canonical
`/private/tmp` root every time. Neither snapshots nor summaries overwrite an
existing output. Replace artifact paths with verified pinned comparison builds.

```sh
python3 -B scripts/pi-prototype/measurement-report.py fixtures \
  --root /private/tmp/gneauxghts-pi-comparison-001

python3 -B scripts/pi-prototype/measurement-report.py snapshot \
  --binary src-tauri/target/e2e/debug/gneauxghts \
  --data-root /private/tmp/gneauxghts-pi-comparison-001/old/data \
  --output /private/tmp/gneauxghts-pi-comparison-001/old/before.json

python3 -B scripts/pi-prototype/measurement-report.py template \
  --lane old --case short --protocol compatible --cache cold-process \
  --provider fixture --profile debug \
  --fixture-root /private/tmp/gneauxghts-pi-comparison-001 \
  --snapshot /private/tmp/gneauxghts-pi-comparison-001/old/before.json \
  --output /private/tmp/gneauxghts-pi-comparison-001/old/short-input.json

python3 -B scripts/pi-prototype/measurement-report.py summarize \
  --input /private/tmp/gneauxghts-pi-comparison-001/old/short-input.json \
  --output /private/tmp/gneauxghts-pi-comparison-001/old/short-summary.json

python3 -B scripts/pi-prototype/measurement-report.test.py
```

An untouched template has no observations; its summary is entirely unknown.
Populate `events` from the owned native harness, then repeat with `--lane pi`, its
verified binary/root, both protocols and the short/long/cancel/startup cases.
For bundled runs add `--frontend /absolute/built/frontend` to the snapshot. For
Vite-served runs preserve the exact served source/config/dependency state and
server-start command; a digest of a different static build is not equivalent.

Actual offline preflight artifacts are in
`/private/tmp/gneauxghts-pi-measurement-baseline-20261015-v2/` (generated fixtures,
old/Pi `snapshot-before.json`). Fixture seal:
`59f2b8baee2005531f0083048a9563639006803edc13392d7dd0f6275d5a5a26`.
These private local artifacts are preparation only. Pure helper tests: **8 pass**;
CLI fixture/snapshot/template/summarize smoke and `git diff --check` pass. No native
gate or provider request is included in that validation claim.

## Native observer contract and exact remaining validation

One JSON journey contains one clock domain and one launch/send/cancel boundary
per kind. Event `atMs` values are finite monotonic offsets in chronological order.
Use one harness clock, or explicitly calibrate renderer observations to it; do not
mix `Date.now()`, renderer `performance.now()` and process uptime. A counter-only
example, with illustrative numbers **not measurement evidence**, is:

```json
{"kind":"ipc","atMs":12,"category":"sqlite","requestBytes":60,"responseBytes":20}
```

Allowed boundaries: `launch`, `workspace_visible`, `send`, `first_visible`,
`terminal`, `cancel_request`, `cancel_settled`. Provider interval events are
`provider_start`/`provider_end` with numeric `dispatch`; counter events are `rss`
or `storage` with `bytes`, and `listeners`, `documents`, `document_families`,
`retired_documents`, `collected_documents`, `retained_messages` with `count`.
IPC categories are `sqlite`, `provider`, `domain`, `other`. No command names, SQL,
arguments, note paths, model text, credentials, errors or raw SSE bodies are
accepted in the counter format. Byte counts are UTF-8 serialized payload sizes;
transport envelopes/channel frames must be measured separately or marked absent.

| Observation | Required native measurement |
| --- | --- |
| Startup | Start immediately before spawning the already-built isolated app; stop after the real workspace/chat is usable and two renderer animation frames. Record process-cold versus same-process warm explicitly; do not label warmed OS/provider caches cold. Never include build/Vite setup time. |
| First visible | Start at composer send. Observe the first admitted user-visible answer text through the real mounted chat after two frames. Exclude placeholders, spinner/activity, raw SSE, reasoning and provisional formatter JSON. Polling alone measures observation delay, not paint. |
| Completion | Observe durable terminal receipt and displayed terminal answer. Record send-to-terminal, union of complete provider intervals, outside-provider elapsed and last provider-end to terminal separately. HTTP intervals include queue/network/server time, not pure inference. Outside-provider time includes bridge, tools, storage and observation, not exclusively Pi overhead. |
| Cancellation | Start at Stop; end after caller-visible cancellation and durable owner terminal settlement. A cancellation IPC acknowledgement alone is insufficient. Confirm transport ends and no late answer/publication or implicit replay on restart. |
| IPC | Attach at the shared Tauri invoke boundary before the measured interval. Count every invoke, classify `pi_sql` separately, and count request/result UTF-8 payload bytes without retaining payloads. Record asynchronous native stream frame/chunk bytes independently; current `nativeTransportStats` counters are cumulative, so take deltas. Old in-process SQL has zero *cross-IPC SQL* only when complete IPC coverage establishes that fact; internal SQL work remains a separate unmeasured cost. |
| RSS | Sample the exact owned native PID and renderer subprocesses at fixed intervals while idle and during each case. Pin PID/start identity; retain numeric counters only. Parent process RSS alone omits WKWebView/helper memory. Sampled maximum is not OS lifetime peak or physical footprint. |
| Storage/retention | Snapshot equivalent roots before seeding, after short/long turns, after cancellation/restart and after the same explicit retention/collection operation. Include DB+WAL+SHM, note/history/assets and derived transcripts. Record checkpoint/close state; do not checkpoint one lane alone. Count live/retired document families and all admitted records via bounded native/SQLite counter probes without reading or retaining content. |
| Listeners and scale | Repeat conversation open/switch/close/restart under identical counts, measure watcher/listener/document growth, verify no silent pagination truncation, and separate retained history from provider context. The current 1,000-item scans and retained `watched` set in `chatApi.ts` are profiling/acceptance targets, not demonstrated leaks. |

Use the same fixture bytes, semantic-search mode, provider protocol/model/reasoning,
output length, features, build profile, foreground/window state and sampling cadence
for each lane. Build and pin separately before measurement; serialize native Cargo
and Xcode work. Run paired alternating old/Pi order, at least three repetitions
per process/cache/protocol/size case, and retain individual observations with
median/range. Warm-up observations are labelled and excluded from cold comparisons.
Do not derive tail-latency claims or invent a performance threshold from that sample.

The existing `e2e/specs/native/request-latency.spec.ts` and
`e2e/support/latency/{proxy.py,analyze.py}` are relevant old-lane starting points.
The native test polls once per second, includes WebDriver transport, writes answer
artifacts, and only captures old compatible-provider requests. Its proxy is
local-compatible HTTP and parses that protocol's counters; it does not establish
Responses timing, rendered first output or complete IPC. Reuse it only in generated
fixtures, keep its raw artifacts local, and adapt both lanes to the same counter
contract. Do not relabel historical warm measurements from
[latency-probe](../chat-reliability/latency-probe/README.md) as this comparison.

Still required before claiming the issue 01 resource baseline complete: verified
old/Pi build receipts with frontend/config hashes; a native observer attached to
both paths; generated note/history seeding through app-owned APIs; actual paired
short/startup/cancel captures; complete SQLite IPC/frame accounting; process and
renderer RSS; equivalent retained-storage snapshots. The long/listener/collection,
live-provider and final exclusion/removal comparisons must then be repeated for
ticket 13. No build/launch/provider permission or exclusive native process
ownership is implied by the offline helper commands.
