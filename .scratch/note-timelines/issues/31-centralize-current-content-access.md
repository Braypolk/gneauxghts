# 31: Centralize current-content access

**What to build:** Search, retrieval, task, and Atlas reads share one role-limited current-content capability so deleted, cleared, forgotten, Missing, or concurrently invalidated content cannot escape through caller-specific consistency checks.

**Blocked by:** 03: Migrate app-owned note writers to NoteTimeline; 10: Implement clear, purge, and deletion boundaries; 19: Recover and expire Missing Notes.

**Status:** ready-for-agent

- [x] Provide one Note Timeline-owned current-content interface that applies identity, vault access, lifecycle eligibility, and deletion-consistency rules internally.
- [x] Migrate search, retrieval, task, and Atlas consumers without changing their valid user-visible results.
- [x] Ensure a read invalidated by clear, purge, forget, Missing transition, or concurrent mutation cannot return stale current content.
- [x] Keep role-limited access explicit so callers cannot acquire historical prose or broaden their permitted note set.
- [x] Remove the caller-managed begin-and-recheck protocol after every production consumer has migrated.
- [x] Add concurrency and architecture coverage for each consumer family, including invalidation between query execution and result delivery.
