# Current Pi evaluation validation matrix

2026-10-16. Implementation is integrated; ticket acceptance remains open at the
boundaries below. This matrix summarizes actual evidence, not a final verdict or
goal closure. See [spec](spec.md), [hands-on instructions](README.md),
[detailed native records](desktop-acceptance.md) and [progress](progress.md).

## Current source and validation

Current actual checkpoint **v34**, canonical manifest
`22c8180fe7a6d14333bd01d1c4050db0fb4840f1f46b2d49e0d863570b8e949d`,
is `/private/tmp/pi-removal-final-20261015-v34`. Expanded compiled-only executable
`8ccdf4b08c0e38e8f3c1af79bc762ced1f4a9b3fbb58da9abc1d172ed0da5607`
([compiler receipt](/private/tmp/pi-removal-final-20261015-v34/artifacts/ios-expanded-build.json))
ran **cE9fvy whole FAILED**, 88 provider requests
([gate receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json)).
First14/relaunch10 checks and local parent/worker compaction/research
(30 reads/31 generations/59 sources), fresh read, text and image attachment
checks passed. The relaunch phase nevertheless failed during follow-ons.

Post-response **audio parent generation508** failed after 2015ms with exact
unprefixed `Current notes changed during the read; retry the read`.
Provider request87 completed in66ms, then failure followed1891ms later; no
AdmittedAnswer was committed, with zero evidence/context/grants at this boundary.
`resolveContinuity` → `pi_continuity_references` exhausted three invalidated
`current_content.read_refreshable` attempts. The actual writer remains **unknown**;
these timings do not establish attribution. The root's retained
[forensic receipt](/private/tmp/pi-removal-final-20261015-v34/artifacts/ios-expanded-failure-boundary.json)
binds this boundary/pin, `admittedAnswer:false`, `wholeGatePassed:false` and
`remainingNativeBuildersStarted:false`. Closed backup:
`/private/tmp/pi-owned-simulator-after-v34-expanded-failure-20261015`.
The native queue closed failed; remaining iOS/desktop builders did not start,
and the desktop queue produced no gates. Narrow diagnostic investigation is
ongoing. Upcoming exact unprefixed friendly-error mapping is presentation only,
**not an underlying fix or accepted native result**.

Previous captured checkpoint **v33** is
`/private/tmp/pi-removal-final-20261015-v33`, canonical manifest
`e87cf98893523599dd51342cdab24027adf4924736f0c70bf04d9417452194e5`.
Desktop compiled/three exclusion checks passed, binary
`2d5613455092a52c3a984c4eede2864d7d13d16c1fe7bf3d5a4e8b8147f222aa`
([receipt](/private/tmp/pi-removal-final-20261015-v33/artifacts/desktop-build.json)).
All three iOS variants compiled; transcript/live **not run** on v33. Desktop queue
was superseded before any gate; the iOS queue closed failed. No final desktop
native acceptance follows from compilation.

Actual v33 expanded **5W81zD whole FAILED**, 80 provider requests, executable
`a54fd98a599b725fddbc03236b15cf9239b3f5eaedd4ec6e511499be19193b96`
([receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json)).
First14/relaunch10 checks passed, but the relaunch phase failed during follow-ons.
Worker334/generation465 failed after 2153ms with
`Evidence or access changed; read again`, after 55 sources/28 successful reads.
This isolates the standalone per-citation `pi_validate_sources` Option wrapper
failure; that wrapper still hides availability versus changed-context cause.
Closed 85-entry backup:
`/private/tmp/pi-owned-simulator-after-v33-expanded-failure-20261015`.

Batch checking and standalone validation are now unified in reviewed commits
`9feed2d`/`2864fff`, with clear user errors. Full Pi Rust751/architecture21/
exclusion3/runtime1 passed
(`/private/tmp/pi-v34-full-rust-pi-20261015.log`); affected default evidence23
passed (`/private/tmp/pi-v34-default-evidence-tests-20261015.log`). Prior full
default941/architecture21/exclusion3/runtime1 passed at v33; these overlapping
suites are not added together. Frontend adapter17 passed. Initial Svelte Map type
error remains retained at `/private/tmp/pi-v34-svelte-check-20261015.log`;
repair passed zero errors/warnings and E2E TypeScript
(`/private/tmp/pi-v34-svelte-check-repair-20261015.log`). The tested source was captured in v34; its actual whole native run failed
at the continuity-refresh boundary above. No accepted whole rerun follows.

Historical v32 **WRrwST whole failed**, 143 requests: initial14/relaunch10 and all
local/openai research, parent/worker compaction, fresh read, attachment/exact Retry
and hosted-web fixture follow-ons passed, then the closed publication verifier
failed desktop `nativeRoot/vault` lookup on iOS Documents layout. That is **not
follow-on relocation**. The registered-path verifier fix binds owner/target paths,
manifest/confinement (27 Python checks passed), but **no whole closed iOS
publication proof yet**. v32's completed workers334/598 (30 reads/59 sources each,
no failed tools) do not close the intermittent v31 failure. v32 artificial
STOP/CONT fresh post-CONT UI read remains false/following durable relaunch true;
no physical OS-suspension claim follows.

Prior v31 **HrJXyy transcript PASS** and **7GmG8j bounded local-live PASS** keep
canonical/pins and receipts below. Live scope was two
normal Sends/three completed real inference POSTs, 15 total requests/no replay.
Earlier whole failures retain their actual boundaries; no cross-artifact final
pass. Manual app v31 SHA
`159dc528aceabce4e5b23b22d261dd6e7d466cc439b366c73428c11525c952bd`
remains compiled only/closed. Earlier desktop live/original 388-file seal proof
stays on its own older product pin. Hosted live is user-deferred; fixture openai/
web checks are not hosted live. Physical touch/device/OS pressure and standalone
normal Settings vault relocation remain unverified.

**Scale v5 FINAL FAILED** its original two-hour seed budget; process closed,
no cleanup error. [Receipt](/private/tmp/pi-product-scale-20261015-v5/product-scale-gate.json)
retains last public progress776, **782 answer +4 summary admissions =786 completed
provider requests**, prefix request bytes13,880,171/max27,796. This is not full
seed/identity/history/archive/restart/final closed proof. IPC is null; sampled
app RSS209,764,352 bytes has helper/renderer coverage unknown. Native build overlap
prevents a controlled timing claim. Keep the original 1005-answer/≤1100 total/
two-hour budgets; **v6 is required after resources on an updated build**, with no
reduction. Final desktop/churn/default regression, repeated paired resources and
full cost/collection/lifecycle evidence remain pending; existing IPC/storage
regressions and unknowns stay explicit. Verdict pending/continue evaluation;
no goal closure, archive or adoption claim.

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
| [01](issues/01-persistent-isolated-evaluation-app.md) isolated persistent app | Integrated copy/recovery/setup and separate installed app | **M live:** 209 copied files; repeated launches retain model/history/review; approved synthetic edits leave original unchanged | Final comparison/resources and remaining platform gates; agent observations are not user trial feedback |
| [02](issues/02-isolate-pi-lifecycle-ownership.md) lifecycle ownership | Integrated explicit Pi API/native domain seam | **R:** 52 legacy files physically absent in compiled comparison builds; lifecycle exclusion checks; **F/C/T/D** actual native slices | Recheck final captured build/default path and full native matrix; ordinary deliverable retains its default runtime |
| [03](issues/03-provider-settings-and-model-switching.md) provider/settings | Integrated frozen native routing and model refresh | **D:** normal model/protocol checks; **P:** compatible and Responses subsets; **M:** configured local model; **L:** bounded local-compatible iOS live passed | Final both-protocol matrix; hosted live explicitly user-deferred, not fixture-equivalent |
| [04](issues/04-conversation-history-and-request-lifecycle.md) history/Stop/Retry | Integrated Pi admission, checkpoints, projection and paging | **D:** first/relaunch/failure slices; **C:** crash recovery; **M:** short Stop then separate Retry completed READY | Complete final concurrent/session/lifecycle matrix; **S** v5 failed budget; updated-build v6 required |
| [05](issues/05-context-discovery-and-evidence.md) discovery/permission/citations | Integrated native policy/evidence and Pi bindings | **P:** selected/current/retained evidence and grants; **M:** actual discover→Deny, fresh Allow once→read/citation/canonical navigation; **L:** admitted native read/normal citation passed | Final race/revocation/platform matrix; paired grant API checks do not prove paired permission-dialog parity |
| [06](issues/06-reviewed-note-changes-and-refinement.md) editable proposals | Integrated durable review/refinement and narrow canonical effects | **D:** real review, checkpoint/conflict/dirty-buffer slices; **F/C/T:** recovery and duplicate-effect slices; **M:** approved normal Keep | Final full review/refinement/termination/iOS matrix; partial runs do not close all races |
| [07](issues/07-faithful-save-to-note.md) faithful Save/origin | Integrated deterministic whole/selection Save | **P:** whole Save/origin, explicit selection append and closed duplicates; **M:** normal Save→approved Keep→Open in chat; **L:** exact Keep/duplicate/final restart; **I:** Save/Keep/relocation recovery; **E:** three independent publication plans/read-backs passed | **E** latest local research/text/image checks passed; whole failed audio continuity refresh; historical openai follow-ons passed v32, whole closed publication proof pending |
| [08](issues/08-first-usable-desktop-milestone.md) desktop handoff | Integrated normal UI harness, app and checklist | **M:** bounded persistent local live scope passed/closed; **D:** 14 first + ten relaunch checks passed | Complete expanded fixture run still failed; hosted live user-deferred; no invented user feedback requirement |
| [09](issues/09-pi-research-and-safe-compaction.md) research/compaction | Integrated isolated Pi worker and safe summaries | **D:** worker summaries and 23 UI follow-ons passed; focused actual-Harness tests | **D** historically lacked parent summary; **E** actual parent/worker summaries and research passed both fixture lanes, whole failed final verifier; v31 intermittent freshness cause unproven, **S** pending |
| [10](issues/10-attachments-and-web-search.md) attachments/web | Integrated native admission, retained bytes and search routing | **D/E:** bounded attachment/web/Retry follow-ons, including v32 both fixture lanes | Complete both-protocol failure/restart/Retry matrix; bounded hosted live web not established and user-deferred |
| [11](issues/11-managed-transcripts-and-relocation.md) transcripts/relocation | Integrated committed projection, conflicts and identity-bound mapping | **T:** desktop watcher/Save/generated-root relocation/uncertain Keep passed; **I:** v31 whole synthetic iOS transcript/sandbox relocation passed | Final combined platform acceptance and standalone normal Settings vault move remain unproven; synthetic/programmatic scope only |
| [12](issues/12-native-fault-and-ios-acceptance.md) native faults/iOS | Integrated fault/crash/storage/iOS drivers; suspension/live preparations | **F/C:** four cases each passed; **D:** five native-storage checks passed; **I:** v31 transcript whole passed; **L:** bounded local iOS live passed; **E:** first14/relaunch6 and artificial STOP/CONT observed | **E** whole failed; v32 fresh post-CONT false/following durable relaunch true; no OS-suspension claim; complete expanded/desktop/churn pending; hosted deferred, physical touch/device/OS-pressure unverified |
| [13](issues/13-replacement-proof-and-evaluation-verdict.md) replacement/cost | Removal/compiler/ledger and paired tooling; v31 strict issued-citation/refusal fixture reviewed and frozen | **R/F/C/T:** removed-tree native slices; **I:** v31 transcript whole passed; **E:** publication proof slices; **P/U:** bounded paired subsets/resources | v34 expanded whole failed post-response continuity refresh; writer unknown, remaining builds unstarted; scalev5 failed; final/default/scale/churn/retention/collection/cost open; no measured speed/adoption/savings claim |

## Receipt provenance and scope

| ID | Artifact / actual result | Scope limit |
| --- | --- | --- |
| **M** | [Manual receipt](/private/tmp/pi-persistent-live-20261015/manual-live.json), `updatedBundleV2`/`liveDiscoveryPermission`; installed product `c74a53e`, probe `2a11f83`, SHA `9328ff2f9fcffdc194ee20631615ff80aecb9adaf5f2ae0846c7eda3526f57b2` | Bounded live local pass: source-free follow-up, canonical citation, approved mutation/Save/origin, two-launch retention, short READY Retry, discovery/Deny/Allow once. Normal Cmd-Q exited 0. Top-level legacy `status:in-progress` remains; completed nested observations establish this bounded scope, not full acceptance. Earlier long-count Retry was stopped, not completed. |
| **R** | v17 comparison canonical `468be149b7a263236c258b6b1f9ef053a7e546ab0b48ac37ab8dea6e314404e6`; desktop SHA `024dad84fbdc2b35c6358fd662c7d7bbdc5c82990f74b1dd7ddae379810e13a5`; [removal ledger](replacement-ledger.md) | 52 actual comparison-tree absences and compiler evidence; not deletion from the normal deliverable or proof that all runtime gates passed. |
| **F** | [K7YRrL fault receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-K7YRrL/fault-gate.json): passed four publication/model-boundary cases, eight provider requests | v17 binary **R**; synthetic fault injection, not real disk exhaustion/OS pressure. |
| **C** | [RJ9Vy0 crash receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-RJ9Vy0/native-crash-gate.json): passed four cases | v17 binary **R**; prepared-review and transport-completed crashes under both synthetic protocols; no physical-device guarantee. |
| **T** | [HVmzV1 transcript receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-HVmzV1/native-transcript-gate.json): passed four checks, six provider requests | v17 binary **R**; generated-root relocation, exact pending review/recovery and duplicate one-effect checks; standalone Settings move excluded. |
| **D** | [6xfnis desktop receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-6xfnis/desktop-interactive-gate.json): **whole failed**, 141 requests; 14 first, ten relaunch (six core/four failure), five storage and 23 follow-on UI checks passed | v19 SHA `0ced4b174e8f453bdcc0c39dc50bcbb9c36700910713b0d5eda5d7f4c91a2095`, canonical `836a19cf05ff18dfc96cd809b8ae8253981c6966672dd356075c0b654f05b069`. Strict native parent summary missing: adjacent selected context grounded warmups, 10,990-byte parent request stayed below 96k threshold. Worker summaries do not replace parent proof. Selection setup correction prepared. |
| **I** | [HrJXyy v31 transcript receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-HrJXyy/ios-transcript-gate.json): **whole passed**, six synthetic requests, binary `5c3cc2c7ebc63ffb88945aee2087a3aefa3a76ed5e88933b5f181554163506f0` | Watcher edit/delete/normal Convert/Restore, sandbox relocation/pending body-version/retained conflict, uncertain Keep recovery/duplicate and source/Origin/unknown-root checks. Synthetic programmatic WKWebView, not physical/live/Settings move. Prior [0cCfVn v30](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-0cCfVn/ios-transcript-gate.json) and [z3TtcW v27](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-z3TtcW/ios-transcript-gate.json) whole passes retain own pins; earlier failures remain historical. |
| **L** | [7GmG8j v31 local-live receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-7GmG8j/ios-live-gate.json): **whole passed**, binary `1ea5f166d510eb7d9dea35b2e03989061ed7347ef13d4bca032c8aae8ada9bdb`, two Sends/three completed real inference POSTs/15 total requests, `noReplay:true` | Normal continuity/read/citation, Save/edit/background, pending restart, Keep/duplicate/final committed restart. Bounded local/programmatic simulator scope; hosted user-deferred, physical touch/OS pressure unverified. Prior [B6Dw3j v30](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-B6Dw3j/ios-live-gate.json) and [ZlW6lU v26](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-ZlW6lU/ios-live-gate.json) whole passes retain own pins; failures remain historical. |
| **E** | [cE9fvy v34 expanded receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json): **whole failed**, 88 requests, first14/relaunch10 checks and local research/parent-worker compaction/freshread/text/image passed; binary `8ccdf4b08c0e38e8f3c1af79bc762ced1f4a9b3fbb58da9abc1d172ed0da5607` | Post-response audio gen508 failed continuity refresh after3 invalidations/no AdmittedAnswer; actual writer unknown. [Forensic receipt](/private/tmp/pi-removal-final-20261015-v34/artifacts/ios-expanded-failure-boundary.json) binds exact error/source/pin. Remaining builders unstarted/queue failed. Prior [5W81zD v33](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json) standalone-validation failure; [WRrwST v32](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-WRrwST/ios-interactive-gate.json) all fixture follow-ons passed then Documents-layout verifier failed, not relocation; [3g4HLR v31](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-3g4HLR/ios-interactive-gate.json) freshness failure retained. v32 STOPCONT fresh-UI false/following durable relaunch true is not OS suspension. |
| **P** | [Compatible v8](/private/tmp/pi-paired-compatible-20261015-v8/paired-parity-gate.json) and [Responses v2](/private/tmp/pi-paired-responses-20261015-v2/paired-parity-gate.json): both old/Pi `passed-prepared-subset` | Frozen v13 frontend, Pi v2 binary `a1ec5982e1f8ea74a80dffef75d858fa94c1cd83c41f6219212d851ef750a338`; old `4b5ff2de` fixture binary `d5e3a76aed10c9441dc76e4d9d768d497a209a8be06434ce4d3ab254bbb60bc0`. Evidence/grants/body review/Save/selection append/closed duplicates only. Old title read-only; Pi editable. Grants use public API; permission dialogs not compared. |
| **U** | [Resource v8 receipt](/private/tmp/pi-shared-resources-20261015-v8/shared-resource-gate.json): both lanes `passed-core-fixture`, eight requests, exact 256-line/9,215-byte output; [audited measurements](replacement-proof-plan.md#audited-paired-core-resource-checkpoint--v8-2026-10-15) | Old fixture binary above, Pi **R**. Actual module IPC observed: old 26/Pi 1,159 warm calls; closed logical storage old 684,378/Pi 2,059,929 bytes. Material observed bridge/storage increases disclosed. One rejected Pi invoke response size unknown; JSON proxies are not wire bytes. App-only RSS, uncontrolled cache/order and observer overhead prevent a performance-win claim. |
| **S** | [v5 scale receipt](/private/tmp/pi-product-scale-20261015-v5/product-scale-gate.json), frozen v22: **final failed** two-hour seed budget; last public progress776, 782 answers+4 summaries=786 completed requests, 13,880,171 request bytes/max27,796 | No complete seed/identities/history/archive/restart/final closed proof. Process closed/no cleanup error. IPCnull; app-only RSS209,764,352 bytes/helper-renderer unknown; builds overlapped, no controlled timing/performance claim. Original1005-answer/≤1100 total/two-hour budgets unchanged; updated-build v6 required after resources. Prior v3 SHM ENOENT/v4 operator-ended failures remain retained; no continuation acceptance. See [scale contract](product-scale-proof-plan.md). |

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

1. Diagnose v34 post-response audio continuity refresh invalidations and identify
   the actual writer; it remains unknown. Friendly exact-error mapping is only
   presentation, not an underlying fix. Preserve forensic/closed backup evidence.
2. Capture/build any reviewed change and rerun whole expanded native acceptance
   through all follow-ons and final closed publication proof. v34 passed local
   research/text/image slices do not make its whole run pass; v32's historical
   all-follow-on pass does not establish later intermittent failures fixed.
3. Remaining iOS/desktop builders did not start after v34 queue failure; desktop
   queue produced no gates. Final desktop/fault/crash/transcript/churn, three
   alternating Pi/old/Pi resources, updated-build scalev6 and fresh default smoke
   remain pending. Preserve original1005-answer/≤1100 total/two-hour scale budgets.
   v5 is closed failed; retain pins/path/cache/observer/renderer/IPC/storage unknowns.
4. Keep v31 transcript/local-live and earlier passes independently pinned; rebuilt
   manual app remains compiler-only/closed. Hosted live is user-deferred;
   simulator/artificial STOPCONT does not prove physical OS suspension/touch/
   device/radio/OS pressure or normal Settings vault relocation.
5. Reconcile lifecycle/listener, retained-family/collection, scale and resource
   evidence with unknowns/regressions intact, then acceptance/ledger/verdict.
   Verdict pending/continue evaluation; no goal closure/archive/adoption claim.
