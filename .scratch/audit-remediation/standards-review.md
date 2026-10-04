# Independent Standards review of combined remediation

Date: 2026-10-03
Reviewer: audit_documents (frontend document owner; review emphasis on other owners)
Baseline and scope: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, also current HEAD. Reviewed uncommitted combined work with `git diff -- <paths>` and inspected relevant untracked implementations directly. There are no intervening commits. Working tree remains active across parallel owners; this records the inspected checkpoint, not a blanket claim about later edits.

## Standards sources and assessment

Read `.agents/skills/code-review/SKILL.md` and applied its labelled smell baseline: names, duplication, Feature Envy, Data Clumps, Primitive Obsession, repeated switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest. These are judgement prompts, not automatic violations. No separate CODING_STANDARDS/CONTRIBUTING file was found. Repository requirements are `AGENTS.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, `CONTEXT.md`, `ARCHITECTURE.md` and linked behavior invariants/ADRs. Runtime review additionally read ADR0001; document/timeline invariants and ADR0002/0007/0008 were read in the initial audit.

**No actionable documented-standard violation or additional baseline-smell finding was confirmed in the inspected changes.** This is not an assertion of exhaustive correctness. Spec review is independently assigned by root; browser/native execution remains the integration owner's gate.

The user explicitly authorized expanded remediation after audit files were persisted. Local tickets precede expanded work, use the canonical `Status: ready-for-agent` with a separate Progress field, and retain original audit snapshots. Private module extraction and focused local harnesses are compatible with the architecture; no new cross-module state owner or canonical write bypass was found in inspected call paths. The edits intentionally retain distinct domain owners rather than flattening similarly named save/restore/review transitions.

## Inspected changes and reasoning

| Area/files inspected | Standards and ownership assessment |
| --- | --- |
| `app/listenerScope.ts`, AppStore listener changes, `chat/controller.svelte.ts`, chat lifecycle tests | Shared listener lifetime is a concrete repeated responsibility. Scope owns acquired unlisteners, closes partial acquisition and releases late arrivals; callbacks check scope closure. This reduces duplicated lifetime work without replacing chat/AppStore operation ownership. Distinct request/selection admission remains with the chat machine. |
| `settings/store.svelte.ts`, settings tests, removed semantic loader/coordinator, `atlas/atlasStore.svelte.ts` and tests | Lifecycle and sequence admission stay private to existing owners. Settings reads shared backend state through AppStore; no mirrored vault/semantic snapshot owner. The serialized settings write queue is warranted by actual overlapping durable mutations; stale UI-result guards do not invent another persistence service. Separate snapshot, mutation and route lifetimes are meaningful rather than a reason for an all-purpose request abstraction. |
| `notepad/search/store.svelte.ts`, related/task store changes and task tests | Stale admission and narrow per-document/per-view tickets preserve ownership and avoid presentation-readiness coupling. Similar short guards occur at different cancellation boundaries; no concrete maintenance reduction justified combining them into a new shared owner. |
| `editor/editorDocumentRuntime.ts`, image loader/upload extraction | Sequential transaction changes use the preceding transaction's state. Upload state/effects now have an actual CodeMirror owner; asset cache budgets are existing policy with injectable limits for bounded verification. No new cache/DOM authority appears. |
| `src-tauri/src/chat/admission.rs`, `chat/store.rs`, runtime/tool context/research changes | Durable acceptance and terminal persistence remain on ChatService with private `pub(super)` helpers. Admission/terminal methods use SQLite transactions. Provider execution injection uses app-owned protocol types; provider types do not leak into durable or frontend state (ADR0001). Worker-context construction makes intended shared permissions/budgets and independent evidence bookkeeping explicit rather than mutable clone correction. |
| `services/evidence.rs`, `evidence/inventory.rs`, `retrieval.rs`, research integration tests | Evidence continues to own scoped cursors, bounded search and canonical reads. Retrieval remains a compatibility adapter with metadata-date semantics; private inventory extraction does not create another timeline/history owner. Explicit permission rechecks are necessary boundary duplication, not a smell warranting removal. |
| `services/note_catalog.rs`, `state/task_projection.rs`, `test_support.rs`, history-store codec extraction | Pending work indexing retains generation watermarks while limiting retry work to pending paths. Removed projection DDL calls rely on existing database initialization; tests cover initialization/repair. TestVault joins its rebuildable work and restores process-wide test paths while serialized. Codec is private and storage-independent; transaction/error ownership remains with NoteTimeline. |
| `e2e/support/ownedServer.mjs/.test.mjs`, `nativeSuite.mjs`, CI workflow/package lane changes | Process admission uses a newly generated nonce and owned child/process group; foreign HTTP200 is rejected without killing it. Functional/measurement/live lanes are explicit. CI retains frontend typechecking, functional suites and Rust fitness. No added package dependency or hidden installation flow. Signals and teardown deserve the existing harness tests; this review did not equate script listing with execution. |
| Original and new TS fitness guards, new browser split and instrumentation | Reviewed separately in `harness-documents.md`: preserved structural boundaries, removed migration-era spelling, retained typed checks, demonstrated AST mutation probes. All 117 moved assertions preserved; browser resets and temporary hooks have explicit lifetimes. These are owned changes and therefore not counted as independent other-owner verification. |

## Follow-up defects found while integrating review

These are behavior/spec defects, not invented style findings:

1. **Fixed, owned browser spec:** History controls selected Clear while History tools remained collapsed. The root browser result passed the other two cases. `history-controls.spec.ts` now opens the scoped disclosure, waits for Clear, and uses independent workspace reset. Root must rerun it; typechecking cannot prove the fix visually.
2. **Fixed following independent Spec finding:** `openFlow.ts` still used an indexed `editorLineNumber` as authoritative before the verified text resolver. A pending target can outlive a document edit. The direct-line bypass is removed; task text is checked against the current full document with line number only a hint. Tests cover shifted, out-of-range and deleted task text. This finding was reported by audit_ui_semantic and communicated to root before the owned fix.

No unrelated production files were changed as part of this review.

## Validation and limits

- Reviewed existing focused results recorded by owners; did not rerun the full frontend/Rust/browser/native gates.
- TS architecture suite 12/12, Svelte check 0 errors/0 warnings, and E2E typecheck passed at the earlier frontend-harness checkpoint. Subsequent targeted navigation and E2E checks are recorded in the follow-up reports.
- A supplemental owned-server forced-termination timing probe could not bind its ephemeral loopback socket in this sandbox (`EPERM`); no child was created. No defect is asserted from that unexecuted probe. Existing ownedServer tests and root integration remain its validation evidence.
- Large backend fixture/test relocations were sampled through target implementation, ownership and admission paths; this was not a line-by-line rereview of every moved test. No browser or full suite was launched by this reviewer.

Readiness: no new Standards blocker identified at this checkpoint. Complete root's integrated validation and independent Spec review before calling the combined remediation verified.
