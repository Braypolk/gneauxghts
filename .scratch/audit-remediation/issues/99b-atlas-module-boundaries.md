# Atlas private generation, geometry and query boundaries

Status: ready-for-agent
Progress: complete; Atlas27 and architecture23 passed; root native refresh passed
Owner: audit_agent
Findings: Sol AA-12 Atlas half

## Evidence and decision

The original AA-12 asks private generation publication, graph/community/layout and query modules behind one semantic owner. This is distinct from UIX-10's proposed generalized ANN abstraction, which was rejected for different chunk/note policies. Current atlas.rs combines atomic JSON/ready-pointer/GC operations and worker scheduling with deterministic geometry and search ranking. Geometry tests need no persisted generation fixture; publication tests test compatibility/pointer visibility; query tests test searchable fields. These independent change domains justify private extraction, preserving the existing call order rather than inventing a public service layer.

## Plan before edits

Extract private publication.rs with existing worker build/label publication and published-generation serving methods plus atomic filesystem/compatibility helpers. Keep schemas and concrete state owner under atlas. Extract geometry.rs for tightly coupled graph/community/UMAP/disc calculations; keep these together because splitting their numerous shared intermediate calls into graph/community/layout siblings would widen interfaces. Expose only functions used by existing worker stages; preserve cancellation checkpoints between stages. Extract query.rs for actual search method and ranking helpers, retaining existing recency/frequency exports. Group existing tests under their owning private modules. Record exact test-name/body inventory before and after; no assertion deletions, numerical changes, schema changes, transaction changes or worker-queue replacement. Coordinate shared cosine rename with semantic editor before reading final source snapshot.

## Validation

Compile targeted Atlas tests and architecture gate. Compare test IDs via stable leaf names and body hashes. Root refreshes native binary after this source extraction. Inspect public visibility paths and keep ActiveSemanticState method visibility at its original semantic-owner scope.

## Comments

2026-10-03: Plan persisted before extraction. Reviewed codebase-design, current architecture, AA-12 original source; one semantic queue and immutable published generation ownership remain unchanged.

## Outcome

Implemented private publication.rs, geometry.rs and query.rs, retaining one AtlasWorkerContext/ActiveSemanticState owner, existing data/schema formats and complete stage/publication order. Publication-specific artifact structs and disk I/O imports are private to publication; numerical dependencies and adjacency/partition intermediates are private to geometry. Graph/community/layout stay together because splitting their shared mutable intermediate algorithms would create a wide sibling API. Query's recency/frequency exports retain their original crate paths through re-export.

All27 preexisting test leaf names and assertion bodies retained; only module prefixes changed. Whitespace-normalized hashes verified for every test (measurements/atlas-test-moves.json); raw inventories saved before/after. Final focused Atlas run27passed0failed0.33s after a warning-free build. No tests deleted or added for this mechanical extraction. Architecture gate23passed; root native feature rebuild passed after extraction. Native acceptance is recorded in integrated validation.

Final architecture gate:23passed,0failed in3.59s. Source stable; parent notified for native refresh.

Final validation update: architecture23 passed (`validation/architecture-final.log`) and root native feature build refreshed successfully (`validation/native-build-final.log`), SHA256 `86203422a94684501cebf731b772023687e8d646c6db7c4a5ea1516b6cefbe5b`. Independent token/body/visibility/publication review found no actionable issue; see ../final-late-review.md. Native acceptance results remain root-owned and are distinct from build completion.
