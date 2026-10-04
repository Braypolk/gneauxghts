# Timeline design: own the whole authored publication

Status: ready-for-agent
Progress: Read-only proposal; coordinator approval required before implementation.

## Recommendation

Complete the existing `NoteTimeline` ownership decision by replacing the remaining caller-managed prepare/write/finalize protocol with complete authored publication operations. Migrate clean task commits and accepted proposal update/create together, reuse the same private publication implementation for editor saves and Version Restore, and make prepared tokens/finalization private. This is a bounded rewrite of the authored-publication seam; do not replace the SQLite store, rewrite observation replay, or combine lifecycle deletion transactions with ordinary edits.

This removes ordering knowledge and failure handling from callers, not merely files. The task and proposal owners retain their domain decisions. The timeline becomes the sole owner of readiness admission, canonical write ownership, durable preparation, watcher correlation, abandonment, committed-warning finalization, and projection synchronization.

## Evidence from current code

- `services/note_timeline/publication.rs:62–237` already offers a complete `save_note[_with_tags]` operation. It performs target readiness outside the file owner, repeats identity/materialization under the file/replay owners, prepares history, writes, and finalizes. This is the behavior to preserve and generalize internally.
- `services/task_mutation.rs:97–172,183–217,257–275` introduces `TaskMutationSink`, `AppStateTaskMutationSink`, and `TaskSynchronization` solely to split read/write/synchronize. Its concrete writer prepares history, handles failure abandonment, correlates the watcher, then constructs `NoteMutation`. Its caller takes the global file owner before timeline preparation/readiness. The service must continue to own task matching and the shared pure transform, but needs none of this publication machinery.
- `commands/proposal_commands.rs:96–150,174–199` repeats the protocol, carries opaque history intent through a second synchronization DTO/helper, and abandons prepared history on a conflict result. `proposals.rs:377–430,483–536` accepts timeline preparation objects and performs canonical writes despite being the proposal preview/planning module. Creation has an important distinct `create_new` no-overwrite boundary (`proposals.rs:554–564`).
- `services/note_timeline/history_mode.rs:1106–1177` privately repeats prepared-intent failure handling/watcher/write/finalize for Version Restore. It additionally attaches selected-revision lineage before publication, verifies exact authored bytes, and returns the reserved Revision Identity. Those are required restore semantics, not duplication to discard.
- `services/note_timeline/domain.rs:1061–1187` carries a selected store, optional operation/current-content leases, and prepared base data inside a token that escapes the timeline. It exposes decomposition and abandonment to callers. Much of this runtime lifetime plumbing exists because the operation is split across the seam.
- External observation is materially different: `observation.rs:51–126` durably retains an exact observed state before ordered replay/acknowledgement; it is not an app-owned prepare/write action. Forget/recovery and purge additionally own staged filesystem/metadata rollback. Folding them into one generic mutation enum would add options and obscure their actual transactions.

## Before and after

| Concern | Before | After |
| --- | --- | --- |
| Clean task commit | Task owner locks; sink reads/transforms; sink prepares/writes; sink synchronizes | Task owner resolves task and supplies its existing pure transform to a complete timeline edit; receives committed result |
| Accepted proposal | Command records proposal intent; locks; prepares history; calls proposal file writer; branches abandonment/conflict; calls synchronization helper; settles status | Command records proposal intent; requests complete timeline edit/create; maps stale/path-occupied outcome to existing conflict response; settles status |
| Proposal model | Preview/plan plus canonical file writing and history-preparation dependency | Preview/plan and deterministic proposal checks; no history tokens, file writer, or watcher dependency |
| Editor save | Complete timeline operation with inline publication protocol | Same public behavior, private shared publication implementation |
| Version Restore | Complete role-limited method with duplicated private write/finalize sequence | Same role-limited method and lineage checks; shared private publication implementation carries reserved revision and selected-origin metadata |
| Prepared token | Caller-visible mutable protocol object carrying runtime leases/store | Private durable publication evidence, used only while a complete operation owns runtime leases |
| Observation/lifecycle | Retained external snapshots and staged lifecycle transactions | Same distinct owners and persistence formats |

## Smallest complete migration

Expose two complete operations for the remaining callers, alongside the existing save API:

- An existing-note edit accepts validated target path, optional retained Note Identity, the existing closed Mutation Source, and a deterministic transformation of the authoritative current Markdown. The closure owns only calculation/validation; it cannot publish, receive a prepared token, or select durability policy. Task transform stays in `TaskMutationService`. Proposal update supplies replacement authored Markdown after checking its original full-content hash. A typed stale result maps to the existing proposal conflict result; do not inspect error wording.
- An exact-path create accepts the target, authored Markdown, and source, and performs create-new publication. It cannot silently choose another filename or replace an occupied file. Proposal title/access/path planning remains in its existing owner. The complete operation returns a committed `NoteMutationResult` or a typed pre-publication failure.

These names/signatures are illustrative; prefer existing domain types and avoid adding a service trait, a public transaction/session object, a callback for physical publication, or a bag of optional flags. Keep special restore metadata private rather than granting generic callers a restore-origin option.

One private implementation handles the common preparation/write/finalization lifetime. Existing editor path relocation retains its explicit rename/rollback branch; fixed-path edits and exclusive creates use their corresponding filesystem operations. Version Restore uses the private exact-content path and attaches its selected origin before writing. Do not force lifecycle moves or deletion staging through this operation.

Readiness/read ordering must be explicit:

1. Resolve candidate identity and settle required startup/replay work outside the canonical file owner; verify only the target. Release preflight operation leases before waiting for file ownership, as the existing editor save does.
2. Acquire the existing file owner, begin the operation, then enter the existing observation replay owner. Recheck pending replay and identity/proof validity. Changed admission releases the owners and retries; it must not wait for verification under ownership.
3. Read the authoritative Markdown and run the task/proposal transform **under that same file owner**. Do not transform before locking, then publish a stale result. If identity has changed, readmit before applying any transform. Preserve body-only editor enrichment from properties current at ownership.
4. Start current-content invalidation, prepare the exact history intent and source/disposition, attach restore origin when relevant, perform the canonical publication, and finalize/correlate projections before releasing the owner. Ordinary operation locals own leases; they no longer travel through caller DTOs.
5. Every known pre-publication failure abandons the exact intent. An indeterminate editor rename rollback retains/release-marks evidence for recovery exactly as today. Every actual canonical commit returns its authoritative result and warning even when finalization/projection fails; never reapply the transform as recovery.

The transform is evaluated only after an admitted owned read. A retry caused by changed admission happens before invoking it. This keeps the caller contract simple and avoids a new requirement that arbitrary side effects be safely repeatable.

## Delete, do not retain compatibility paths

After all in-scope callers migrate:

- Delete `TaskMutationSink`, `AppStateTaskMutationSink`, `TaskSynchronization`, and their standalone canonical-writer function. Keep task pure transform, dirty-document preparation, hash contract, and task result shape.
- Delete `synchronize_applied_change`/`ProposalSynchronization`, `commit_prepared_note_review`, `commit_prepared_note_creation_at_path`, and proposal-owned canonical write helpers. Move the actual create-new primitive behind the timeline; preserve its atomic occupancy behavior.
- Remove `PreparedHistoryIntent`, `PreparedRevisionPublication`, `NoteMutation`, `prepare_revision_publication`, and `mutate` from the caller-visible contract. Private storage token/record types may remain where their real storage tests need them. Do not add deprecated forwarding APIs for old callers.
- Remove token-carried operation/current-content lease fields and lease-forwarding methods once all production operations own them lexically. Retain the private prepared-base optimization and exact scoped token validation; neither is obsolete. Avoid rewriting unrelated provenance leases or shared close barriers merely because their guard type is nearby.
- Replace the task fake sink's protocol-order tests with the already-existing real `TestVault` seam, merging their assertions into a small set of actual task command outcomes. Migrate direct prepared-publication tests outside the timeline to the complete operations. Preserve internal receipt/corruption/recovery tests at the private storage seam; they exercise distinct durability facts.
- Update structural fitness so callers cannot regain canonical write/intent dependencies. Remove exact expectations for deleted wrappers. Document the deeper operation in `ARCHITECTURE.md`; existing ADR0002 already chooses this owner, so this does not reopen its policy.

## Risks and meaningful validation

Existing behavior owners must remain, with tests adapted to the complete operation rather than duplicated:

- Readiness/concurrency: `save_waiting_for_target_verification_leaves_ready_notes_writable`, `save_replays_an_observation_retained_after_preflight_before_its_own_publication`, `close_between_save_preflight_and_file_ownership_finishes_and_rejects_publication`, and `body_only_save_enriches_from_properties_current_when_the_file_owner_is_acquired`. Add only the missing analogous task/proposal admission case needed to prove these callers use the replacement owner; do not build another complete parallel test matrix.
- Task: literal toggle/delete/due transform oracle and dirty prepare nonwriting/hash/ambiguous-match tests remain. Real clean commit must show canonical bytes, immediate task projection, one distinct TaskAction boundary after an editor window, and committed warning without a repeated write. Preserve immediate intent abandonment on injected publication failure.
- Proposal: existing conflict/no-overwrite and preserved-frontmatter tests run through timeline edit/create. Preserve creation occupied-path conflict, retained identity, accepted-proposal source, permissions before commit, and chat proposal-intent recovery/status convergence after committed bytes. Chat proposal state remains with ChatService; this rewrite does not create a transaction spanning its database and history SQLite.
- Restore: retain exact unmanaged frontmatter/CRLF, empty restore, stale hash rejection, selected-origin recovery after failed finalization/restart, reserved revision identity, and append-only reversibility tests. Shared writer must not normalize the exact-content branch.
- Persistence: unchanged canonical preparation failure, authoritative-read failure, exact token/source/identity finalization, rollback/indeterminate rollback, retained observation replay, source/time evidence, close barriers, and receipt bounds. No schema/generation/receipt format changes.
- Run focused affected Rust suites plus architecture fitness, then coordinator's combined Rust/native lifecycle/timeline acceptance. Actual simplification is measured by eliminated public protocol types/call sequences and production writer owners, not an LOC target.

## Alternatives assessed

1. **Only consolidate helper functions while leaving tokens with callers:** smaller patch but fails the deletion test. Callers still own abandonment, finalization, and lock placement; rejects the architectural goal.
2. **One global actor/transaction for all history operations:** tempting state reduction, but serial waiting would undermine ADR0008's ready-note availability unless it reintroduces separate verification/admission scheduling. It also conflates read proof, external observation, authored publication, and confirmed discard semantics. Not justified for this bounded rewrite.
3. **Replace SQLite store or introduce HistoryStore trait:** no demonstrated second storage need, conflicts with ADR0004's deliberate concrete implementation, and expands the validation surface without eliminating caller publication policy.
4. **Recommended complete authored-publication owner:** removes real production protocols and test-only sink scaffolding while keeping the current durable format and demonstrated concurrency mechanisms. Highest confidence coherent scope.

Reviewed governing sources: `CONTEXT.md`, `ARCHITECTURE.md`, behavior invariants (external observation; save completion; identity; restore; restart), Editing Window capture contract, ADR0002–0009, and codebase-design/DEEPENING. This design preserves their ownership, typed failure, mandatory preparation, exact replay, and portability choices.
