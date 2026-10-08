# Select connections by strength, without a count limit

Status: ready-for-human
Type: task

## Request

Base visible connections on their strength rather than a fixed number. Hard
(authored wikilink) connections must not be limited.

## Change

Keep every authored connection. Keep every semantic connection whose published
strength is >= max(0.7, 0.9 * strongest semantic strength for this note). The
absolute floor rejects weak neighborhoods; the relative floor removes weaker
tails on hubs. The ratio is a tuning choice on existing ranking weights, not a
probability/confidence claim. The count is unbounded, including equal-strength
ties. Authored connections do not affect the semantic cutoff. Duplicate edges
to the same neighbor still collapse to one authored edge.

Removed the seven-edge budget, discovery hash and selection counter. Selection,
hover and camera changes now reuse the same connections until response scores
change. The graph, labels, emphasis and relevance-ordered reader still share
one policy. This replaces the earlier optional variance request with selection
based solely on connection strength.

## Verification

Six unit scenarios cover strength-filtered hubs, thirty equal-strength semantic
ties, thirty weak authored links plus a strong semantic link, duplicate collapse,
missing/self/nonfinite links, relative strength tails and the absolute floor on
sparse notes. The browser journey checks more than seven qualifying connections,
graph/label/reader agreement, stable zoom/reselection and authored-link priority.
All six unit tests and fifteen map browser tests pass. Type checking reports
zero errors/warnings, and the production build passes. The production selector
applied to the cached screenshot note returns 11 of 79 candidate connections.
