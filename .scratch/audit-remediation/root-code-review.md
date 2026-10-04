# Independent root-owned correctness review

Baseline: cb4d4c02f0e2c1220d37b281ee300eff1aabf20b, including working-tree changes and added regressions. Scope: search.rs, commands/search_commands.rs, note.rs, commands/asset_commands.rs, path_utils.rs and their immediate callers. Sources: audit remediation issues/review, behavior invariants, architecture, repository code-review skill. This is the Spec/correctness complement to standards-review.md.

## Confirmed findings and disposition

1. **P2 — candidate eligibility must precede upstream search limits.** Ordinary search's merge helper rejected ChatIndex before its own final limit, but semantic/mod.rs truncated to the requested candidate limit before this helper. With no tag scope, search_commands.rs passed no eligible-path filter; enough higher-ranked chat chunks could therefore erase all ordinary-note candidates. The newly added helper test supplied untruncated candidates and could not catch this. Sent to root and semantic owner. Owner has now added optional kind eligibility to semantic candidate SQL before ranking/truncation and an actual scoped-query regression; reviewed current SQL/call site. The broader evidence search deliberately keeps all kinds. **Follow-up still pending at review time:** lexical.rs search_locked line351 applies TopDocs(limit*4) before kind filtering too; search_with_catalog line269 only filters its fallback. Sent owner to verify and handle indexed-chat crowding in that path rather than declare final merge sufficient.

2. **P2 — managed timestamp grammar accepted signed fields and second60.** The prior parser parsed two-character fields with parse::<i64>(), so '+1' month/day/hour values succeeded, and accepted arbitrary ':60'. Exact extracted production parser probe returned Some timestamps for all those cases; even 1969-12-31T23:59:60Z became Some(0), contradicting the new preepoch rejection test. This predates the patch but was a gap in the expanded grammar/epoch audit. Recommended ASCII digits at fixed field positions and seconds0..59, matching the app's emitted format. Root implemented both and added signed/second60 regressions at note.rs665; source review confirms the correction. Full compiled Rust validation remains root-owned.

## Inspected without additional confirmed defects

- Unicode original_span maps folded byte positions to original scalar boundaries, including lowercase expansions; frontend highlight consumer uses Array.from, matching scalar indexing. Reviewed original-match offset and excerpt highlight paths plus expansion/emoji fixtures. Contextual casing does not produce a demonstrated offset-length defect here.
- Fallback search cache hashes resolved current body and title when supplied content hash is absent. Fingerprint framing, generation/currentness, cache hit validation and boundary regressions inspected; no new confirmed cache collision/stale-delivery path.
- Asset creation reserves the destination with create_new and retries occupied candidates, including dangling symlink entries through symlink_metadata. Existing files are preserved; failed writes remove the newly reserved candidate. This is atomic name reservation, not whole-file atomic publication, but the command returns only after successful writes and no required observer contract establishing a new partial-read defect was found. Parent-directory symlink policy is unchanged.

## Verification limits

Read scoped diffs and relevant tests/callers; exact parser reproduction compiled separately with rustc before correction. Did not run full Rust/browser/native suites or claim pass results from source inspection. Root and semantic owner own corrective implementations and combined validation. No unrelated production edits made during this review.
