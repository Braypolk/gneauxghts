# Deduplicated image index and coverage

Status: ready-for-human
Updated: 2026-10-06
Blocked by: 02, 03, 04

## Scope

Capture/hash bounded local PNG/JPEG/static WebP bytes and verify source identity before publication. Normalize EXIF/alpha with a versioned policy. Share vectors for duplicate bytes, retain independent eligible occurrences, store separate image ANN and modality/representation identities, and report unsupported/failed coverage independently of text.

## Implementation state

Implemented bounded image preprocessing, byte/profile deduplication, separate durable vectors and immutable incremental HNSW snapshots, SQLite reranking, scope admission, snapshot repair/cleanup, and independent indexed/unsupported/failed coverage. The 3,000-vector benchmark records 99.5% recall@10.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
