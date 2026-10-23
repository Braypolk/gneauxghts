# Scoped chat retrieval outcome

Implemented 2026-10-22 under the app quality follow-up. This record describes the
implementation and validation; architecture and behavior documents remain the
authoritative owner map.

## Behavior

`pi_chat/notes.rs::search_notes` now adapts the same native lexical/semantic ranking
used by dock retrieval. Semantic discovery is available only while local semantic
search is usable; lexical discovery remains available without it. Search emits
Note Identities, titles and bounded canonical previews. It creates no read source,
citation receipt, publication capability or new history record.

The adapter preserves chat's 4096-byte query limit and page sizes from 1 to 50
(default 12). The dock retains its independent 1024-byte/20-item contract. The
shared ranker bounds candidate work at 4096 passages; chat requests its bounded
unique-note ranking for pagination. Search is discovery, not exhaustive vault
inventory. The Pi tool description tells the model to refine broad queries.

The authority store supplies explicit attachments and exclusions before ranking.
The shared native CurrentContentAccess seam verifies delivery eligibility and
current-content generation. Canonical source-byte fingerprints reject unobserved
external edits during ranking; current canonical ranges supply previews instead
of stale lexical text. A final authority transaction rechecks revision, retirement,
read scope and exclusions before any result is returned. Known notes with damaged
or blank embedded identities remain readable through their catalog identity;
conflicting nonempty identities and forgotten/trash content remain unavailable.

## Cursor policy

A cursor binds the exact query, authority identity and authority revision, followed
by a digest of the ordered bounded ranking's Note Identities, paths, titles and
previews, then the next offset. The next request reruns current ranking and policy
admission. A changed ranking rejects the cursor and asks for a fresh first page,
rather than silently shifting an offset and skipping or duplicating a result.
There is no content cache or persisted search snapshot. Empty cursors mean first
page. Previous token shapes fail safely through the same retry response.

## Validation

- `cargo test --manifest-path src-tauri/Cargo.toml --lib pi_chat::notes::tests -- --test-threads=1`:
  12 passed. Covers 55 tied notes across a 50-item first page and 5-item second
  page, repeat-page determinism, exact 4096-byte query admission, invalid query/page
  bounds, foreign/query-bound cursors, unwatched external edits, stale-cursor
  rejection, exact-title discovery, attachment scope, retirement between ranking
  and delivery, and the existing read/citation/identity-damage behavior suite.
- `pnpm exec vitest run src/lib/features/chat/pi/notes.test.ts src/lib/features/chat/pi/toolSchemas.test.ts`:
  17 passed. Covers Pi tool invocation, cursor forwarding/recovery, source separation
  and constrained schema behavior. The final description-only wording refinement
  does not change tool execution or schema.

Approximate recall is supported through the shared ranker's semantic candidate
path; synthetic semantic fixtures can establish admission/fusion and lexical
fallback policy, not real-model quality. No installed model or representative
personal vault benchmark was used here, so improved real-world relevance and
latency remain unmeasured. No chat-to-note action or general filesystem authority
was introduced.
