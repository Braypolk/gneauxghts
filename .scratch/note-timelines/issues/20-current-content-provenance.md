# 20: Compute Current-Content Provenance

**What to build:** The app can explain when and how content still present in a note was introduced, last changed, or returned through Version Restore without treating deleted historical prose as current knowledge.

**Blocked by:** 08: Record external revisions and Lifecycle Events; 09: Initialize existing vaults with Baseline Revisions; 17: Restore a complete earlier revision; 34: Prove the native Phase 1–3 integration journey.

**Status:** ready-for-agent

- [x] Build Current-Content Provenance as a rebuildable projection over retained Note Revisions and Lifecycle Events rather than a SQLite-only source of truth.
- [x] Track `introducedAt`, `lastChangedAt`, and optional `restoredAt` at internal range granularity and return useful line or paragraph groupings.
- [x] Represent Baseline Revision content with `knownSince` and unknown earlier introduction and change times.
- [x] Preserve lineage across content movement only when correspondence is provable; treat ambiguity as a new introduction.
- [x] Treat manually retyped identical text as a new introduction and Markdown formatting changes as changes to affected authored ranges.
- [x] Track current-title provenance through title Lifecycle Events without placing title in revision content.
- [x] Expose provenance only through the role-limited current-content capability and never return prose absent from the current canonical note.
- [x] Add property-style and behavior tests for insert, edit, delete, move, ambiguous move, retyping, formatting, external change, baseline, restore, clear, and title changes.

## Comments

Implemented Current-Content Provenance behind `current_content(AllowedScope)`.
The rebuildable projection emits current body/properties in line groups with
UTF-8 ranges and title evidence from lifecycle predecessor order. Unique line
and word correspondence preserves lineage; duplicates and retyping are
conservative. Markdown parser context accounts for inline and multiline
formatting changes. Baselines and clears retain unknown earlier provenance.

New Version Restores durably retain their selected Revision Identity before
publication, including across failed finalization and restart. Schema 11 adds
that reference; older restores without it report unknown earlier lineage for
returning ranges. No chat tool or UI is added by this ticket.

Validation: `pnpm check`, `cargo check --manifest-path src-tauri/Cargo.toml`,
`pnpm test` (771 tests across 122 files), and
`cargo test --manifest-path src-tauri/Cargo.toml` (457 unit tests and 15
architecture checks). Eleven provenance tests include generated edits and
real-vault restore/restart/clear, title, external change, and access-policy
journeys. Independent Standards and Spec reviews passed after correcting
multiline edit correspondence and Markdown formatting scope.
