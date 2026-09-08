# Compact publication persistence

Status: ready-for-agent
Depends on: 51

## Acceptance

Make one coherent fresh-format change that stops repeating full serialized publication tokens in durable keys and retains detailed preparation data only while operations need recovery. Prefer the token's existing random nonce as a compact private key over an additional mapping layer. Validate complete store instance, generation, Note Identity, deletion epoch, sequence and nonce before lookup; preserve exact retry semantics and globally unique public Revision/Lifecycle identities.

Completed receipts retain the minimum exact outcome and scope evidence. Finalization must atomically commit retained history/outcome before removing preparation-only fields. Preserve PendingWindow outcomes after sealing, reserved point revision identities needed by Version Restore before publication, live/unresolved receipts, retirement watermark behavior and the bounded unreferenced retry tail. Retained revision evidence must have one authoritative durable representation rather than redundant preparation copies. Do not invent synthetic revision identities for private pending windows.

Use a single new current schema with fresh-only admission and the existing explicit reset route; do not migrate or trust old stores, and do not reset user data. Update private fixture/schema contracts and relevant architecture decisions without rewriting historical evidence.

## Design guidance

Use the existing token nonce as the private receipt key; keep store instance/generation in store metadata and note epoch/sequence in scoped receipt data. Reconstruct full boundary tokens only when necessary and reject every mismatching scope field before using a receipt. A compact key alone must not authorize an otherwise forged token.

Receipts own terminal status, liveness and exact outcome; unresolved preparations reference receipts and hold only recovery fields. Revisions, Lifecycle Events, pending endpoints and restore origins reference the compact receipt instead of retaining a completed preparation. Point operations still reserve real public identities before publication where required. Window preparation uses explicit disposition with no fabricated public revision identity. Keep pending interval evidence with pending work and one authoritative retained interval in revision evidence after sealing.

Protect live, unresolved, endpoint, revision, lifecycle and restore-referenced receipts even below the retirement watermark. Clear/purge ordering and epoch advancement must be transactional. The compact schema should make these relationships easier to inspect rather than adding an identifier registry or general serialization framework.

## Checks

Production-path focused workloads must prove create/save/window/action/restore/lifecycle outcomes, duplicate and stale callbacks, rollback/clear/purge/reset, dropped callbacks and fresh-process recovery at preparation/publication/capture/seal boundaries. Verify exact retained identities, reconstruction/provenance/export equivalence and payload retirement. Scope-forged tokens must fail without data publication. Inspect foreign keys, query plans, allocations and retained record bounds; preserve latency budgets. Use small authentic fixtures now, then one final authentic 10k/100k generation in issue 55. No durable compatibility adapter or generic storage interface.

## Comments

- 2026-09-06: Compact keys and completed-receipt separation belong in one schema change to avoid layered migrations.

## Resolution

Implemented schema 14 with compact nonce receipt keys and unresolved-only
preparations. All publication boundary operations validate complete token scope
before using the nonce. Exact outcomes and status/liveness live on receipts;
finalize/abandon removes preparation fields transactionally. Window dispositions
have no synthetic Revision Identity, point operations preserve reserved public
identities, and retained interval verification uses receipts plus the sole
`revision_window_evidence` record. Reference protection, 64-receipt retry tails,
watermarks, and transactional clear/purge epoch invalidation remain intact.

Fresh-only fixture contracts now use window-v3/current-scale-v2 and reject old
formats. Existing schema-13 masters/reports and the issue-51 old-format experiment
were preserved. No user database, native application, or startup policy was
changed. Current source is frozen for orchestrator and independent audit.

Validation: 542 backend tests, 16 backend architecture checks, 17 frontend
architecture/contracts tests, 8 fixture Python checks, and 5 Node fixture
preflight checks passed. A small authentic production-command fixture passed:
3 notes, 300 saves, 12 windows, 15 retained revisions, 207 receipts, zero remaining
preparations. Schema-14 receipt keys are 26 bytes; FK and query-plan checks passed.
Full commands, logs, limitations, and allocations are in the
[validation report](../../../docs/architecture/compact-publication-persistence-52-validation.md).
Final authentic 10k/100k and native acceptance remains issue 55 work.

- 2026-09-06: Final orchestrator integration, independent Standards/Spec, follow-up source and evidence audits passed. The report includes the final 200-test result and distinguishes the earlier full-library/small-fixture source stage. All 16 pre-existing validation/measurement reports remain byte-identical to `after51.tgz`. Issue 52 is complete for its scope; issue 53 may proceed.

Independent Standards/Spec and orchestrator source audits passed. The requested
follow-up removed only two duplicate retained-window verification passes;
`verify_retained_revision` remains authoritative for those checks and the
separate cross-record/base/pending-window guard remains. Final focused regression:
200 passed, 0 failed, 9 ignored in 29.00 s
(`/tmp/issue52-timeline-audit-followup.log`). Source is frozen again for final
evidence review; canonical `ready-for-agent` status is unchanged.
