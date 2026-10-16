# First usable desktop acceptance

Current checkpoint: 2026-10-16. **Bounded v38 functional acceptance passed;
full scale, final persistent handoff and evaluation verdict remain open.**
Implementation/ticket status is tracked in [progress](progress.md) and the
[validation matrix](validation-matrix.md). Pure tests do not establish live-provider
success, and fixture/programmatic observations are not physical-device acceptance.

## Current checkpoint — 2026-10-16

Immutable source `/private/tmp/pi-removal-final-20261015-v38`, code HEAD `44d200d`:

| Pin | SHA-256 |
| --- | --- |
| Canonical source manifest | `14ceb2312d90d66f870cc273a4e6372e7c7f6403b88fc4a109eb5d7013100728` |
| Removed-tree desktop executable | `c9f08ac067cf58c671da4ae62c6728d69d37048cfb63e749fea7b07f32272c1e` |
| Served frontend | `23e74527ceaac2692a194c3d6e46e6464fc109b96b764628be74fdcc71ffcb88` |
| iOS expanded executable | `2f81cf8609cce773c27bf141698a03445085efd257788f349dd416c28d760469` |
| iOS transcript executable | `7a00ea09d2afbd055d259a12bd21b928e7e6aa464ea68f8ae2b597dee498be3c` |
| iOS local-live executable | `d110c6a16dae11226ba5205b8db559d7b4fdbb17a284dbea50d9e1eea7f7e747` |

Temporary diagnostics are absent; settled-preparation repair remains. The
comparison tree physically excludes 52 legacy files; the ordinary deliverable
retains its default runtime. [Ledger](replacement-ledger.md) distinguishes actual
removal, retained owners, new obligations and inventory limits.

[Post-fix static checks](/private/tmp/pi-origin-fixed-static-checks-20261016.json)
match the frontend digest and six changed-input hashes: support 38, Vitest 1631
in 192 files, Node 166, Svelte zero errors/warnings, e2e TypeScript passed.
[Full Rust](/private/tmp/pi-final-full-rust-receipt-20261016.json) is explicitly
reused, not rerun: Pi 754 passed/20 ignored, default 944 passed/32 ignored; each
21 architecture/three exclusion/one runtime checks passed. The
[v37→v38 diff](/private/tmp/pi-removal-final-20261015-v38/v37-v38-source-diff.json)
is six frontend/driver files/no native changes. Python 89 retains unchanged-input
binding to the [prior static receipt](/private/tmp/pi-final-static-checks-20261016.json).

## Commands and receipts

Root owns all builds/apps/drivers/simulators/ports. Current execution accounting:
[desktop queue](/private/tmp/pi-final-desktop-queue-v38-20261015.json),
[iOS queue](/private/tmp/pi-final-ios-queue-v38-20261015.json),
[root pre-resource closure attestation](/private/tmp/pi-v38-native-closure-owner-attestation.json).
The attestation binds closed native builders/apps/drivers, absent owned ports and
simulator shutdown before paired resources; a queue exit alone is not that proof.

| Actual v38 receipt | Bounded result |
| --- | --- |
| [Desktop expanded I0gmUQ](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-I0gmUQ/desktop-interactive-gate.json) | Whole passed, 143 synthetic requests; normal UI, exact independent publication/read-back/origin, failures, storage and follow-ons. |
| [Publication faults 4C3GQB](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-4C3GQB/fault-gate.json) | Four cases passed, eight requests; one-effect/canonical/NoteTimeline proofs. |
| [Native crashes EtcRrX](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-EtcRrX/native-crash-gate.json) | Four cases passed, ten requests; no real disk-exhaustion/OS-pressure inference. |
| [Desktop transcript m0NmD4](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-m0NmD4/native-transcript-gate.json) | Whole passed, four checks/six requests; watcher/Convert/Restore, generated-root mapping, exact pending conflict/recovery and duplicate one-effect proof. |
| [Compatible paired subset](/private/tmp/pi-paired-parity-final-v38-20261015-compatible/paired-parity-gate.json) / [Responses paired subset](/private/tmp/pi-paired-parity-final-v38-20261015-responses/paired-parity-gate.json) | Both passed prepared evidence/grantAPI/body review/Save/selection append/closed duplicates; not full parity. |
| [Owned churn v7](/private/tmp/pi-resource-churn-20261015-v7/resource-churn-gate.json) | Bounded owned-resource pass; read-only operations unchanged, explicit archive/revision work accounted separately. Private disposal/physical collection unknown. |
| [iOS expanded qxKi7t](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-qxKi7t/ios-interactive-gate.json) | Whole passed, 143 requests: first 14, relaunch 10 including four failures, 25 follow-ons and closed registered-vault publication proof. |
| [iOS transcript DxtdzR](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-DxtdzR/ios-transcript-gate.json) | Whole synthetic pass, six requests; actual sandbox relocation, stable owner/vault, exact pending review/conflict/recovery/source/Origin and ordered portable close. |
| [iOS local-live 7ETlYP](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-7ETlYP/ios-live-gate.json) | Bounded whole pass: two normal Sends, four real inference POSTs/16 total requests including metadata, no replay; exact citation/Save/review/Keep/duplicate/pending and committed restart proofs. |

Old paired baseline is source `4b5ff2de`, executable
`d5e3a76aed10c9441dc76e4d9d768d497a209a8be06434ce4d3ab254bbb60bc0`.
Readonly-title/stale-Keep capability differences remain explicit; grantAPI checks
are not permission-dialog parity. Paired/resource `frontendReceiptVerified:false`
remains a provenance limit despite independent Pi compiler/source pins. iOS uses
programmatic WKWebView controls; local-live uses the configured real endpoint,
while hosted-style fixture requests do not establish hosted live acceptance.
Closed iOS backups are recorded in the queue; only the owned bundle was uninstalled.

To repeat the normal-workspace synthetic base/failure gates under the root lease:

```sh
env -u PI_PROTOTYPE_DATA pnpm pi:prototype interactive-gate
env -u PI_PROTOTYPE_DATA PI_PROTOTYPE_INTERACTIVE_FAILURES=true pnpm pi:prototype interactive-gate
```

The gate builds `pi-prototype,e2e-wdio`, opens `/`, allocates a fresh generated
root and refuses inherited `PI_PROTOTYPE_DATA`/occupied fixture/dev/driver ports.
Native fixture flags and the `piInteractiveTest` query enable the driver; normal
installed/copied-vault use cannot seed it. A failure retains its root, receipt,
screenshots and bounded visible error. Do not commit copied-user data/live requests.
See [README diagnostics](README.md#diagnostics-and-repeatable-checks) for other
entries and [proof plan](replacement-proof-plan.md) for pinned comparison setup.

## Prepared fixture matrix

The current passed scope covers normal source-free/follow-up chat, conversation/
model selection, current/retained/selected citations, discovery/Deny/Allow once,
Stop/Retry, acknowledged editable proposals, checkpoint failure, stale-source
refusal, target conflicts, dirty ordinary buffers, Keep/Discard/duplicates,
whole-answer Save, exact Origin navigation, research/parent and worker summaries,
fresh reads, attachments and fixture web routing. The
[13-ticket matrix](validation-matrix.md#ticket-coverage) maps each feature to receipts.

Synthetic fixture setup creates fresh Pi conversations through the public Pi API
and notes through `save_note`/`finalize_note_editing_window`/NoteTimeline, never
generic native chat tables. Normal split keeps the selected editor mounted.
Most journeys use existing chat/workspace/CodeMirror controls. Selection append
uses explicit public Save destination/occurrence inputs because UI does not collect
a destination/heading; review/Keep still use the ordinary editor. This is a recorded
scope difference. Transport counters prove no inference around deterministic Save/
Keep/duplicate/append; unrelated API counters are not complete wire coverage.

## Ordinary default smoke

The original overall desktop queue remains failed at default smoke: first three
specs passed 2+2+1; chat-to-note passed eight/failed one at its initial edited-review
input wait. The intended multiline edit contained one extra trailing LF; mechanism
is unresolved. **Unchanged focused one-test rerun passed** (session19792), then
**unchanged full 14-test/four-spec smoke passed** (session2532), both closed.
[Continuation receipt](/private/tmp/pi-v38-default-continuation-20261016.json)
retains original queue/log hashes and default executable
`d308c7aa0986ec00ecbea9a0a7c07a3328910e3919b3e3688b8694e68c673761`.
No product/test/trim change or mechanistic fix is claimed; the first failure remains.
Root verified apps/builders/drivers closed, absent ports and simulator shutdown
after both continuations, before scale.

## Persistent live local observations

[Manual receipt](/private/tmp/pi-persistent-live-20261015/manual-live.json), nested
`updatedBundleV2`/`liveDiscoveryPermission`, records the bounded local pass on
product `c74a53e`/probe `2a11f83`, bundle
`9328ff2f9fcffdc194ee20631615ff80aecb9adaf5f2ae0846c7eda3526f57b2`.
This is its own pin, not the v38 fixture build. The separate `pi-prototype`-only
installed app used 209 copied files, fresh settings and the configured local model.
Normal source-free/follow-up, admitted current-note citation/navigation, editable
mutation, faithful Save/origin and two-launch model/history/pending-review retention
were observed. Human approval resolved the initial automatic Keep rejection;
both approved normal Keeps completed. Short Stop→separate Retry completed READY;
the earlier long-count Retry was stopped after bounded waiting, not completed.
Fresh Approved-only discovery→Deny disclosed no unread source; subsequent Allow
once admitted the exact synthetic note/read/citation. Full-vault access was restored.
Normal Cmd-Q exited 0; the original remained unchanged. Legacy top-level manual
`status:in-progress` does not override completed nested observations or imply full
acceptance. These are agent observations, not user trial feedback.

The user explicitly requested local-only use; hosted live is deferred and no
hosted credential request remains pending. For normal repeated use:

```sh
env -u PI_PROTOTYPE_DATA pnpm pi:prototype installed
```

Use the [hands-on checklist](README.md#repeat-the-normal-hands-on-check),
[setup/launch instructions](README.md#setup-and-launch) and
[copy/recovery safety contract](README.md#copy-and-failure-contract).
Reuse the existing root; do not setup/reset it merely to relaunch. Final updated
persistent normal-app handoff remains open; compiled later bundles do not inherit
this earlier live pass. Root's [manual close receipt](/private/tmp/pi-final-manual-close-before-resources-v22-20261015.json)
records normal quit before resource work, retained copied data and no inference.
[Final original seal](/private/tmp/pi-final-original-vault-seal-20261016.json)
remains exact 388 files/SHA
`66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`.
Regular-file hashing includes opaque databases; it is not a live SQLite read or
proof about external app-data/directory metadata.

## Resource observations

Three closed foreground debug pairs passed, Pi/old → old/Pi → Pi/old, four
compatible fixture requests/lane/run (24 total), eight committed messages/no
replay/clean close each. Completed outputs were exact 24/27/9215 bytes (long output
256 lines). Cancelled content differs: old zero/Pi 28 bytes, so not exact equality.
[JSON summary](/private/tmp/pi-v38-controlled-resource-summary-20261016.json) and
[median/range tables](/private/tmp/pi-v38-controlled-resource-summary-20261016.md)
retain all three raw receipts, hashes, per-journey/category metrics and provider
intervals. No native build/app/CUA overlap during capture; later default work is separate.

| Median observation | Old | Pi |
| --- | ---: | ---: |
| Initial launch→workspace, ms | 1699.5 | 1417.6 |
| Short/follow-up/long first visible, ms | 226 / 175 / 213 | 305 / 242 / 259 |
| Stop request→settled, ms | 67 | 84 |
| Sampled app-PID RSS peak, bytes | 235110400 | 206159872 |
| Provider request bodies/lane, bytes | 97687 | 41604 |
| Warm module calls | 26 | 1085 |
| Request JSON proxy bytes | 2187 | 321954 |
| Known response JSON proxy bytes | 119536 | 1778331 |
| Unknown response sizes/run | 0 | 1 |
| Closed logical storage/lane, bytes | 684378 | 2059929 |

**Material bridge/storage regressions remain:** 41.7× warm calls, 3.01× storage
(+1375551 bytes), including Pi WAL1351392/SHM32768 bytes versus old zero.
Checkpoint/allocation unknown; this is not irreducible physical steady state.
Pi median first-visible and Stop intervals were higher; lower startup/app-only RSS
is not an overall performance win. OS caches are uncontrolled, debug/polling
(50ms+two frames; startup100ms) and observer traffic affect measurements. Module
IPC excludes bootstrap/direct injection; JSON proxies are not wire bytes; one null
Pi response prevents complete response totals. Provider timing is partial; sampled
RSS excludes helpers/renderers/other processes. Zero provider-category module calls
is not zero transport. No causal attribution, scale/live/Responses/review/Save
resource equivalence, savings or adoption claim. [Source cost audit](scale-cost-audit.md)
records mechanisms, not measured attribution or implemented optimization.

## Material historical failures

Superseded chronology is recoverable from committed checkpoint
`a393836:.scratch/pi-durable-chat-evaluation/desktop-acceptance.md` and
`a393836:.scratch/pi-durable-chat-evaluation/progress.md`; raw receipts/backups
remain retained. Selected failed scopes are not relabeled by later passes:

- [v37 desktop qHtwIk](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-qHtwIk/desktop-interactive-gate.json): exact Origin anchor failed; v38 has its own whole pass.
- [v34 cE9fvy](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json): post-audio continuity exhausted three refresh invalidations; its exact writer was not identified. [v33 5W81zD](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json) failed standalone evidence validation. Diagnostic-only v35 passes are not clean final evidence; settled-preparation repair was tested before clean v38.
- [v32 WRrwST](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-WRrwST/ios-interactive-gate.json): follow-ons passed but closed publication verifier used desktop layout for iOS Documents; not a relocation/product publication failure.
- Earlier local-live [QUeIgd](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-QUeIgd/ios-live-gate.json), [sxZ0Sp](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-sxZ0Sp/ios-live-gate.json) and [kcG1jG](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-kcG1jG/ios-live-gate.json) whole failed citation lookup, detached-editor lookup and independently predicted Keep-version proof respectively; observed partial live steps were not whole passes.
- [v26 transcript xVPQ2S](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-xVPQ2S/ios-transcript-gate.json): driver assumed desktop restart on iOS; fixture-only ordered-close wrapper changed native diagnostic bytes, not production iOS restart semantics.
- [Resource v6](/private/tmp/pi-shared-resources-20261015-v6/shared-resource-gate.json) instrumentation returned zero journey IPC despite completed fixtures; unknown coverage was not a performance result. [Churn v5](/private/tmp/pi-resource-churn-20261015-v5/resource-churn-gate.json) counted explicit archive as read-only; strict separation corrected the harness. Their current replacements are independently pinned above.
- [Scale v3](/private/tmp/pi-product-scale-20261015-v3/product-scale-gate.json) failed transient SQLite SHM disappearance during scanning; [v5](/private/tmp/pi-product-scale-20261015-v5/product-scale-gate.json) failed the two-hour seed budget on historical v22: 782 completed answers + four summaries/786 requests, public progress776. No final seed/identity/archive/restart/closed proof; IPC unknown/app-only RSS/build-overlap limits retained. Neither is a 1005-history pass.
- The original default-smoke extra-LF failure remains unresolved despite unchanged continuations above; no confirmed product regression or mechanistic fix is inferred.

## Remaining milestone evidence

Full scale v6 is **RUNNING**, session66327, started 07:19 UTC in fresh
`/private/tmp/pi-product-scale-20261015-v6`, without overlapping native work.
Keep unchanged 1005-answer/≤1100-total/two-hour budgets and require actual summary,
identity/history/archive/restart/final closed proof; progress is not acceptance.
Final persistent handoff/relaunch/seal and evidence/verdict reconciliation remain
open. Hosted live is user-deferred; physical touch/device/OS-pressure, standalone
Settings vault move and private disposal/retirement/GC counts remain unverified.
Artificial STOP/CONT is not OS suspension; fresh post-CONT UI proof remains false,
following durable relaunch proof true. Branching/import/physical-device acceptance
and production adoption remain deferred. No final verdict, ticket resolution,
archive, goal closure, performance win or savings claim.
