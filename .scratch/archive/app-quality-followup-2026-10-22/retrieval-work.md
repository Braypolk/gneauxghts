# Retrieval work and retrieval-time cues

2026-10-22 implementation evidence for issue 02. This is an outcome record,
not a replacement for ARCHITECTURE.md or the current-content invariants.

## Implemented

- Ordinary text search keeps independent note and image requests. The media
  request can omit passage ranking (`includePassages: false`), since hybrid note
  search already owns those rows. Image-input search retains both channels by
  default. Optional `includeImages` lets an explicit Notes cue omit image work;
  each included channel applies its own admission and limit before presentation.
- One last successful exact text-query embedding is shared inside the fixed
  vault-lifetime semantic provider/generation. It is keyed by exact input and
  model fingerprint; a distinct query/model replaces it. Preparation serializes
  concurrent callers, does not cache errors, and has no arbitrary TTL. The cache
  contains a vector and input, never note bytes, scope, candidates or results.
  Every consumer still admits its generation, scope, modality threshold and
  current canonical content. Repeated semantic widening can reuse preparation.
- Retrieval fingerprinting captures sorted identity/path bindings under the
  notes-index mutex, reads and hashes file bytes outside it, and rejects a
  changed binding after the read. Both before/after byte fingerprints remain.
  Same-size writes, unchanged timestamps, missed watcher changes, conflicting
  managed identities and ambiguous passage ranges are still checked. No
  timestamp-only or watcher-only freshness shortcut was introduced.
- `retrieve_scoped_notes` shares the canonical passage ranking with authorized
  paginated consumers: query bound 4096 bytes, unique-note work page at most
  4096, refreshable current-content delivery. The ordinary retrieval adapter
  keeps its 1024-byte/20-note bounds. A blank damaged managed ID remains
  admissible under its established catalog identity; a conflicting nonblank ID
  or trashed metadata is rejected.
- Both dock commands accept optional `modifiedSinceMillis`. Filesystem edited
  time enters lexical/semantic/image eligibility before ranking and limits, and
  the hybrid cache key includes the cutoff. Lexical scope enters Tantivy before
  its bounded collector and also scopes pending catalog fallback; it does not
  filter an already limited result list. A clean active editor retains saved
  modification time. Unsaved work and an active body/title/tag different from
  canonical content count as edited now. This is an optional cue, not new
  classification or storage.

The pre-existing short result caches retain their separate policies. This pass
does not add a generic cache framework or combine caller authority with cached
rankings.

## Reproducible measurements

Run from the repository root:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib profile_ -- --ignored --nocapture
```

Two explicitly ignored diagnostic tests retain the matched baseline and current
implementations. Run on this Mac in the unoptimized Rust test profile with seven
warm-filesystem samples per corpus. Times below are medians. They are local
fixture evidence, not production latency targets or real-model quality results.

`profile_dock_query_work` calls the actual native semantic text/media APIs with
one current chunk per note, 3-dimensional controlled vectors, no images, and an
explicit 40 ms inference delay. The baseline clears shared preparation between
the consumers and retains the old discarded media text ranking. The current
path shares preparation and omits that ranking. Corpus bytes, scope, vectors,
provider delay, result limit and ordering are otherwise identical.

| Notes / corpus bytes | Query embeddings before → after | Text chunks scored before → after | Native semantic pair before → after |
| --- | --- | --- | --- |
| 128 / 2,063,360 | 2 → 1 | 256 → 128 | 164.414 ms → 83.375 ms |
| 1024 / 16,506,880 | 2 → 1 | 2048 → 1024 | 682.755 ms → 343.657 ms |

The deterministic work counts establish removal of duplicate work. The timing
depends on the deliberately controlled provider cost and debug build. It does
not measure the complete dock IPC/lexical/rendering journey, a live Gemma/Jina
model, large real image inventories or perceived query latency.

`profile_fingerprint_corpus_work` compares the prior mutex-held implementation
with the unlocked file-read implementation on identical note bytes. Assertions
require identical fingerprints. Times cover the pair of scope fingerprints used
by a query. The new lock figure is deliberately a conservative upper bound: all
non-file-I/O time, including work that actually runs outside the mutex.

| Notes / bytes read per fingerprint pair | Total before → after | Prior catalog lock held | New aggregate lock upper bound |
| --- | --- | --- | --- |
| 128 / 4,371,712 | 63.476 ms → 64.544 ms | 62.818 ms | 3.470 ms |
| 1024 / 34,973,696 | 500.236 ms → 505.742 ms | 495.242 ms | 26.404 ms |

File I/O under the new catalog lock is zero; a controlled regression acquires
that lock during the file-reader callback and mutates a binding to verify
invalidation. Total fingerprint latency is approximately unchanged, slightly
higher in these samples. This change removes catalog contention; it does not
claim fewer bytes or a faster isolated fingerprint. A narrower freshness proof
remains deferred because dropping either byte scan could miss external changes
that the watcher has not observed.

## Verification and limits

- Native retrieval tests cover canonical UTF-8 previews, pending lexical
  fallback, scope/exclusions, metadata dates, limits, blank/conflicting managed
  IDs, stale bytes with unchanged timestamps, ambiguity, source fusion and
  scope-path mutation during hashing.
- A synthetic approximate source demonstrates lexical absence for
  “inexpensive greenhouse” while admitted semantic evidence returns “budget
  seedling shelter.” This verifies the semantic candidate path and canonical
  admission, not a real model's relevance quality.
- The real text/media API test checks one prepared query and one text-ranking
  operation for ordinary text search, retains image-input passage ranking,
  and keeps a failed media request from poisoning later note retrieval.
- Query-preparation tests cover exact input/Unicode, eviction by distinct input,
  model identity, concurrent callers and failure retry.
- Edited-time and lexical tests prove older strong title matches cannot consume
  a recent note's bounded collector, cutoff cache separation, pending/indexed
  agreement, and dirty/unsaved current document eligibility.
- The frontend owns cue selection, request supersession and independent channel
  errors. Its browser/UI evidence is recorded by the coordinating app-quality
  outcome, separately from these native profiles.

Edited-time cues use the catalog's filesystem modification observation for
saved notes, consistent with existing interactive indexing. They are not
historical provenance or a claim that timestamp-only changes are authored
revisions. Real-vault performance, model relevance, mobile/WebView behavior and
human delayed-refinding outcomes remain separate evaluation work.
