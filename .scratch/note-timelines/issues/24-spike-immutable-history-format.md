# 24: Spike the immutable portable history format

**What to build:** A separate evidence-backed decision selects the immutable history-record shape and single-writer live-sync consistency model using real SQLite histories, without introducing concurrent history merging or speculative abstractions.

**Blocked by:** 01: Benchmark revision storage and migration shape; 11: Make cleanly closed vaults portable.

**Status:** ready-for-agent

- [ ] Evaluate immutable independently addressable representations for revisions, checkpoints, Lifecycle Events, labels, deletion markers, manifests, and rebuildable projections.
- [ ] Use exported real-world SQLite histories and adverse cases to measure object count, changed-content write amplification, reconstruction, synchronization, compaction, and deletion behavior.
- [ ] Define how one logical writer detects incomplete transfer, duplicate delivery, manifest races, rollback, and inconsistent local projections without implying concurrent merge support.
- [ ] Preserve existing globally unique identities, explicit parent relationships, versioned payloads, content hashes, deletion semantics, and role-limited `NoteTimeline` capabilities.
- [ ] Determine the real common storage interface required by both SQLite and the selected immutable implementation, extracting no abstraction based only on conjecture.
- [ ] Prototype verified export, interrupted transfer, reconstruction, and projection rebuild from immutable records.
- [ ] Record the selected format, consistency rules, migration boundaries, rejected alternatives, and unresolved multi-writer questions in a separate accepted decision before implementation.
