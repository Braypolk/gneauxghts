# 08: Record external revisions and Lifecycle Events

**What to build:** Every distinct external note state actually observed becomes honest timeline evidence, while path changes and conflict choices remain distinguishable from content revisions.

**Blocked by:** 07: Capture and reconstruct durable Note Revisions.

**Status:** ready-for-agent

- [x] Record one External Edit revision for each distinct canonical state observed by the watcher or reconciliation scan, without claiming unobserved intermediate saves.
- [x] Record authoritative observation time and an optional clearly untrusted filesystem modification time.
- [x] Record title-only and path-only rename or move changes as Lifecycle Events that create no Note Revision and do not enter revision content.
- [x] Immediately treat observed disk content as canonical while preserving dirty local content in the existing conflict model.
- [x] When the user chooses to keep dirty local content after an external change, publish it as a separate Editor revision so both observed states remain retained.
- [x] Make duplicate events, debounce bursts, self-save expectations, and background reconciliation idempotent.
- [x] Repair unfinished finalization and missed observations without replaying an already committed write.
- [x] Add tests for external edits, source recreation, path reuse, rename, dirty conflicts, watcher loss, duplicate events, and restart reconciliation.
