# 09: Initialize existing vaults with Baseline Revisions

**What to build:** Existing notes acquire honest Baseline Revisions in the background without Markdown rewrites, including a race-safe synchronous path when editing starts before initialization reaches a note.

**Blocked by:** 07: Capture and reconstruct durable Note Revisions; 08: Record external revisions and Lifecycle Events.

**Status:** ready-for-agent

- [x] Scan existing managed ordinary notes in the background and create exactly one Baseline Revision for each uninitialized Note Identity without modifying its Markdown.
- [x] Record `knownSince` for baseline content while leaving earlier introduction and last-change provenance explicitly unknown.
- [x] If a mutation arrives before background initialization reaches the note, synchronously establish its baseline before preparing the new mutation.
- [x] Make repeated initialization, interruption, restart, and concurrent watcher observations idempotent.
- [x] Expose initialization progress and per-note initialization state through typed diagnostics.
- [x] Record vault identity, selected history format, and store generation in both manifest-level and store-level metadata and detect mismatches on reopen.
- [x] Support resetting development metadata and rebuilding baselines without pretending that erased history survived.
- [x] Add tests for new vaults containing existing notes, large scans, mutation races, restart, identity damage, and generation mismatch.

Same-generation replacement by an older, internally valid store copy remains
part of Ticket 11's clean-close portability and reconciliation work; this
ticket detects missing stores, selector rollback, and manifest/store metadata
mismatch without introducing that later watermark protocol.
