# Pi evaluation ownership and replacement cost ledger

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

Source inspection: 2026-10-15. Baseline:
`4b5ff2de500db089787b3d7adefb40d99f13a574`, read from the pinned source at
`/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de`. The current frozen v51 source and bounded final native acceptance are recorded below. This ledger is a source inventory and responsibility comparison for
[ticket 13](../archive/pi-durable-chat-evaluation/issues/13-replacement-proof-and-evaluation-verdict.md), **not full ticket
acceptance, measured savings or production adoption**. It now records
actual comparison-tree removal/compiler/native receipts produced by the native
owner, separately from this worker's read-only source inspection.
The v17 removal/compiler/native slices below are bound to their frozen v17
source. Each later compiler/native result must retain its exact captured inputs. Historical
resource/scale observations do not automatically rebind to changed source. The [spec](../archive/pi-durable-chat-evaluation/spec.md),
[proof plan](replacement-proof-plan.md)
and [removal reproduction contract](removal-experiment-preparation.md) define
the remaining gates.

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

## Retained v38 functional/resource/scale checkpoint

Historical immutable **v38** source, HEAD `44d200d`, is
`/private/tmp/pi-removal-final-20261015-v38`, canonical manifest
`14ceb2312d90d66f870cc273a4e6372e7c7f6403b88fc4a109eb5d7013100728`.
Removed-tree desktop binary
`c9f08ac067cf58c671da4ae62c6728d69d37048cfb63e749fea7b07f32272c1e`
and served frontend
`23e74527ceaac2692a194c3d6e46e6464fc109b96b764628be74fdcc71ffcb88`
are pinned to v38. Temporary native diagnostics are absent; settled-preparation repair
remains. **At this historical checkpoint acceptance/verdict were open; the current
bounded recommendation and separate final reconciliation are recorded above.**

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

**Full scale v6 passed its bounded fixture**, exit 0 at 08:17:40 UTC, on frozen
v38 inputs: [receipt](/private/tmp/pi-product-scale-20261015-v6/product-scale-gate.json),
[accounting/limits](/private/tmp/pi-v38-scale-final-analysis-20261016.md),
[root closure](/private/tmp/pi-v38-scale-root-native-closure-20261016.json).
Exactly 1005 answers plus six actual summaries completed (1011 requests); all
1005 conversations/1005 inputs/2010 messages and identities survived restart,
ten chats archived/restored and no implicit replay occurred. Closed current
documents were 9053 before/after; final logical files 64797047 bytes. Public
listing is aggregate-only; verified IPC/private watchers/physical collection,
actual focus and full-process RSS remain unknown. Archive is not collection.
The later linked v48 check above is not another full scale/cost run. Historical
v22 scale v5 remains failed. Final persistent handoff/closure evidence stays open.

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
recorded 388 files at its observation, SHA
`66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`.
The later final original-vault observation at the current checkpoint differs
with cause unestablished; no continuous/final equality is claimed.
Hosted live is user-deferred. Physical touch/device/OS pressure, private resource/
controller-disposal/collection counts and standalone Settings vault relocation
remain unverified. No adoption/performance-win/goal-closure claim.

Material historical failures: [v37 desktop origin](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-qHtwIk/desktop-interactive-gate.json),
[v34 continuity](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-cE9fvy/ios-interactive-gate.json),
[v33 validation](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-5W81zD/ios-interactive-gate.json),
[v32 Documents verifier](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-WRrwST/ios-interactive-gate.json).
Earlier diagnostic passes retain their own pins and do not replace clean v38 evidence.

## Historical source inventory at v23 capture

The following inventory is frozen at v23, before later live-probe
corrections; it is not a recomputed v38 or v48 native/frontend total. The new fixture-close
wrapper/registration and shared proof adapter remain added maintained obligations. It is
an inventory of maintained source, not measured savings or executable-function
counts. The 52 comparison-tree deletions remain absent in v23; the default
deliverable still deletes zero legacy files. The v23 desktop compiler/exclusion checks and three iOS builds passed;
native journey results remain separate.

| Bounded inventory | Baseline `4b5ff2de` | Historical v23 |
| --- | ---: | ---: |
| Pi normal static TS closure from `chatApi.ts` | 5 files / 42,679 bytes / 494 lines | 17 files / 173,405 bytes / 2,020 lines |
| All non-test Pi TS, including diagnostics | 8 files / 69,293 bytes / 799 lines | 44 files / 368,243 bytes / 4,321 lines |
| Separate Pi TS tests | 0 files | 36 files / 248,772 bytes / 2,875 lines |
| Top-level native `pi_*.rs`, excluding separate test files | 4 files / 32,508 bytes / 570 lines | 12 files / 195,427 bytes / 4,100 lines |
| Seven explicitly extracted domain/command paths | Embedded in other modules | 92,288 bytes / 2,365 lines |

The normal static closure follows top-level relative import/export declarations
within the Pi directory, using the installed TypeScript parser. It excludes
dynamic imports, shared UI/domain modules and third-party dependencies. Lines
are physical LF lines; bytes are UTF-8. The closure's sorted
`path + NUL + fileSHA256 + LF` inventory hash is
`2ca43b081d5905fc23fbf6b3fde155400a2683efcf3f4ddd0466f4e10174c59f`.
Its 481 syntax function bodies include 403 arrows; 73 per-file distinct named
function declarations/expressions have bodies. Baseline equivalents are 151
bodies / 137 arrows / 11 names. These are syntax counts, not a comparison with
the Rust lexical counts below or a count of lifecycle responsibilities.

The native Pi files contain 151 per-file distinct lexical `fn` names, including
inline tests/inactive cfg, versus 23 at baseline. Seven extracted paths are
`chat_domain.rs`, `provider_config.rs`, its `local_reasoning.rs` and
`model_metadata.rs`, `proposal_policy.rs`, `note_promotion.rs`, and
`commands/pi_chat_commands.rs`; their policy was already maintained inside other
owners. Extraction is not wholly new policy or eliminated maintenance.

Ten custom Pi document definitions (six singletons/four families), two custom
tasks and the separate request-entry contract remain app-maintained. Pi AI,
Pi Durable and Chord remain pinned at 1.3.0. The responsibility table below,
actual bridge/storage observations and recovery obligations are the substantive
replacement comparison; source size alone cannot establish a simpler system.

## Authority being replaced

The production baseline implements ADR 0001: `ChatService` owns durable
conversation/run/proposal lifecycle and invokes the Rust agent runtime. The
evaluation deliberately tests the contrary owner in isolation. ADR 0001 and the
ordinary default runtime remain in place; this inventory does not revise that
decision. ADRs 0002, 0009 and 0011 still govern NoteTimeline publication,
evidence access and ordinary source links in saved notes.

| Concern | Baseline owner | Integrated Pi owner and maintained obligation |
| --- | --- | --- |
| Input admission, accepted work, committed model/tool history, cancellation | `chat/admission.rs`, `chat/store.rs`, `ChatService`, `AgentRunCoordinator` | Pi Harness submissions/tasks/entries; `chatApi.ts::submit` admits the request snapshot and evidence bindings with the input. The adapter must project Pi identities into ChatApi and reject a second active admission. |
| Model/tool loop and child research | `AgentRuntime::run`, `run_model_with_measurement`, `agent_tools/research.rs::run_research` | Pi `GenerationTask` and task-owned child conversations in `research.ts::executeResearch`; native transport makes one inference dispatch per fetch. Research still needs an isolated tool set, parent authorization, scope/temporal inheritance, handoff validation, usage attribution and cleanup. |
| Terminal answers and partial streams | `chat/runtime.rs::finalize_agent_response`, terminal transactions and `StreamingCheckpoint` in `chat/store.rs`, `chat/answer_stream.rs` | Pi provider entries and `AdmittedAnswer`; `nativeProvider.ts`, `notesExtension.ts` and `streamProjection.ts` keep validated final output separate from provisional structured text and acknowledge ordinary partial checkpoints. Pi storage does not validate note evidence automatically. |
| Retry/restart | `ChatService` run registry, `chat/store.rs::recover_interrupted_requests`, original run/context rows | Pi task restart/abort semantics plus the adapter's durable `gneauxghts.request` snapshot; explicit Retry rereads the original input/configuration. `chatApi.ts` restores visible history/reviews without implicitly replaying interrupted network work. Native quiesce must join frontend/storage/transport queues before NoteTimeline closes. |
| Pending Note Proposals and decisions | `chat_agent_proposals`, working-draft/origin/receipt tables, `chat/note_proposals.rs` | `Reviews`, keyed `Review` and `ReviewTask` in `reviews.ts`; exact version/payload acceptance in `reviewState.ts`. The document runtime still owns the live editable body/title/hunks and the global review workflow still owns UI admission/committed adoption. |
| Canonical effect | Legacy proposal IPC coordinates `ChatService` status with NoteTimeline | `pi_prototype_publication.rs::publish` validates accepted payload/access/identity/target, prepares an intent, calls NoteTimeline, then records a receipt. Neither Pi transactions nor a review decision can atomically commit Markdown. |
| Settings, grants/exclusions, composer drafts and model capability policy | Mixed into `ChatService` and legacy chat commands | Extracted `ChatDomain` and `commands/pi_chat_commands.rs`; four configuration/policy tables remain in vault `ai.sqlite3`. These are retained app policy, not a second Pi lifecycle store. |
| Evidence and source navigation | `services/evidence.rs`, NoteTimeline, chat citation/admission wrappers | The same domain services, reached through `pi_prototype_notes.rs`; app-issued evidence sessions, per-request records, current access/freshness checks and exact source proofs remain mandatory at operation/provider boundaries. Hook exceptions alone cannot authorize or block delivery. |
| Save whole answer/selection/addition | `chat/note_proposals.rs` durable workflow and embedded deterministic policy | Pi review/origin documents plus `save.ts`, `pi_prototype_save.rs`, extracted `proposal_policy.rs` and `note_promotion.rs`; deterministic selection/association/ordinary-link policy remains app code. Direct Save must issue no model request. |
| Managed Markdown, conflicts and relocation | `chat/projection.rs`, `chat/relocation.rs`, transcript import in `chat/recovery.rs` | Derived Pi snapshot publication in `transcript.ts`/`pi_prototype_transcript.rs`, receipt/hash conflict handling and identity-bound root mapping in `pi_prototype_relocation.rs`. Transcript import is omitted by explicit scope; derived Markdown cannot recreate lifecycle authority. |
| Compaction | Persisted `ChatService` history preparation and ephemeral `agent_runtime/compaction.rs` | Pi compaction task plus app-defined safe summary task/state/baselines/usage. The adapter retains original request context, validates reduction/schema, attributes usage and rechecks evidence before continuation. A summary is not evidence or permission. |

## Legacy code conditionally excluded

`src-tauri/src/lib.rs` uses `cfg(not(feature = "pi-prototype"))` on the
guardrails, permissions, coordinator, runtime, tools and legacy chat roots. With
the feature enabled, `chat` resolves to `pi_chat.rs`; `commands.rs` resolves chat
commands to `commands/pi_chat_commands.rs` and excludes
`commands/proposal_commands.rs`. Startup constructs `ChatDomain` rather than
`ChatService::new_managed`. Frontend `features/chat/api.ts` names every Pi method
and selects it using `VITE_PI_PROTOTYPE`; retained native settings/policy methods
are explicit delegations, not missing-method lifecycle fallback.

The following are **excluded in that feature graph, retained in the deliverable
for the default runtime, and physical-removal candidates**. Function examples
name baseline functions, not all declarations or a compiler-resolved count.

| Candidate paths under `src-tauri/src/` | Representative superseded functions/responsibilities |
| --- | --- |
| `agent_run_coordinator.rs` | `AgentRunCoordinator::execute` hands the old run to the Rust runtime. |
| `agent_runtime.rs`, `agent_runtime/*.rs` | `AgentRuntime::run`, `run_model`, `run_model_with_measurement`; compatible/Responses Rig construction, result streaming, local reasoning, context measurement/capacity, usage guard and `RollingContext::compact`. |
| `agent_tools.rs`, `agent_tools/**` | Tool registration/context, capability/permission wrappers, evidence model-reference wrappers, note-save tools, feedback normalization and research (`run_research`, `configure_worker_request`, `isolate_request`, `validate_selection`). Retained underlying domain services are listed below. |
| `agent_guardrails.rs`, `agent_permissions.rs` | Old shared run-limit/cancellation guard and permission request/decision coordination; the evaluation still maintains equivalent authorization/cancellation obligations at its own boundaries. |
| `chat.rs` | `ChatService::new_managed`, `create_conversation_with_config`, `cancel_request`, `decide_agent_permission`, `normalized_rig_history`; legacy active-run registry, durable conversation/configuration projection and history assembly. Extracted settings/source/domain types are retained separately. |
| `chat/admission.rs`, `chat/store.rs`, `chat/runtime.rs`, `chat/answer_stream.rs` | `admit_request`, `streaming_checkpoint`, `store_terminal_message`, `persist_terminal_outcome`, `persist_terminal_with_associations`, `recover_interrupted_requests`, `run_request`, `run_agent_response`, `finalize_agent_response`, `generate_model_conversation_title`; old request/terminal/partial coordination. |
| `chat/note_proposals.rs` | `prepare_note_save_selection`, `prepare_note_save_target`, `checkpoint_proposal_draft`, `refine_proposal_draft`, `save_proposal_receipt`, `recovered_proposal_receipt`, `refresh_saved_addition`; old durable draft/origin/status/receipt workflow. Deterministic content/link/placement policy was extracted, not eliminated. |
| `chat/projection.rs`, `chat/recovery.rs`, `chat/relocation.rs` | `write_projection_locked`, `mark_projection_detached_if_needed_locked`, `recover_transcript_conversations`, `import_conversation`, `relocate_persisted_paths`; old lifecycle-derived projection/recovery/root rebinding. |
| `commands/chat_commands.rs`, `commands/proposal_commands.rs` | Native conversation/run/permission/review IPC dispatch and old canonical-effect/status coordination. Pi domain commands and effect adapters remain. |
| Remaining `chat/**` except `citations.rs`, `date_time.rs`, `structured_answer.rs` | Legacy tests, instruction/evaluation text and fixtures. Their removal is an inventory change, not removed runtime behavior. |

The historical read-only `removal-experiment.py::plan` inspection found **130 conservatively reachable Rust
module files** and **52 disjoint candidate files**, totaling **1,168,539 bytes**
and **791 per-file distinct lexical `fn` names** at inspection. The corresponding
52 baseline files total **1,206,491 bytes / 814 lexical names**; 49 files are
byte-identical. These totals include tests, inactive cfg, fixtures and prose;
names reused in different files count again. They are not production-function
counts, savings or compiler proof. The changed/extracted policy explains why
deleting a whole legacy file must not be counted as deleting all its obligations.

| Candidate family at historical inspection | Files | Bytes | Lexical names |
| --- | ---: | ---: | ---: |
| Guardrails / permissions / coordinator | 3 | 37,413 | 39 |
| Rust runtime root and directory | 10 | 174,297 | 132 |
| Rust tools root and directory | 19 | 406,863 | 254 |
| Legacy chat root and candidate descendants | 18 | 477,443 | 293 |
| Legacy chat/proposal command implementations | 2 | 72,523 | 73 |

**Actual comparison-tree removals: 52 files; default-deliverable removals: zero.**
The native owner prepared and compiled the isolated v17 comparison tree at
`/private/tmp/pi-removal-final-20261015-v17/source`. Read-only verification against
its `removal-ledger.json` found all 52 manifest-listed paths absent there, all 52
retained in its `removed-source` archive, and all 52 still present in the default
worktree. Thus the feature graph is no longer the only exclusion evidence, while
the default runtime's source and maintenance cost remain retained pending a
separate adoption decision.

| v17 removal proof | Bound evidence / limit |
| --- | --- |
| Canonical source manifest | `468be149b7a263236c258b6b1f9ef053a7e546ab0b48ac37ab8dea6e314404e6` |
| Removal manifest/archive | `/private/tmp/pi-removal-final-20261015-v17/removal-ledger.json`; 52 paths/hashes/bytes/lexical names; archived bytes under `removed-source` |
| Compiled desktop artifact | SHA-256 `024dad84fbdc2b35c6358fd662c7d7bbdc5c82990f74b1dd7ddae379810e13a5`; `artifacts/desktop-build.json` records `removedFiles: 52` and matching canonical source digest |
| Compiler log | `/private/tmp/pi-removal-v17-desktop-build.log` |
| Publication fault `K7YRrL` | Passed after-intent/after-publication/after-receipt/during-model cases; eight synthetic provider requests; same binary |
| Fault receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-K7YRrL/fault-gate.json` |
| Native crash `RJ9Vy0` | Passed prepared-review and transport-completed boundaries for local/OpenAI synthetic protocols; each prepared-review has one canonical file/effect row/publication receipt; transport-completed has zero canonical effects |
| Crash receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-RJ9Vy0/native-crash-gate.json`; transport withholds terminal before Pi terminal commit, not proof of a failed Pi COMMIT |
| Desktop transcript `HVmzV1` | Passed four checks: watcher edit/delete/Convert/Restore with preserved ordinary copy; full generated-root relocation/session/source/origin/conflict/pending review; UI Retry Keep plus duplicate API Keep one effect/no inference; known-old-root-only mapping/copied legacy inert |
| Transcript receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-HVmzV1/native-transcript-gate.json` |
| Expanded desktop | Partial first/relaunch passes; v17 `r3L0r7` closed failed at visible failed-checkpoint deadline; no complete expanded native pass |
| Remaining limits | No full iOS, scale, final removal/evaluation acceptance or production adoption; standalone Settings-selected vault move remains unproven |

These are actual removal-tree/compiler and bounded synthetic native observations,
not removed production functions or measured savings. They do not make the
remaining expanded/iOS/scale gates pass or reconcile later source snapshots
implicitly. Later snapshots and partial gates are tracked in
[progress](progress.md) and [desktop acceptance](desktop-acceptance.md).

## Retained policy, editor and effect services

- `chat_domain.rs` retains `ChatSettings`, `VaultAccess`, `ChatSource`, grants,
  exclusions, composer drafts, capability selections, migrations and SQLite
  configuration. `get_settings`, `set_defaults`, `note_is_allowed`, `grant_note`,
  `revoke_note` and related operations exist independently of `ChatService`.
- `provider_config.rs` retains endpoint/platform validation;
  `commands/pi_chat_commands.rs` retains native keyring access and model metadata/
  capability policy. Secrets never become Pi documents or fixture evidence.
- `pi_chat.rs` retains `chat/citations.rs`, `chat/date_time.rs`,
  `chat/structured_answer.rs` and aliases `proposal_policy.rs`. These are citation,
  calendar and deterministic answer/selection/placement/decision policy leaves,
  not the old store/runtime/recovery modules. `note_promotion.rs` retains source
  link conversion and identity-bound fragment policy.
- `proposals.rs` retains proposal preview, diff/hunk coordinates, target/path
  checks, `plan_agent_update_commit`, `plan_agent_creation_commit` and canonical
  editor-visible normalization. The Pi adapter calls these services; Pi does not
  acquire direct note-writing authority.
- `services/evidence.rs` and its query/read/inventory modules retain retrieval,
  scoped cursors, current/historical reads, permissions, budgets, exact proofs and
  freshness validation. `services/note_timeline.rs` and its private modules retain
  Note Identity/Revision, Editing Windows, canonical mutation preparation,
  publication, history and recovery. Catalog/task/lexical/semantic reconciliation
  remains behind that canonical seam.
- `src/lib/features/proposals/reviewSession.svelte.ts` and `reviewCheckpoints.ts`,
  document machines/runtime,
  `src/lib/features/notepad/document/documentEditingService.ts`, workspace/navigation/save barriers
  and shared chat controller/components remain. Their one editable review,
  checkpoint-before-switch, dirty-edit protection and committed-adoption duties
  are not replaced or removed by the engine substitution.

`chat_domain.rs`, `provider_config.rs`, `proposal_policy.rs` and
`note_promotion.rs` did not exist as separate files in the baseline. Their
historically inspected combined **65,019 bytes** include extracted existing policy and tests;
they are not 65 KB of purely new behavior or pure savings.

## Added Pi state, stores and recovery cost

The historical normal static local import closure from `chatApi.ts` contained
**17 TypeScript files / 167,407 bytes / 1,944 physical lines** at that earlier
inspection. This is not a current or final-source count: later product changes,
including `c74a53e`, were not included, and no reliable existing closure inventory
has been rerun here. Five of those paths
already existed in the baseline prototype. This closure excludes dynamic
fixture/probe imports, tests, shared UI/controller files and dependencies. The
historical 12 top-level `pi_*.rs` files excluding separate test files totaled
**195,427 bytes / 4,100 lines**, including inline tests, diagnostics and fixture faults; retained
domain files and composition changes are additional. These inventories describe
maintained surfaces, not comparable executable sizes or net cost.

The product path at that source inspection defined **ten custom Pi document kinds** (six singleton kinds,
four keyed families), plus **two custom task definitions**. Upstream Pi documents
and tasks are additional; probe-only kinds are excluded from this count.

| Definition / file | Scope and purpose | Recovery/retention obligation |
| --- | --- | --- |
| `Meta` / `chatApi.ts` | Conversation `gneauxghts.pi.chat-presentation` | Title/archive/reasoning presentation; archive hides without physical collection. |
| `Evidence` / `notesExtension.ts` | Conversation `gneauxghts.pi.evidence` | Current request access, context, issued sources/read activity/permission identities. Must not grant current authority from stale persisted state. |
| `EvidenceRun` / `notesExtension.ts` | Session keyed `gneauxghts.pi.evidence-run` | Per-request source/grant/navigation records survive later sends and interruption. Lifecycle retirement/collection remains a separate gate. |
| `AdmittedAnswer` / `notesExtension.ts` | Session keyed `gneauxghts.pi.admitted-answer` | Validated text, selected sources/grants and segment associations for durable projection/Save. Provisional text cannot substitute for admission. |
| `Reviews`, `Review` / `reviews.ts` | Session catalog and keyed `gneauxghts.pi.review` | Origin deduplication, proposal/draft version, pending decision, exact accepted payload, publication receipt/version and refinement replay record. Catalog/family growth remains maintained storage. |
| `ResearchWorker` / `research.ts` | Conversation `gneauxghts.pi.research-worker` | Parent/session/call binding; isolated child tasks must abort/release native evidence and provider policy on every exit. Child conversation storage is real retained cost. |
| `ContextBaselineDoc` / `compaction.ts` | Conversation `gneauxghts.pi.context-baseline` | Observed capacity/usage projection invalidates on context/configuration changes. No guessed token capacity can become authority. |
| `CompactionState` / `compactionState.ts` | Conversation `gneauxghts.pi.compaction-state` | Durable ready/pending/failure state prevents unsafe continuation after failed/interrupted summaries. |
| `SummaryUsageRun` / `compactionState.ts` | Session keyed `gneauxghts.pi.summary-usage` | Per-session summary spend and worker attribution; must avoid double counting. |
| `ReviewTask` / `reviews.ts` | `gneauxghts.pi.review` | Wait for decision; Keep invokes native effect then converges receipt/status. Uncertain publication preserves accepted payload and requires reconciliation; Discard cannot cancel an accepted unknown effect. |
| `summaryTask` / `compaction.ts` | `gneauxghts.pi.safe-summary` | Closed summary schema, bounded/reducing output, usage accounting, cancellation, post-inference freshness and restart abandonment. |

`gneauxghts.request` is an admitted **entry kind**, not an eleventh document:
it carries original user input, attachments, selected context, provider/model/
capability settings, safe history, temporal anchor and retry lineage. Retry must
use it rather than inferring context from transcript proximity. `LiveDoc`,
`ProviderDoc`, `UsageDoc`, `GenerationTask` and `CompactionTask` are upstream
engine state/tasks, not custom definitions counted above.

| Durable boundary | Physical owner | What remains app-maintained |
| --- | --- | --- |
| Pi schema | App-data `PROTOTYPE-wipe-me/pi.sqlite`, upstream `SqliteStorage` through `nativeSqlite.ts`/`pi_prototype.rs` | IPC serialization, integer/blob encoding, transaction queue/handles, leases/revocation, rollback, restart acknowledgement/close ordering. Pi owns schema/lifecycle; the bridge still owns native transaction correctness. |
| Retained configuration/policy | Vault-data `ai.sqlite3`, `ChatDomain` | Four initialized settings/policy/draft/capability tables; legacy grant migration/revocation. No new generic conversation/run/message/proposal tables belong here. |
| Canonical publication adapter | App-data `PROTOTYPE-wipe-me/publication-receipts.sqlite`, `effects` table | Accepted-payload hash, Note Identity/target/intended hash, temporary proof and receipt. Recover exact prior publication after acknowledgement loss without overwriting a later ordinary edit; retire temporary proof after receipt. |
| Managed transcript adapter | Vault-data `pi-transcripts.sqlite`, `projections` table | Derived publication intent/Markdown/hash receipt, detached/conflict state, recovery and explicit restore/convert choices. This is an effect ledger, not imported conversation history. |
| Vault binding/relocation adapter | App-data `PROTOTYPE-wipe-me/locations.sqlite`, `vault_locations` and `pi_vault_owner` | Root history and one stable vault owner; only proved root relocation may alter displayed paths, never accepted hashes/authored strings or authority. |
| Canonical note/history | Existing Markdown and vault NoteTimeline store | Existing identity, mutation preparation, history/reconciliation and portability obligations remain in full. |

`nativeProvider.ts` and `pi_prototype_transport.rs` add/reuse a native fetch
adapter with frozen admission/configuration, current policy validation, stream
abort/join, credential and attachment admission, request-purpose isolation and
supported web-search configuration. `pi_prototype_notes.rs` adds evidence-session
binding and admission/navigation commands; `pi_prototype_research.rs` coordinates
native scope/handoff checks rather than running a model. `pi_prototype_context.rs`
observes loaded capacity; it is not a hidden model loop.

`chatApi.ts` maintains active/admitting/permitted/request-policy maps, event and
evidence watches, sequence correlation, review announcements, source/status
projection and transcript scheduling. `close` joins watchers/transcript work,
closes Harness and releases provider/evidence sessions. These ephemeral maps and
queues are adapter coordination, not free engine savings. The review state
machine, effect reconciliation, startup shutdown handshake and policy validity
machine remain app responsibilities even when durable tasks run in Pi.

Later product work adds maintained coordination cost beyond that historical
inventory. `chatApi.ts` now preserves tool-rich read activity across generic
`message_end` projection, correlates admitted read events with native policy and
conversation access revisions, and rechecks admission after awaited validation.
Its terminal-origin/read-evidence/pending-commit paths must reject revoked or
cross-conversation evidence rather than reviving stale parts. The request and
provider policies in `notesExtension.ts`/`nativeProvider.ts` still validate current
evidence before dispatch and answer admission. Research activity must match the
shared UI schema, and review recovery must restore persisted uncertainty through
identity-checked UI admission. These are real adapter/state-coordination and
regression-test obligations; they are not functionality Pi removes. No new byte,
line, document-kind or net-savings total is inferred from this qualitative update.

Pi Durable, Pi AI and Chord remain pinned at **1.3.0** in `package.json` and the
lockfile. Evaluation preserves ordinary Rust runtime dependencies/default wiring;
conditional source exclusion is not a dependency-size or supply-chain reduction.
Both TypeScript/provider protocol adapters and native Tauri/Rust bridges remain
maintained compatibility seams.

## Evidence, omissions and unresolved cost

Executed by this ledger worker: read-only baseline/current source inspection,
the existing read-only removal planner, and
`python3 -B scripts/pi-prototype/removal-experiment.test.py`: **7 pure tests pass**.
The planner proves disjointness only in its conservative external-module graph.
Inline modules/macros, target cfg, type checking, application linking and
runtime behavior require the real compiler/native gates. The existing
`src-tauri/tests/pi_lifecycle_exclusion.rs` documents those static checks; this
worker did not run Cargo, a build, app, provider, port or simulator.

This worker ran no native/compiler operation. The actual v17 passes above are
read from the native owner's bound receipts; they retain their original pins.
Earlier binaries or source-test passes cannot be relabeled final-source proof.
The current checkpoint records actual v51 whole iOS/linked history, all five iOS
faults, desktop retry and final normal manual handoff passes, retaining the failed
first desktop attempt and v48/v38 evidence. The final index and root semantic
receipt record bounded required acceptance complete; archive reconciliation
remains with its owner. These results do not establish unobserved gates, even if
empty generic native lifecycle tables are observed. Static exclusion is supporting
evidence, never an assertion of product parity.

Branching, standalone excerpt workflows, old-conversation/transcript import,
physical iPhone acceptance and production adoption are scoped omissions, not
replacements or complexity savings. Selection Save and its Open in chat origin
remain required despite standalone excerpt omission. The Pi API explicitly
rejects deferred workflows rather than routing to legacy lifecycle methods.

`scanAll` follows real upstream cursors in 128-row pages and rejects an unchanged
cursor; list/history do not intentionally stop at 1,000. Their public returns
still materialize arrays and summaries, and startup transcript scheduling scans
all conversations. Rebuilding growing history, per-origin review reads and
derived transcripts can cause substantial repeated work. Archive is visibility,
not physical collection. No app collection API, bounded private watcher count,
or acceptable long-history resource growth is established by this source scan.
The [product scale plan](product-scale-proof-plan.md) distinguishes its native
1,005-conversation/1,005-input gate from in-memory engine fixtures.

Bounded resource captures now exist; their exact measured scope and limitations
are recorded in the [proof plan](replacement-proof-plan.md). A complete cost
comparison of cold/warm startup, first visible output, completion overhead,
cancellation, IPC, app/renderer/helper memory, listener lifetime and retained
storage must still be paired against the pinned old artifact at equivalent roots/cache/lifecycle boundaries.
Provider inference time, bridge/engine time, synthetic fixtures and live-provider
journeys remain separate measurements. This ledger records no timing/memory/IPC/
storage improvement and no material-regression threshold invented by the agent.
User feedback must be dated and separate from synthetic/agent observations;
its absence must be disclosed, but receiving it is not an extra spec acceptance
gate. Final recommendation and tracker/archive closure belong to the native
owner after the required evidence is reconciled.

### 2026-10-16 — product scale cost source audit

[Read-only audit](scale-cost-audit.md) distinguishes event-driven product scale from earlier resource-driver polling and identifies full-history reconstruction, empty native source validations, missing summary lookups and retained frozen-history bytes. These mechanisms are not measured attribution, an implemented optimization or a scale pass. Historical v5 failed; bounded v6 passed on v38. This source audit itself is not
measured attribution, an optimization or scale acceptance; immutable-boundary
IPC counters remain unknown.
