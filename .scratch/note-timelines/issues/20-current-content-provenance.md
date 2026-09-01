# 20: Compute Current-Content Provenance

**What to build:** The app can explain when and how content still present in a note was introduced, last changed, or returned through Version Restore without treating deleted historical prose as current knowledge.

**Blocked by:** 08: Record external revisions and Lifecycle Events; 09: Initialize existing vaults with Baseline Revisions; 17: Restore a complete earlier revision.

**Status:** ready-for-agent

- [ ] Build Current-Content Provenance as a rebuildable projection over retained Note Revisions and Lifecycle Events rather than a SQLite-only source of truth.
- [ ] Track `introducedAt`, `lastChangedAt`, and optional `restoredAt` at internal range granularity and return useful line or paragraph groupings.
- [ ] Represent Baseline Revision content with `knownSince` and unknown earlier introduction and change times.
- [ ] Preserve lineage across content movement only when correspondence is provable; treat ambiguity as a new introduction.
- [ ] Treat manually retyped identical text as a new introduction and Markdown formatting changes as changes to affected authored ranges.
- [ ] Track current-title provenance through title Lifecycle Events without placing title in revision content.
- [ ] Expose provenance only through the role-limited current-content capability and never return prose absent from the current canonical note.
- [ ] Add property-style and behavior tests for insert, edit, delete, move, ambiguous move, retyping, formatting, external change, baseline, restore, clear, and title changes.
