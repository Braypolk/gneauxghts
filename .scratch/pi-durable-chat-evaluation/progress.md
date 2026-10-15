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
| 01 | Helper implementation complete | Native recovery/persistence/resource checks pending | `ticket01_app`, `ticket01_baseline`; orchestrator integrates |
| 02 | In progress | Pending | `ticket02_native`: native exclusion/domain seam; `ticket04_lifecycle`: explicit frontend API |
| 03 | In progress | Pending | `ticket03_providers`: provider registry, frozen routing and native dispatch |
| 04 | In progress | Pending | `ticket04_lifecycle`: durable admission/history/Retry/events/paging |
| 05 | In progress | Pending | `ticket05_evidence`: canonical context/discovery/permission/evidence |
| 06 | In progress | Pending | `ticket06_reviews`: editable review/refinement/publication |
| 07 | Waiting for contracts from 05–06 | Pending | Unassigned |
| 08 | Waiting for 01–07 | Pending | First usable desktop acceptance |
| 09–11 | Waiting for 08 | Pending | Eligible for parallel implementation after 08 |
| 12 | Waiting for 09–11 | Pending | Expanded native/iOS acceptance |
| 13 | Waiting for 12 | Pending | Removal/resource proof and verdict |

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
