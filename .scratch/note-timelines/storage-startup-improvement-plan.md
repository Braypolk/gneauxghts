# History storage and startup improvements

Continue from completed issues 44–50. Implement one issue at a time with a fresh implementation agent, followed by orchestrator review and focused follow-ups before the next issue. Preserve existing uncommitted work and historical evidence; do not commit or reset user databases.

## Agreed outcome

Reduce permanent publication bookkeeping without changing retained Note/Revision/Lifecycle identities or the Editing Window contract. Open the normal workspace without waiting for a whole-vault history scan. The user explicitly selected: allow saves after interrupted-work recovery and verification of the edited note, while other history is verified in the background. Corruption in unrelated history may therefore be discovered later; once discovered, the existing corruption gate blocks new publication. Durable preparation, committed-result warnings, and truthful provenance remain mandatory.

This deliberately replaces the whole-vault-before-first-save verification policy. Record the timing/scope trade-off in an ADR and update the applicable invariants; do not reinterpret mandatory history preparation as permission to save without history. Verification of a note may still cost time proportional to its own retained history. Recovery must settle actual interrupted operations before conflicting work is admitted.

## Sequence

| Issue | Outcome |
| --- | --- |
| [51](issues/51-remove-unused-history-indexes.md) | Verify/remove unused indexes and establish a reproducible table/index allocation baseline. |
| [52](issues/52-compact-publication-persistence.md) | One fresh storage-format change for compact private publication keys and pending-only preparation data, with minimal exact completed receipts. |
| [53](issues/53-verify-active-note-before-background-history.md) | Note-scoped readiness after recovery, prioritized foreground verification, and background full-history verification inside NoteTimeline. |
| [54](issues/54-open-workspace-with-explicit-save-readiness.md) | Responsive workspace bootstrap, clear saving/readiness behavior, and no false saved state or unrelated-scan blocking. |
| [55](issues/55-validate-compact-storage-and-responsive-startup.md) | Final storage/repacking, recovery, startup, interaction and native acceptance on authentic current-format histories. |

## Constraints and evidence

- No generic store interface, permanent second history owner, new durable draft subsystem, history bypass, or silent reset. Keep implementation policies private to the concrete NoteTimeline store/runtime and existing workspace/document owners.
- Existing user preference for rebuilding databases permits a fresh-only current schema; no legacy migration or trust path. Never actually reset the user's databases. Preserve domain identities and semantic export/restore/citation contracts in the new format.
- Use compact internal publication references, retaining complete token scope validation at the boundary. Retire only information proven unnecessary for exact retries, window evidence, restore provenance, generation/epoch checks and interrupted recovery.
- Separate allocated bytes, payload bytes, index pages, unused space inside pages, freelist pages and measured repack results. Benchmark compaction only on disposable copies; do not put a whole-database VACUUM on startup or claim every unused byte is reclaimable.
- Historical issue-49/50 masters and reports stay immutable. Existing masters can establish old-format baselines and disposable experiments; never relabel them as new-format production acceptance. Generate authentic new-format scale evidence once after the storage and runtime code stabilizes, reusing smaller focused fixtures during implementation.
- Native runs must use the shared isolated/hash/profile/feature-admitted E2E artifact, all three contained temporary roots, owned-PID/vault checks, actual unlocked/visible/focused frames, and exact child cleanup. Preserve failed attempts. No hidden-frame measurements.
- Test corrupt/unavailable/replaced stores, reset/clear/purge invalidation, pending publication/window/observation/deletion recovery, concurrent saves/background verification, close/switch cancellation, old citations and workspace restoration. A stale verification result must never bless newer state or another store generation.
- Issues 22 and 24–26 remain deferred. Implement only verification concurrency safeguards required by this change; do not broaden into the deferred History Mode feature work.

## Baseline

Exact pre-plan workspace snapshot: `/tmp/gneauxghts-history-hardening-baseline/before51.tgz`. Issue 49: ~608 MB history database for 100k revisions, ~222 MB allocated indexes, ~5.4 MB compressed revision payload, ~7.2 s fresh backend recovery/attestation with warm OS caches. Read-only follow-up breakdown: prepared intents ~136 MB, window publication records ~91 MB, receipts ~74 MB; repeated publication token averages ~169 bytes. These are measurements of the old schema, not promised savings.
