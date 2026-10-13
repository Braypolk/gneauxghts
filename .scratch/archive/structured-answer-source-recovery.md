# Structured answer source recovery

The 2026-10-13 user run completed nine model calls and twelve successful read/search
calls, then failed finalization with `An answer source is unknown, stale, or no
longer allowed`. There were no research-worker calls or context compactions in
that run. Its structured draft was transient, so the saved diagnostic records do
not identify the rejected selection; they cannot establish whether it was
unissued or became stale between inference and delivery.

The structured renderer previously treated a well-formed invented source ID as
a fatal error and erased the entire draft. It now matches ordinary-text citation
handling: an unissued selection becomes explicit, inert `[citation unavailable]`
text, preserving other segments and validated citations. It never guesses a
source or creates a link/card for that selection. Issued passages that fail
current validation still stop delivery; malformed IDs, duplicate selections and
malformed answer shapes remain errors. The stale/access error is now distinct
from an invented selection.

Verification: seven focused Rust checks and all 21 architecture checks passed, including a production streaming
runner with real `read_notes`, mixed valid/invented formatter selections, actual
ChatService finalization, terminal persistence and reload. The same production
path rejects a real source after its note is excluded. Renderer checks cover
mixed selections, multiple segments, numbering, malformed IDs and missing issued
passages.

Native development acceptance: rebuilt the disposable `Gneauxghts Dev Test` app
and used its existing synthetic two-note conversation against LM Studio's
`qwen3.8-27b-gsq-rco`. A follow-up re-read both notes, returned their current
statuses and distinct review codes, cited both passages and retained the earlier
conversation code. Both the visible terminal UI and saved conversation retained
the complete answer with two sources and no error (two model calls, two tool
calls, 12.089 seconds). This live run selected valid IDs; the controlled streaming
regression above supplies the unissued selection deterministically. No private
notes were changed and the original cleared draft cannot be recovered from the
saved failed run.

## Preventing unissued selections

The follow-up investigation found a concrete contract gap: the static answer
schema accepted any string matching `S[1-9][0-9]*`, while reads supplied Markdown
labels (`[S1]`) and separate discovery selectors. The model had to convert labels
and obey prose about selecting only issued numbers. The original rejected draft
was not retained, so this does not establish which transformation or selection
went wrong in that specific run.

Reads now provide a bare `sourceId` alongside the citation label. Final-answer
instructions explicitly distinguish those IDs from discovery `evidenceId` and
note identities. Before every dispatch, the answer formatter enumerates only
currently validated sources in the originating run's registry, keeping their
issued numbers. With no read sources, only an empty selection is allowed.
Executable tool definitions and worker selection schemas are unchanged. Backend
freshness/access and final-selection checks remain authoritative even when a
provider treats the schema only as guidance.

Formatter recognition removes only the source-choice annotation before comparing
its closed schema. Context configuration fingerprints likewise normalize that
annotation, allowing existing compaction checkpoints and usage baselines to
survive additional reads. Added choice bytes still count toward projected usage,
and actual request measurement includes the full constrained schema.

Verification: 24 focused source-related checks passed, including actual runtime
dispatch before and after a real read, exact outbound choices, ongoing draft
streaming, nonconsecutive issued numbers, revocation, two compaction checkpoints
while choices grow, and conservative usage growth. A synthetic six-checklist live
baseline used six valid IDs in 38.30 seconds. The constrained live Qwen run used
12 issued IDs and correctly cited all six review codes with their actual body
passages (`S2`, `S4`, `S6`, `S8`, `S10`, `S12`), completing in 61.12 seconds
without unavailable citations. The opted-in test is
`agent_tools::tests::source_ids_live::live_multi_note_source_selection`; its local
JSON reports retain synthetic read/result traces and final selections without
headers, credentials or reasoning text.

The affected runtime suite passed all 42 checks (three explicitly opted-in live
checks skipped), and all 21 architecture checks passed. Rebuilt native dev
acceptance requested `research_notes` in the existing synthetic conversation:
two validated worker handoffs completed (the first partial, the second ready),
and the final answer correctly cited both current review codes and remembered
the conversation code. One worker tool error was recovered before its validated
handoff; the terminal run completed in 85.354 seconds with 11 model calls and ten
tool calls. Both saved source cards survived navigation, and clicking each source
opened its actual Aster/Birch note with the matching review code. No unavailable
markers appeared in this answer.
