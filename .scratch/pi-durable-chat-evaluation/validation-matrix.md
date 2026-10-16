# Current Pi evaluation validation matrix

2026-10-16. Implementation is integrated; ticket acceptance remains open at the
boundaries below. This matrix summarizes actual evidence, not a final verdict or
goal closure. See [spec](spec.md), [hands-on instructions](README.md),
[detailed native records](desktop-acceptance.md) and [progress](progress.md).

## Current source and validation

Product/native source is frozen at `b52b1a6`; mobile diagnostic correction
`43e24dd` is captured as **v23**, canonical manifest
`3fa0bab74e705b9d439f556b2bcd8fcd28cccd18d2f1c94a8eaaf1796a6aba95`, at
`/private/tmp/pi-removal-final-20261015-v23`. Desktop compilation/exclusion tests
and all three iOS builds completed; their pins below establish compiler results,
not completed native journeys. Each iOS source copy verified 1499 retained
files and 52 legacy absences. `v22-v23-source-diff.json` proves that only eight
probe/helper/test files changed and two were added; all captured native and other
product files remain byte-identical. This correction passed 53 focused/affected
checks, zero-error/warning types and independent Spec/correctness review.
Subsequent live-only diagnostic builds v24/v25 completed; neither actual live run
passed as a whole. v25 canonical manifest is
`d5436fb086ad42948abbd8af4364763a13f55ab404f5eee93db760862df84664`.
Latest diagnostic source capture **v26** is
`92782d6d42e182791d1138b8c3dfcc0e96d9d5d5bc36b82c9a9b3895b25ce35c`;
actual local iOS live **ZlW6lU passed**, under the exact v26 live artifact below.
All three v26 iOS variants compiled; actual transcript **xVPQ2S whole failed**,
and v26 expanded never ran. Corrected shared interactive execution remains pending.
Product lifecycle semantics remain frozen at `b52b1a6`; the next capture will
explicitly change native fixture wrapper/registration bytes for close preparation.
Current `a1a4509`
diagnostic driver also supports owned iOS fixture port 1446 (six pure helper
tests); this is functional parallelism, not product change or native acceptance.

Product scale v5 remains pinned to v22 (canonical
`3b3c6cfb273de778f6f859d4074332993ca36b771496d3d5578ab6645973c8a5`), whose desktop
compiled and passed three exclusion checks, binary SHA
`e6cfcd12d2a042d21bd8df2f9bc8f357a587e6c9b272c2aa93a06d05877d7635`.
The v22 local-iOS **UGhOtn** run failed before inference on the compact title
portal; two real model GETs succeeded and zero inference POSTs occurred. The app
is terminated and data/receipt preserved. The corrected v23 local-iOS **QUeIgd**
run subsequently completed three real inference POSTs (HTTP 200), source-free
continuity and an actual admitted note read, but **whole failed** at the normal
source citation deadline. The diagnostic searched a collapsed EvidenceSource
button rather than actual ChatMarkdown `button[data-chat-note-citation-id]`.
QUeIgd establishes no Save/Keep/restart acceptance. Subsequent v24 **sxZ0Sp**
passed normal citation/Save/edit acknowledgement/background and exact pending
restart, then failed a detached-editor diagnostic; correction `70ea085` is in v25.
Actual v25 **kcG1jG** observed normal Keep/duplicate receipt and exact canonical
body/title/path/hash, but **whole failed** the independent version check `4 !== 3`
before final committed restart/full native effect verification. Normal Keep's
resolved-hunk checkpoint advances the version; the strict proof must predict
that checkpoint before clicking, not accept an arbitrary returned version.
`b2a85e7` independently predicts the normal resolved-hunk v3→v4
checkpoint before Keep; ZlW6lU now verifies this strict local-live proof.
Prepared `0706ecc` uses normal Expand/chat reveal before exact compact refinement
pane acquisition; shared expanded native verification remains open.

Latest **ZlW6lU** passed all four local-live phases: two normal Sends/three real
POSTs HTTP 200/completed, canonical citation, Save/edit acknowledgement, native
background retention, exact pending-review restart, normal Keep/duplicate and
final committed restart, with no implicit inference. Its independent pre-click
draft v3→Keep v4/full checkpoint SHA and exact canonical read-back bind the
publication. Closed native before/after `pi-review-30:4` has one publication,
unchanged canonical relative path/Note Identity/receipt/hash. The root preserved
48 closed entries at `/private/tmp/pi-owned-simulator-after-v26-live-20261015`,
uninstalled only the owned bundle and observed process 2504 exit 0.

The actual v23 expanded **yvWBO9** receipt is now **failed**, after 12 recorded
first-phase checks/22 provider requests, at the normal conversation-mount deadline.
It used pinned v23 expanded executable/current driver on port 1446. The closed
previous owned container's 48 entries were backed up at
`/private/tmp/pi-owned-simulator-before-v23-expanded-20261015` before owned uninstall.
Latest v23 transcript **MlXAXC** is **whole failed** at mounted creation-review
decisions; the bounded watcher external edit/delete plus normal Convert/Restore
check passed. Its closed container's 46 entries were backed up at
`/private/tmp/pi-owned-simulator-before-v26-20261015` before owned uninstall.
Prepared `8347d67` binds exact connected body/title/reviewId acknowledgement
before compact chat destroys its editor, also after relocation. Thirty focused
tests, Svelte zero errors/warnings and root `check:e2e` passed. Its v26 transcript
rerun **xVPQ2S** has closed exit 1 at `awaiting-retained-conflict`, error
`Native restart did not close to portable state`; receipt/UI report retained.
Bounded Save/Keep/duplicate receipt, exact pending acknowledgement, uncertain
Keep conflict and relocation-state checkpoint were observed, but **no actual
move/restart**. Native `prepare_restart` deliberately rejects iOS before lifecycle
admission when `can_relaunch=false`; the probe assumed desktop portability.
A narrow fixture-only `pi_probe_prepare_close` is pending, calling existing
`AppLifecycle.prepare_restart` on a blocking worker under fixture/interactive/
expanded guards. This adds native diagnostic bytes, changes no production iOS
restart behavior and forces no portable marker.
Independent review found a separate shared interactive proof gap: post-Keep
version was trusted and recorded canonical hash was not independently bound.
Diagnostic correction/recapture is pending; no product corruption is established
and no whole shared gate pass is inferred.
Scale v5's prior memory projection of 476/1005 submissions is
historical progress only; no fresh count or final durable acceptance is claimed.
Compilation and independent iOS local-live work can overlap functional scale on
separate roots/ports, excluding all timing/RSS/cost comparisons.

Earlier frontend 609/609 (81 files), Node 157/157, later localized iOS proof
16 Vitest/four Node, and owner-query 35 Vitest/full types retain their individual
scopes; overlapping test counts are not additive. Compilation, helper tests and
native execution are separate evidence classes. The updated manual desktop bundle
built with `pi-prototype` alone, SHA
`e6ef2bbe82f8966544ac521208c586782f6012833c99d891b470e25083fb64a2`;
normal native CUA observed retained synthetic note, chat/citation/Stop history and local model on this launched rebuilt bundle. No inference was dispatched during this bounded observation; earlier live acceptance retains its own binary pin.

| v23 compiler receipt under `artifacts/` | Binary SHA-256 | Actual result |
| --- | --- | --- |
| [desktop-build.json](/private/tmp/pi-removal-final-20261015-v23/artifacts/desktop-build.json) | `d88797134ba05bdc728d9b33402ddbadea627b96569124d3772d4d7c53c6ea20` | Compiled and exclusion tests passed |
| [ios-expanded-build.json](/private/tmp/pi-removal-final-20261015-v23/artifacts/ios-expanded-build.json) | `19ec12d3a503f2d588b9fd3d570503ea86c2598a3fa8f6457b41bd62fb8a9f8b` | Compiled only |
| [ios-transcript-build.json](/private/tmp/pi-removal-final-20261015-v23/artifacts/ios-transcript-build.json) | `a352dac04402b681b39cd74dec9950bc7091d9f337d5d9cee57701390a6b346b` | Compiled only |
| [ios-live-build.json](/private/tmp/pi-removal-final-20261015-v23/artifacts/ios-live-build.json) | `013ce6a9269e9eedeea2e1de6e5ad745deb61c4210911d76ee94e0f7a7761ac7` | Compiled; actual QUeIgd live journey failed |

| Later live-only compiler receipt | Binary SHA-256 | Actual result |
| --- | --- | --- |
| [v24 ios-live-build.json](/private/tmp/pi-removal-final-20261015-v24/artifacts/ios-live-build.json) | `310140ac811d8693b7858fae55033c8c243816cf03122a90ceff12bf1d34ea3e` | Compiled; sxZ0Sp whole failed before Keep |
| [v25 ios-live-build.json](/private/tmp/pi-removal-final-20261015-v25/artifacts/ios-live-build.json) | `d90197ffa8eeb63b30881d09ed65201b5a1b8c40c1d25b28558c74c31edbf9e6` | Compiled; kcG1jG whole failed strict version proof |

| v26 compiler receipt | Binary SHA-256 | Actual result |
| --- | --- | --- |
| [ios-live-build.json](/private/tmp/pi-removal-final-20261015-v26/artifacts/ios-live-build.json) | `1a1c106c3057b0b36b084e5ca2b6c95d0556f6e5105f50b826cfb71b37a48c88` | Compiled; ZlW6lU bounded local-live passed |
| [ios-transcript-build.json](/private/tmp/pi-removal-final-20261015-v26/artifacts/ios-transcript-build.json) | `07ad57cecc9335445288bcc47f879f30d48d9b038e52e80851909ba1e997ddc9` | Compiled; actual xVPQ2S whole failed before portable close/move |
| [ios-expanded-build.json](/private/tmp/pi-removal-final-20261015-v26/artifacts/ios-expanded-build.json) | `bef89cdc07b78dc3a4e2316123ed3a2b26885b855cb919054742e30c2576916f` | Compiled; never run, stronger shared proof/recapture pending |

## Ticket coverage

Evidence IDs link to the pinned scope below. “Integrated” describes implementation,
not complete acceptance. Fixture means synthetic provider/data; live means actual
configured local inference through normal visible UI.

| Ticket / feature | Implementation | Actual bounded evidence | Still required / latest boundary |
| --- | --- | --- | --- |
| [01](issues/01-persistent-isolated-evaluation-app.md) isolated persistent app | Integrated copy/recovery/setup and separate installed app | **M live:** 209 copied files; repeated launches retain model/history/review; approved synthetic edits leave original unchanged | Final comparison/resources and remaining platform gates; agent observations are not user trial feedback |
| [02](issues/02-isolate-pi-lifecycle-ownership.md) lifecycle ownership | Integrated explicit Pi API/native domain seam | **R:** 52 legacy files physically absent in compiled comparison builds; lifecycle exclusion checks; **F/C/T/D** actual native slices | Recheck final captured build/default path and full native matrix; ordinary deliverable retains its default runtime |
| [03](issues/03-provider-settings-and-model-switching.md) provider/settings | Integrated frozen native routing and model refresh | **D:** normal model/protocol checks; **P:** compatible and Responses subsets; **M:** configured local model; **L:** bounded local-compatible iOS live passed | Final both-protocol matrix; hosted live explicitly user-deferred, not fixture-equivalent |
| [04](issues/04-conversation-history-and-request-lifecycle.md) history/Stop/Retry | Integrated Pi admission, checkpoints, projection and paging | **D:** first/relaunch/failure slices; **C:** crash recovery; **M:** short Stop then separate Retry completed READY | Complete final concurrent/session/lifecycle matrix; **S** 1005-history acceptance pending |
| [05](issues/05-context-discovery-and-evidence.md) discovery/permission/citations | Integrated native policy/evidence and Pi bindings | **P:** selected/current/retained evidence and grants; **M:** actual discover→Deny, fresh Allow once→read/citation/canonical navigation; **L:** admitted native read/normal citation passed | Final race/revocation/platform matrix; paired grant API checks do not prove paired permission-dialog parity |
| [06](issues/06-reviewed-note-changes-and-refinement.md) editable proposals | Integrated durable review/refinement and narrow canonical effects | **D:** real review, checkpoint/conflict/dirty-buffer slices; **F/C/T:** recovery and duplicate-effect slices; **M:** approved normal Keep | Final full review/refinement/termination/iOS matrix; partial runs do not close all races |
| [07](issues/07-faithful-save-to-note.md) faithful Save/origin | Integrated deterministic whole/selection Save | **P:** whole Save/origin, explicit selection append and closed duplicates; **M:** normal Save→approved Keep→Open in chat; **L:** Save/edit, pending restart, exact Keep/duplicate/final restart passed; **I:** bounded Save/Keep observed | Final full Save/platform matrix and independently bound shared interactive proof; **I** whole failed before portable close/move |
| [08](issues/08-first-usable-desktop-milestone.md) desktop handoff | Integrated normal UI harness, app and checklist | **M:** bounded persistent local live scope passed/closed; **D:** 14 first + ten relaunch checks passed | Complete expanded fixture run still failed; hosted live user-deferred; no invented user feedback requirement |
| [09](issues/09-pi-research-and-safe-compaction.md) research/compaction | Integrated isolated Pi worker and safe summaries | **D:** worker summaries and 23 UI follow-ons passed; focused actual-Harness tests | Whole **D** failed strict parent-summary receipt; source-free fixture setup fixed/prepared, native rerun required; **S** pending |
| [10](issues/10-attachments-and-web-search.md) attachments/web | Integrated native admission, retained bytes and search routing | **D:** bounded attachment/web follow-on checks within 23 passed UI checks | Complete both-protocol failure/restart/Retry matrix; bounded hosted live web not established and user-deferred |
| [11](issues/11-managed-transcripts-and-relocation.md) transcripts/relocation | Integrated committed projection, conflicts and identity-bound mapping | **T:** complete desktop watcher/Save/generated-root relocation/uncertain Keep slices; **I:** watcher, Save/Keep, exact pending/conflict/checkpoint observations | **I** whole failed at portable close before actual relocation/restart; fixture-close wrapper pending; standalone Settings vault move unproven |
| [12](issues/12-native-fault-and-ios-acceptance.md) native faults/iOS | Integrated fault/crash/storage/iOS drivers; suspension/live preparations | **F/C:** four cases each passed; **D:** five native-storage checks passed; **I:** bounded watcher/Save/conflict observations; **L:** bounded real local iOS live passed; **E:** 12 first checks passed | Final desktop/iOS expanded/transcript; close wrapper/shared proof correction pending, **I/E** whole failed; prepared suspension/churn not executed; hosted deferred, physical touch/device/OS-pressure unverified |
| [13](issues/13-replacement-proof-and-evaluation-verdict.md) replacement/cost | Removal/compiler/ledger and paired capture tooling implemented | **R/F/C/T:** removed-tree native slices; **P:** both-protocol prepared subsets; **U:** paired bounded core/long-output pass | Final source build/native/default gates, scale/churn/retention/collection and full cost evidence; no adoption or savings conclusion |

## Receipt provenance and scope

| ID | Artifact / actual result | Scope limit |
| --- | --- | --- |
| **M** | [Manual receipt](/private/tmp/pi-persistent-live-20261015/manual-live.json), `updatedBundleV2`/`liveDiscoveryPermission`; installed product `c74a53e`, probe `2a11f83`, SHA `9328ff2f9fcffdc194ee20631615ff80aecb9adaf5f2ae0846c7eda3526f57b2` | Bounded live local pass: source-free follow-up, canonical citation, approved mutation/Save/origin, two-launch retention, short READY Retry, discovery/Deny/Allow once. Normal Cmd-Q exited 0. Top-level legacy `status:in-progress` remains; completed nested observations establish this bounded scope, not full acceptance. Earlier long-count Retry was stopped, not completed. |
| **R** | v17 comparison canonical `468be149b7a263236c258b6b1f9ef053a7e546ab0b48ac37ab8dea6e314404e6`; desktop SHA `024dad84fbdc2b35c6358fd662c7d7bbdc5c82990f74b1dd7ddae379810e13a5`; [removal ledger](replacement-ledger.md) | 52 actual comparison-tree absences and compiler evidence; not deletion from the normal deliverable or proof that all runtime gates passed. |
| **F** | [K7YRrL fault receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-K7YRrL/fault-gate.json): passed four publication/model-boundary cases, eight provider requests | v17 binary **R**; synthetic fault injection, not real disk exhaustion/OS pressure. |
| **C** | [RJ9Vy0 crash receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-RJ9Vy0/native-crash-gate.json): passed four cases | v17 binary **R**; prepared-review and transport-completed crashes under both synthetic protocols; no physical-device guarantee. |
| **T** | [HVmzV1 transcript receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-HVmzV1/native-transcript-gate.json): passed four checks, six provider requests | v17 binary **R**; generated-root relocation, exact pending review/recovery and duplicate one-effect checks; standalone Settings move excluded. |
| **D** | [6xfnis desktop receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-6xfnis/desktop-interactive-gate.json): **whole failed**, 141 requests; 14 first, ten relaunch (six core/four failure), five storage and 23 follow-on UI checks passed | v19 SHA `0ced4b174e8f453bdcc0c39dc50bcbb9c36700910713b0d5eda5d7f4c91a2095`, canonical `836a19cf05ff18dfc96cd809b8ae8253981c6966672dd356075c0b654f05b069`. Strict native parent summary missing: adjacent selected context grounded warmups, 10,990-byte parent request stayed below 96k threshold. Worker summaries do not replace parent proof. Selection setup correction prepared. |
| **I** | [xVPQ2S v26 transcript receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-xVPQ2S/ios-transcript-gate.json) **whole failed**, closed exit 1: native restart not portable; exact `07ad57ce…ddc9` pin above. [Failed UI report](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-xVPQ2S/failed-ui-report.json) retained | Watcher Convert/Restore, normal Save/Keep/duplicate committed receipt, exact pending acknowledgement, uncertain Keep conflict and relocation-state checkpoint observed; no actual move/restart. Fixture close wrapper pending. Earlier [MlXAXC](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-MlXAXC/ios-transcript-gate.json) failed creation review; [jDLSGA](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-jDLSGA/ios-transcript-gate.json) failed Save readiness; both prior failures retained. |
| **L** | [ZlW6lU local iOS live receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-ZlW6lU/ios-live-gate.json): **passed**, four phases/three completed real POST200, `noReplay:true`; exact v26 live pin above | Independent pre-click v3→v4/full predicted checkpoint SHA `274ab96ee86912267b421cf7bed212c76231fe6c425faa87be969a8a9e7b6a42`, canonical body/title/path/editor hash and closed one-effect proof bind pending/final restarts and normal Keep/duplicate. No inference during citation/Save/background/restarts. Hosted deferred; programmatic simulator controls do not establish physical touch/OS pressure. Prior [kcG1jG](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-kcG1jG/ios-live-gate.json), [sxZ0Sp](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-sxZ0Sp/ios-live-gate.json), [QUeIgd](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-QUeIgd/ios-live-gate.json) and UGhOtn remain historical whole failures. |
| **E** | [yvWBO9 expanded iOS receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-yvWBO9/ios-interactive-gate.json): **whole failed**, 12 recorded first-phase checks/22 requests | v23 expanded SHA `19ec12d3a503f2d588b9fd3d570503ea86c2598a3fa8f6457b41bd62fb8a9f8b`; current `a1a4509` diagnostic driver/port 1446. Deadline mounting requested normal conversation; no whole first/relaunch/follow-on acceptance. |
| **P** | [Compatible v8](/private/tmp/pi-paired-compatible-20261015-v8/paired-parity-gate.json) and [Responses v2](/private/tmp/pi-paired-responses-20261015-v2/paired-parity-gate.json): both old/Pi `passed-prepared-subset` | Frozen v13 frontend, Pi v2 binary `a1ec5982e1f8ea74a80dffef75d858fa94c1cd83c41f6219212d851ef750a338`; old `4b5ff2de` fixture binary `d5e3a76aed10c9441dc76e4d9d768d497a209a8be06434ce4d3ab254bbb60bc0`. Evidence/grants/body review/Save/selection append/closed duplicates only. Old title read-only; Pi editable. Grants use public API; permission dialogs not compared. |
| **U** | [Resource v8 receipt](/private/tmp/pi-shared-resources-20261015-v8/shared-resource-gate.json): both lanes `passed-core-fixture`, eight requests, exact 256-line/9,215-byte output; [audited measurements](replacement-proof-plan.md#audited-paired-core-resource-checkpoint--v8-2026-10-15) | Old fixture binary above, Pi **R**. Actual module IPC observed: old 26/Pi 1,159 warm calls; closed logical storage old 684,378/Pi 2,059,929 bytes. Material observed bridge/storage increases disclosed. One rejected Pi invoke response size unknown; JSON proxies are not wire bytes. App-only RSS, uncontrolled cache/order and observer overhead prevent a performance-win claim. |
| **S** | `/private/tmp/pi-product-scale-20261015-v5`, pinned v22 desktop above; **pending**, prior memory projection 476/1005 submissions retained as historical progress only | No fresh count or final durable seed/identity/history/provider accounting claimed. Requires exactly 1005 answers plus validated automatic summary requests, total ≤1100. Prior v3 failed transient SHM `ENOENT`. v4 was operator-ended at 03:45 UTC (401 submissions reported/421 provider requests) to switch superseded v17 to final indexed-query v22; its final receipt failed `fetch`, without full seed/identity accounting. `operator-stop.json` preserves verified owned-app stop. Neither prior run is eligible for guarded continuation or scale acceptance. See [scale contract](product-scale-proof-plan.md). |

Manual **M** copied 209 files and retained the original 388-file seal
`66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`
unchanged after synthetic Keeps and final shutdown. No source content or secrets
belong in committed evidence. Hosted live is explicitly deferred by the user's
local-only instruction; synthetic Responses passes do not become hosted live.
Receipts retain their own source, binary, frontend and driver pins. Cross-version
passes cannot be combined into a claim that v23 passed every native journey;
paired/resource `frontendReceiptVerified:false` remains an explicit binding limit.
The [read-only scale cost audit](scale-cost-audit.md) records source-backed
reconstruction/validation/storage mechanisms, not measured attribution,
implemented optimization, known IPC totals or a scale pass.

## Remaining gate queue

1. Finish scale v5 and inspect the closed exact seed/history/identity/provider
   accounting; preserve failure if any. Do not promote derived progress or timing
   into acceptance. Pure test/source-capture CPU overlap prevents scale cost claims.
2. Freeze/review the fixture-only existing-lifecycle close wrapper and independently
   bound shared interactive Keep/receipt proof, then recapture/build before reruns.
   All v26 iOS compiles and bounded local-live passed; shared expanded was unrun,
   transcript whole failed and their acceptance remains
   open. Complete affected exclusion/native/default checks and expanded
   desktop summary/follow-on
   gates against their exact pinned artifacts. Earlier broad default smoke failed
   one input wait; unchanged foreground/background focused reruns passed. Preserve
   that original flake rather than reporting the broad run passed.
3. Complete corrected actual iOS expanded/transcript; preserve the bounded
   local-compatible live pass and user-deferred hosted scope.
   desktop expanded and owned churn are queued, not started, until v5 closes and
   releases owned ports. Execute prepared artificial suspension checks. Simulator
   automation does not establish physical touch, device/radio or real OS-pressure
   behavior. Hosted live remains user-deferred.
4. Complete comparable lifecycle/listener, retained-family/collection, scale and
   resource evidence with unknowns/regressions intact; reconcile ownership/cost
   ledger and ticket acceptance only from those results. The evaluation goal and
   final verdict remain open; production/default adoption is outside this matrix.
