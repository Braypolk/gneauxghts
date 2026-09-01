# 15: Inspect deterministic historical diffs

**What to build:** A user can inspect exactly what authored content changed in a selected revision without mixing managed metadata or lifecycle changes into the content diff.

**Blocked by:** 13: Open and navigate History Mode.

**Status:** ready-for-agent

- [ ] Default to comparing the selected Note Revision with its parent and allow switching to selected-versus-current comparison.
- [ ] Reconstruct and diff the complete authored body deterministically without offering arbitrary two-revision comparison.
- [ ] Render unmanaged frontmatter changes in a collapsible properties section.
- [ ] Hide managed Gneauxghts metadata from historical diffs.
- [ ] Keep title and path changes in Lifecycle Events and prove that a title-only or path-only operation creates no revision diff.
- [ ] Preserve historical Markdown asset references and visibly report referenced binary assets that are no longer present without attempting to version them.
- [ ] Keep diff selection pinned as new history arrives and show integrity failures instead of substituting a nearby revision.
- [ ] Add reconstruction, component, and end-to-end tests for insertions, deletions, formatting, frontmatter, empty content, lifecycle-only changes, current comparison, and missing assets.
