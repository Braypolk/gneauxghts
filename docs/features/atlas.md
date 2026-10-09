# Atlas map

`/map` displays all published Atlas notes as topic-colored dots inside semantic
regions. Cloud outlines follow the accepted note and filename footprints, including
visible child outlines, with a small fixed border rather than padding proportional
to cloud size. Smooth, identity-seeded waves give the contours organic bulges and
dips; inward bends respect member footprints and parent clouds use smaller outward
variation. The same cloud keeps its contour character across updates and renames.
Parent contours narrow through empty gaps between subgroups while keeping a
connected waist and enclosing their children. Their fill and outline are quieter;
faint child boundaries remain visible at overview zoom, with child captions
appearing when zoomed in or when inspecting the child.
Conservative collision radii reserve clearance during initial placement only.
Deletion and same-width renames preserve accepted note positions. New or larger
filename footprints resolve collisions locally against all notes, including
isolated notes. Changed subgroup membership may adjust the affected family to
maintain distinct territories; unrelated roots stay anchored.
Stable spacing reserves room for filenames. Names omit `.md`, truncate
at 60 characters, fade together at reading zoom, and scale with the map. Region
captions stay inside their clouds. Dot size expresses connectedness; baseline
opacity expresses recent opening activity using the existing backend-decayed
opening count and last-viewed timestamp. Unknown activity remains visible.

Automatic cloud names are one-word topics selected with the installed local embedding
model. A readable topic vocabulary, extended by tags shared by at least a quarter
of the cloud's members, supplies the candidates. Every member contributes its
title, tags and up to two indexed passages nearest the cloud's semantic centroid.
Semantic similarity and shared evidence favor broad names; joint assignment
keeps sibling clouds distinct. Parents and children have separate naming pools.
If a sibling group exceeds the vocabulary, readable names can repeat.

Clouds retain opaque identities, colors and accepted world anchors as notes
change. A note joins its strongest meaningful theme, with a small margin to
avoid oscillation around close ties. Isolated notes stay outside clouds. A clear
change of theme can move a note; an unrelated replacement retires the former
cloud identity and preserves its name in retired metadata. Path changes retain
ordinary-note placement by Note Identity.

Layout begins at accepted note positions. New memberships or larger footprints
can adjust the affected cloud and its enclosing family; unrelated roots stay
fixed. Excessively sparse leaves contract around their notes. Large internal
footprint gaps close by translating nearby groups together, preserving their
internal spacing. Long titles reserve horizontal room without masking vertical
gaps. Sibling clouds have separate territories within their parent; whole-root
clearance preserves families and keeps isolated notes fixed. These geometric
constraints do not create semantic groups or change theme membership.

First-time layout uses a global initializer, then local readability constraints.
Placement-policy revisions repair older maps once through normal durable admission.
Aggregate strong relationships guide initial placement and new-region seeds;
affinity does not continuously pull accepted regions together. Search, naming,
activity, ordinary reopening and unchanged inputs do not move accepted geometry.
Legacy responses retain a temporary rendering fallback while the backend migrates
them to accepted world geometry. Migration details are recorded in the Atlas
continuity issues; the current layout has one backend owner.

Growing clouds reveal child regions before they branch nearby. Strongly
separated children can promote after a 30-second presentation interval;
moderate candidates require distinct supporting semantic updates. Polling does
not add evidence. The best continuation keeps the original identity and name;
a balanced split can retire the broad parent. Nearby successors keep subgroup
identities and family context at overview zoom. Merging requires several distinct
updates with much stronger similarity, including an extra observation after a
split. A homogeneous large theme is allowed to stay large rather than being
arbitrarily cut into false topics.

The region guide supports naming parent and child clouds, saving/canceling by
keyboard, and restoring the automatic name. Overrides allow 1–80 Unicode
characters on one line, with surrounding whitespace trimmed; duplicate names are
allowed. Names change presentation only. They persist across restart and derived
cache clearing, independently for each chat-visibility map. Failed saves remain
visible in the naming form. Automatic names remain until cumulative semantic
change warrants relabeling.

Accepted geometry updates morph over 450 ms on one frame clock. Interrupted
updates start at the displayed pose; removed notes leave immediately. Reduced
motion adopts the endpoint directly. Inspection preserves the selected region's
screen anchor while it settles. Transition links use a cheap direct representation;
obstacle routing resumes once at the endpoint.

Topic descriptor embeddings are cached by model and naming version. Note edits,
additions and removals use the existing semantic indexing and Atlas generation
pipeline; new generations rescore current member evidence using cached topic
vectors. New qualifying tags require embedding only their missing candidates.
A naming-version change invalidates labels without invalidating map geometry.
Labels still publish through the existing generation and supersession checks.

Names share the map's world transform and a single fade, avoiding per-name
screen-coordinate updates during zoom/pan. Hover emphasizes connections without
filename tooltips. Dragging from a dot/name pans the map instead of selecting SVG
text; text inside the floating reader remains selectable.
Wheel zoom listens on the full HTML map surface with a non-passive listener;
an invisible SVG background supplies a hit target between clouds in WebKit.

Search uses AtlasStore's indexed retrieval, including body text and authored tag
filters (`tag:name` / `#name`). It highlights existing positions without
selecting a note, opening/closing the reader, moving the camera or regrouping
notes. An explicit selection survives matching and zero-result searches.

Selecting a note reveals its connections and related filenames in place and
opens a floating reader. All authored links are shown without a count limit.
Semantic strength retains the absolute cosine score and discounts connections
that are weak relative to either endpoint's nearest neighbors. The local scale
uses each note's mean score gap from its best neighbor with a small noise floor;
flat neighborhoods do not become certain matches. Folder affinity fills a small
fraction of remaining strength headroom, avoiding high-score saturation. Raw
cosine remains separate from this relative relationship weight.
Semantic suggestions qualify when their published strength is at least 0.7
and at least 90% of this note's strongest semantic connection. These are ranking
weights, not probabilities. Every qualifying connection and equal-strength tie
is shown; the number varies by note. Reselection, hover, pan and zoom keep the
set stable until the underlying connections change. Duplicate semantic/authored
pairs become one authored connection. The reader reports shown versus total
candidate connections. The floating info panel includes a minimum suggested
strength slider (0–1). Changing it applies an absolute cutoff live to lines,
labels, emphasis and connected-note browsing; authored links always bypass it.
Auto restores the adaptive policy above. This control is temporary for the map
visit and does not change published scores or the camera/selected note.

Connections use smooth cubic curves and obstacle routing by default. Within a
cloud, connections can travel directly without being forced outside its border.
Unrelated cloud silhouettes receive clearance. Unrelated note dots reserve a
six-world-unit gap outside their radius, enforced on final sampled curve
segments as well as routing seeds. Only the connection's own endpoints are
exempt. Filenames and captions influence route cost without forcing hard turns.
Spatial buckets keep dot-clearance checks local to the route. An elastic-string pass
relaxes sideways displacement to reduce bending and stretch while retaining
forward travel and cloud clearance. A global natural cubic spline spreads
curvature over the whole route; its first and second derivatives are continuous.
At shared junctions, the branches match both the trunk's approach direction and
zero endpoint curvature. The incoming trunk must also meet this requirement;
the older cubic fallback is restricted to independent routes. If an intervening
cloud leaves too little room for a smooth arrival, routing tries nearby approaches
around the destination silhouette before relaxing cloud avoidance. Feasible
gateways are compared by actual smoothed travel distance. These choices
depend on geometry, keeping the junction stable through filtering and link order.
A broad departure profile carries that direction into
the branch, so the bend does not concentrate at its first knot. If the
natural spline cannot retain clearance, the existing validated cubic bends
remain available for independent routes. A branch that cannot meet its junction
constraints tries the earlier shared junction, then an independent route,
instead of using a sharper fork. No random perturbations are used.

Connections from the selected note to the same destination cloud share a
highway, drawn once, then branch to individual notes when sharing has modest
travel cost. A fully clear independent route replaces a shared detour if sharing
adds more than 35% travel. Nearby destinations can
share a second approach inside that cloud, delaying their split. Groups are
planned from fixed note geometry: every pair must be close relative to the
remaining journey, preventing a chain of neighbors from bundling divergent
routes. Planning is quadratic in region size and cached per source/region.
Additional shared sections are accepted only with smooth matching tangents and
curvature, forward travel and dot clearance. Unsafe approaches retain the earlier
fork. Branches approach the shared junction with matching tangents. Extreme side approaches retain direct
routes instead of being forced into a sharp highway fork. Destination hover/focus emphasizes the
complete source-to-note path so an individual relationship remains traceable.
A shared trunk containing an authored link is solid; individual branches retain
their authored/semantic styling. The floating panel's “Route connections around
clouds” checkbox allows comparison with straight lines.

Routing uses a bounded world-coordinate grid with an eight-direction distance
estimate and goal-progress tie breaking, avoiding exhaustive exploration of
equivalent long diagonal paths. It caches paths; zoom/pan and
strength changes do not recompute existing full routes. Shared trunks appear
only when at least two visible connections use them. Each shared section is drawn
once. A singleton continuation is drawn from its last shared ancestor; with one
remaining connection overall, its full path is drawn unchanged. Hover/focus
traces the full route through every shared section. Updated geometry or titles
invalidate the cache. An unavailable forward route retries with a penalty for
crossing unrelated clouds. Cloud avoidance yields before dot clearance; an
unrouteable/overlapping geometry retains a direct cubic as the final fallback. Routing never
drops an authored link. This affects drawing only, not Atlas scores, geography,
connection selection or reader order.

The reader browses this same neighborhood in relevance order, or search matches
while a query is active. Full source is fetched through `read_note` and is
invalidated when the selected note changes. Open in editor, double-click and
Enter use the existing pending note target, including document kind. Closing
the floating panel clears selection and restores overview labels. Clicking
empty canvas also clears selection and restores overview labels, while leaving
the floating panel open on Regions. Dragging/pinching does not deselect; note,
filename and region controls keep their own click actions.

The Regions button expands into the same floating panel. Hovering or keyboard
focusing an entry in All regions highlights that cloud's fill, outline and caption
on the map. Leaving the entry clears the preview. Selecting a region by
its cloud surface or panel entry opens its guide and eases the camera
into its geography over 300 ms. Reduced-motion settings skip the animation;
pan, zoom and Fit map interrupt it immediately. Names are passive labels;
clicks over them reach the cloud beneath. Each cloud is one keyboard control.
Dragging from a cloud pans without selecting the region. Fit map (or `0`)
explicitly frames the complete map;
routine refreshes and searches retain the camera. Wheel/pinch zoom, drag pan,
`+`/`-` zoom, reader arrows and Escape are supported. Local button/region
keyboard actions take precedence over global map shortcuts.

AtlasStore remains the owner of published responses, search and selected-note
state, with the original save/external/vault/indexing subscriptions and pending
build polling. The renderer owns transient camera, hover, region inspection and
reader state. Layout is cached separately from metadata/captions. No new activity writes are introduced. Durable map memory remains with the semantic owner. Empty, building,
unavailable and failed refresh/search states remain explicit.

`atlasConnections` is the single connection-selection policy used by edges,
related filenames and reader browsing. The retired renderer's zoom tiers,
fixed connection caps and presentation state have been removed from AtlasStore.
`atlasGeometry` shares polygon containment and segment-distance calculations
between layout and routing; node connectedness and world radius are defined in
layout. Both routing spline strategies use the same cubic sampling resolution,
and root/extended highways share one success cache and one failure cache.
Escape also closes the reader when its read-only full-source text has focus;
arrow keys there retain native scrolling rather than changing the active note.

`/atlas` and old `/map/prototype` bookmarks redirect to `/map`. The development
command `pnpm atlas:lab` uses read-only cached vault data on port 1422; it offers
text/tag matching rather than native semantic retrieval. Fictional data requires
`--demo`. Production does not import the demo fixture or depend on this launcher.
