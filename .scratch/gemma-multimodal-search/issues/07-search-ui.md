# Add image queries, result previews and occurrence navigation

Status: needs-triage
Type: task
Depends on: 06
Triage reason: typed search command/result contract follows ticket 06.

## Deliverable

Image-query controls and image results in the shared search UI, with accessible navigation and explicit indexing coverage.

## Work

Extend SearchBar/SearchDock and the notepad search store with choose/paste/drop image input, a query preview, clear/replace/cancel, keyboard actions and focus return. Do not steal editor paste/import events. Scope image drop handling to the search target. Query images do not create vault assets or persist in recent searches/logs; release previews and temporary resources on replacement, cancellation and lifetime changes.

Render image thumbnails through the existing bounded asset loader alongside containing-note context. Revalidate occurrence and asset identity before navigation, then open the current image inventory/viewer at that occurrence. Handle stale locations by refresh/error rather than navigating to old coordinates.

Show text/image readiness, migration and per-image incomplete coverage in Settings/status using normal product language. Image queries explain disabled/unavailable/rebuilding states. Preserve keyword fallback for text queries and the existing transient viewer owner.

## Acceptance

Focused browser/native tests cover image choose/paste/drop, cancellation/racing responses, scopes, keyboard focus, thumbnail loading, stale occurrence navigation, unsupported assets, setup retry and lifecycle cleanup. Existing editor image import/delete/undo and text search flows remain intact.
