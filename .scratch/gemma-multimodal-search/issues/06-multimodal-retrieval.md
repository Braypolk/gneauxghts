# Add scoped text/image queries and typed results

Status: needs-triage
Type: task
Depends on: 05
Triage reason: image index and calibrated channel limits must exist first.

## Deliverable

Text→text/image and image→text/image retrieval through typed commands and result records, integrated with existing scoped hybrid search.

## Work

Search compatible text/image ANN with text query vectors or pure image query vectors. Image query preprocessing must match indexing and is temporary bounded input. Apply existing folder/note/document eligibility and revalidate current note/asset identity before delivery. An image query scoped to remembered chats searches their text vectors; it does not manufacture chat images.

Fuse independently ranked lexical/text/image channels, cap repeated note/asset hits, and calibrate modality-specific thresholds. Image-only queries have no lexical score. Retune Jina-calibrated similarities; do not inherit its floor or sum uncalibrated cosine scores. Preserve literal/regex/current-note textual find.

Extend backend and TypeScript query/result types with passage versus image occurrence variants. Leave textual coordinates/quotes semantically intact. Agent evidence APIs remain text-only; image similarity alone cannot issue a passage citation or visual fact.

## Acceptance

Tests exercise all retrieval directions, scopes, duplicates, source replacement/deletion, incompatible generations, unavailable vision and text fallback. Judged fixtures include images with misleading filenames and near-duplicate hard negatives. Existing text/evidence/citation contracts continue to pass.
