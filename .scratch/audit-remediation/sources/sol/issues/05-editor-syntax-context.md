# 05 — Replace inconsistent whole-document fence scanners

Status: ready-for-agent
Type: task
Audit items: FE-07

Evidence: [module report](../reports/frontend-editor.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Use the actual CodeMirror Markdown syntax context for selection-surround and wikilink input; share a bounded internal helper if needed. Define partial-parser fallback and preserve intentional formatting differences.

## Acceptance and validation

Four-backtick fence containing three-backtick text, mixed fence kinds, nested quoted/list code, inline and partially parsed large-note cases follow parser semantics. No input command edits protected code or scans the entire document per keystroke unnecessarily.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
