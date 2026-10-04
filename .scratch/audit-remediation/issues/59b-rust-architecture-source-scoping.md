# Rust architecture source scoping

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BT-12; BP-10

## Scope and acceptance

Replace brace counting and first-cfg truncation with parsed Rust item/function ranges. Exclude test-only items and comments from ownership checks. Match whitespace-insensitively, retain forbidden cross-boundary SQL/calls, typed owner, grant/citation issuance, offthread read and restart ordering constraints. Remove exact doc sentences and internal SQLite configuration spelling checks where executable durability suites own behavior. Test scanner against comments/raw strings, cfg(test) before later production, legal formatting/extraction and injected forbidden calls. Existing syn/proc-macro crates are already transitive dependencies; only add dev access. Do not change production APIs to satisfy source spelling.

## Validation

Architecture integration target and scanner negative controls; full suite remains root-owned.

## Outcome

Implemented and reviewed; [owner outcomes and verification](../timeline.md) contain exact evidence and limitations.
