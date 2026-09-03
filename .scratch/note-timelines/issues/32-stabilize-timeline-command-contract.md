# 32: Stabilize the timeline command contract

**What to build:** History failures appear to users and frontend callers as stable Note Timeline product states while storage, reconstruction, and database details remain private implementation concerns.

**Blocked by:** 30: Encapsulate Note Timeline runtime coordination; 31: Centralize current-content access.

**Status:** ready-for-agent

- [ ] Define closed errors for history access and history-changing operations, including unavailable, corrupt, stale, ineligible, missing, and invalid-request states.
- [ ] Preserve diagnostic causes for logs while preventing storage paths, query text, and reconstruction internals from crossing the command interface.
- [ ] Map every command failure to a stable frontend representation and a useful user-facing recovery action where one exists.
- [ ] Establish shared contract fixtures for mutation sources, lifecycle kinds, time kinds, history health, cursors, and command errors across Rust and TypeScript.
- [ ] Add contract tests that fail when either side adds, removes, or changes a serialized timeline state without updating the other.
