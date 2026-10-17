# Historical chat-to-note flow

> Superseded by [the Pi rebuild](../archive/pi-chat-rebuild-scope.md). Whole-answer/selection promotion, editable proposal UI, research and transcript publication are retired. Native typed create/update authority, canonical proof and document conflict protection continue through the new publication foundation; this document is historical.

Type: spec
Design confirmed: 2026-10-14
Implemented: 2026-10-14

This spec records the user-confirmed first release. The six implementation
slices are consolidated in the [completion record](../archive/chat-to-note.md). The older
[ambient-agent brief](../ambient-agent-foundation/astra-planning-brief.md) is
broader discovery material beyond this feature's scope.

## Outcome and scope

A useful chat answer, or selected part of it, can become reviewed, durable note
content. Users start with a message action or a conversational request. Both
produce a Note Proposal reviewed in the normal note editor and published only
through Keep. The initial release creates notes and adds content to explicitly
specified existing notes.

Whole-note replacement, several-note change sets, automatic maintenance, jobs,
Inbox, sandbox execution, skills infrastructure and generalizing chat into a
durable work platform are deferred. Existing agent editing capabilities remain
usable; this feature does not broaden its Save action into arbitrary rewriting.

## 1. Entry and faithful content transfer

- Whole completed assistant answers and selections expose **Save to note**.
  It replaces selection's existing direct Insert action. Copy, Copy link and
  Remember retain their separate meanings.
- Transfer the chosen authored content and supported Markdown formatting.
  Selections do not expand into neighboring paragraphs, complete answers or
  unselected claims. Preserve associated source links, including a citation
  attached to selected content whose rendered marker falls outside the highlight.
  Use the answer's recorded citation associations, not new semantic inference.
- Default saving performs no rewriting, summarization, adaptation or model call.
  There is no Adapt for note option. A conversational save may use the ordinary
  agent run to understand the request; it still transfers the referenced content
  faithfully unless the user explicitly asks for a refinement.
- A direct action binds to the completed message and verified selection at
  invocation. Later navigation cannot substitute another answer or editor range.
  Streaming drafts, failed placeholders and missing selected content cannot be
  treated as completed answers. An unavailable origin yields an actionable error.

## 2. Destination, naming and placement

- A new note is the default. An open/adjacent note is not an implicit destination.
  Use an existing note only when the user explicitly specifies it; resolve an
  ambiguous existing-note reference before preparing the change.
- New-note title: the chosen content's first Markdown heading, otherwise the chat
  title. Titles are editable; explicitly requested titles take precedence. Use
  ordinary note filename sanitization and the usual new-note location (currently
  the vault root). Honor an
  explicitly supplied in-vault location without silently inventing folders.
- Suggest an unused name when a filename is occupied. If a collision appears at
  Keep, preserve the draft and propose another editable name, requiring
  confirmation before publication. A new-note save never overwrites that file.
- Existing-note placement: append by default. Honor an explicitly named heading
  or insertion location. Ambiguous or missing locations require clarification;
  preserve the draft while resolving them. Existing content is not rearranged.
- Keep ordinary document dirty-buffer/conflict protection. Preparing a proposal
  cannot overwrite unsaved edits or turn them into unreviewed canonical changes.

## 3. Source links and chat backlink

[ADR 0011](../../docs/adr/0011-use-ordinary-note-links-for-chat-promotion.md)
records this deliberate boundary. Convert selected answer note citations into
ordinary wikilinks with meaningful note names using their recorded source
identities and the standard link formatter. Preserve ordinary external URLs and
other authored links. Historical note citations also become source-note
wikilinks; their surrounding answer wording is preserved. Preserve authored
heading/block fragments. Passage citations use a unique existing block ID when
available, otherwise the ordinary paragraph reference. Recorded offsets choose
the exact occurrence only for unchanged current content; edited or historical
content requires a unique surviving excerpt. Missing/ambiguous passages use the
note-level link. Do not insert anchors into source notes.

Wikilinks have the same maintenance and navigation semantics as ordinary note
links. They do not retain exact-passage evidence, track source edits or require
an independent passage registry. Resolve the recorded source identity when
available; a removed source uses its recorded note target as an ordinary broken
link rather than silently selecting a similarly titled note. The transferred
answer does not gain a new correctness or source-freshness claim.

Include one unobtrusive **Open in chat** backlink to the originating answer or
selected excerpt, reusing the existing transcript/excerpt navigation mechanism.
Do not duplicate the full transcript or source excerpts. Removing the chat may
break that backlink; it does not remove or rewrite the saved note or its other
wikilinks. Live chat's citation validation rules remain unchanged.

## 4. Editor review and durability

- An explicit Save action opens its review in the normal note editor. A
  conversational save request authorizes presenting that requested review when
  ready. Unrelated background proposal arrival retains the existing no-navigation
  rule. Navigation uses the workspace's existing pane/departure owners.
- Review exposes editable content and, for creations, editable title and
  location. Updates show additions in the destination's surrounding content.
  Keep publishes; Discard removes the pending draft. Ordinary autosave never
  publishes proposed bytes or creates the new canonical file.
- Persist the current draft, title, destination, base/placement data and review
  decisions across navigation and process restart. Persisted working state is
  restored, not merely the original generated proposal. Report persistence
  failures; retain the live draft and block a handoff that would lose those edits.
- Only one review is editable globally. Starting another save first durably
  checkpoints the current review, then opens the requested review. Earlier
  drafts remain pending and reachable from their originating chats. Switching
  requires neither Keep nor Discard. A restart restores drafts without publishing
  them or seizing focus through passive arrival.
- Distinct saves retain distinct proposals even if they target the same note.
  They are reviewed individually; after one commits, another must refresh its
  base as described below. Update the same proposal only for repeated invocation
  of that save or an explicit refinement. Target identity alone cannot authorize
  superseding unrelated work.

## 5. Changed destinations and publication

Bind existing targets by Note Identity, not a mutable path. If their canonical
content changes before Keep, preserve the user's draft, load the latest content
and reapply the intended addition only when the placement is unambiguous. A
refreshed preview requires another explicit Keep. Append uses the latest end;
heading placement must resolve uniquely. Never replay a stale whole-note preview
over intervening edits. Overlapping review edits that cannot be separated safely
remain an explicit conflict with the working draft retained.

Keep uses the existing complete NoteTimeline mutation operations and mandatory
history preparation. Failure before publication leaves canonical Markdown
unchanged. After publication, adopt the authoritative commit receipt and
converge status without repeating the write. Preserve the existing handling of
late ordinary edits, committed warnings, interrupted commits and access changes.
An occupied creation path, revoked destination access or missing destination
retains the proposal and explains how to recover; none silently changes its target.

## 6. Repeated saves and explicit refinement

- Reinvoking the same message/selection save for the same destination returns
  its unfinished review. Deduplication uses persisted origin/selection and
  destination identity, not the editable title or a component-local button flag.
- After Keep, show **Open note** using the committed Note Identity. Another copy
  requires deliberate user action with a new save intent. Concurrent clicks,
  retries, remount and restart cannot duplicate publication.
- Explicit requests such as “make that draft shorter” revise the same pending
  proposal from its latest user-edited working state. Resolve which draft is
  meant before changing it. Preserve unrelated user edits, show the proposed
  changes for review, and require Keep. Bind inference to a draft version; edits
  made during generation cannot be silently overwritten by late output.
- Refinement may call the selected model through existing capabilities. A direct
  Save remains deterministic. No extra rewrite tool, automatic refinement step,
  new cumulative run quota or expanded core system prompt is required by this plan.

## Ownership and persistence boundary

Reuse `ChatService` for durable proposal records and their origin relationships;
reuse `proposals.rs` and the existing commit path for planning and publication.
The document runtime remains the sole owner of an open review's editable body
and hunk state. Extend the existing global review workflow for creation,
checkpoint/hydration and switching. Persistence checkpoints are versioned durable
representations of that working state, not another live editor buffer.

Expose a small app-owned proposal interface for prepare/reopen, checkpoint,
refresh, Keep and Discard. Direct actions and agent tools cross that same seam.
Do not introduce a generic jobs/artifacts platform or parallel note-writing path.
Origin records retain conversation/message identity and an optional real agent
run. A deterministic Save creates no synthetic model run. Serialize draft
versions and publication settlement; stale saves, model completions and pane
callbacks cannot replace a newer draft or revive terminal work.

Extend storage without resetting conversations, proposals, note identities,
canonical Markdown or Note Timelines. Preserve existing pending/conflicted
proposals and their original previews; hydrate a working draft from that preview
when no newer checkpoint exists. No reset or historical-data-loss permission was
granted. A schema change that needs a different assumption requires fresh triage.

## Historical implementation starting points

Facts below were inspected before implementation on 2026-10-14. This table is
historical design evidence; current owners and behavior are documented in
ARCHITECTURE.md and the behavior invariants.

| Owner / source | Starting behavior and design consequence |
| --- | --- |
| `src/lib/features/chat/ui/ChatMessage.svelte`, `ChatMessageList.svelte` | Whole-message Copy and selection actions exist; add Save without model inference. |
| `src/lib/features/chat/ui/chatSelectionMarkdown.ts::serializeNode` | Selection serialization drops inline citations; preserve source associations in promotion. |
| `src/lib/features/notepad/orchestration/notepadChatCoordinator.svelte.ts::insertSelectionIntoNote` | Directly inserts a blockquote into the first editor selection; replace this path. |
| `src/lib/features/chat/ui/ChatProposalRegion.svelte::proposalDrafts` | Creation review edits are component-local; replace with shared editor review and durable checkpoints. |
| `src/lib/features/proposals/proposalOrchestration.ts`, `reviewSession.svelte.ts` | Update review is document-owned and global; extend rather than duplicate ownership. |
| `src/lib/features/proposals/types.ts::DurableProposalReviewRequest` | Admission currently accepts an update preview; support creation and persisted working versions. |
| `src-tauri/src/chat.rs::stage_agent_proposal`, `src-tauri/src/chat/store.rs` | Proposals require a run and supersede by target; support direct-save origins and distinct pending saves. |
| `src-tauri/src/chat.rs::create_excerpt_from_selection`, `src/lib/features/chat/api.ts::createExcerpt` | Legacy excerpt fallback is not precise raw-Markdown selection mapping; Save needs verified occurrence/source associations. |
| `src-tauri/src/agent_tools.rs::working_note`, `agent_tools/interface.rs` | Existing edit reads may use stored previews or run-start editor snapshots; explicit refinement needs the current shared draft version. |
| `src-tauri/src/commands/proposal_commands.rs::commit_agent_proposal_with_state` | Checks access, base hash and exclusive creation through NoteTimeline; preserve commit/recovery guarantees. |
| `src-tauri/src/commands/chat_commands.rs::chat_resolve_passage` | Exact passage resolution is conversation-bound; promotion emits normal wikilinks instead. |

Binding ADRs: 0001 (app-owned runtime), 0002/0006 (canonical mutation and mandatory
history), 0007/0008 (history boundaries/admission), 0009 (live historical evidence),
and 0011 (promoted source links). ADR 0003 remains superseded in part by 0009;
this feature grants no restore authority. The existing behavior invariant that
edited reviews must be resolved before switching is deliberately revised to
durable suspension; the single editable review and passive-arrival rules remain.
The architecture and invariants now describe that implemented ownership. The
completion record identifies validation surfaces and their limits.

## Acceptance and validation

The [completion record](../archive/chat-to-note.md) maps the implemented slices
to verification. Each slice exercises production owners using synthetic notes.
Required release scenarios:

1. Whole answer and partial selection → new-note review → edit → restart → Keep;
   inspect faithful Markdown, source wikilinks, backlink and retained revision.
2. Explicit existing note → append / named heading → changed disk content →
   refreshed review → Keep without losing intervening or user-authored edits.
3. Switch two edited/partially decided reviews, including two saves to the same
   target, and recover exact pending states after restart.
4. Initial and late filename collisions; dirty destinations; unavailable target;
   checkpoint failure; failed publication; post-publication status failure.
5. Duplicate invocation/concurrent Keep/retry/restart → one canonical publication;
   Open note follows Note Identity; intentional new copy is distinct.
6. Conversational save and explicit refinement preserve current draft edits;
   late model output cannot overwrite newer typing or discarded/kept work.
7. Source-note links behave like ordinary wikilinks after source edits and chat
   deletion. Selections preserve their own citations without surrounding prose.
8. Stop/cancel generation, ordinary note editing/autosave, Copy/Remember, live chat
   citations and passive proposal arrivals retain their existing contracts.

Use Rust persistence/fault-injection tests, frontend document/workflow and mounted
editor tests, and native production-IPC/restart journeys in proportion to each
ticket. Deterministic action tests must assert zero inference. Actual provider
tests record model/settings and raw result evidence; citation entailment remains
a separate investigation. Direct action tests use no inference; the completion record identifies the
separate opt-in local-provider check.

## Comments

2026-10-14: User confirmed the complete flow after fifteen design questions.
Q2 excludes an Adapt for note option. Q3 defaults to new notes unless an existing
destination is explicit. The Q9 correction chooses ordinary user-maintained
wikilinks, superseding the earlier recommendation for original-passage binding.

2026-10-14: All six slices implemented; acceptance and remaining validation
limits are consolidated in the completion record. Current ownership lives in
ARCHITECTURE.md and the behavior invariants.
