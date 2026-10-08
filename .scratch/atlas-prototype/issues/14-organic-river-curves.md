# Organic Atlas curves with gradual branching

Status: ready-for-human
Type: task

## Request

Try the river-network approach: broad natural curves, gradual highway forks,
landscape-aware paths and stable geometry as strength changes.

## Change

The existing routing module keeps its public interface. A bounded elastic-string
relaxation minimizes sideways bending and stretch with endpoints pinned,
forward positions ordered and cloud-clearance constraints. A global natural
cubic-spline solve supplies continuous first and second derivatives; shared
junction tangents are clamped so branches peel away smoothly. Candidate scoring
considers actual curve length, bending and note/title costs. Cloud bounds are
cached to keep relaxation inexpensive.

When a natural spline cannot retain obstacle clearance, existing validated cubic
bends remain available. Extreme sideways branches use direct routes instead of
sharp highway hooks. Geography, scores, authored-link visibility and the
camera-independent route cache retain their existing behavior. No random
perturbations or animation were added.

## Verification

All 45 Atlas unit tests and 18 map browser tests pass. New sampled-curve checks
verify continuous geometric curvature through a branch, nonzero broad bending,
forward progress and modest route length. Existing checks cover obstacles,
shared junction tangent alignment, cache stability, unlimited authored edges,
full-path highlighting, strength changes and zoom. Type checking reports zero
errors/warnings and the production build passes.

Read-only measurement against the 166-note cached vault: eleven qualifying
routes, two shared highways, approximately 30 ms initial computation, 0.3 ms
cached and 41 ms to add the other 68 routes. Sampled qualifying curves showed no
backward progress; maximum travel/direct-distance ratio was approximately 1.009.
These are local computation measurements, not native WebKit frame timings.
The temporary benchmark was removed. Live browser verification inspected the
updates-for-Kylie neighborhood at overview and closer zoom, including the
analytics and image highway branches.
