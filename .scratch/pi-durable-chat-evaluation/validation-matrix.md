# Current Pi evaluation validation matrix

2026-10-16. Implementation is integrated; ticket acceptance remains open at the
boundaries below. This matrix summarizes actual evidence, not a final verdict or
goal closure. See [spec](spec.md), [hands-on instructions](README.md),
[detailed native records](desktop-acceptance.md) and [progress](progress.md).

## Current source and validation

Current immutable **v38** source, HEAD `44d200d`, is
`/private/tmp/pi-removal-final-20261015-v38`, canonical manifest
`14ceb2312d90d66f870cc273a4e6372e7c7f6403b88fc4a109eb5d7013100728`.
Removed-tree desktop binary
`c9f08ac067cf58c671da4ae62c6728d69d37048cfb63e749fea7b07f32272c1e`
and served frontend
`23e74527ceaac2692a194c3d6e46e6464fc109b96b764628be74fdcc71ffcb88`
are pinned. Temporary native diagnostics are absent; settled-preparation repair
remains. **Acceptance is still open; no final verdict/ticket resolution/archive.**

[Desktop queue](/private/tmp/pi-final-desktop-queue-v38-20261015.json) records all
seven functional classes passed: expanded I0gmUQ (143 requests), publication
faults 4C3GQB, native crashes EtcRrX, desktop transcript m0NmD4, compatible/Responses
paired observable subsets, and owned churnv7. The prior v37 exact-origin failure
is retained; the current desktop whole run passed. Paired subsets retain old
`4b5ff2de`/`d5e3a76a…60bc0` capability differences, grantAPI-only comparison and
source/binary provenance limits; they are not full product parity.

[All three clean iOS gates passed](/private/tmp/pi-final-ios-queue-v38-20261015.json):
expanded [qxKi7t](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-qxKi7t/ios-interactive-gate.json)
(`2f81cf8609cce773c27bf141698a03445085efd257788f349dd416c28d760469`, 143 requests),
transcript [DxtdzR](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-DxtdzR/ios-transcript-gate.json)
(`7a00ea09d2afbd055d259a12bd21b928e7e6aa464ea68f8ae2b597dee498be3c`, six synthetic requests),
local-live [7ETlYP](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-7ETlYP/ios-live-gate.json)
(`d110c6a16dae11226ba5205b8db559d7b4fdbb17a284dbea50d9e1eea7f7e747`, two normal Sends/
four inference POSTs/16 total requests including metadata, no replay).
Fixture/programmatic versus configured-local-live scope stays distinct. Root
[closure attestation](/private/tmp/pi-v38-native-closure-owner-attestation.json)
binds native builders/drivers/apps/ports closed and owned simulator shutdown
before resource pairs; it does not imply later default build/smoke was already done.

**Three controlled paired core-resource runs passed**, Pi/old → old/Pi → Pi/old,
24 bounded compatible fixture requests total. [JSON](/private/tmp/pi-v38-controlled-resource-summary-20261016.json)
and [table](/private/tmp/pi-v38-controlled-resource-summary-20261016.md) retain
per-run metrics, medians/ranges and receipt hashes. Old→Pi medians: warm module
calls 26→1085 (41.7×), request JSON proxy bytes 2187→321954, known response proxy
bytes 119536→1778331 with one Pi response size unknown per run. Closed logical
storage 684378→2059929 bytes (3.01×; +1375551), including Pi WAL 1351392/SHM 32768;
checkpoint/allocation unknown. These are **material observed bridge/storage
regressions**, not automatic Pi savings. First-visible medians short 226→305,
follow-up 175→242, long-output 213→259ms; Stop settlement 67→84ms. Initial startup
1699.5→1417.6ms and sampled app RSS235110400→206159872 bytes were lower, without
an overall performance/all-process-memory inference. OS cache/debug/observer/
polling/provider-partial limits remain; JSON proxies are not wire bytes, bootstrap/
direct bridge IPC unknown. Old cancelled content 0/Pi 28 bytes is not exact content
equivalence. Full scale is outside these resource fixtures.

The original overall desktop queue remains failed at ordinary default smoke:
first three specs passed2+2+1, then chat-to-note8 passed/1 failed at the initial
edited-review input wait. Intended multiline input had one extra trailing LF;
mechanism remains unresolved. **Unchanged focused rerun1 passed** (session19792),
then **unchanged full smoke14 passed in4 specs** (session2532), both closed.
[Continuation receipt](/private/tmp/pi-v38-default-continuation-20261016.json)
retains original queue/log hashes and default binary
`d308c7aa0986ec00ecbea9a0a7c07a3328910e3919b3e3688b8694e68c673761`.
No product/test/trim change or mechanistic fix is claimed; original failure remains.
Root verified owned apps/builders/drivers closed, absent ports and simulator
shutdown after both runs, before scale.

**Full scalev6 is RUNNING**, session66327, started07:19UTC at
`/private/tmp/pi-product-scale-20261015-v6`, with no overlapping native work and
unchanged full1005-answer/≤1100 total/two-hour budgets. No acceptance result yet.
Historicalv22 scalev5 remains failed. Final persistent handoff/closure evidence
remains open; default rerun passes do not close scale or erase the original flake.

[Post-fix static checks](/private/tmp/pi-origin-fixed-static-checks-20261016.json)
match the v38 frontend digest: support 38, Vitest 1631 tests in 192 files, Node
166, Svelte zero errors/warnings and e2e TypeScript passed. Its six changed-input
hashes match the immutable capture. [Full Rust](/private/tmp/pi-final-full-rust-receipt-20261016.json)
is reused: Pi 754 passed/20 ignored and default 944 passed/32 ignored, each with
21 architecture/three exclusion/one runtime checks passed. The recorded
[v37→v38 diff](/private/tmp/pi-removal-final-20261015-v38/v37-v38-source-diff.json)
is exactly six frontend/driver files, with no native changes; this is explicit
input binding, not a Rust rerun. Python 89 remains the unchanged-input result in
the [prior static receipt](/private/tmp/pi-final-static-checks-20261016.json).
[Original seal](/private/tmp/pi-final-original-vault-seal-20261016.json)
remains exact 388 files/`66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`.
Hosted live is user-deferred. Physical touch/device/OS pressure, private resource/
controller-disposal/collection counts and standalone Settings vault relocation
remain unverified. No adoption/performance-win/goal-closure claim.

Material historical failures: [v37 desktop origin](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-qHtwIk/desktop-interactive-gate.json),
[v34 continuity](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json),
[v33 validation](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json),
[v32 Documents verifier](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-WRrwST/ios-interactive-gate.json).
Earlier diagnostic passes retain their own pins and do not replace clean v38 evidence.

| Available v28 compiler receipt | Binary SHA-256 | Scope |
| --- | --- | --- |
| [desktop-build.json](/private/tmp/pi-removal-final-20261015-v28/artifacts/desktop-build.json) | `f0715b4cbeacb571cc3d74c0705efdcdca2cab2bf460595d24f23f259c4dfc7f` | Compiled and three exclusion checks passed; native gates unrun |
| [ios-expanded-build.json](/private/tmp/pi-removal-final-20261015-v28/artifacts/ios-expanded-build.json) | `998b977a5127cc1482046aa5ced86ecc68e40906feca340b0fab8401f4bcf8ab` | Compiled; djWH4K whole failed exact-origin navigation |
| [ios-transcript-build.json](/private/tmp/pi-removal-final-20261015-v28/artifacts/ios-transcript-build.json) | `c06b99b18b02e11d3e4b35438747a32273e084c03e0c4f932e2d373a7692b38c` | Compiled only |
| [ios-live-build.json](/private/tmp/pi-removal-final-20261015-v28/artifacts/ios-live-build.json) | `55320711869a21decd1a37bcad4e1e544ad250d24d0c5bcda39ccc1921589978` | Compiled only; unrun |
| [fresh default receipt](/private/tmp/pi-v28-default-build-closed-20261015.json) | `f3774b58edce7c16c25e164254abbe708107317d11caf232b4c73ff00ef3dfff` | Compiled only; default smoke unrun |

| v30 compiler receipt | Binary SHA-256 | Actual scope |
| --- | --- | --- |
| [ios-expanded-build.json](/private/tmp/pi-removal-final-20261015-v30/artifacts/ios-expanded-build.json) | `dc4cdcec417c4e8839e3b34811e7db6036f7a589c0e91323a840072b82021c83` | Compiled; 71i6Ij whole failed stale-source selector |
| [ios-transcript-build.json](/private/tmp/pi-removal-final-20261015-v30/artifacts/ios-transcript-build.json) | `53712878aa60d22561ecae1ec1422c0ed342eb1b15edf6a33b8c37952021e63c` | Compiled; 0cCfVn whole synthetic transcript passed |
| [ios-live-build.json](/private/tmp/pi-removal-final-20261015-v30/artifacts/ios-live-build.json) | `dca8b4de82f2afb32e8432df9be968fbe07e2bf96541eaec113d3919782e4697` | Compiled; B6Dw3j bounded local live passed |

## Retained artifact evidence

Product lifecycle owner/semantics remain based on `b52b1a6`; mobile diagnostic correction
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
Earlier diagnostic source capture **v26** is
`92782d6d42e182791d1138b8c3dfcc0e96d9d5d5bc36b82c9a9b3895b25ce35c`;
actual local iOS live **ZlW6lU passed**, under the exact v26 live artifact below.
All three v26 iOS variants compiled; actual transcript **xVPQ2S whole failed**,
and v26 expanded never ran. Corrected shared interactive execution remains pending.
Earlier captured preparation **v27**, canonical manifest
`d3d120f286fc7273dad773e38ee67cdb289fd745195c145d8f540117eef1ec89`,
`/private/tmp/pi-removal-final-20261015-v27`. Transcript/expanded source copies
verified 1504 retained files/52 legacy absences. Its
[v26→v27 diff](/private/tmp/pi-removal-final-20261015-v27/v26-v27-source-diff.json)
explicitly allows fixture-close native `lib.rs`/`pi_prototype.rs` wrapper and
registration changes; **native bytes are not identical**, despite unchanged
product lifecycle ownership. Desktop build/three exclusion tests passed;
transcript/expanded iOS builds also completed. **v27 transcript z3TtcW whole PASS**,
exit 0, is scoped below. Actual v27 expanded **lvqjxb whole FAILED**, session
69024 closed exit 1: 26 requests, first 14/five relaunch checks passed before the
`saved note in retained editor` deadline. All three independent Keep/Save/append
plans and canonical read-backs passed. Compact `openChat` in `settleReview`
unmounted the editor; no canonical publication discrepancy is established.
Normal originating-message Open note before the existing editor/backlink
assertion is now reviewed/committed in v28, not a new native pass.

Exact owned-PID artificial STOP/CONT completed in 14,008 ms with same process/
launch and static-report no replay. The receipt retains
`freshPostContinueUiRead:false` and
`durablePartialAndReviewVerifiedByFollowingRelaunch:false`; failed whole phase
does not upgrade those flags. The root preserved 51 closed entries at
`/private/tmp/pi-owned-simulator-after-v27-expanded-failure-20261015` before owned
uninstall. That failed v27 native gate is closed.
Earlier `a1a4509`
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
A narrow fixture-only `pi_probe_prepare_close` is prepared in `1ae47ec`, calling existing
`AppLifecycle.prepare_restart` on a blocking worker under fixture/interactive/
expanded guards. This adds native diagnostic bytes, changes no production iOS
restart behavior and forces no portable marker. Three native `diagnostic_close`
checks/28 TypeScript checks passed; fresh review found no functional issue and
the manual-copy integration failure filename was clarified. The closed 48-entry
xVPQ2S container was preserved at
`/private/tmp/pi-owned-simulator-after-v26-transcript-failure-20261015` before
owned uninstall.
The corrected v27 **z3TtcW** subsequently passed six-request synthetic transcript
acceptance: real sandbox CD286BAC→B6A513BA, same vault/owner, exact pending body/
version and retained authored conflict, normal Retry Keep `pi-review-60:3` at
relocated path with one publication/proof cleared/canonical hash unchanged,
normal source navigation/stable Origin lookup/unknown-root rejection and both
ordered portable close receipts. The root preserved 46 closed files at
`/private/tmp/pi-owned-simulator-after-v27-transcript-20261015` before uninstalling
only the owned bundle. This is no live/physical-touch/Settings relocation claim.
Independent review found a separate shared interactive proof gap: post-Keep
version was trusted and recorded canonical hash was not independently bound.
Prepared `bfe4260` now independently binds shared Keep version/canonical proof,
including the actual-relaunch staged v1/empty decisions→mounted v2 pending→normal
Keep v3 regression. Thirty TypeScript/11 Python checks, Svelte zero errors/warnings,
fresh Spec review without findings and root `check:e2e` passed. Expanded native
verified three independently bound publication plans/read-backs but whole failed
at the subsequent editor navigation; neither those slices nor transcript pass
establish a whole shared expanded pass.
Scale v5's 04:32 memory projection of 576/1005 submissions is
historical progress only; no fresh count or final durable acceptance is claimed.
Compilation and independent iOS local-live work can overlap functional scale on
separate roots/ports, excluding all timing/RSS/cost comparisons.
A minimal source-free empty-native-validation guard in `chatApi.ts`/tests is now
reviewed/committed in v28, with no summary/index rewrite. The audit's roughly 2N needless calls
are source inspection, not measured cost attribution or an optimization speed
claim. Current v5/frozen v22 is untouched. The Mac was unlocked and the normal
persistent app quit before queued resource capture; no new comparison result.

Earlier frontend 609/609 (81 files), Node 157/157, later localized iOS proof
16 Vitest/four Node, and owner-query 35 Vitest/full types retain their individual
scopes; overlapping test counts are not additive. Compilation, helper tests and
native execution are separate evidence classes. The updated manual desktop bundle
built with `pi-prototype` alone, SHA
`e6ef2bbe82f8966544ac521208c586782f6012833c99d891b470e25083fb64a2`;
normal native CUA observed retained synthetic note, chat/citation/Stop history and local model. It is now normally closed (runner8295 exit0), with no new inference; earlier live acceptance retains its own binary pin.

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

| v27 compiler receipt | Binary SHA-256 | Actual result |
| --- | --- | --- |
| [desktop-build.json](/private/tmp/pi-removal-final-20261015-v27/artifacts/desktop-build.json) | `f0a44da5b404ca50b215326f49dd5ef0fff296ac495105f2eb5722c0cc5167c4` | Compiled; 3/3 lifecycle exclusion checks passed; desktop queue superseded before any gate start |
| [ios-transcript-build.json](/private/tmp/pi-removal-final-20261015-v27/artifacts/ios-transcript-build.json) | `6ba7182fbee956ffe660419b214d06182b309af87ce86d78f7ae2e057c31f7c8` | Compiled; z3TtcW whole synthetic transcript passed |
| [ios-expanded-build.json](/private/tmp/pi-removal-final-20261015-v27/artifacts/ios-expanded-build.json) | `e4faddd647a175dd91d6346353ccb0d3bf36c1cf29241d87ae5a6567e8204d2b` | Compiled; lvqjxb whole failed after first14/relaunch5 passed |

## Ticket coverage

Evidence IDs link to the pinned scope below. “Integrated” describes implementation,
not complete acceptance. Fixture means synthetic provider/data; live means actual
configured local inference through normal visible UI.

| Ticket / feature | Implementation | Actual bounded evidence | Still required / latest boundary |
| --- | --- | --- | --- |
| [01](issues/01-persistent-isolated-evaluation-app.md) isolated persistent app | Integrated copy/recovery/setup and separate installed app | **M live:** 209 copied files; repeated launches retain model/history/review; approved synthetic edits leave original unchanged | v38 bounded native/resource comparisons passed; final persistent handoff remains open; agent observations are not user trial feedback |
| [02](issues/02-isolate-pi-lifecycle-ownership.md) lifecycle ownership | Integrated explicit Pi API/native domain seam | **R:** 52 legacy files physically absent in compiled comparison builds; lifecycle exclusion checks; **F/C/T/D** actual native slices | v38 removal/native functional scopes and unchanged full default smoke passed; original default flake retained; ordinary deliverable retains default runtime |
| [03](issues/03-provider-settings-and-model-switching.md) provider/settings | Integrated frozen native routing and model refresh | **D:** normal model/protocol checks; **P:** compatible and Responses subsets; **M:** configured local model; **L:** bounded local-compatible iOS live passed | v38 both-protocol prepared subsets/fixture matrix passed; hosted live explicitly user-deferred, not fixture-equivalent |
| [04](issues/04-conversation-history-and-request-lifecycle.md) history/Stop/Retry | Integrated Pi admission, checkpoints, projection and paging | **D:** first/relaunch/failure slices; **C:** crash recovery; **M:** short Stop then separate Retry completed READY | v38 bounded desktop/iOS lifecycle matrix passed; **S** v5 failed budget, full v6 running without acceptance result |
| [05](issues/05-context-discovery-and-evidence.md) discovery/permission/citations | Integrated native policy/evidence and Pi bindings | **P:** selected/current/retained evidence and grants; **M:** actual discover→Deny, fresh Allow once→read/citation/canonical navigation; **L:** admitted native read/normal citation passed | v38 bounded race/revocation/platform fixture scopes passed; paired grant API checks do not prove paired permission-dialog parity |
| [06](issues/06-reviewed-note-changes-and-refinement.md) editable proposals | Integrated durable review/refinement and narrow canonical effects | **D:** real review, checkpoint/conflict/dirty-buffer slices; **F/C/T:** recovery and duplicate-effect slices; **M:** approved normal Keep | v38 whole bounded desktop/iOS review/refinement/recovery scopes passed; physical-device/OS-pressure behavior remains unverified |
| [07](issues/07-faithful-save-to-note.md) faithful Save/origin | Integrated deterministic whole/selection Save | **P:** whole Save/origin, explicit selection append and closed duplicates; **M:** normal Save→approved Keep→Open in chat; **L:** exact Keep/duplicate/final restart; **I:** Save/Keep/relocation recovery; **E:** three independent publication plans/read-backs passed | **D/E** clean v38 desktop/iOS whole expanded passed; unchanged full default smoke passed with original flake retained; full scale/handoff acceptance remains open |
| [08](issues/08-first-usable-desktop-milestone.md) desktop handoff | Integrated normal UI harness, app and checklist | **M:** bounded persistent local live scope passed/closed; **D:** 14 first + ten relaunch checks passed | v38 clean iOS/desktop whole expanded and unchanged default14 passed; original smoke failure retained; hosted live user-deferred; no invented user feedback requirement |
| [09](issues/09-pi-research-and-safe-compaction.md) research/compaction | Integrated isolated Pi worker and safe summaries | **D:** worker summaries and 23 UI follow-ons passed; focused actual-Harness tests | **D/E** actual parent/worker summaries and research passed both fixture lanes on cleanv38; historical intermittent failures retained; **S** v6 running, no final result |
| [10](issues/10-attachments-and-web-search.md) attachments/web | Integrated native admission, retained bytes and search routing | **D/E:** bounded attachment/web/Retry follow-ons, including v32 both fixture lanes | v38 bounded both-protocol fixture follow-ons passed; hosted live web not established and user-deferred |
| [11](issues/11-managed-transcripts-and-relocation.md) transcripts/relocation | Integrated committed projection, conflicts and identity-bound mapping | **T:** desktop watcher/Save/generated-root relocation/uncertain Keep passed; **I:** v38 clean whole synthetic iOS transcript/sandbox relocation passed | v38 bounded desktop/iOS transcript scopes passed; standalone normal Settings vault move remains unproven; synthetic/programmatic scope only |
| [12](issues/12-native-fault-and-ios-acceptance.md) native faults/iOS | Integrated fault/crash/storage/iOS drivers; suspension/live preparations | **F/C:** four cases each passed; **D:** five native-storage checks passed; **I:** v38 clean transcript whole passed; **L:** bounded local iOS live passed; **E:** first 14/relaunch 10 (including four failure checks)/25 follow-ons passed; artificial STOP/CONT observed | **E** clean whole expanded/churn passes; fresh post-CONT false/following durable relaunch true; no OS-suspension claim; default unchanged full smoke passed with original flake retained; full-scale/handoff pending; hosted deferred, physical touch/device/OS-pressure unverified |
| [13](issues/13-replacement-proof-and-evaluation-verdict.md) replacement/cost | Clean v38 removal/compiler/ledger/paired/functional tooling with temporary diagnostics removed | **R/F/C/T:** removed-tree native slices; **I:** v38 clean transcript whole passed; **E:** publication proof slices; **P/U:** bounded paired subsets/resources | v38 iOS3/desktop7 functional classes and controlledresources3 passed; unchanged default14 passed/original flake retained/fullscalev6running/handoff open; full-scale/handoff and private-retention/collection/coverage limits open; no measured speed/adoption/savings claim |

## Receipt provenance and scope

| ID | Artifact / actual result | Scope limit |
| --- | --- | --- |
| **M** | [Manual receipt](/private/tmp/pi-persistent-live-20261015/manual-live.json), `updatedBundleV2`/`liveDiscoveryPermission`; installed product `c74a53e`, probe `2a11f83`, SHA `9328ff2f9fcffdc194ee20631615ff80aecb9adaf5f2ae0846c7eda3526f57b2` | Bounded live local pass: source-free follow-up, canonical citation, approved mutation/Save/origin, two-launch retention, short READY Retry, discovery/Deny/Allow once. Normal Cmd-Q exited 0. Top-level legacy `status:in-progress` remains; completed nested observations establish this bounded scope, not full acceptance. Earlier long-count Retry was stopped, not completed. |
| **R** | Current v38 canonical `14ceb231…00728`, desktop SHA `c9f08ac0…72c1e` above; [removal ledger](replacement-ledger.md) | 52 actual comparison-tree absences, compiler/exclusion and bounded native evidence; ordinary deliverable retains legacy runtime. Historical v17 slices retain their own pins. |
| **F** | [4C3GQB v38 faults](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-4C3GQB/fault-gate.json): passed, eight fixture requests | Current removed-tree desktop pin; synthetic fault boundaries, not real disk exhaustion/OS pressure. Earlier K7YRrL remains historical. |
| **C** | [EtcRrX v38 crashes](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-EtcRrX/native-crash-gate.json): passed, ten fixture requests | Current removed-tree pin; synthetic protocols/crash boundaries, no physical-device guarantee. Earlier RJ9Vy0 retains own pin. |
| **T** | [m0NmD4 v38 desktop transcript](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-m0NmD4/native-transcript-gate.json): passed, four checks/six requests | Current pin; watcher/generated-root relocation/exact pending recovery/one-effect proof. Standalone Settings move unproven. |
| **D** | [I0gmUQ v38 desktop expanded](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-I0gmUQ/desktop-interactive-gate.json): whole passed, 143 requests | Whole bounded fixture scope including independent publications/origin/failures/storage/follow-ons. Prior qHtwIk origin and6xfnis parent-summary failures remain historical. Default smoke is separate: original failure retained, unchanged focused/full continuations passed. |
| **I** | [DxtdzR v38 transcript](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-DxtdzR/ios-transcript-gate.json): clean whole passed, six requests, exact `7a00ea09…be3c` pin above | Synthetic/programmatic watcher/relocation/recovery/source/Origin scope; not physical/live/Settings move. Prior POk25L/HrJXyy/0cCfVn/z3TtcW retain own pins. |
| **L** | [7ETlYP v38 live](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-7ETlYP/ios-live-gate.json): bounded local whole passed, two Sends/four inference POSTs/16 total/no replay; exact `d110c6a1…e747` pin above | Actual configured local endpoint/programmatic simulator; hosted deferred, physical touch/OS pressure unverified. Earlier live passes remain pinned. |
| **E** | [qxKi7t v38 iOS expanded](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-qxKi7t/ios-interactive-gate.json): clean whole passed, 143 requests, `2f81cf86…0469` pin above; [churnv7](/private/tmp/pi-resource-churn-20261015-v7/resource-churn-gate.json) passed bounded owned resources | No temporary instrumentation; programmatic simulator and fixture limits. Private resource counts/controller disposal/retirement/GC remain unobserved. Initial churnv5 harness failure retained; corrected explicit archive/revision proof now passes on current source. |
| **P** | [v38 compatible](/private/tmp/pi-paired-parity-final-v38-20261015-compatible/paired-parity-gate.json) and [v38 Responses](/private/tmp/pi-paired-parity-final-v38-20261015-responses/paired-parity-gate.json): old/Pi prepared subsets passed | Pi current source/pin above, old4b5ff2de/d5e3a76a…60bc0. Evidence/grantAPI/body review/Save/selection append/closed duplicates only; title/staleKeep capability differences, no paired permission-dialog/full-product parity. |
| **U** | [v38 controlled summary JSON](/private/tmp/pi-v38-controlled-resource-summary-20261016.json)/[table](/private/tmp/pi-v38-controlled-resource-summary-20261016.md): three closed paired-core passes, Pi/old→old/Pi→Pi/old | Current pinned debug compatible fixture,24requests. Modulecalls medianold26/Pi1085; logicalstorage684378/Pi2059929 bytes. Material bridge/storage regressions disclosed; one Pi null response/run. Module-only/JSONnotwire/providerpartial/app-onlyRSS/cache/polling/observer/source-provenance limits, no performance win. Earlier resourcev8 remains historical. |
| **S** | Current full scalev6 **running**, session66327, fresh `/private/tmp/pi-product-scale-20261015-v6`, started07:19UTC after verified native closure; no overlapping native work, unchanged budgets/no acceptance result. [Historicalv5](/private/tmp/pi-product-scale-20261015-v5/product-scale-gate.json) final failed two-hour budget onv22 | v6 must prove full1005answers/≤1100 total/exact identities/history/archive/restart/closed proof; resource pairs/default passes do not substitute. v5 last public776/782answers+4summaries786completed requests is failed prefix only; IPCnull/app-onlyRSS/build-overlap limits retained. |

Earlier failed iOS receipts remain retained: transcript
[xVPQ2S](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-xVPQ2S/ios-transcript-gate.json),
[MlXAXC](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-MlXAXC/ios-transcript-gate.json),
[jDLSGA](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-jDLSGA/ios-transcript-gate.json);
live [kcG1jG](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-kcG1jG/ios-live-gate.json),
[sxZ0Sp](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-sxZ0Sp/ios-live-gate.json),
[QUeIgd](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-QUeIgd/ios-live-gate.json);
expanded [yvWBO9](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-yvWBO9/ios-interactive-gate.json).
Their failed scopes are not relabeled by later passes.

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

1. Finish current full scalev6 without concurrent native work; inspect exact full
   seed/history/identity/archive/restart/closed proof under unchanged1005-answer/
   ≤1100 total/two-hour budgets. Running is not acceptance; historicalv5 failed.
2. Complete final persistent normal-app handoff/relaunch/original seal and any
   remaining source-bound checks. Post-fix frontend digest matches v38; Rust/Python reuse is explicitly bound
   to unchanged inputs above. Immutable v38 passes cannot silently bind later edits.
3. Retain original broad default input failure despite unchanged focused1/full14
   pass continuations. Extra trailing LF mechanism remains unresolved; no test/
   product/trim change or mechanistic fix claimed.
4. Preserve IPC/storage regressions and coverage/cache/observer/provider/app-only
   memory/private-resource/collection unknowns. Hosted live is user-deferred;
   physical touch/OS pressure/standalone Settings move remain unverified.
5. Reconcile evidence/ticket progress/verdict only after required outcomes;
   no final verdict/adoption claim, ticket resolution, archive or goal closure now.
