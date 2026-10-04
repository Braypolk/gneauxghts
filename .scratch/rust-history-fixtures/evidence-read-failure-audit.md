# Focused surviving-evidence failure: read-only diagnosis

Status: complete
Progress: Source/log diagnosis recorded; no source edits, tests, builds, or reproduction runs by this reviewer. Coordinator repeats baseline/current test separately.

## Finding

`editing_window_capture/tests.rs::focused_evidence_returns_surviving_period_ranges_after_later_edits_and_clear_invalidates` assumes `EvidenceSession.read(..., &ids, false)` returns every requested passage in its first response. That assumption contradicts the existing bounded read protocol.

The recorded failure in `rust-full-after.log` reports `delivery.complete=false`, `hasMore=true`, `nextCursor="read:2"`, `truncationReason="read_capacity"`, and an empty failures array. The first response validly contains three deliverable passages, but not the launch-decision passage. The failed assertion looks only at that response.

Production evidence:

- `services/evidence.rs:852–877` sorts equally scored search candidates by citation ID. The citation hash includes the note's random durable identity (`CanonicalSnapshot::candidate`), so fresh-fixture runs can order equivalent passage candidates differently. The test does not establish a semantic order before making its first-page assertion.
- `services/evidence/reads.rs::deliver_read` caps the **complete serialized page** at `READ_BYTES` (6000), including provenance/support metadata even when new provenance loading was not requested. It stops before a next item would exceed capacity, retains the remaining IDs, and publishes a continuation. Selecting at most eight IDs is a request limit, not a guarantee they fit one response.
- The cfg(test) `read` wrapper calls the same normal presentation/delivery path and therefore also registers resumable continuations. Public `read_request(ReadRequest { cursor, ..Default::default() })` can consume them without changing the original selection/options.

This establishes a concrete test-assumption defect and explains order-dependent failure without blaming the new prebuilt fixture consumers. It does not by itself prove a before/after flake frequency; the coordinator's original/current repeat owns that evidence.

## Narrow correction preserving coverage

Keep the fixture, search request, all selected IDs, lexical/regex checks, currentness check, real history clear, and empty post-clear search unchanged. Replace only the one-response interpretation:

1. Read the same complete selected-ID list as today.
2. Aggregate returned items and sources from this response and its `nextCursor` responses. Use a bounded loop of at most `ids.len()` pages; each valid page must make progress, and `include_provenance=false` means no requested extra provenance pagination should repeat an ID in this small fixture. Require no reported item failures and eventual `delivery.complete=true` with no continuation. A budget/error/empty-progress failure should fail the test, not silently stop collection.
3. Assert every requested ID was delivered exactly once (or at minimum retain an explicit complete-delivery assertion), so a broken cursor cannot make the old assertion pass by merely returning the launch passage.
4. Apply the existing launch-decision presence and forbidden-excerpt checks to the aggregate, retaining nonempty sources and provenance-object assertions. Then run the existing currentness and history-clear invalidation assertions.

Do not choose only the launch ID, sort desired content to the front, increase the production read limit, remove the launch assertion, or retry the test until a favorable order occurs. Those approaches conceal or reduce the original selected-passage contract.

The failure log's separate `Later`, `unrelated`, and `followup` excerpts each have retained introduced-at and last-changed-at evidence. The existing forbidden check only excludes the whole phrase `Later unrelated` in an excerpt, and read output explicitly distinguishes supporting current context from activity evidence. Whether that provenance granularity deserves a different product contract is a separate question; it is not needed to explain the missing first-page launch passage, and this bounded test correction should not invent a new provenance policy.
