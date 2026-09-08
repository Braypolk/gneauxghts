# Remove unused history indexes

Status: ready-for-agent
Depends on: 50

## Acceptance

Audit current query access paths and remove only indexes shown to be unnecessary. In particular, establish whether `prepared_intents_by_target` has any current consumer. Apply derived-index cleanup only after supported-store identity/format/generation/observation admission. Preserve all preparation/recovery checks and history behavior.

## Checks

Record reproducible read-only table/index allocation, payload, in-page unused space and freelist measurements from the sealed 10k/100k old-format masters. Use disposable copies to measure index removal and optional repacking; clearly distinguish logical removal from physically reclaimed bytes. Compare relevant query plans and focused production save/recovery/history behavior before/after. Unsupported stores must remain unchanged on rejection. Preserve sealed masters and historical reports. Do not remove an index merely because its name is not mentioned by application code.

## Comments

- 2026-09-06: First sequential storage/startup improvement; orchestrator audit precedes issue 52.
- 2026-09-06: Final audit passed: orchestrator source/Standards review and independent evidence/Spec review both reported no findings. Implementation remains frozen; `Status: ready-for-agent` is preserved.

## Resolution

Implemented and frozen for orchestrator audit, 2026-09-06. Fresh schema-13 stores
omit `prepared_intents_by_target`; existing admitted stores drop only that index
after complete metadata and app-observation admission. Pending-note and both
successor indexes remain. The SQL access audit found no target-prefix consumer;
all six representative current query plans are identical with/without the index.

An admission regression reproduced a header write on an observed-instance
rejection for DELETE-journal stores. Moving persistent WAL configuration after
observation admission fixes it; all 11 rejection cases now preserve database and
observation bytes. No normal-startup VACUUM was added.

The [validation report](../../../docs/architecture/history-index-51-validation.md)
and [raw allocation evidence](../../../docs/architecture/history-index-51-measurements.json)
record sealed old-format 10k/100k baselines and reproducible DROP/repack operations
on byte-identical disposable database copies. The 100k target index occupies
39,432,192 bytes; DROP leaves the 607,735,808-byte main file unchanged and raises
the freelist from 65,536 to 39,497,728 bytes. Separate full VACUUM reduces the copy
to 485,175,296 bytes, including consolidation unrelated to the dropped index.
The baseline's 112,908,359 unused bytes are inside allocated pages, not freelist.
Old 10k access paths and current derived-index plans are reported separately.

Checks: 198 NoteTimeline tests passed (8 explicit scale/benchmark ignores),
16 architecture fitness tests passed, full copy integrity/foreign-key checks
passed, master seals verified before/after. Historical reports and masters stay
unchanged; no app launch, user database reset, commit, or issue-52 work performed.
Status remains `ready-for-agent` pending orchestrator review.
