# Pi evaluation implementation progress

Current checkpoint: 2026-10-16. Orchestrator `01a141e7-aed3-7962-85b6-2768654155e7`.
Worktree `/Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts`, branch
`codex/pi-durable-native-prototype`. The authorized evaluation remains active.
**Implementation is integrated; final acceptance, verdict and ticket closure remain open.**

## Current checkpoint — 2026-10-16

Immutable v38 source is `/private/tmp/pi-removal-final-20261015-v38`, code HEAD
`44d200d`, canonical manifest
`14ceb2312d90d66f870cc273a4e6372e7c7f6403b88fc4a109eb5d7013100728`.
The removed-tree desktop binary is
`c9f08ac067cf58c671da4ae62c6728d69d37048cfb63e749fea7b07f32272c1e`;
served frontend is
`23e74527ceaac2692a194c3d6e46e6464fc109b96b764628be74fdcc71ffcb88`.
Temporary diagnostics are removed; settled-preparation repair remains. The
comparison tree has 52 actual legacy-file absences; the ordinary deliverable
retains its default runtime. See [ownership/cost ledger](replacement-ledger.md).

[Desktop queue](/private/tmp/pi-final-desktop-queue-v38-20261015.json) records all
seven functional classes passed: expanded, publication faults, native crashes,
transcript, compatible/Responses prepared paired subsets and owned churn.
[All three clean iOS gates passed](/private/tmp/pi-final-ios-queue-v38-20261015.json):
expanded, synthetic transcript/sandbox relocation and bounded configured-local live.
[Receipt table and scope](desktop-acceptance.md#commands-and-receipts) and the
[13-ticket matrix](validation-matrix.md) bind the individual pins and limitations.

Three controlled paired core-resource runs passed, Pi/old → old/Pi → Pi/old,
24 bounded compatible fixture requests total. **Material observed regressions**:
old→Pi median warm module calls 26→1085 (41.7×), request JSON proxy bytes
2187→321954, closed logical storage 684378→2059929 bytes (3.01×). Known response
proxy subtotal is 119536→1778331 bytes, with one Pi response size unknown per run.
Lower startup and sampled app-only RSS do not establish an overall performance win.
[Measured table/limits](desktop-acceptance.md#resource-observations) and
[prose-free summary](/private/tmp/pi-v38-controlled-resource-summary-20261016.json)
retain ranges, cancellation differences, IPC/storage and provenance limits.

The original desktop queue failed only ordinary default smoke: first three specs
passed 2+2+1; chat-to-note passed eight/failed one at the initial edited-review input
wait, with an extra trailing LF. **Unchanged focused one-test and full 14-test/four-spec
continuations passed**, both closed. The
[continuation receipt](/private/tmp/pi-v38-default-continuation-20261016.json)
retains original failure/log hashes; no product/test/trim change or mechanistic fix
is claimed. Root verified native closure/absent ports/simulator shutdown before scale.

**Full scale v6 is RUNNING**, session66327, started 07:19 UTC in fresh
`/private/tmp/pi-product-scale-20261015-v6`, without overlapping native work.
Unchanged budgets: 1005 answers, ≤1100 total requests including actual summaries,
two hours. No final seed/history/identity/archive/restart/closed-proof result yet.
Historical v22 scale v5 failed its two-hour seed budget; a completed prefix is not
scale acceptance. Final persistent normal-app handoff/closure is also open.

## Source-bound tests

| Evidence | Recorded result and binding |
| --- | --- |
| [Post-fix static checks](/private/tmp/pi-origin-fixed-static-checks-20261016.json) | Support 38; Vitest 1631 tests/192 files; Node 166; Svelte zero errors/warnings; e2e TypeScript passed. Frontend digest and six changed-input hashes match immutable v38. |
| [Full Rust](/private/tmp/pi-final-full-rust-receipt-20261016.json) | Pi 754 passed/20 ignored; default 944 passed/32 ignored; each has 21 architecture/three exclusion/one runtime checks passed. Reused, not rerun: [v37→v38 diff](/private/tmp/pi-removal-final-20261015-v38/v37-v38-source-diff.json) contains exactly six frontend/driver files and no native changes. |
| [Prior static receipt](/private/tmp/pi-final-static-checks-20261016.json) | Python 89 retained with unchanged inputs. Earlier frontend/Node counts are superseded by the matching post-fix receipt above. |
| [Original vault seal](/private/tmp/pi-final-original-vault-seal-20261016.json) | Exact 388 files, SHA `66a085d23fce3cc0445700b8bfea9e4d35f497bc71402aad6c6ba257cf211863`. |

These receipts do not automatically bind subsequent source changes. Fixture,
configured-local live, pure-test and compiler results remain separate evidence.

## Current assignments

| Ticket | Implementation | Acceptance | Assignment |
| --- | --- | --- | --- |
| 01 | Isolated copy, native recovery and separate installed app complete | Bounded persistent local manual scope passed/closed; v38 native and resource scopes passed; final persistent handoff open | `ticket01_app`, `ticket01_baseline`; orchestrator integrates |
| 02 | Implemented | v38 removed-tree compilation/exclusion and native functional scopes passed; unchanged default full smoke passed after retained original flake; ordinary deliverable retains default runtime | `ticket02_native`: native exclusion/domain seam; `ticket04_lifecycle`: explicit frontend API |
| 03 | Implemented | v38 compatible/Responses prepared subsets and normal settings/model fixture checks passed; configured-local desktop/iOS live passed; hosted live user-deferred | `ticket03_providers`: provider registry, frozen routing and native dispatch |
| 04 | Implemented | v38 desktop/iOS history, Stop/Retry, restart, failure and crash scopes passed; full scale v6 running, not accepted | `ticket04_lifecycle`: durable admission/history/Retry/events/paging |
| 05 | Implemented | v38 evidence/discovery/citation/revocation fixture scopes and bounded local live permission flow passed; paired grants are API scope, physical-device behavior unverified | `ticket05_evidence`: canonical context/discovery/permission/evidence |
| 06 | Implemented, retained-proof recovery verified | v38 independent review/publication, conflict, dirty-buffer, recovery and duplicate-effect scopes passed on desktop/iOS; broader physical/OS-pressure limits remain | `ticket06_reviews`: editable review/refinement/publication |
| 07 | Implemented | v38 exact whole/selection Save, independent publication/read-back and normal Origin navigation passed; final persistent handoff open | `ticket07_save` |
| 08 | Normal-workspace fixture harness integrated; bounded local live scope passed, hosted user-deferred | v38 clean expanded desktop/iOS scopes and unchanged default full 14 passed; bounded persistent local live passed; final handoff open, hosted live user-deferred | `ticket08_acceptance`; root native lease |
| 09 | Integrated research and adaptive compaction | v38 parent/worker summaries, research and fresh reads passed both fixture protocols; historical intermittent failures retained; full scale v6 running | `ticket09_prepare`; root native lease |
| 10 | Integrated attachments and hosted web | v38 attachment/audio/video/text Retry and hosted-web fixture follow-ons passed; hosted live explicitly user-deferred | `ticket10_prepare` |
| 11 | Integrated transcript export/conflicts and relocation | v38 whole desktop and synthetic iOS transcript/sandbox relocation scopes passed; standalone normal Settings vault move unverified | `ticket11_prepare`; root integration |
| 12 | Native/iOS drivers and real SQLite fault probe implemented | v38 four-case publication faults/crashes, expanded storage/lifecycle and three clean iOS scopes passed; programmatic/artificial STOP/CONT is not physical touch or OS-pressure proof | `ticket08_acceptance`, `ticket12_prepare`; root native lease |
| 13 | Clean v38 comparison-tree removal, compiler, ledger, paired and resource tooling integrated; temporary diagnostics removed | v38 removal/native/paired scopes and three controlled resource pairs passed; material IPC/storage regressions retained; default unchanged full 14 passed with original flake retained; full scale v6 running/final handoff/verdict open | `ticket13_prepare`, `ticket04_lifecycle`, `replacement_ledger`; root native lease |

Independent implementation proceeds against agreed interfaces while acceptance
dependencies remain gates. This does not declare prerequisites accepted early.
`evaluation_prereqs` completed metadata-only vault/provider/tool checks without
reading credentials, copying data, launching models or changing the ordinary app.

## Coordination

- Root owns Git staging/commits, source integration and the single native build,
  app, simulator and port lease. Delegated agents edit only their assigned files;
  pure checks may run independently when permitted.
- Persistent copied-vault use stays separate from fresh synthetic fixture roots.
  Setup/reset require the [documented safety contract](README.md#copy-and-failure-contract).
  No copied source content, credentials or live request bodies belong in evidence.
- Failed raw receipts remain failed. Cross-artifact slices, compiler results,
  archive counts and artificial process stops do not establish unobserved gates.

## Remaining work and limits

Finish unchanged full scale v6, then final persistent handoff/relaunch/original-seal
checks and evidence/verdict reconciliation. Do not resolve tickets, archive the
phase or close the goal before required outcomes are inspected. Use the
[normal hands-on checklist](README.md#repeat-the-normal-hands-on-check); executable
fixture commands and root restrictions are in [desktop acceptance](desktop-acceptance.md#commands-and-receipts).

Hosted live is explicitly user-deferred. Physical touch/device/OS pressure,
standalone Settings vault relocation, private resource/controller disposal and
physical retirement/GC counts remain unverified. Paired results cover observable
prepared subsets, not full parity or permission-dialog parity. Resource captures
are debug fixtures with OS-cache/polling/observer/provider-partial/app-only-RSS/
module-only IPC/JSON-not-wire limits. No adoption, savings or performance-win claim.

## Evidence history

The complete superseded chronology remains recoverable at committed checkpoint
`a393836:.scratch/pi-durable-chat-evaluation/progress.md` and
`a393836:.scratch/pi-durable-chat-evaluation/desktop-acceptance.md`.
No raw receipt or private backup is removed by this consolidation. Selected
[material failures](desktop-acceptance.md#material-historical-failures) retain
exact receipt links and explain which old scopes remain unproven. The
[scale cost source audit](scale-cost-audit.md) records mechanisms, not measured
attribution or an optimization/scale pass.
