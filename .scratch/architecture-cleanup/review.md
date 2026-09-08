# Planning review

Date: 2026-09-07. Scope: source investigation and implementation instructions, not an implementation correctness certification.

## Independent review

- Save/restore investigator reviewed tickets 01, 07, 09 and 10.
- Vault investigator reviewed tickets 04–06 and the normalized census, then rechecked corrected lifecycle/selection instructions.
- Agent-action investigator reviewed tickets 07, 08 and 11–13, including type containment and request/snapshot ordering.
- Orchestrator synthesized the specification, selected target boundaries, wrote tickets, checked cross-workflow dependencies and incorporated the findings below.

## Corrections incorporated

| Review finding | Plan correction |
|---|---|
| Initial vault and agent counts used different subsystem granularity. | Normalized all four rows to save's owner families/grouped dimensions; retained original checklists as explicitly noncomparable evidence. |
| Generic document adoption has external-refresh and forgotten-recovery consumers as well as save/restore/proposal. | Ticket 09 migrates those consumers before deleting generic public flags/callbacks. |
| Proposal adoption must respect disk changes after canonical commit. | Ticket 09 retains canonical read-back mismatch routing through external sync/conflict. |
| Stable-handle collisions can occur after a successful write. | Ticket 10 preserves committed evidence and both dirty drafts; no retry of canonical publication. |
| Task matching must use fresh bytes under ownership. | Ticket 07 keeps policy in task domain but evaluates it inside timeline publication. |
| Vault globals have aliases and direct app-state DB callers. | Ticket 04 explicitly audits derived root accessors and task projection database access. |
| Chat cancellation signals and an empty active map do not join detached title work. | Ticket 05 tracks/cancels/joins completion/title/projection work under existing ChatService ownership. |
| Semantic shutdown currently stops a provider, not all maintenance/index work. | Ticket 05 requires explicit admission/settlement of those workers. |
| Stopping dependencies too early could break close settlement or make failed restart unrecoverable. | Ticket 05 distinguishes reversible quiescence from final shutdown, retains required sinks through close, and covers every closing-state error. |
| Backend exit preparation cannot flush unsent frontend content. | Ticket 05 explicitly limits fallback scope and does not claim broader native quit save safety. |
| Command/Settings results can be stale even if bootstrap is revision-guarded. | Ticket 06 includes event and command/load correlation plus delayed B-after-C tests. |
| Existing live-request registry lacks request context metadata. | Ticket 11 enriches the existing registry; no new durable request table or parallel frontend map. |
| A conversation opened after a terminal event could read activity not yet removed. | Ticket 11 retires snapshot-visible activity before terminal delivery and keeps separate completion tracking. |
| Singular activity snapshot is ambiguous with concurrent sends from two panes. | Ticket 11 chooses one admitted interactive run per conversation, with atomic reservation and an already-active response that preserves the second composer's unsent draft/attachments/context. |
| Review cleanup must retain immutable in-flight commit evidence and arrival/replacement rules. | Ticket 12 preserves those facts while removing simultaneous mounted/suspended fallbacks. |
| Rig usage also leaks through AgentResponseSuccess; both main and title calls need guards. | Ticket 13 includes those call sites and failure statistics. |

## Verification performed

- All planning Markdown links resolve locally.
- Fully qualified repository source references were checked for file existence and valid line bounds. Two dependency references to Tauri's `src/app.rs` are intentionally relative to the installed crate named in that paragraph, not this repository.
- Core workflow source files remained stable during final drafting. A hash comparison detected concurrent changes in eight history UI/E2E files; the planning effort did not edit or revert those files. Source references are tied to named symbols and must be re-resolved when implementation starts.
- This effort wrote only `.scratch/architecture-cleanup/` planning artifacts. No tests, native app actions, user database operations, commits, or implementations were run. The absence of test runs is intentional for a documentation-only plan; source-confirmed race hazards are labeled as needing deterministic reproduction.

## Implementation audit requirement

Each future ticket must satisfy its own behavior checks and show removal of the replaced protocol. Passing existing tests or moving code into a new file is insufficient. Preserve production/test/tooling line accounting separately and report changed owner/state/coordination ledgers without regrouping the baseline.

## Scope revision — narrowed first implementation round

The user chose to narrow the first implementation round after reviewing whether the original thirteen-ticket plan would simplify architecture or merely relocate code. The active order is **01 → 02 → 03 → 09 → 10**. Ticket 09 uses existing backend contracts and no longer depends on deferred 08. Tickets 04–08 and 11–13 are marked needs-triage/deferred. Their original review remains technical evidence, not authority to implement them.

After 10, the orchestrator must audit actual deletions, caller obligations, affected workflow counts and tests, then stop. No correctness/lifecycle or runtime/review redesign is implicitly pulled into this round. The scope revision changes planning artifacts only.

## Scope addition — NoteTimeline file organization

The user authorized a bounded organization step after 02. New ticket **14** preserves existing ticket IDs and makes the active sequence **01 → 02 → 14 → 03 → 09 → 10**. This supersedes the five-ticket sequence above. Active ticket checkpoints and the fresh-context prompt are updated.

Ticket 14 moves cohesive production implementations and tests into private files behind the unchanged NoteTimeline owner/import surface. It preserves capability privacy, cfg/test discovery, serialization and operation ordering, and updates file-sensitive fitness checks without exempting moved code. It does not implement deferred publication redesign. Moved lines must be reported separately from deletion; the benefit is navigation, not reduced owner/state/coordination counts.

## Final completed-set audit — Tickets 01–06, 09–10, and 14

Date: 2026-09-07. Tickets 04 → 05 → 06 were subsequently authorized and executed sequentially after the accepted Round 1 set. Each used a fresh-context implementation agent, an exact pre-ticket dirty-tree archive, and an orchestrator Standards/Spec gate before the next ticket. Their archives are `/tmp/gneauxghts-ticket04-baseline.2TOXTh`, `/tmp/gneauxghts-ticket05-baseline.uuM3Cz`, and `/tmp/gneauxghts-ticket06-baseline.ngRHw7`.

The final audit incorporated the already-recorded accepted audits for Tickets 01, 02, 14, 03, 09, and 10, then rechecked their current boundaries together with the complete 04 → 05 → 06 flow. The joined behavior is coherent: one immutable canonical Running Vault owns backend resources; Apply atomically stages only the next-launch selection; frontend departure joins Version Restore and document-owned persistence; backend restart joins producer settlement and Note Timeline portability before relaunch; and the next process admits one bundled session plus one revision-ordered AppStore vault/semantic snapshot. Settings cannot make staged B the running A asset root, a delayed B/Settings result cannot replace newer C/event state, and failed bootstrap or restart preparation cannot silently expose an empty or closed editable workspace.

Ticket-level audits found and routed five caused defects to their original agents: four Ticket 04 propagation/documentation gaps and one Ticket 05 missing-owner resumability error. All were corrected and re-audited. Ticket 06's operation-admission design was tightened during implementation so newer operations win in either response order. No unresolved Standards, Spec, cross-ticket interaction, documentation, or scope-isolation finding remains.

Final validation passed `cargo test --manifest-path src-tauri/Cargo.toml` with 591 tests passed, 9 explicit release/scale diagnostics ignored, and 0 failures; Rust architecture fitness passed 19/19; `pnpm test` passed 880/880 tests across 125 files; `pnpm run check` reported 0 errors and 0 warnings; and archive-relative whitespace checks passed. Ticket 05's scoped disposable two-process lifecycle evidence remains the native restart check; no final native/scale run or user-vault/app-data access was performed. The pre-04 archive comparison contains only Tickets 04–06 code, focused tests/contracts/tooling, their issue records, and required architecture/domain documentation; ignored Tauri schema output is generated build state. Tickets 07–08 and 11–13 remain `needs-triage` and were not implemented.
