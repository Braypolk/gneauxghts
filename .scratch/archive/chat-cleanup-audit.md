# Chat cleanup audit — 2026-10-14

Reviewed uncommitted chat-to-note, evidence freshness, Activity links, selection,
latency diagnostics and background native testing against HEAD
`5601ab09790e20cf515f589f7f3b37825e0df29e`, current architecture/invariants,
ADR 0011 and the confirmed chat-to-note spec. Independent standards and spec
reviews checked actual callers. Unrelated Atlas edits were excluded from cleanup.
No commit or live-model request was made.

## Corrected findings

- Navigation now settles review checkpointing and ordinary-note persistence
  independently. A failed checkpoint still blocks departure, but cannot strand
  unrelated edits after their autosave timers were cancelled.
- Passive and final review admission use complete canonical document cleanliness.
  An unsaved title can no longer be overwritten by a persisted proposal title.
- Disposal captures the review whose checkpoint is running. Its late failure
  cannot become an error on a different review.
- Selection validation now matches supported highlights and table-cell spacing;
  DOM capture preserves literal punctuation, list markers, entity spellings and
  separators across partially selected cells. Opaque link aliases/autolinks and
  code retain literal equals signs. Code serialization uses safe fence lengths
  and padding when selected code contains backticks.
- Identical text selected at different occurrences retains distinct save intents
  and verified excerpt positions. Repeating the same occurrence still deduplicates;
  the first occurrence retains compatibility with existing save keys.

## Structure and coverage

`reviewCheckpoints.ts` serializes writes for the retained review lifetime across
route remounts and keeps only the newest waiting body/title/hunk snapshot. Explicit
locations survive pre-dispatch coalescing; an already-dispatched location is not
reapplied over later title edits. A failed location cannot be falsely acknowledged
by a successful body-only save. Shared dismissal settlement preserves ordinary
edits outside legacy undone hunks, while explicit Discard restores the baseline.
The document runtime remains the sole live body/hunk owner.

The shared source normalizer, editor review components, document commit-adoption
seam and NoteTimeline publication owner remain appropriate. No alternate state
owner, model prompt or broad new abstraction was added. Browser selection setup
now uses one reusable fixture installer. Regression tests protect real behavior;
none were removed merely to reduce the count.

## Scratch cleanup

Eight resolved reliability tickets are consolidated in
[resolved issue outcomes](chat-reliability-resolved-issues.md); references are updated.
Only latency and citation entailment remain in the active issue directory.
The redundant chat-to-note README and empty issue directory were removed, and
its completion record was shortened while retaining acceptance, artifact pins,
follow-up diagnoses and validation limits. Finder metadata was removed.

Reusable metadata-only latency proxy and offline analyzer moved into
`e2e/support/latency/`; the report/reproduction now points there. Offline analysis
of the retained original capture and proxy CLI checks pass without inference.
Raw local evidence for open investigations and the live save/refinement result
are retained. No production notes, API keys or app preferences were touched.

## Validation

- Frontend: 153 files, **1,242 tests passed**; 38 support tests passed.
- Rust library: **916 passed, 31 ignored**. After the final opaque-label correction,
  its focused selection regression also passes. The ignored scale/live tests are
  not claimed as passes.
- Architecture/runtime lifetime: 21 + 1 passed.
- Headless browser selection: four cases passed, including the reported source
  buttons, repeated word, actual highlight/list and cross-cell DOM ranges.
- Background native smoke: four files, **14 passed, one explicitly skipped**.
  Covers native focus-permission denial, restart, reviewed saves, switching,
  source/Activity links, collision/discard and saved-note survival after chat deletion.
- Svelte/E2E TypeScript: zero errors/warnings. Rust formatting, local record links
  and `git diff --check` pass.

Pinned native debug `e2e-wdio` binary SHA-256:
`155171510b20300ce7bf37534ab32a63bb4ab1ceac3d8e76875e1a29d347f407`.
The native runner used `GNEAUXGHTS_E2E_FOREGROUND=0` with disposable vaults and
separate app data. The dependency's known shutdown mock-store warning still
appears after successful sessions; it did not fail a case.

Foreground-only cursor/paint acceptance was not run. No physical iOS or paid/live
provider checks were repeated. Citation entailment and the historical five-minute
timeout remain open questions; this cleanup does not establish their resolution.
