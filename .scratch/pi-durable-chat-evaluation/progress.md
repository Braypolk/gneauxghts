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
| 01 | In progress | Pending | `ticket01_app`: runner, copied-vault setup, docs; orchestrator: baseline/integration |
| 02 | Waiting for 01 | Pending | `native_seam_facts`: read-only dependency investigation |
| 03–07 | Waiting for dependencies | Pending | Unassigned |
| 08 | Waiting for 01–07 | Pending | First usable desktop acceptance |
| 09–11 | Waiting for 08 | Pending | Eligible for parallel implementation after 08 |
| 12 | Waiting for 09–11 | Pending | Expanded native/iOS acceptance |
| 13 | Waiting for 12 | Pending | Removal/resource proof and verdict |

`evaluation_prereqs` is inspecting metadata-only vault/provider/tool prerequisites.
It cannot read secrets, copy data, launch models or change the ordinary app.

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
