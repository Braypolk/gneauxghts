# Build bounded deduplicated image embeddings and ANN

Status: needs-triage
Type: task
Depends on: 02, 03, 04
Triage reason: runtime limits and generation schema must be finalized first.

## Deliverable

Incremental pure-image vectors and a separate image ANN with accurate coverage and current note-occurrence associations.

## Work

Support PNG/JPEG/static WebP through bounded decode, orientation normalization, fixed alpha policy and verified model preprocessing. Reject unsupported/animated, missing/corrupt and oversized media with per-image coverage reasons. Use ticket 01 budgets; do not resize/patch differently from the declared representation.

Cache vectors by byte hash and image representation identity, sharing work across identical bytes. Keep individual eligible occurrences and typed locators separate from text passages. Image failures leave note text usable. Remove the final reference from search eligibility without deleting its file.

Reuse worker coalescing, priority, retries and generation publication. Validate source bytes/occurrences on completion; superseded work cannot publish. Update readiness/coverage and rebuild only affected representations. Do not incorporate images into Atlas/Related Notes aggregates in v1.

## Acceptance

Tests cover duplicate bytes, format/size bounds, interrupted embedding, stale completion, replacement during indexing, failed images beside successful text, last-reference removal and incremental recovery. A runtime integration fixture proves images, not filenames, determine vectors.
