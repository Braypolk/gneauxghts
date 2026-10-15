# Chat-to-note completion

Implemented 2026-10-14 against working-tree changes based on
`5601ab09790e20cf515f589f7f3b37825e0df29e`. The [confirmed contract](../chat-to-note/spec.md)
retains the product decisions; architecture and behavior invariants are authoritative.
The [cleanup audit](chat-cleanup-audit.md) records subsequent corrections and current
verification. Completed tickets and intermediate reports are consolidated here.

## Delivered slices

| Ticket | Result |
| --- | --- |
| 01 Whole answer/new note | Deterministic Save, normal-editor creation review, durable checkpoints, Keep-only publication, receipt reconciliation and Open note |
| 02 Selected content | Captured occurrence, recorded citation associations, ordinary source wikilinks and selected-excerpt backlink |
| 03 Explicit existing note | Identity-bound append or unique heading; separable refresh and second Keep after destination changes |
| 04 Switch/recover | One editable review; distinct pending drafts; checkpointed body/title/path/hunks and restart recovery |
| 05 Conversation | Shared read/proposal tools save/refine the latest version; stale output cannot replace newer edits or terminal work |
| 06 Native acceptance | Restart/publication/link journeys and one live local-provider journey; superseded Insert/creation-textarea paths removed |

Direct message/selection Save makes no model call. Conversational requests use
the normal agent runtime. An adjacent editor never supplies an implicit destination.
[ADR 0011](../../docs/adr/0011-use-ordinary-note-links-for-chat-promotion.md)
records ordinary user-maintained link semantics.

## Ownership and integrity

`chat/note_proposals.rs` owns deterministic transfer, origin deduplication,
versioned recovery drafts, safe addition refresh and commit receipts. Direct saves
have no synthetic agent run. The populated legacy-store migration preserves
proposals and foreign keys. Structured finalization atomically records content-bound
citation associations.

The document runtime owns live body/hunk state. Proposal orchestration checkpoints
before handoff; failure retains edits and blocks switching. Autosave cannot publish
pending proposals. Independent ordinary-note saves still flush when checkpointing
fails. Keep uses NoteTimeline, and receipt adoption preserves typing newer than the
submitted commit. Publication/checkpoint/discard/refinement serialize; repeated Keep
returns the authoritative receipt.

## Release acceptance

Acceptance covers whole/selected saves, edited title/body, real process restart,
partial decisions, same-target review switching, explicit append/heading additions,
changed destinations, initial/late filename collisions, narrow-layout Discard,
repeat/concurrent Keep, explicit extra copies, stale refinement, source navigation
and saved-note survival after originating-chat deletion. Fault/access/dirty-target
cases use deterministic frontend/backend fixtures.

Initial validation passed 1,230 frontend tests, 33 support tests, 906 Rust tests
(31 opt-in tests ignored), 21 architecture checks, one runtime lifetime check,
Svelte/E2E types and five native scenarios. Later follow-ups expanded native coverage;
these counts describe their original checkpoint, not the current gate.

One opt-in native live journey saved an answer and refined only the requested
sentence in the same proposal, retaining handwritten detail and the backlink.
Model: `qwen3.8-27b-gsq-rco`, `http://100.117.20.29:1234/v1`, reasoning medium,
full access, lexical retrieval, web off. No paid provider was tested.
The final raw capture is retained locally at `../chat-to-note/evidence/live.json`.
Reproduce with that server available:

```sh
GNEAUX_CHAT_NOTE_LIVE=1 \
GNEAUX_LIVE_ENDPOINT=http://100.117.20.29:1234/v1 \
GNEAUX_LIVE_MODEL=qwen3.8-27b-gsq-rco \
GNEAUX_LIVE_OUTPUT="$PWD/.scratch/chat-to-note/evidence/live.json" \
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/chat-to-note-live.spec.ts
```

Native builds are pinned under `src-tauri/target/e2e/debug/`; fixtures use disposable
vaults and separate app data. Initial acceptance binary SHA-256:
`c60aebfc90b5d07c17c1e15831ff2ff8212362bdaa19b1ce9561d28100236855`.
Unrelated Atlas work was present in the build and is outside this feature claim.

## Position-preserving source links (2026-10-14 follow-up)

Promotion preserves authored heading/block fragments. Passage citations prefer a
unique existing block ID, otherwise the ordinary paragraph destination. Sources
are never modified to add anchors. Unchanged current content uses verified offsets;
edited/historical content requires a unique surviving excerpt. Missing, ambiguous,
title and property passages retain the note-level fallback.

Regression coverage includes repeated Unicode, historical offsets, source edits,
authored fragments, URLs and six normal-navigation round trips. All five native
cases passed, including block navigation after source edits and resolution after
chat deletion. Binary SHA-256:
`ad360e9cb66ea3390acebcdb1c200025d33fa17d7a50698c2096d7993c41608e`.

## Selection across source controls (2026-10-14 follow-up)

The reported paragraph containing three displayed source buttons failed because
DOM capture included their labels while backend matching excluded them. Generated
passage controls and unavailable placeholders are now marked and omitted from both
selection serializers. Recorded associations still recover the links; authored
note/web links remain selectable. Contiguous occurrence validation is retained.

The browser/native reproduction failed before the fix. Three browser cases, five
Rust promotion cases and the focused native restart/selection pair passed after it.
A fixture missing source metadata correctly failed the independent availability
check; adding a real source and recorded reference corrected that fixture.

## Native review-switching validation

Resolved follow-up issue 07. The fixture treated a requested proposal ID as review
readiness while the workflow was still opening, then injected input during handoff.
The helper now waits for enabled actions and the editor's review projection; input
also waits for accepted shared state. No production guard, retry or sleep changed.

A separate fixture restored a hard-coded 1200 native width, yielding 600 CSS pixels
on Retina and leaking compact layout into later tests. It now restores the measured
window rectangle in `finally` and waits for the original CSS width. The seven-case
journey passed twice (11.1/11.3 seconds), with no inference or real-vault writes.
Binary SHA-256:
`b6a11c39099af23e955c68e32c0153778cf7c372cad95fa06f5fe91a933b2930`.
Subsequent [background testing](native-background-testing.md) splits focused paint
from the default background gate; its explicit skip is not a full foreground pass.

## Validation limits and deferred work

macOS WebKit/native and narrow-desktop acceptance do not establish physical iOS
suspension, lock, termination or touch behavior. One local-model pass does not
establish other provider/settings behavior. Transfer fidelity and navigable links
do not prove entailment, completeness or support after sources change. Citation
quality, historical timeout diagnosis and ambient-agent infrastructure remain
separate investigations. Raw evidence supporting those questions is retained.
