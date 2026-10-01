# Verify that cited passages support the associated claim

Status: needs-triage
Type: task

## Evidence

`../artifacts/native-citation-mismatch.json` contains a complete temporal answer that cites a
canonical note title for the claim that “Experimental pilot idea.” was inserted
within the requested interval. The cited title is valid and resolvable, but its
text does not establish that claim. The other body sources support current
completion, supersession and cancellation status. Citation validity alone is
not a semantic quality gate.

## Next step

Add model-independent fixtures for claim-to-passage support and an evaluation
rubric that checks source location, quoted text, and historical attribution.
Measure a narrowly scoped citation instruction or verification step against
those cases and multiple live answers; avoid hard-coded workflow responses.
The UI test now selects a cited current body passage for exact highlighting,
while title/property citations retain their legitimate navigation behavior.

## Further evidence and bounded correction

The complete native journey in `../artifacts/native-discovery-only-research.json` passed the
original execution checks, but its research answer quoted retained-change search
previews without reading any historical passages. Its cross-note follow-up also
added an unsupported “pilot was running” narrative despite correctly reporting
current commitments. Shared capability instructions now distinguish discovery
from read evidence, require claim-supporting passages, and prohibit inventing
folder filters from topic names. The research E2E assertion now requires a read,
cited historical passage. General semantic entailment still needs evaluation.

## Comments

2026-09-30: The intermediate structured-worker run
(`../artifacts/worker-structured-final.json`) rendered September 30 as September 9 and
attributed a related vendor preview after the shared allowance prevented its
body read. Earlier failed output also exposed internal failure fields. The
final worker run reads and cites both current bodies and renders the interval
correctly, but this fixture does not resolve general semantic entailment.
See [worker validation](../worker-validation.md); this issue remains open.

2026-09-30: Chat date integration live runs also demonstrated a resolvable body
citation paired with an inconsistent classification of a fenced-code example
as open/undated work. Shared instructions alone did not resolve it in the first
repeat. Exact checkbox text was added to canonical parsed deadline metadata;
the final parent and research samples classified the fixture correctly. See
[date validation](../../chat-date-context/validation.md) for failed/intermediate
and final artifacts. General semantic evaluation remains open.
