# 01: Benchmark revision storage and migration shape

**What to build:** An evidence-backed storage decision for lossless Note Revisions that selects the initial delta, compression, checkpoint, and SQLite durability policies while proving the stored domain records can later leave SQLite without changing their meaning.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Benchmark verified UTF-8 retain/delete/insert deltas across realistic typing sessions, repeated small changes to 1 MB notes, complete replacements, repetitive text, random text, long replay chains, and adverse delta ratios.
- [x] Compare candidate compression and adaptive checkpoint policies using replay count, accumulated delta bytes, delta-to-full ratio, measured reconstruction cost, stored size, and changed-content write cost.
- [x] Select SQLite WAL, foreign-key, synchronous, busy-timeout, and checkpoint parameters that preserve durable intent preparation before Markdown publication.
- [x] Demonstrate timeline paging near 250 ms and deep reconstruction below one second for representative histories approaching 10,000 revisions on one note and 100,000 revisions across a vault, or document measured constraints that must be resolved before implementation.
- [x] Export representative SQLite-backed revisions, checkpoints, Lifecycle Events, labels, and deletion markers into storage-neutral immutable fixtures without relying on row IDs or row order.
- [x] Reconstruct the exported fixtures and prove that opaque domain identities, parent relationships, canonical UTF-8, and content hashes match the SQLite-backed source.
- [x] Record the selected codec, encoding versions, thresholds, parameters, benchmark evidence, and rejected alternatives in implementation-facing documentation without designing the later live-sync format.
