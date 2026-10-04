# Remove test-only publication replica

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BT-02

## Scope and acceptance

Migrate rename, nested rename, concurrent same-title creation, and chat read-only cases to actual NoteTimeline save commands with disposable AppState. Preserve byte, identity, path, warning and preparation assertions. Delete cfg(test) persist_note/publish_note_save and reexports after locating all consumers.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
