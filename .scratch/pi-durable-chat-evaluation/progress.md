# Pi evaluation implementation progress

2026-10-15. Orchestrator chat: `01a141e7-aed3-7962-85b6-2768654155e7`.
Worktree: `/Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts`.
Branch: `codex/pi-durable-native-prototype`.

The human authorized fresh-context implementation subagents and parallel work
where dependencies and file ownership allow. The actual persistent goal was
created successfully. It remains active until every required implementation and
acceptance gate is satisfied; unverified external prerequisites are not passes.

## Current assignments

| Ticket | Implementation | Acceptance | Assignment |
| --- | --- | --- | --- |
| 01 | Isolated copy and native recovery complete | Persistent UI/resource checks pending | `ticket01_app`, `ticket01_baseline`; orchestrator integrates |
| 02 | Implemented | Native graph checks passing; desktop gate pending | `ticket02_native`: native exclusion/domain seam; `ticket04_lifecycle`: explicit frontend API |
| 03 | Implemented | Provider unit checks passing; fixture/live gate pending | `ticket03_providers`: provider registry, frozen routing and native dispatch |
| 04 | Implemented | Lifecycle unit checks passing; desktop gate pending | `ticket04_lifecycle`: durable admission/history/Retry/events/paging |
| 05 | Implemented | Permission/evidence unit checks passing; desktop gate pending | `ticket05_evidence`: canonical context/discovery/permission/evidence |
| 06 | Implemented, retained-proof recovery verified | Native recovery test passing; desktop gate pending | `ticket06_reviews`: editable review/refinement/publication |
| 07 | Implemented | Source-boundary tests and desktop gate pending | `ticket07_save` |
| 08 | Normal-workspace fixture harness in progress | Waiting for 01–07 acceptance | `ticket08_acceptance`; root native lease |
| 09 | Integrated research and adaptive compaction | 23 focused checks pass; native extended-work acceptance pending | `ticket09_prepare`; root native lease |
| 10 | Integrated attachments and hosted web | Provider/native checks pass; native follow-on journeys pending | `ticket10_prepare` |
| 11 | Integrated transcript export/conflicts and relocation | TS/native checks pass; WKWebView relocation pending | `ticket11_prepare`; root integration |
| 12 | Native/iOS drivers and real SQLite fault probe implemented | Actual expanded matrix pending | `ticket08_acceptance`, `ticket12_prepare`; root native lease |
| 13 | Resource capture and removal experiment tools in progress | Paired native evidence and verdict pending | `ticket13_prepare`, `ticket04_lifecycle` |

Independent implementation proceeds against agreed interfaces while acceptance
dependencies remain gates. This does not declare prerequisites accepted early.
`evaluation_prereqs` completed metadata-only vault/provider/tool checks without
reading credentials, copying data, launching models or changing the ordinary app.

## Coordination

- Agents start with `fork_turns=none` and read the spec/ticket/current source.
- The orchestrator owns Git staging/commits and shared integration. Agents may not
  independently stage all files or overwrite another assignment.
- Native builds, app launches and simulator operations require a single assigned
  owner. Focused pure/helper tests may run independently.
- `ticket01_app` owns runner/config/new copy helpers/tests and assigned docs. Native
  `lib.rs` composition remains reserved until its concrete change is agreed.
- Full lifecycle exclusion and removal are proven by compilation/native behavior,
  not merely zero generic database rows. Earlier prototype passes remain historical.

## Evidence

Initial working changes were the approved spec, 13 tickets and tracker entry.
No implementation acceptance is claimed yet. Baseline reference: `afa1f4c0` and
the previous prototype's results/validation. Production default and original vault
remain unchanged.

2026-10-15 integration evidence:

- The user reported the ordinary app failed and was removed, and explicitly
  authorized proceeding with its stopped vault. Its history remains marked open.
  Source integrity, manifest/store/observation identity, stopped handles, absent
  WAL and zero pending work were verified. Retained deletion tombstones remain.
- Exported a quarantine copy containing 209 copied files, excluding 50 individual
  files plus excluded chat/private directories. Full source hashes and the exact
  original observation bytes were stable across export. Only the matching existing
  observation entry was copied; no watermark was manufactured.
- Quarantine is the separate Pi app-data root's `.stopped-recovery` sibling.
  It has no normal evaluation marker. Native NoteTimeline recovery and clean close
  must advance its real watermark before guarded adoption. The unmarked former
  Pi test root (two files) was preserved as `.pre-evaluation-20261015`.
- Copy helper: 17 Python and 3 Node tests pass. Measurement helper: 8 pure tests
  pass. The production release window fixture generator passed (95 retained
  revisions, 92 window-evidence records); sealed fixture is in
  `/private/tmp/pi-evaluation-window-baseline`.
- A read-only Git archive of checkpoint `4b5ff2de` was built with `e2e-wdio` to
  pin a known pre-replacement baseline. Binary SHA-256:
  `435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3`.
  Source/build receipts and canonical copied binary are under
  `/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts`.
  This is a temporary build artifact, not another implementation worktree.
  Paired native resource measurements remain pending.

- Quarantine recovery ran through the actual native NoteTimeline and clean close.
  Identity was retained and the real clean-close sequence advanced to 1. Guarded
  adoption into the persistent Pi root succeeded (209 copied files). Original
  source inventory and observation bytes remain unchanged; no close marker was
  fabricated in the source.
- Known pre-replacement empty-workspace startup observation passed at
  `/private/tmp/pi-old-startup-baseline-SWnxTV/startup-baseline.json`: 4111 ms
  observed workspace readiness (100 ms polling uncertainty), 160169984 bytes
  observed process RSS. Renderer RSS is incomplete; this single uncontrolled-cache
  sample is preparation, not evidence of a performance improvement.
- Integration native checks: 702 Pi library tests passed, 20 ignored; all 21
  architecture checks passed. Lifecycle exclusion initially falsely matched
  `ChatServiceTier` as `ChatService`; the exact identifier check is corrected and
  awaits rerun. Latest 14 focused Pi tests passed, including failed receipt write
  followed by a later ordinary edit and exact recovery without overwrite.
- Atomic permission settlement now binds one current Pi live input in the same
  transaction. Structured tool-call messages suppress unvalidated provisional
  text. Save follows canonical Note Identity and current access, never a recorded
  stale source path. Normal composer suggestions use title-only canonical
  discovery without granting read or citation authority.

### Integration checkpoint — 2026-10-15 18:15 MDT

- Default native regression after ownership separation: 937 passed, 32 ignored;
  architecture fitness 21 passed. Pi-focused TS tests: 110 passed before the latest
  usage/repeated-compaction refinements.
- Research/compaction, native attachments/web, managed transcript publication and
  location-binding commands are connected to the normal Pi ChatApi. Transcript
  conflicts now have explicit restore/convert controls; export failures remain
  visible warnings. These changes still require final native acceptance.
- Desktop synthetic run `gneauxghts-pi-interactive-01z0DY` progressed past the
  previous status race and checkpointed edited review switches. Concurrent frontend
  edits were initially suspected; the frozen repeat ruled that explanation out.
  Neither incomplete run is acceptance evidence.

- Frozen repeat `gneauxghts-pi-interactive-8mz7Ks` stalled its report after the
  review switch. Its persisted `interruptedId` checkpoint proves the ordinary UI
  partial-text and streaming-status assertions actually passed. Growing diagnostic
  button arrays exceeded the native report limit, hiding the next checkpoint;
  this was not evidence of native streaming failure. Diagnostics are compacted,
  report publication now has a bounded failure fallback, and the explicitly gated
  synthetic report limit is increased. Separately, ticket04's controlled actual
  Harness/controller regression proved an admission-window event ordering bug.
  Its fix acquires the Pi watch before admission but begins delivery after the UI
  started event, preserving Pi's backlog/snapshot handling. Native rerun is pending.
- Integrated native Pi-focused checks: 30 passed. All three lifecycle exclusion
  checks ran separately without the earlier name filter and passed. Latest full
  Svelte/e2e type checks report zero errors/warnings.

### Native rerun and independent review — 2026-10-15

- Frozen desktop run `gneauxghts-pi-interactive-RHMHl6` passed seed and all 13
  first-launch checks, including ordinary UI partial text. The first relaunch
  assertion passed: model, committed history, edited review and interrupted text
  survived without implicit provider replay. The subsequent duplicate Keep failed.
  Read-only Pi records show the probe captured draft version 4 before the normal
  Keep decision checkpointed hunk state as version 5; the accepted intent and
  receipt both bind version 5. The probe must duplicate that final acknowledged
  version while continuing to reject stale versions. Full acceptance remains open.
- Pi frontend suite: 114 passed before the latest relocation regression tests.
  Review relocation tests: 20 passed; full Svelte/e2e type checks are clean.
- Independent Standards and Spec review found four additional implementation
  gaps: intermediate rename recovery can strand accepted Keep; an independent
  note move can be silently reversed by Keep; source-free reconstruction lacks
  freshly permitted identity/title continuity for prior grounded questions; parent
  requests also need the existing validated run date/time context. Assigned fixes
  retain NoteTimeline publication ownership and Pi lifecycle ownership. These
  findings remain open until focused regression and native verification.
- Expanded follow-on fixture and iOS transcript query routing are integrated.
  Pure fixture/probe checks pass. They remain prepared rather than native or live
  acceptance evidence.
- Native full Pi regression after the first review corrections: 735 passed,
  20 ignored. The final rename-recovery suite then passed all seven checks,
  including canonical-write interruption followed by whole-vault relocation,
  repeated recovery, unchanged bytes and one revision/lifecycle event. Focused
  Standards re-review found no remaining defect in that correction.
- Focused Spec re-review caught two secondary gaps before the next native run:
  identity-only automatic editor hints incorrectly omitted ordinary dialogue,
  and older interrupted requests without an original temporal anchor resampled
  Retry time. Identity hints now preserve source-free answers, delivered selections
  still ground history, and missing/malformed Retry temporal context fails before
  native admission. Final focused TS verification: 55 passed; Svelte/e2e types
  clean. The next desktop run uses a rebuilt native binary and frozen frontend.
- Native desktop run `gneauxghts-pi-interactive-gMsq5k` passed seed, all 13 first
  checks and the first three relaunch checks: restored history/model/partial with
  no replay, edited review Keep/Discard with exact duplicate acknowledgement, and
  explicit Retry. Save then exposed a probe acquisition race: the ordinary UI had
  already opened its review, while the probe waited for the now-hidden chat card.
  Review acquisition is being corrected to observe either valid UI state. This
  incomplete run is not acceptance. All 62 Node driver/helper tests passed.
- Follow-up `gneauxghts-pi-interactive-1X7GUr` passed seed, all 13 first-launch
  checks and all six relaunch checks, including whole/selection Save, exact append
  and Open in chat. Active Stop closed the provider stream before completion;
  the restart request count remained 25 until explicit Retry. Optional failures
  then stopped at its checkpoint-version assertion, with the expected persistence
  error and working editor still visible. Fault acceptance remains open.
- Final ordinary-runtime library regression: 937 passed, 32 ignored. Integrated
  Pi frontend tests after review-acquisition repair: 147 passed in 22 files.
  Read-only/pure Python driver helpers: 20 passed. Rebuilt normal-root Pi/e2e
  binary is pinned at `/private/tmp/pi-evaluation-integrated-artifacts-20261015-v2`
  with SHA-256 `a1ec5982e1f8ea74a80dffef75d858fa94c1cd83c41f6219212d851ef750a338`.
