---
status: accepted
---

# Retain Atlas geography outside derived caches

A learned map and user-authored cloud names must survive rebuilding semantic
projections. The existing semantic owner binds a vault-local `atlas-map` store
beside its derived caches. One notes-only map has one durable head. Immutable
metadata contains opaque cloud identities, note identities, accepted world
placements, theme evidence, lineage, automatic names and user overrides. Retired
identities retain their names; identities are never reassigned by display order.

The durable head is the publication boundary. Atlas writes its structural
artifact and metadata before atomically replacing that head. Derived ready
pointers may then be repaired from the head. The previous valid metadata
generation remains recoverable, and artifact collection protects both durable
references. Unrecoverable metadata is reported and preserved. Legacy published
maps can seed the first durable generation. SQLite `atlas_positions` is a
migration hint, no longer an independently written continuity authority.

Structural admission, label admission, naming and cache clearing serialize under
one private map-store lock. Expensive graph/layout/model calculations happen
outside it. Structural work checks its source dependencies, queue supersession,
base generation and cache epoch before admission. Naming rebases onto the latest
accepted state; structural publication preserves the latest names. Cache clear
invalidates in-flight jobs and removes only derived artifacts. Model changes
retain places and names but reset incompatible semantic candidate evidence.

The backend owns final readable world geometry. For current world-layout
generations, the frontend consumes it directly and owns camera, captions,
selection and bounded transitions between accepted endpoints. `atlasLayout.ts`
retains a compatibility layout for legacy responses without the world-layout
flag. No second durable layout owner is introduced. Deleted or
ineligible content is removed before serving a cached response, and
canonical note admission continues through NoteTimeline.

This favors familiar geography over globally optimal semantic distance. Local
clearance can move neighboring regions; theme similarity alone does not cause
routine global layout. This storage contract supports one local vault owner;
cross-device concurrent map merging is outside its scope.

The 2026-10-16 Pi cleanup removes chat visibility variants, synthetic conversation
nodes and transcript-link projection. The notes map retains its established
durable head filename so this simplification cannot discard cloud names or
accepted geography. Derived ready pointers may rebuild through the same private
publication owner; chat settings no longer participate in map identity.
