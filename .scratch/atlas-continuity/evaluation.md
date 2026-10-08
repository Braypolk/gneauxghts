# Atlas continuity evaluation

Date: 2026-10-07
Implementation: complete; automated verification passed
Live desktop/provider usability smoke: not performed

## Scope and baseline

The pre-implementation versions of 61 relevant files were captured under
`/tmp/gneauxghts-atlas-before/`. Review used this snapshot because the workspace
already contained extensive unrelated changes. The existing 42 Rust Atlas tests
and 22 frontend tests passed before implementation. The legacy rendering path is
retained temporarily for pre-migration responses and provides the direct rendered
baseline comparison below.

## Measured results

| Scenario | Observed result |
| --- | --- |
| Distant unrelated addition, demo renderer | Legacy maximum retained-note displacement: 1,950.09 world units; accepted-world renderer: exactly 0 |
| Unchanged 2,000-note sequence, 20 coherent themes | 20/20 cloud IDs retained; 0 note displacement; 0 membership churn; same relative geography |
| 2,000-note continuity calculation, debug build | Initial 741 ms; repeat 912 ms in final run; excludes embedding, HNSW construction, label inference and full first-map UMAP |
| Local addition beside a separate theme | Unaffected cloud anchor exactly retained; added note joins matching theme; unrelated note remains isolated |
| Restart / metadata-only updates | Exact note positions, IDs and hull samples retained; automatic/user label updates do not change geometry |
| Path move, removal, excluded inventory | Stable Note Identity retains position across path moves; removed/excluded nodes and incident links leave immediately |
| Gradual theme change | Ten incremental embedding changes eventually move the note to its dominant theme |
| Whole-theme replacement | Original ID/name retire; successor has a new ID with predecessor lineage and retained nearby positions |
| Strong/balanced split | Children visible first; original child identities survive promotion; balanced parent retires; identical polls add zero evidence |
| Moderate balanced split | Requires distinct supporting evidence; promotes both children together after presentation; no perpetual pending rebuild |
| Merge | Three corroborating semantic updates required; unchanged replay does not reverse the result; promoted regions require four |
| Dense/long filenames | Accepted notes have at least 42 world units of separation; finite cloud envelopes include filename clearance |
| Browser scale fixture | All 2,000 notes and filenames render and remain navigable |

The large fixture exposed a repeated candidate-membership construction inside the
merge-pair loop. Candidate member sets are now built once, and incompatible
semantic pairs are rejected before membership comparisons. Homogeneous connected
themes also bypass arbitrary graph partitioning into semantically identical
subthemes. A debug regression guard permits 15 seconds for the repeated fixture;
this is a broad regression threshold, not a UI latency promise.

## Policy established by these fixtures

- Dominant-theme floor 0.30 cosine similarity; retention margin 0.08.
- Retained original theme prototype prevents repeated small replacements from
  silently transferring a user-authored name to an unrelated theme.
- Subgroup minimum 8 members; soft parent size 36; separation floor 0.22.
- Strong separation 0.35 can promote after a 30-second presentation interval
  without another content edit. Moderate cases need distinct evidence. The
  interval never increments evidence, and no timer continuously moves the map.
- Balanced continuation scores within 0.05, no child over 60%, and complete
  coverage retire the original parent when every branch qualifies.
- Merging needs shared community evidence and cosine similarity at least 0.96.
- Automatic name retention compares current evidence to its retained naming
  prototype (0.94 threshold); user overrides never influence membership.
- New/changed/unchanged region separation weights are 1/8/1000. Clearance takes
  precedence over an absolute movement cap. Filename text is 6.5 world units,
  note spacing 42, and inter-region gap 28.
- Geometry morphs settle in 450 ms; reduced motion skips interpolation.

These are explicit initial policies supported by deterministic fixtures. They
have not been calibrated against subjective usability across real embedding
models or a broad set of personal vaults. A homogeneous theme can remain large.

## Recovery and publication evidence

The native Rust test uses the production database, ANN, structural publication,
label publication, map store and response reader with temporary Markdown files
and a deterministic embedding provider. It tests adding actual persisted notes,
reopening the map owner, preserving geometry/names, repairing a missing ready
pointer after durable-head admission, corrupt-artifact rebuild admission, actual
cache clearing, supersession, visibility-eligible inventory filtering and empty
publication after deletion. Another test corrupts metadata twice across recovery
and verifies that the last valid backup survives. Provider-change tests verify
candidate evidence resets while places and names remain.

Independent code reviews found and verified corrections for promotion position
loss, model evidence reuse, recovery fallback loss, corrupt-artifact rebuild
admission, visibility exclusions, balanced split readiness, retained theme
identity, and the frontend admission/animation inventory race. Final label and
structural commits share map admission; queue supersession is serialized across
the structural head write. No second worker or frontend durable layout was added.

## Checks

- Rust Atlas/label/publication/sequence tests: 56 passed.
- Rust Atlas command current-content admission: 1 passed.
- Rust architecture fitness: 21 passed.
- Frontend Atlas, IPC and architecture fitness: 59 passed.
- Browser map suite: 26 passed (including naming, promotion and 2,000-note fixture).
- `pnpm check`: 0 errors, 0 warnings; E2E TypeScript check passed.
- `pnpm build`: passed; existing large-bundle size advisory remains.
- Changed Rust files formatted; `git diff --check` passed.

## Limits

No live vault was modified and the installed desktop app was not restarted.
Native lifecycle evidence covers the production owner seams with temporary data,
not a full desktop relaunch using an installed embedding model. There is no
exhaustive process-kill injection at every filesystem instruction, large-vault
release benchmark, or cross-device concurrent writer test. Alternate batching
can legitimately change how many distinct semantic observations are available;
replaying the same content never creates additional evidence. Legacy rendering
fallback removal should follow migration verification.
