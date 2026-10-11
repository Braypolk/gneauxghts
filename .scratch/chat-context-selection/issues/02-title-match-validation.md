# Validate lexical title matches against canonical titles

Status: ready-for-agent
Type: task
Resolution: implemented

On a synchronized index, a lexical search for Meridian retrospective restricted to that note returns title and body matches. The evidence owner attempts to locate both in canonical body text. The title is absent there, so coverage includes a false “An indexed passage changed or was ambiguous” gap. This is independent of semantic availability and broad search scope.

Preserve a match's canonical location through retrieval and validate title matches against the canonical title. Keep real stale/ambiguous-body rejection, access filtering, ranking, overlapping candidate handling and citation validation. Do not suppress the warning globally or trust unvalidated index excerpts.

Acceptance: a title-only match in a fresh note succeeds without a stale-passage gap, while stale and ambiguous body passages remain withheld. Verify discovery/read/citation behavior and exclusions through the registered interface. Include a title matching multiple body paragraphs so title validation cannot accidentally bind to a body occurrence.

Evidence: [audit](../audit.md), `freshIndexTitleMatches` and first `searchAlternatives` entry in [trace](../offline-trace.json). Implementation: `LexicalIndex::evidence_matches`, `EvidenceSession::search_inner`, `current_text_range`.

## Comments

2026-10-09: Added typed title/body locations to lexical matches and canonical validation. Registered-tool regressions cover title-only discovery/read/citation, exclusions, repeated matching body text, and real stale-body rejection. See [fixes and verification](../fixes.md).
