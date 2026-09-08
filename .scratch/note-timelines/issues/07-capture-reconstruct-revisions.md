# 07: Capture and reconstruct durable Note Revisions

**What to build:** Meaningful app-owned note commits create exact, durable, reconstructable Note Revisions whose history survives restart and whose failure ordering never permits a silent gap.

**Blocked by:** 01: Benchmark revision storage and migration shape; 05: Contract the legacy mutation seam; 06: Harden stable Note Identity.

**Status:** ready-for-agent

- [x] Create the dedicated vault-owned SQLite history store using localized private SQL, closed domain records, selected durability parameters, and versioned storage-neutral payloads.
- [x] Exclude the hidden Gneauxghts directory and database sidecars from note ingestion and watcher-driven note events.
- [x] Record a new Note Revision only when body, unmanaged frontmatter, or another explicitly restorable authored field differs from the prior canonical authored state.
- [x] Record new-note creation as a creation Lifecycle Event plus first Note Revision, and assign the correct typed Mutation Source to editor, task, proposal, creation, and reconciliation writes.
- [x] Durably prepare history intent before Markdown publication; preparation failure must publish nothing and preserve dirty editor content.
- [x] Treat published Markdown as authoritative when finalization or required projection fails, returning the committed identity and visible warning without replaying the write.
- [x] Reconstruct exact canonical UTF-8 across insertions, deletions, complete replacements, Unicode, line-ending changes, unmanaged frontmatter, and empty authored content while verifying recorded hashes.
- [x] Add fault-injection and restart tests at preparation, publication, and finalization boundaries, including idempotent completion of recoverable intents.
- [x] Keep history capture mandatory for every managed ordinary note with no disable or save-without-history path during initial development.
