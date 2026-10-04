# 97-semantic-note-kind-admission

Status: ready-for-agent
Progress: complete
Findings: BB02 semantic candidate admission follow-up
Owner: semantic remediation (editor agent); command call site root

## Evidence and plan

Semantic queries currently collect mixed note/chat ANN candidates, score and truncate before the command filters ordinary notes. ChatIndex dominance can remove all eligible results. Extend the scoped query with optional DocumentKind, selecting eligible labels via notes metadata before scoring or truncation; combine with allowed paths. Preserve unscoped mixed-document callers. Add a real database/query/provider composition test with more chat candidates than ANN overfetch and a lower-ranked ordinary note, plus path intersection and unfiltered behavior.

## Validation

Scoped Rust semantic tests and command compilation; root owns command wiring and broad integration.

## Outcome

Implemented document-kind admission before semantic candidate limiting. Public scoped helper adds Option<DocumentKind>; root owns Some(Note) caller. Mixed80chat/1note real DB/ANN/provider composition passes, including None scope/path intersection/exclusion.

Validation evidence: `../semantic.md` and `../semantic-validation/`.
