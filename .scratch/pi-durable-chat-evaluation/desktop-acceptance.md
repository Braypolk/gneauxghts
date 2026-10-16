# First usable desktop acceptance

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

Current checkpoint: 2026-10-16. **v51 whole iOS/history, five iOS faults and
desktop retry and final normal manual handoff passed; the final evidence index and
root bounded semantic acceptance exist. Archive reconciliation remains separate.
The outcome is narrow/continue isolated evaluation and deferred default adoption.**
Implementation/ticket status is tracked in [progress](progress.md) and the
[validation matrix](validation-matrix.md). Pure tests do not establish live-provider
success, and fixture/programmatic observations are not physical-device acceptance.

## Current source and acceptance checkpoint — v51, 2026-10-16

Frozen source commit `81f3bf7` is captured at
`/private/tmp/pi-removal-final-20261016-v51`, canonical manifest
`f81a1549fca48d8ed191168acf4e4f924761d2f007046d5c2284bce6fde89a57`:
1585 captured files,1533 retained files and **52 actual legacy-file absences**.
The [v48→v51 delta](/private/tmp/pi-removal-final-20261016-v51/v48-v51-source-delta.json)
is nine diagnostic packaging/probe/test paths, with no Rust or product-runtime
change. Whole frontend digest is now
`3262311db05903e4009d630beb8008405bc4e3119333422f466a9795d566bbe2`;
it differs from v48/v49 because the diagnostic probe is included. **Fresh final
desktop/history/iOS/manual artifacts are selected; no desktop equivalence reuse
is the final index.** Retained v48 observations below stay separately pinned.

| Actual v51 artifact | Recorded result / pin |
| --- | --- |
| [Desktop compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/desktop-build.json) | Compiled with three exclusion checks passed; `pi-prototype,e2e-wdio`; SHA `6d39bbdd56b7f8e2d35b79f60e16a2d7e9d0cc03107b712dc7588b07ac150858` |
| [iOS compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/ios-expanded-build.json) | Compiled; `pi-prototype,e2e-chat-fixture,tauri/custom-protocol`; SHA `b3c224070042409b995f29a763227da31c822a28912971125fcf7796e45fb135` |
| [Manual compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/manual-build.json) | Compiler receipt; `pi-prototype`; SHA `78154483e2ed80efbf573a35775d55d364e34785bf87fcdba3e98a1c9996a48c`; ordinary two-launch/quit/root-retention acceptance passed (manual receipt below) |

**Whole v51 iOS expanded gate passed**,178 synthetic requests:
[BTSO9O receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json).
First14 and relaunch10 shared checks passed, followed by parent/worker compaction,
research/fresh reads, attachments/exact Retry/web follow-ons, exact latest-draft
refinement/restart and both-protocol source-after-read races/active worker Stop/
clean new research (14 requests per protocol). Fresh **same-launch post-CONT UI**
observed ordinary authored-note bytes, exact review version10 and acknowledged
partial without replay; following durable relaunch also verified retained state.
An active native transaction was armed424ms before STOP, then held across about
14 seconds against the10-second lease TTL: stale COMMIT rejected `Revoked SQLite
owner`, zero rejected durable rows, stale owner revoked and fresh owner one row.
These are actual fresh observation/lease proofs, not the old static suspension
report. Controlled STOP/CONT remains distinct from actual OS pressure.
[Closed100-file backup](/private/tmp/pi-owned-simulator-v51-passed-whole-20261016/backup-receipt.json)
was retained and only the owned simulator app uninstalled.

**All five separate iOS crash/publication cases passed**,11 synthetic requests:
[yw2Vaa receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-publication-yw2Vaa/ios-publication-fault-gate.json).
The `after-intent`, `after-publication`, `after-receipt`, `prepared-review` and
`transport-completed` boundaries retain fresh launch/nonce/process ownership,
independently predicted exact drafts/canonical receipts and one-effect checks;
prepared outcomes and acknowledged partials restore without implicit replay,
then explicit Retry continues. These are bounded actual simulator fixture proofs,
not hosted/physical acceptance. The last case's
[closed45-file backup](/private/tmp/pi-owned-simulator-v51-passed-faults-20261016/backup-receipt.json)
was retained; root reports owned simulator shutdown exit0. Fresh post-CONT,
lease-spanning-STOP and these five boundaries now have actual v51 evidence; keep
their distinct protocol/fixture/platform limits. Final manual handoff is recorded below.

[Current v51 linked history](/private/tmp/pi-history-render-v51-20261016/history-render-revalidation.json)
passed on a copy of the closed generated v38 scale-v6 corpus. Exact1005
conversation identities/all2010 API and mounted DOM message IDs/content/order
matched before/after restart. Long-history ready observations were
**14023ms/13993ms**; obsolete rendering observed at192/2010 cancelled into an
empty conversation unchanged through200ms. Zero fixture/provider requests;
closed scoped counts identical (9053 current documents,1005 inputs/Meta), and
original corpus/receipts and tested source/artifact pins unchanged. This is current
restored-data/UI coverage, **not** new provider reseeding/compaction or comparative
resource measurement. DOM/timer checks do not prove physical paint/focus;
`frontendReceiptVerified:false`, recovered readiness retries and root closure
attestation requirements remain explicit.

**The initial v51 desktop whole attempt failed** at the first failure-slice CREATE before
admission, with the correct composer observed and cause unproven:
[xyySVL receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-xyySVL/desktop-interactive-gate.json),
[log](/private/tmp/pi-v51-desktop-supplement-native-20261016.log).
The serialized controlled identical-driver retry **passed**, exit0 and178
synthetic requests:
[O7czrc receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json),
[log](/private/tmp/pi-v51-desktop-observed-retry-native-20261016.log).
[Operational provenance](/private/tmp/pi-v51-desktop-observed-retry-20261016)
retains frozen driver imports, immutable executable and matching Vite cwd with
catch-only read observation; no product/input change or mechanistic repair is
claimed. The first xyySVL attempt (receipt above, `xyySVL`) stays **failed**:
an unexplained flake, cause unproved. The retry is its own actual whole pass,
not borrowed v48 or iOS evidence.

[v51 pure checks](/private/tmp/pi-v51-pure-checks-20261016.json) bind the capture:
fresh support38/Vitest1711 in201 files/frontend and types zero errors/warnings,
e2e TypeScript passed; Node204 reuses exact unchanged v49 inputs, Python90 exact
unchanged v41 inputs. The static receipt's `native-unrun` field describes its
recording time; later native receipts have their own status. Native compiler
input bytes, generated ACL deltas and required diagnostic packaging remain
separately recorded; no temporary runtime diagnostics or cost claim follows.

**Final normal manual handoff passed on the actual v51 bundle:**
[manual acceptance](/private/tmp/pi-v51-manual-acceptance-20261016.json) binds the
source manifest and manual executable above. Both normal launches restored exact
`pi-review-163`, “Pi final handoff scratch” / `PI FINAL HANDOFF READY`, with one
hunk and normal Keep enabled; normal Keep on launch2 published the exact Markdown
body. Both READY responses completed through normal UI, both Cmd-Q owner runners
exited0, and prior synthetic note/history survived without reset or recopy.
[Known synthetic canonical readback](/private/tmp/pi-v51-manual-synthetic-canonical-20261016.json)
retains the initially incorrect diagnostic whole-file/body assertion and its
corrected frontmatter-separated exact-body check; no product change followed.
This is local-model manual acceptance, not hosted acceptance or a new full
permission/Save/cancellation cross-product. The earlier
[v50 preparation](/private/tmp/pi-v50-manual-preparation-20261016.json) keeps its
own preparation scope.

[Root final native closure](/private/tmp/pi-v51-final-native-closure-20261016.json)
records `nativeClosed:true`, closed persistent/original apps, both manual owner
exits, free owned ports, owned simulator shutdown/uninstall with retained backups,
and identity-verified owned caffeinate cleanup. These are scoped root observations,
not independent OS-wide write tracing.

[Final evidence index](/private/tmp/pi-v51-final-evidence-index-20261016.json) now
exists and binds final source/builds, five selected proofs and retained failures.
Its `acceptanceVerdict:null` is intentional hash binding, not semantic acceptance.
[Root final semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json)
records `passed-bounded-evaluation-delivery`, all13 implementation tickets and
`boundedRequiredAcceptanceComplete:true`, with the decision narrow/continue
isolated evaluation and deferred default adoption. Archive reconciliation is
complete; the [archived outcome](../archive/pi-durable-chat-evaluation/outcome.md)
contains the 13 final ticket reconciliations outside the executable backlog.

**Recommendation: narrow/continue isolated evaluation; defer default adoption.**
Material bridge/storage regressions and remaining hosted/physical/measurement
limits support that bounded recommendation, not a performance win or net
maintenance reduction. Hosted live is user-deferred; physical device/radio/
distribution, real OS pressure, private disposal/collection and full IPC/process
memory remain unverified. Native/manual terminal evidence and root bounded semantic acceptance are complete
within these recorded scopes. Archive reconciliation is complete; the historical tickets and spec are outside
the executable backlog. Real user feedback remains separate; production default runtime/ADR0001 remain intact.

### Retained v48 desktop/history and default-smoke evidence

Actual v48 source commit`02d6111`, canonical
`c76d594904d38c5c9e206f6fcbb3fc32e2d719e09a1d58ab490655dfd6f4fcb2`
(1583 captured/1531 retained/52 absent), desktop
`a930ca9adeaf42097521b593cb89280a85c054d00c27795bc07af9ab7d6b3467`,
frontend`46006fd4223669dd229ee83ec2e9342b7c7128f34268152129fe57ab7d475fa0`:
[whole KCwTai](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-KCwTai/desktop-interactive-gate.json)
passed178 requests, exact normal refinement7→8→10/restored10/Keep canonical and
three after-read source races plus active worker Stop/clean new research under
both fixture protocols (eight checks,14 requests/protocol). Its
[linked history](/private/tmp/pi-history-render-v48-20261016/history-render-revalidation.json)
passed2010 before/after restart,13040/8592ms,96/2010→empty cancellation, zero
requests and unchanged corpus. These remain actual historical passes; the separate v51 desktop retry above
now has its own whole pass, preserving the initial failed attempt.

[Current-frontend default smoke](/private/tmp/pi-v48-current-frontend-default-smoke-20261016.json)
passed14 in4 specs with one preexisting optional cursor-paint skip. It served
v48/v49 frontend46006fd4…bbe2 using retained v38 default-native
`d308c7aa0986ec00ecbea9a0a7c07a3328910e3919b3e3688b8694e68c673761`;
no new default compilation or v51 whole-frontend equality is claimed. The
original v38 extra-LF failure remains failed/cause unresolved. The ordinary
deliverable still retains its default runtime; comparison-tree removals are not
production source deletions or demonstrated maintenance savings.

### Retained failures and original-vault observation

- [v48 iOS l8ZTxK](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-l8ZTxK/ios-interactive-gate.json) failed after first14 at CSP control `Load failed`, before suspension; [49-file closed backup](/private/tmp/pi-owned-simulator-v48-failed-suspension-20261016) retained. Its compiled executable `59f0b539ec78a4eaa98ff2255825e4ba8aa031a07c2c316766d0c92d927ed412` is not a successful iOS gate.
- [v49 iOS tDkt12](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-tDkt12/ios-interactive-gate.json) failed canonical-conflict setup at retained CodeMirror review lookup after actual fresh-CONT/lease partial proofs; [57-file closed backup](/private/tmp/pi-owned-simulator-v49-failed-review-20261016) retained. Partial proofs are not a whole pass.
- [v50 iOS y7PETc](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-y7PETc/ios-interactive-gate.json) failed later web Save presentation; [90-file closed backup](/private/tmp/pi-owned-simulator-v50-failed-web-save-20261016/backup-receipt.json) retained. Its partial checks are not a whole pass.
- [v47 failure/closure](/private/tmp/pi-v47-native-failure-and-history-closure-20261016.json) retains failed whole desktop and linked history stalled624/2010. Earlier guard/Retry/loading/foreground-requested failures remain failed; actual focus and cause are not inferred from later passes.

The [final opaque original-vault observation](/private/tmp/pi-original-vault-final-observation-20261016.json)
was made after the user closed the ordinary app:388 files, read-only hashing,
no SQLite connection/source mutation. SHA
`759e94ba60290d368e6edcb3b15a11d55fe2db32216a1538086acd7a9b9a105c`
differs from prior`66a085d2…1863`, cause unestablished. Record scoped evaluation
agent-write isolation by owned roots/actions; do not assert continuous/final
original byte equality or attribute the difference from this observation alone.

[Post-v51-manual original observation](/private/tmp/pi-original-post-v51-manual-20261016.json)
records388 files and aggregate `759e94ba60290d368e6edcb3b15a11d55fe2db32216a1538086acd7a9b9a105c`,
equal to the fresh pre-v50-manual baseline only across that bounded manual interval.
It opened no SQLite connection or mutated source. Historical-seal inequality and
its unestablished cause remain; this does not prove continuous original equality.

## Retained v38 functional/resource/scale evidence

Historical immutable source `/private/tmp/pi-removal-final-20261015-v38`, code HEAD `44d200d`:

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

Root owns all builds/apps/drivers/simulators/ports. Retained v38 execution accounting:
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

The retained v38 passed scope covers normal source-free/follow-up chat, conversation/
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

The original v38 overall desktop queue remains failed at default smoke: first three
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
Normal Cmd-Q exited 0; the original was unchanged at that observation. Legacy top-level manual
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
[Original seal](/private/tmp/pi-final-original-vault-seal-20261016.json)
recorded 388 files/SHA at its observation
`66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`.
Regular-file hashing includes opaque databases; it is not a live SQLite read or
proof about external app-data/directory metadata. The current final opaque
388-file observation differs with cause unestablished, as recorded above. No
continuous or final original-vault byte equality is claimed.

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

## Retained full product-scale v6 result

[Full v6 receipt](/private/tmp/pi-product-scale-20261015-v6/product-scale-gate.json)
passed the bounded compatible-loopback fixture, exit 0 at 08:17:40 UTC:
1005 conversations, 1005 inputs/2010 messages in one long conversation and 1004
empty, 1005 answers plus six actual summaries/1011 completed requests. Every
history position and Meta/message identity matched before/after restart; ten
archive/restores and zero implicit replay were verified. Closed current documents
stayed 9053; final process-closed file metadata totaled 64797047 bytes.
[Analysis](/private/tmp/pi-v38-scale-final-analysis-20261016.md) retains summary
ranges, request budgets, recovered readiness errors, 12232/11984ms aggregate list
and 14670/14681ms long mounted navigation observations, app-only RSS and all
unknowns. [Root closure](/private/tmp/pi-v38-scale-root-native-closure-20261016.json)
attests its serial native boundaries. This is a frozen v38 result, not current
v48 provider reseeding, collection/IPC/full-memory proof or full product parity.
The linked v48 history check at the current checkpoint tests the changed shared
render path without replacing or relabeling this full seed result.

## Material historical failures

Superseded chronology is recoverable from committed checkpoint
`a393836:.scratch/pi-durable-chat-evaluation/desktop-acceptance.md` and
`a393836:.scratch/pi-durable-chat-evaluation/progress.md`; raw receipts/backups
remain retained. Selected failed scopes are not relabeled by later passes:

- [v47 whole desktop/history failure and closure](/private/tmp/pi-v47-native-failure-and-history-closure-20261016.json): both failed; linked history remained at 624/2010 before deadline. Later v48 has independent whole/linked passes; earlier loading/guard/foreground-requested failures are not relabeled or causally explained.
- [v37 desktop qHtwIk](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-qHtwIk/desktop-interactive-gate.json): exact Origin anchor failed; v38 has its own whole pass.
- [v34 cE9fvy](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json): post-audio continuity exhausted three refresh invalidations; its exact writer was not identified. [v33 5W81zD](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json) failed standalone evidence validation. Diagnostic-only v35 passes are not clean final evidence; settled-preparation repair was tested before clean v38.
- [v32 WRrwST](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-WRrwST/ios-interactive-gate.json): follow-ons passed but closed publication verifier used desktop layout for iOS Documents; not a relocation/product publication failure.
- Earlier local-live [QUeIgd](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-QUeIgd/ios-live-gate.json), [sxZ0Sp](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-sxZ0Sp/ios-live-gate.json) and [kcG1jG](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-kcG1jG/ios-live-gate.json) whole failed citation lookup, detached-editor lookup and independently predicted Keep-version proof respectively; observed partial live steps were not whole passes.
- [v26 transcript xVPQ2S](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-xVPQ2S/ios-transcript-gate.json): driver assumed desktop restart on iOS; fixture-only ordered-close wrapper changed native diagnostic bytes, not production iOS restart semantics.
- [Resource v6](/private/tmp/pi-shared-resources-20261015-v6/shared-resource-gate.json) instrumentation returned zero journey IPC despite completed fixtures; unknown coverage was not a performance result. [Churn v5](/private/tmp/pi-resource-churn-20261015-v5/resource-churn-gate.json) counted explicit archive as read-only; strict separation corrected the harness. Their current replacements are independently pinned above.
- [Scale v3](/private/tmp/pi-product-scale-20261015-v3/product-scale-gate.json) failed transient SQLite SHM disappearance during scanning; [v5](/private/tmp/pi-product-scale-20261015-v5/product-scale-gate.json) failed the two-hour seed budget on historical v22: 782 completed answers + four summaries/786 requests, public progress776. No final seed/identity/archive/restart/closed proof; IPC unknown/app-only RSS/build-overlap limits retained. Neither is a 1005-history pass.
- The original default-smoke extra-LF failure remains unresolved despite unchanged continuations above; no confirmed product regression or mechanistic fix is inferred.

## Final bounded milestone evidence

Current v51 whole iOS, linked history, all five iOS crash/publication boundaries
and serialized whole desktop retry passed on their actual pinned artifacts.
The initial desktop CREATE attempt remains failed, cause unproved; a later pass
does not erase it. Fresh post-CONT ordinary note/exact review/partial and active
lease-spanning-STOP rejection are actual simulator evidence, not OS-pressure proof.

Final manual acceptance now records both exact retained-review launches, normal
Keep/canonical exact Markdown, completed READY/follow-up responses and both normal
Cmd-Q exits0. Root native closure is recorded above. Earlier v50 preparation and
v48/v38 resource/default/scale scopes keep their own pins. The final index and root
bounded semantic acceptance exist; archive reconciliation is complete.

Recommend narrow/continue isolated evaluation and defer default adoption due to
material bridge/storage costs and remaining limits. Hosted live is user-deferred;
physical device/radio/distribution/real OS-pressure, standalone Settings vault
move, private disposal/retirement/GC and full IPC/process-memory remain unverified.
No adoption, overall performance win or net maintenance reduction is claimed.
This document does not itself assert archive creation or goal completion. User feedback is separate, not a new completion
dependency. Original-vault equality is established only for the fresh bounded
manual interval; historical/continuous equality is not established.
