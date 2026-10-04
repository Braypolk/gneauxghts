# 98-lexical-note-kind-admission

Status: ready-for-agent
Progress: complete
Findings: BB02 ordinary lexical candidate admission follow-up
Owner: editor agent; root owns query command composition

## Evidence and plan

`LexicalIndex::search_with_catalog` excludes non-Note catalog fallbacks, but indexed `search_locked` collects TopDocs(limit * 4) across every document kind before command filtering. More than 160 high-scoring chat paragraphs can exhaust the ordinary search collector at the command's limit 40. Verify with `build_indexed_note` and the production `LexicalIndex::upsert_note` / `search_with_catalog` path. Add a document-kind term constraint before TopDocs in the ordinary-note helper. Keep `evidence_matches` independently scoped by allowed IDs and able to return chat passages.

## Validation

Red/green real Tantivy fixture with 200 stronger chat paragraphs and a lower-ranked ordinary-note body. Assert ordinary notes survive the40-result path and no chat result enters it, before and after projection upserts. Assert the separate evidence query still retrieves the chat by its admitted ID. Run lexical and relevant command/evidence scoped tests; root runs final native build.

## Scope refinement

Root approved the identical current-path starvation boundary: add the excluded path as a MustNot term before TopDocs, with a real 200 paragraph ordinary-current-note fixture proving another ordinary note survives. Remove redundant post-collector path rejection; evidence scope remains unchanged.

## Outcome

Implemented kind and current-path admission inside the indexed BooleanQuery before TopDocs. Both real production upsert/query regressions failed before their fixes and pass afterward. Evidence remains independently scoped and returns chat passages. Final lexical suite: 5 passed. See ../semantic.md and ../semantic-validation/ for evidence. No public signature changes.
