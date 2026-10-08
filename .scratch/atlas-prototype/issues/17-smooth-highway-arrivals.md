# Remove sharp arrivals into shared highways

Status: ready-for-human
Type: task

## Request

Fix the hard corner in the reporting-cloud approach from ai initiatives.

## Diagnosis

Branches required a natural spline with matching tangent and zero curvature,
but incoming trunks could still use the older cubic fallback. After avoiding
onboarding, that fallback squeezed the reporting trunk's final direction change
into a very short segment. The branch matched the endpoint tangent while the
approach immediately before it still formed a sharp hook.

A read-only probe reproduced this on the published vault. A smaller three-note
fixture with an intervening cloud reproduced excessive arrival curvature
(approximately 0.144 world units inverse) through the public routing interface.

## Change

Either constrained end now requires the natural spline: the older fallback is
available only to independent routes. If the central cloud approach cannot
support a smooth arrival, the router tries a bounded set of nearby approaches
around the destination silhouette. It tries these with cloud avoidance first,
before allowing unrelated-cloud crossings. Fixed geometry determines the
gateway independently of visible link order; failed searches are cached.

The actual destination still passes forward-travel and shallow-fork checks.
If no smooth gateway works, the connection routes independently rather than
forcing a sharp shared join. Dot clearance and authored link visibility remain
unchanged.

## Verification

The new geometry regression failed before the correction and now passes while
retaining a shared highway and avoiding the intervening cloud. All 49 Atlas
unit tests and 19 map browser tests pass. Type checking, the production build
and diff whitespace checks pass. Temporary probe code was removed.

The live ai initiatives neighborhood retains 27 visible connections and ten
shared sections. Sampling its full routes found a minimum unrelated-dot gap of
about 6.84 world units and no backward steps. Maximum sampled endpoint curvature
across the shared sections was approximately 0.000034. The reporting approach
was also verified visually in the live map.
