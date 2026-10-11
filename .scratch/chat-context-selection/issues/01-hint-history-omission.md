# Preserve ordinary dialogue after editor hints

Status: ready-for-agent
Type: task
Resolution: implemented

An allowed adjacent-editor hint calls `bind_context`, which sets `has_revision_evidence` on the current assistant message despite creating no citable source or read coverage. Later history selection and compaction replace that assistant response with the note-evidence omission marker. Terminal storage preserves the flag. The offline audit reproduces marker 0 → 1 with zero sources.

Separate canonical freshness binding for editor metadata from marking an answer as using note evidence. Preserve the existing exclusion/freshness validation and omission of actual note-grounded content, including content whose sources later become unavailable. Do not classify answer wording to infer evidence use.

Acceptance: exercise the admitted chat/message path, ordinary conversation with an editor hint and no retrieval, completion storage and next-turn history/compaction. Ordinary dialogue remains available. Canonical note reads and explicit body context still cause the required fresh-evidence behavior; exclusions remain enforced.

Evidence: [audit](../audit.md), `hintOnlyHistoryMarker` in [trace](../offline-trace.json). Implementation: `AgentToolContext::active_note_context` / `bind_context`, `ChatService::mark_current_history_use`, `store_terminal_message`, `model_history_content`.

## Comments

2026-10-09: Separated hint freshness from evidence history marking. Actual note reads and explicit body delivery save the durable marker before returning content; marker failures stop delivery and do not grant rewrite read coverage. Added regressions through real terminal storage, history and compaction, including source exclusion and marker failure. See [fixes and verification](../fixes.md).
