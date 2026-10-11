# Chat context selection audit

Historical audit: issues 01 and 02 were subsequently implemented; see [fixes and verification](fixes.md). Issue 03 is also implemented; see [coverage and reuse](coverage-and-reuse.md). The measurements and original trace below retain the pre-fix behavior.

The adjacent note body is no longer automatically included in the model request. Context still grows through explicit linked-note excerpts and model-selected retrieval. The audit also found two concrete problems: editor hints mark otherwise ordinary dialogue for omission on later turns, and fresh title matches can produce a misleading stale-passage warning. Fix those before tuning the model's stopping behavior.

The measurements below use disposable synthetic notes, production context helpers and registered tools, and the real streaming runner with scripted model choices. They made no provider requests. The earlier live evaluation retained query titles and result summaries, but not complete tool arguments; these experiments establish application behavior, not why that particular model chose another search.

## How context enters the model

| Entry | Selection and content | Limits and meaning |
| --- | --- | --- |
| Editor hint | The frontend chooses the nearest visible editor, with pane-order ties; without an editor it uses the chat pane's retained note. The backend checks access and supplies canonical ID/title plus a selection that still occurs in canonical text. | Title capped at 256 bytes; selection at 480. No automatic body or citable source. The full snapshot still crosses local IPC and is stored locally; it can support a later explicit working-copy read during proposal review. |
| Explicit `[[note link]]` | Exact case-insensitive title/file-name lookup includes the first matching allowed note's canonical body prefix. | Up to 2,400 bytes per note under the shared allowance. Creates a source; a complete body can satisfy proposal read coverage. Clipped excerpts have no explicit truncation or continuation field. |
| Explicit attached context | The API resolves up to eight selected notes/ranges against canonical files; the runtime verifies and includes the excerpts. | Resolution allows up to 12,000 characters per note, then runtime admission clips each excerpt to 2,400 bytes. The current composer submits an empty selection list and does not invoke related-note suggestions on send. |
| Conversation | Up to 16 recent complete user/assistant messages, plus an older summary capped at 12,000 bytes. Earlier note-based assistant answers are replaced with a fresh-evidence reminder. | Previous note evidence/tool outputs are not replayed on a new user turn. Recent messages have a count limit rather than a separate character limit. A previous interpreted activity query can supply configuration, not old result facts. |
| `find_notes` | The model supplies query, mode and optional note IDs/folder/activity range. Without note IDs/folder, discovery covers the allowed vault. The open note does not restrict that scope. | Default hybrid mode and eight results, maximum twenty. Lexical search matches title, section and body, boosts title matches, then combines validated canonical candidates with semantic results when available. Backend access/exclusions apply before retrieval. |
| `read_notes` | The model chooses a known note, evidence IDs or a continuation. Answer reads use canonical content; edit reads use working content, including pending proposals. | Direct answer reads page title, properties and body. Evidence-ID reads deliver selected passages. First applicable interpretation guidance appears once per runtime. Read envelopes are capped at 6,000 bytes and share the 24,000-byte evidence allowance. |
| Research | The model can request a bounded worker with an explicit question/scope. | The worker gets focused inputs and evidence tools; validated selected evidence returns to the parent. It shares budgets but has its own guidance-delivery state. |

Within one run, tool calls and results remain in model history for subsequent calls. The backend deduplicates overlapping candidates within one search; later searches can return an already-read passage, and repeated reads can deliver it again. The evidence allowance limits delivered material; it is not a provider token count or a total repeatedly transmitted context limit.

Implementation entry points: [composer](../../src/lib/features/chat/ui/ChatComposer.svelte), [editor selection](../../src/lib/features/notepad/workspace/paneRoles.ts), [context helpers](../../src-tauri/src/agent_tools.rs), [run assembly](../../src-tauri/src/chat/runtime.rs), [history](../../src-tauri/src/chat.rs), [retrieval](../../src-tauri/src/services/evidence.rs), [reads](../../src-tauri/src/services/evidence/reads.rs).

## Measured starting context

These are UTF-8 assembled input bytes before provider formatting, not tokens. Each scenario uses the same five-tool registry, empty conversation history and an unrelated open Garden plan note.

| Request | Editor hint bytes | Linked context bytes | Complete assembled input bytes |
| --- | ---: | ---: | ---: |
| Greeting | 203 | 0 | 12,627 |
| Plain named-note question | 203 | 0 | 12,654 |
| Same note named with a wikilink | 203 | 234 | 12,946 |
| Selected-text question | 227 | 0 | 12,684 |
| Question linking a long note | 203 | 2,556 | 15,332 |

The long link adds a 2,400-byte body prefix plus metadata, even though that prefix contains no deployment answer. Its omitted tail has no truncation notice. Short linked-note context can save a read/model round trip, so removing all automatic excerpts is not yet justified by these measurements.

Fixed tool definitions contribute 8,400 bytes and system messages 2,976 bytes to each starting request. The adjacent hint is a small part of the total. No unselected adjacent body, stale snapshot body or excluded canary appeared in any captured model request.

## Findings

1. **A hint alone changes future conversation selection.** Calling `active_note_context` changes the assistant message's `has_revision_evidence` flag from 0 to 1, with zero citable sources and no note read. `bind_context` both tracks freshness and calls `mark_current_history_use`; terminal storage preserves that flag. `model_history_content` then omits the completed answer on subsequent turns and in compaction. Ordinary conversation with an editor open can therefore lose the preceding assistant response. The diagnostic verifies the durable marker; the omission follows the existing history selector. [Issue 01](issues/01-hint-history-omission.md).

2. **Title discovery can falsely report changed content.** A freshly synchronized index returns `Title` and body paragraphs. The evidence search validates all returned text against canonical **body** text. A title absent from the body fails that validation and adds “An indexed passage changed or was ambiguous.” This reproduces even in lexical-only mode restricted to the intended note, ruling out disabled semantic search or broad scope as the cause of that warning. The broader title query also returns Meridian launch because it shares a query term. [Issue 02](issues/02-title-match-validation.md).

3. **Completeness is split across several meanings.** A search can have `delivery.complete=true` while `coverage.complete=false`, correctly distinguishing delivered matches from retrieval exhaustiveness. Hybrid mode reports incomplete coverage when semantic retrieval is disabled or approximate. Answer reads, however, use the same generic coverage text for selected passages and whole-note reads; linked excerpts have no clipping metadata. These signals do not clearly tell the model whether it has finished reading the specific note requested by the user. That is a plausible contributor to further searching, not an established explanation of the prior live run. [Issue 03](issues/03-context-coverage-and-reuse.md).

4. **Follow-up discovery can repeat existing content.** In the fixture, `deployment approv` returns the same evidence ID as the already-read retrospective passage. Literal and lexical `approved` searches also return the same text; a trailing newline gives the literal passage a different ID. Scoping the literal search to the retrospective reduces notes inspected from five to one, but still returns the existing text. Exact ID deduplication alone would miss that overlap. A repeated read returns the same passage again; once-only prose guidance is correctly absent on the second read.

The first retrospective passage contains 213 bytes of source text in a 2,652-byte read envelope, including 1,204 serialized bytes of once-only interpretation guidance. Both proof metadata and guidance contribute to context growth independently of the amount of note text selected.

## Cost of an additional round trip

The controlled search/read trace has three model requests totaling **45,163 assembled input bytes**. Adding two searches, one alongside the read and one on another turn, produces four requests totaling **67,239 bytes**, a 48.9% increase. Its last request contains 7,029 bytes of tool-result messages, versus 4,492 in the focused trace. Both paths deliver the same supporting retrospective passage.

This demonstrates repeated transmission cost under fixed scripted choices. It does not measure provider tokens, cache billing, answer quality or a model's willingness to stop. The prior live run's extra queries match this general pattern, but full modes, scopes and read selectors were not retained. [Issue 04](issues/04-live-selection-traces.md).

Automatic conversation naming is also a separate model call on eligible new conversations. It receives only a compact opening user message, no vault tools or note context. Its observer discards usage events, so assistant-response usage is not a complete account of all provider work done by the app.

## Next changes

First separate editor-hint freshness tracking from evidence-based history omission, and fix canonical validation of title search matches. Then make excerpt clipping, selected-passage versus whole-note coverage, and already-delivered overlaps explicit. Preserve access checks, current-content validation and legitimate searches for missing or contradictory evidence; do not silently restrict all searches to the open note or impose a fixed search count.

After those changes, capture full synthetic tool choices and run a small repeated live comparison. That can test whether clearer selection feedback reduces redundant retrieval while preserving unknown actors, citations and correct note choice.

## Verification

The opt-in offline diagnostic passed, including five starting-context cases, scoped retrieval probes, repeated read checks, two scripted streaming traces and the hint-only durable history marker. All 14 affected `agent_tools::tests` checks passed; the paid evaluation and opt-in diagnostic remain ignored in ordinary runs. Formatting, diff whitespace, artifact links and captured-context canary checks passed. See [compact measurements](summary.json), [full synthetic trace](offline-trace.json) and [diagnostic source](../../src-tauri/src/agent_tools/tests/context_selection_audit.rs). Production behavior was not changed during this audit.

Rerun the diagnostic with its corrected expectations from the repository root; save a new trace to preserve the original audit evidence:

```sh
GNEAUX_CONTEXT_SELECTION_AUDIT_OUTPUT="$PWD/.scratch/chat-context-selection/fixed-trace.json" cargo test --manifest-path src-tauri/Cargo.toml context_selection_offline_audit -- --ignored --nocapture
```
