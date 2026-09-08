# 21: Answer chat activity questions with Revision Citations

**What to build:** Chat can answer temporal questions about current notes using activity metadata and Current-Content Provenance, with clickable evidence, without gaining ordinary access to removed historical prose.

**Blocked by:** 13: Open and navigate History Mode; 19: Recover and expire Missing Notes; 20: Compute Current-Content Provenance.

**Status:** ready-for-agent

- [x] Add an on-demand current-content history capability to chat context assembly rather than injecting provenance into every request.
- [x] Reapply stable Note Identity, vault-access, global exclusion, and current-note eligibility rules when resolving activity or provenance.
- [x] Answer activity-period questions with current notes, current excerpts, revision counts, times, and Mutation Sources only.
- [x] Prevent ordinary chat from searching, quoting, summarizing, or recalling prose that is absent from the current note.
- [x] Exclude forgotten, Missing, purged, and otherwise disallowed notes from activity and provenance results.
- [x] Return Revision Citations containing Note Identity, revision identity, timestamp, Mutation Source, and current excerpt.
- [x] Open a citation in History Mode at its supporting revision without changing the existing workspace state.
- [x] Add capability-isolation, context-policy, component, and end-to-end tests proving removed prose cannot cross the ordinary chat boundary.

## Comments

Implemented the on-demand `current_note_history` chat tool behind
`current_content(AllowedScope)`. Activity pages expose current excerpts and
revision metadata; provenance pages expose current body, properties, and title
with supporting Revision Citations. Stable identity, grants, exclusions,
eligibility, canonical bytes, and timeline generation are checked before
results are delivered. Forgotten, Missing, purged, and stale notes are omitted.

Revision evidence persists with conversations and branches and is revalidated
when delivered or reloaded. A durable temporal-answer marker prevents old
answers from reentering model history or compaction after their prose stops
being current. Ordinary chat never receives revision payloads or a History
Mode capability.

Citation clicks enter History Mode at the exact retained revision, paging as
needed, while preserving the invoking chat pane and workspace. A cleared
revision reports unavailable. Historical prose appears only after entering
History Mode.

Independent Standards and Spec reviews completed; findings about conversation
response filtering, repeated reconstruction, canonical-content validation,
and operation-guard lifetime were resolved.

Validation: `pnpm check` (zero errors or warnings), `pnpm test` (777 tests
across 123 files), `cargo test --manifest-path src-tauri/Cargo.toml` (463 unit
tests and 16 architecture checks), and `pnpm test:e2e:browser` (10 journeys).
The first concurrent browser run timed out at blank-page startup; a rerun
following unit-suite completion passed. Real-vault tests cover access scopes,
rename continuity, exclusions, missing/forgotten/purged notes, history clear,
uncaptured external edits, current-only excerpts, and replay/compaction safety.
