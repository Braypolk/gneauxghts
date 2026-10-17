# Preserve conversational note referents across evidence omission

Status: wontfix
Type: bug
Resolution: implemented

The real native pass found a wrong-source follow-up using `gpt-6-luna` with local
semantic retrieval enabled. The first answer distinguished Mateo's production
approval in **Meridian operations** from Iris's sandbox rehearsal approval in
**Meridian operations draft**. After opening the draft, a second turn correctly
answered the production recovery token as QUARTZ-908. The production note was
then changed to TOPAZ-642. Asked to read the updated production note again, chat
read only two passages from the draft and called AMBER-119 the production token,
while also acknowledging that the draft concerns rehearsal rather than production.

Evidence: [three-turn native trace](../native-updated-referent-failure.json),
[native execution log](../native-updated-referent-failure.log). The third answer
contains one successful `read_notes` invocation, no `find_notes` event, and only
draft passages. Its citation resolves correctly: this is wrong-source selection,
not an invented token or a stale citation presented as current.

## Leading hypothesis

`chat.rs::model_history_content` replaces every earlier note-based assistant
answer with a generic fresh-evidence reminder. That intentionally removes old
facts, but also drops the note names and identifiers that established the
conversation's referent. `chat/runtime.rs` assembles this normalized history
before adding the current adjacent editor identity. In this scenario the only
directly supplied note identity is the draft. This code path is confirmed;
whether a particular replacement fixes model behavior remains untested.

Investigate retaining small, currently permitted note-identity hints from
earlier cited sources while continuing to omit their facts and excerpts. A
source identity can survive a body edit even when its old passage is stale;
current policy, canonical identity and title validation must still apply.
Do not promote old assistant claims to evidence, inject adjacent bodies,
lock the answer to the open note, add a note picker, or parse question wording
into a backend workflow. Keep the shared assistant core small.

## Acceptance ideas

- A follow-up refers back to the production note while its similar rehearsal
  draft is open; it reads and cites the newly changed production token.
- Explicit topic changes and subsequent pronouns still select the new topic.
- Exclusions, forgotten notes, renames and moves cannot leak forbidden or stale
  title metadata through a history hint.
- Prior cited identities are distinguished from current factual authority;
  fresh reads and existing citation validation remain required.
- Measure the added context bytes and cover policy/normalization offline before
  another small live replay. The current native failure is a regression fixture,
  not proof that a proposed metadata change works.

## Comments

2026-10-10 — Created from the user's requested small native multi-turn/semantic
pass. Preserve the failure independently of a subsequent successful repetition;
one success cannot erase observed variation.

2026-10-10 — Implementation investigation reproduced the missing identity in
offline history assembled from durable sources after a body edit and rename.
Current scope, canonical identity/title, lifecycle and bounded-context checks
were added. The first native variant appended these fresh identities to older
assistant messages; it still selected the draft on turns 2 and 3. See
[retained trace](../referent-native-1.json). The shared instructions prohibit
reusing IDs from earlier assistant text, so that placement creates a plausible
conflict. The revised variant supplies freshly app-issued identities in a
separate context message. Its effect is pending native verification; no fix is
claimed from the first variant's offline results.

The next two app-context variants found current production evidence but each
stopped at an inline-citation omission ([issue 08](08-inline-citation-omission.md)).
A fourth replay captured raw answer deltas and completed all five turns with
valid citations, but again selected the draft on the updated-note turn. Fresh
identities alone are therefore insufficient evidence of a reliable correction.
The next focused change moves turn-local automatic metadata before the authored
user request, which previously came before the adjacent-editor hint. The shared
assistant core remains 3,161 bytes. Native verification of this ordering is in
progress; all unsuccessful paid attempts remain retained.


2026-10-10 — Implemented and verified in [referent validation](../referent-validation.md).
The request-last variant passed once, then failed its unchanged confirmation;
those attempts remain retained. The adopted layout separates the automatic
editor System context from authored dialogue and links bounded current note
references to their earlier user requests. Replays 7 and 8 each passed all five
turns, semantic participation, inline citations, exact navigation and durable
reload. This is a small synthetic result, not universal reliability.

Independent review corrected bindings for rejected references, pre-inference
validation without tools, per-pass permission reuse, and a newly introduced
parent/worker Arc retention cycle. Targeted offline checks total 120 passing.
Shared instructions remain 3,161 bytes, with no new tool or automatic editor body.
The final lifecycle correction is verified offline; it was not included in the
pinned binary used by replay 8. Intermittent citation omission remains issue 08.


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Current chat behavior and diagnostics are covered by rebuild tickets 02–08/10; intentionally dropped implicit context, exact Retry, formatter/projection or research requirements are not restored.
