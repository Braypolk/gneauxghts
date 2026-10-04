# Browser command contract follow-up

Status: ready-for-agent
Progress: implemented; focused factory 5/5 and E2E TypeScript passed; root mounted history-citations1/1 and startup-readiness2/2 passed
Owner: audit_documents

## Evidence and plan

Root's full browser run exposed a missing seeded revision-chat model-capability response and an invented object rejection for save admission. Production save_note/save_task_note return Result<NoteSession,String>; note_persistence stringifies HistoryError. Preserve that contract in the fixture instead of adding unsupported production error normalization. Add typed seeded chat capabilities and focused factory tests for the conversation prerequisite and failed save preserving canonical content. Preserve strict unknown-command rejection. Root owns browser rerun; run focused Vitest here.
