# Atlas map

`/map` displays all published Atlas notes as topic-colored dots inside semantic
regions. Stable spacing reserves room for filenames. Names omit `.md`, truncate
at 60 characters, fade together at reading zoom, and scale with the map. Region
captions stay inside their clouds. Dot size expresses connectedness; baseline
opacity expresses recent opening activity using the existing backend-decayed
opening count and last-viewed timestamp. Unknown activity remains visible.

Search uses AtlasStore's indexed retrieval, including body text and authored tag
filters (`tag:name` / `#name`). It highlights existing positions without
selecting a note, opening/closing the reader, moving the camera or regrouping
notes. An explicit selection survives matching and zero-result searches.

Selecting a note reveals its connections and related filenames in place and
opens a floating reader. The reader browses connected notes, or search matches
while a query is active. Full source is fetched through `read_note` and is
invalidated when the selected note changes. Open in editor, double-click and
Enter use the existing pending note target, including document kind. Closing
the floating panel clears selection and restores overview labels.

The Regions button expands into the same floating panel. Selecting a region
focuses its geography. Fit map (or `0`) explicitly frames the complete map;
routine refreshes and searches retain the camera. Wheel/pinch zoom, drag pan,
`+`/`-` zoom, reader arrows and Escape are supported. Local button/region
keyboard actions take precedence over global map shortcuts.

AtlasStore remains the owner of published responses, search and selected-note
state, with the original save/external/vault/indexing subscriptions and pending
build polling. The renderer owns transient camera, hover, region inspection and
reader state. Layout is cached separately from metadata/captions. No new
activity writes or persistence policy are introduced. Empty, building,
unavailable and failed refresh/search states remain explicit.

`/atlas` and old `/map/prototype` bookmarks redirect to `/map`. The development
command `pnpm atlas:lab` uses read-only cached vault data on port 1422; it offers
text/tag matching rather than native semantic retrieval. Fictional data requires
`--demo`. Production does not import the demo fixture or depend on this launcher.
