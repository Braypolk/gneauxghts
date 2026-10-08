# Derive a secure current-image inventory and reconcile assets

Status: ready-for-agent
Type: task
Depends on: none

## Deliverable

Backend inventory of eligible image occurrences in ordinary notes, usable for closed notes and incremental asset changes. This ticket can proceed independently of runtime selection.

## Work

Read existing images architecture and NoteTimeline publication boundaries. Implement a syntax-aware complete-document inventory with frontend parser parity for wiki, inline and reference embeds, escaped characters, comments/code exclusions and asset-name decoding. Persist stable Note Identity, note hash, relative asset name and source locator in the semantic projection; never rewrite authored Markdown.

Share the canonical contained-assets resolver from `asset_commands.rs`. Track reverse references and extend `vault_watcher.rs` plus periodic reconciliation for image bytes changing without Markdown edits. Metadata fingerprints are hints; durable cache/source identity uses byte hashes. Revalidate identity before accepting derived results.

Remove occurrence eligibility on edit/forget/deletion; preserve asset bytes and undo/history behavior. Renames/recovery and duplicate occurrences must maintain correct current owners. Exclude remote/unreferenced/chat-attachment/history assets according to the spec.

## Acceptance

Shared parser fixtures and backend tests cover syntax parity, traversal/symlink escapes, external replacement, rename/removal/recovery, deduplication and cross-vault isolation. No frontend open-pane state is required for indexing. Asset reconciliation uses the existing semantic worker ownership/coalescing rather than a second independent index writer.
