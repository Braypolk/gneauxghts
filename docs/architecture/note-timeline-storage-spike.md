# Note Timeline storage spike

This spike resolves the blocking storage choices for the first SQLite-backed Note Timeline implementation. It does not define the later immutable live-sync format.

## Decision

- Encode revision deltas as a versioned sequence of retain, delete, and insert operations.
- Produce those operations with `similar` 3.2's bounded Myers algorithm over complete Markdown lines, then refine each replaced line block with a byte-level single-span delta. This keeps ordinary formatting and text changes compact while avoiding the whole-middle replacement behavior of a pure prefix/suffix codec.
- Use the spike's `NTL1` payload shape as the implementation input for Ticket 07. The production codec may deepen its private representation, but it must remain versioned and reconstruct the exact UTF-8 bytes.
- Store deltas uncompressed. Compress full checkpoints with Zstandard level 3.
- Create a checkpoint when any bound is reached:
  - 128 revisions since the previous checkpoint;
  - 256 KiB of accumulated encoded deltas;
  - the next delta is at least 65% of the complete authored state; or
  - measured replay reaches 50 ms.
- Open SQLite in WAL mode with foreign keys enabled, `synchronous=FULL`, a 5-second busy timeout, and a 1,000-page WAL autocheckpoint. `FULL` is selected despite its higher latency because durable preparation must survive before Markdown publication.
- Keep globally unique domain identities, explicit parent identities, versioned payloads, and BLAKE3 result hashes independent of SQLite row identities and row order.

## Reproduction

Run:

```sh
cargo run --release --example note_timeline_storage_spike --manifest-path src-tauri/Cargo.toml
```

The measured run used Rust 1.93.1 on arm64 macOS, Zstandard CLI 1.5.7, LZ4 CLI 1.10.0, `similar` 3.2.0, and bundled rusqlite 0.32.1. Compression timings include process-launch overhead equally for both CLI candidates; production compression will run in-process.

## Results

| Scenario | Revisions | Final size | Full states | Single-span deltas | Selected deltas | Checkpoints | Maximum replay |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Realistic typing | 2,000 | 15,916 B | 15,372,312 B | 88,829 B | 120,811 B | 27 | 28 µs |
| Repetitive 1 MB note | 1,000 | 1,048,576 B | 1,048,576,000 B | 52,000 B | 68,000 B | 7 | 1,591 µs |
| Random ASCII 1 MB note | 1,000 | 1,048,576 B | 1,048,576,000 B | 51,963 B | 67,963 B | 7 | 1,674 µs |
| Distant multi-hunk edits | 500 | 262,144 B | 131,072,000 B | 130,965,995 B | 47,798 B | 3 | 458 µs |
| Complete replacements | 200 | 131,072 B | 26,214,400 B | 26,221,599 B | 26,224,799 B | 200 | 7 µs |
| Long replay | 10,000 | 65,536 B | 655,360,000 B | 438,931 B | 598,931 B | 78 | 154 µs |

The selected codec adds a small operation-header cost to simple single-span edits. That cost prevents the severe amplification seen when one canonical commit changes distant regions. Complete replacements exceed the 65% ratio and therefore become compressed checkpoints immediately rather than pretending to be useful deltas.

Zstandard produced smaller checkpoints than LZ4 for realistic, repetitive, and random ASCII Markdown. Across the measured random 1 MB checkpoints, Zstandard stored 4,422,001 bytes versus LZ4's 7,334,701 bytes. Across distant repetitive multi-hunk checkpoints it stored 198 bytes versus 3,303 bytes. LZ4 was faster, but even the measured Zstandard CLI work—including process launch—remained well below the checkpoint and restore budgets, so size wins for durable retained history.

With 100,000 revision rows across 100 notes, indexed 100-row timeline pages measured 24 µs for the first page and 19 µs for a deep page. This is comfortably below the approximately 250 ms product target before IPC and rendering overhead.

For 250 independently committed 1 KiB intents, SQLite `synchronous=FULL` averaged 56 µs per commit versus 16 µs for `NORMAL` on the test machine. The stricter mode remains selected because the product contract values the pre-publication durability boundary over this local latency difference.

## Migration-shape proof

The spike inserts three revisions plus a checkpoint, Lifecycle Event, Named Revision, and deletion marker into SQLite in an order different from their domain relationships. It exports all seven as immutable JSON records, discards row identity and ordering, rebuilds the revision parent chain by opaque record identity, and verifies every revision BLAKE3 result hash. The final reconstructed hash is `1c058b6ac518a671715b70569a6eedf6868078c7ed31cf818aaa54d3c84b8365`.

This proves the first representation can leave SQLite without reinterpreting timeline identities. It does not choose the future immutable object layout, conflict rules, or live-sync behavior.

## Limitations and follow-up

- The benchmark is deterministic and representative, not a substitute for fault-injection around actual production writes. Ticket 07 must prove the prepare–publish–finalize crash boundaries.
- The line-aware codec intentionally degrades to a large changed block for multiple distant edits inside one enormous line. The ratio bound turns that case into a checkpoint. Markdown with ordinary line structure retains multi-hunk efficiency.
- Compression timings use command-line executables. Ticket 07 should use an in-process Zstandard implementation and recheck the thresholds without changing the external reconstruction contract.
- The 50 ms replay bound is a runtime safety valve. The measured maximum was 1.674 ms, leaving margin for slower supported hardware and database reads.
- The production availability policy for a history-store failure remains the later release-gate decision defined by the spec.
