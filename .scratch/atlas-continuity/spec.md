# Atlas continuity and local branching

Status: ready-for-human
Date: 2026-10-07

## Outcome

People can learn where themes live in the map. Adding, editing, renaming,
moving, or removing notes adjusts that geography locally. Growing clouds expose
subthemes and branch into nearby clouds rather than becoming one giant central
region. The implementation is complete in the working tree. See [the evaluation](evaluation.md) for automated results and live-app validation limits.

## Accepted product decisions

- A note has one primary home, determined by its most present theme. Other
  relationships remain connections. Small ambiguous edits do not cause repeated
  reassignment; a clear dominant-theme change must eventually change membership.
- Isolated notes retain the existing behavior: they exist outside clouds.
- Familiar geography takes priority over making every newly related cloud close.
  Connections communicate relationships independently of map distance.
- Clouds represent specific themes. Broader groupings are visible at overview
  zoom. A subgroup is visible inside its parent before it separates nearby.
- Users can name clouds. Position pinning, dragging clouds, and manual membership
  editing are outside this feature.
- Names change presentation, not semantic membership. User names survive ordinary
  updates, restart, and rebuilding derived semantic data.
- Search and tag filtering highlight the existing map without regrouping,
  rescaling geography, or reframing the camera.
- Changes happen in bounded updates and settle. Polling, opening activity, camera
  changes, and elapsed idle time do not advance branching or create map drift.
- Deleted, missing, forgotten, and visibility-excluded notes cannot be kept on
  screen to preserve continuity. Existing current-content admission stays in force.

## Existing implementation and constraints

The semantic owner already has a worker queue, visibility variants, immutable
Atlas artifacts, ready pointers, label publication, and supersession checks.
Keep that ownership. AtlasStore owns admitted responses, search, selection, and
subscriptions. AtlasMap owns the camera and transient exploration. The renderer
must not become an independent semantic or durable map owner.

Current structural builds load positions by path, reconstruct communities,
assign rank-based IDs, run UMAP, and place top-level clouds afresh. Center
relaxation also attracts clouds toward the origin. Geometry already detects
children and promotes mature subclouds, but has no continuity across accepted
builds. Position rows are written before the final structural publication check.

The frontend rescales every dataset to a fixed envelope, greedily repacks note
labels, and separates cloud envelopes from scratch. It renders only root clouds.
Fixing only the backend would leave visible churn and hide emerging subgroups.

Relevant files:

- `src-tauri/src/semantic/atlas.rs`, `atlas/geometry.rs`, `atlas/publication.rs`
- `src-tauri/src/semantic/atlas_labels.rs`, `atlas_labels/topic_names.rs`
- `src-tauri/src/semantic/db.rs`, `semantic/mod.rs`
- `src-tauri/src/commands/atlas_commands.rs`
- `src/lib/types/atlas.ts`, `features/atlas/atlasStore.svelte.ts`
- `src/lib/features/atlas/atlasLayout.ts`, `AtlasMap.svelte`, `atlasRouting.ts`
- `docs/features/atlas.md`, `ARCHITECTURE.md`, behavior invariants

Existing topic naming is the approved production policy. Reuse its candidate
vocabulary, model caches, scoring, and generation admission rather than adding a
second labeler. Parent and child pools already differ.

## Design

### 1. Durable map continuity behind the existing owner

Introduce private continuity calculations and storage under `semantic/atlas/`.
The conceptual operation is current structural inputs plus last accepted map
state producing the next map and its continuity state. Keep calculation separate
from publication; the existing owner performs effects and admits results.

Use opaque cloud IDs unrelated to rank, size, label, or a membership hash. Track
stable Note Identities internally; current response node/path IDs can remain
compatible with existing readers and links. A rename/move maps the same identity
to its new path. Legacy identity-less rows have an explicit path fallback and
cannot claim identity continuity across a rename. Non-note nodes use a typed
durable document identity where available, never a note-title match.

A continuity record includes cloud identity, lineage, active/retired state,
membership/core Note Identities, color, world anchor, per-note placements,
boundary shape, automatic name evidence, optional user name, and candidate
branch/merge evidence. Semantic prototypes carry the provider representation
fingerprint; vectors are never compared across incompatible representations.

Store versioned map metadata in a dedicated vault-local `atlas-map/` directory
under RunningVault.data_dir(), outside provider caches and rebuildable semantic
databases. Bind its path once at composition. Keep immutable metadata generations
and an atomic head, with a previous valid generation for recovery. Do not put
names in Markdown notes, Note Timelines, chat settings, or global preferences.

The durable head is the authoritative commit marker for continuity and identifies
the accepted structural generation and cached artifact. Write/verify the cached
artifact and immutable metadata before flipping the head. Existing ready pointers
become repairable derived pointers: their generation must agree with the durable
head before being admitted as fresh. An interrupted pointer update can be repaired
from the head/artifact; a missing cache artifact triggers a rebuild from preserved
continuity. GC retains everything referenced by current/previous durable heads.

Serialize final publication, naming, and cache-clear admission through this same
owner. A failed/superseded computation cannot change the next build's positions,
membership, or branch counters. Retire the pre-publication path-position write as
an authoritative continuity source. A concurrent rename must survive a worker
publication; rebase presentation-only changes or reject a stale result.

Continuity is scoped to the existing Hidden/Remembered/All visibility variants.
Each variant retains its own map and names; switching variants cannot count as
new semantic evidence in another variant. Hidden ordinary-note geography remains
independent of recall-only chat changes. This is an implementation default for the
existing visibility feature, not a new user control.

Migration imports valid last-published memberships and positions once, allocating
opaque identities without moving them unnecessarily. Old artifacts remain
readable for stale display during migration. Cache clear and semantic reindexing
preserve map metadata and names. A provider change retains identity/spatial hints
through Note Identity overlap, recomputes prototypes in the new representation,
and resets incompatible candidate evidence. No destructive reset UI is added.
Malformed continuity fails visibly and retains recoverable bytes; do not silently
replace it and lose authored names.

### 2. Reconcile semantic communities with existing clouds

Treat current community detection as a proposal, not the final cloud identity or
membership. Match proposed groups to old clouds with a deterministic, one-to-one
assignment based primarily on stable member/core overlap and secondarily on
compatible semantic similarity. Handle unmatched groups, departures, splits,
merges, and retirement explicitly; a greedy match must not let two groups inherit
the same identity.

Assign a note to its strongest meaningful theme using current note evidence,
cloud prototypes/core relationships, and a modest retention margin for close
ties. Strong authored links can inform relationships but cannot force an
unrelated note into a theme. Exclude navigation-only placeholder vectors from
claims about a note's dominant semantic theme.

Use current prototypes and cumulative change against retained core evidence so
many small edits can eventually cross the margin. Never make movement depend on
how often the screen polls or how many times identical inputs are rebuilt. A
clearly unrelated note becomes isolated using existing eligibility policy.

### 3. Preserve world geography and adapt locally

Use full layout for the first map. Subsequent builds begin at accepted cloud and
note positions. UMAP may supply initial structure or candidate local targets; it
must not freely redraw all established coordinates on routine changes.

The layout objective balances current semantic fit and readability with strong
penalties for cloud displacement, changed relative directions, and note movement.
Unaffected established clouds have the strongest anchors. New notes start near
related members; new clouds begin near their related region in available space.
Remove routine recentering on the highest-centrality cloud and global origin
attraction. Activity/importance changes do not choose a new map center.

Adjust the affected region and neighbors required for clearance. Let boundaries
grow/contract more readily than anchors. Preserve stable angular boundary samples
so hull changes are localized and can interpolate. Check containment, finite
coordinates, readable spacing, and overlap on final geometry. Collision resolution
can exceed a soft movement budget when necessary, but must minimize the affected
area; never enforce a hard cap that leaves unreadable overlapping regions.

The accepted backend geometry must include the final readable world placements,
not just pre-packing UMAP targets. Port the existing conservative filename-width,
spacing and containment policy into the private layout calculation, using the same
visible filename/truncation rules and world text size as the renderer. Retain
placements by Note Identity and solve only new/changed filename collisions before
publication. Titles that change their spatial envelope invalidate the affected
layout; previews, activity and region-label publication do not.

The frontend consumes those stable world units directly, with no dataset-bounds
normalization or second full-map packing/separation pass. It still owns captions,
camera and rendering caches; backend geometry does not depend on viewport or zoom.
Keep any legacy packing fallback temporary and remove it after migration. This
gives restart/remount the same accepted placements without a second durable
frontend owner. Backend metrics alone are insufficient: measure rendered
placements and readability too.

### 4. Emerging subgroups, promotion, and overview

Keep existing child detection, coherent-group checks, weak-bridge resistance,
and soft size limits as starting policies. Add persisted candidate evidence
based on internal cohesion, cross-group separation, minimum viable membership,
crowding, and novelty of accepted content inputs. Size/crowding triggers evaluation;
size alone must not carve a coherent theme into arbitrary unrelated clouds.

Use explicit candidate -> visible subgroup -> promoted cloud progression. Count
meaningful distinct semantic updates, not index epochs, polling, or failed builds.
Moderate cases remain visible subgroups before promotion; a large import with
strong evidence may enter the visible stage immediately and promote on a later
admitted update. Re-evaluation can be scheduled through the existing queue after
an initial subgroup presentation, but replaying identical data must not manufacture
additional evidence. Promotion must not wait forever for another unrelated edit:
the policy may admit a clearly supported candidate after a bounded presentation
interval, without adding periodic idle drift. Define this evidence/presentation
distinction explicitly in issue 05.

The continuation most representative of the original theme retains the cloud
identity, color, anchor, and user name. Other branches preserve their subgroup
identity and approximate position when promoted and receive their own automatic
names. If neither continuation represents the old theme, retire the old identity
and create nearby successors with lineage; retain its name in retired metadata
rather than silently assigning it to an unrelated successor.

After a split, require stronger contradictory evidence before merging again.
For a clear merge, the best semantic continuation survives; retire other identities
and preserve their names/lineage in metadata. Shrinking groups have tolerance
around minimum size, but empty groups retire immediately and vanished themes
cannot retain unrelated notes merely to preserve an ID.

Render child hulls/captions and allow child inspection/naming. At overview, expose
broader parent/family context; closer zoom exposes specific subgroups. Use actual
parent hierarchy and retained split lineage for context, without duplicating note
membership, counts, or edges. Overview families are presentation, not giant
membership clouds or invisible obstacles. Avoid a new global reclustering pass
solely to invent broad categories. Routing considers the actual visible/structural
cloud obstacles and preserves authored links.

### 5. Naming and transitions

Retain an automatic name while it still represents the theme. Score refreshed
current evidence with the approved labeler; meaningful cumulative semantic change
can update it. Name publication alone cannot repack geography. Preserve generation,
membership, naming-version, and provider compatibility checks. Do not attach a
label from an old cloud to a new ID merely because its ordinal is the same.

Add a typed cloud-name command through the current command worker and Atlas owner.
Trim outer whitespace; allow 1-80 Unicode characters on one line; clearing the
override restores the automatic name. Display may truncate captions, while the
region guide shows the full name. Duplicate user names are allowed because IDs
provide identity. Validate vault/variant/cloud identity and reject retired targets.
Return the admitted name result; an older response or label callback cannot revert
it. Names remain editable during semantic setup/rebuilding using retained map
metadata; failure to save stays visible at the rename control.

Expose naming in the region guide, with keyboard save/cancel and a restore-auto
action. User names are never inputs to membership or theme detection.

Animate bounded geometry updates between accepted endpoints with one correlated
frame clock and consistent node, hull, caption, and edge positions. Interruptions
start from the displayed pose. Reduced motion adopts final geometry immediately.
New/removed notes and split/merge lineage use coherent enter/exit behavior; excluded
notes leave immediately. Selection, camera, source reads, focus, and hit targets
must agree with the admitted dataset and displayed geometry.

While inspecting or naming a region, preserve that region's screen anchor during
a transition, allowing other local geometry to settle. Never defer content removal
or claim stale metadata is fresh to freeze the view. Avoid running the expensive
router on every animation frame; reuse transition geometry or a bounded safe
transition representation, then route final geometry once. Detailed routing
remains unchanged after the transition.

## Delivery sequence

| Issue | Outcome | Prerequisites |
| --- | --- | --- |
| [01](issues/01-durable-cloud-continuity.md) | Durable IDs/state, migration, atomic admission and recovery | None |
| [02](issues/02-incremental-theme-membership.md) | Stable theme matching and dominant-theme membership | 01 |
| [03](issues/03-anchored-local-layout.md) | Cloud/note anchors and local geometry adjustment | 02 |
| [04](issues/04-stable-rendered-world.md) | Direct rendering of stable, readable world geometry | 03 |
| [05](issues/05-progressive-local-branching.md) | Visible subgroups, controlled promotion, overview hierarchy | 02, 03, 04 |
| [06](issues/06-persistent-cloud-names.md) | Stable automatic names and durable user naming | 01, 02, 05 |
| [07](issues/07-correlated-map-transitions.md) | Interruptible morphs and stable exploration | 04, 05, 06 |
| [08](issues/08-sequence-evaluation-and-rollout.md) | Calibrated sequence evidence, documentation and native verification | 01-07 |

Each issue includes behavior regressions at its owning seam. Issue 08 gathers
the complete evidence; it is not a reason to postpone verification of earlier work.

## Validation and tuning

Use deterministic multi-update fixtures: ordinary small edits, new related notes,
an unrelated addition, path rename/move, removal, gradual dominant-theme change,
weak bridges, coherent dense growth, separated subgroup growth, balanced split,
merge reversal, broad import, empty map, long titles, and dense neighboring regions.
Include alternate batching of the same semantic changes: polling frequency must
not determine the result.

Measure cloud-ID retention, unaffected cloud/note displacement in world and
rendered units, neighbor/direction retention, membership churn, label churn,
split/merge frequency, overlap/containment, and processing time. Establish a
baseline from the existing algorithm before replacing it. Define movement limits
relative to cloud radius and note spacing; tune numerical thresholds from fixtures
and live usability, not arbitrary percentages presented as guarantees. Stationary
inputs and presentation-only changes require exactly stationary geometry.

Fault-injection coverage includes supersession before/after artifact write, crash
between durable-head and ready-pointer updates, simultaneous naming/publication,
cache clear during work, legacy import, corrupt/missing artifacts, missing current
notes, restart, provider incompatibility, and visibility switching. Only admitted
generations advance continuity/evidence. Recover names even when derived geometry
must rebuild. Existing freshness/current-content and hidden-chat isolation tests
remain applicable.

Frontend/browser coverage verifies cloud and note continuity after refresh, region
inspection through promotion, name persistence and failed saves, zoom hierarchy,
search stability, camera retention, interrupted animations, reduced motion, and
authored-link visibility. Exercise the existing 2,000-note fixture; avoid full
UMAP/global packing/per-frame routing on each small update.

Run targeted Rust Atlas/publication/command tests, frontend Atlas tests, relevant
IPC fixtures and browser map specs, `pnpm check`, production build, Rust formatting,
and applicable architecture fitness checks as implementation lands. Native smoke
tests must cover real semantic updates and restart; the read-only Atlas lab alone
cannot establish these outcomes. Planning-only changes require link/format checks,
not application tests.

## Documentation and scope

Update `docs/features/atlas.md`, `ARCHITECTURE.md`, and applicable behavior
invariants alongside implementation. Record an ADR for durable continuity vs
rebuildable projections and the single publication boundary when issue 01 fixes
the actual storage contract. Do not rewrite unrelated dirty files or revive
retired map prototypes. No Note Timeline ownership, canonical note write path,
agent runtime, or embedding-provider implementation change is required.

Manual position/membership controls, duplicated multi-theme notes, continuous idle
motion, cross-device concurrent map merging, and a user-visible destructive reset
are outside the accepted scope. A homogeneous giant topic remains a known limit:
surface its coherent substructure and improve packing rather than inventing false
semantic splits. Tune acceptable crowding in the sequence evaluation.

## References

The layout approach is supported by temporal/grouping regularization in
[A Regularized Graph Layout Framework for Dynamic Network Visualization](https://arxiv.org/abs/1202.6042).
[Visualizing Streaming Text Data with Dynamic Maps](https://arxiv.org/abs/1206.3980)
also addresses stable semantic regions and component packing. These motivate the
techniques; they do not establish this app's thresholds or usability outcomes.
