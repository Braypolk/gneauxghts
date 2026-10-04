# Forgotten fixtures and obsolete refresh API

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BT-13/14; BB-06/07

## Scope and acceptance

Repair damaged metadata precondition before lifecycle repair; replace mock Tauri state-explicit forgotten fixtures with real direct AppState/ChatService fixture where valid. Remove ignored max-age internal argument/constant and time-crossing sleep. Replace foreground queue sleep with acknowledged gate; coordinate search fixture callers with root.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
