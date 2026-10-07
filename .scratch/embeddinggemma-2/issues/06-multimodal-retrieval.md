# Scoped typed multimodal retrieval

Status: ready-for-human
Updated: 2026-10-06
Blocked by: 05

## Scope

Add typed text/image queries and passage/image results. Search both compatible vector corpora; retain lexical text retrieval and fuse channel ranks independently. Apply eligibility/scope/source validation, repeated occurrence limits and judged modality admission. Keep text evidence APIs canonical; image hits are not quotations or proof of pixel inspection.

## Implementation state

Implemented typed text/image search, independent rank fusion, scoped candidate admission and current-source checks, repeated occurrence limits, and modality-specific floors evaluated against constructed positives/hard negatives. Text agent evidence remains canonical. Broader judged quality remains a validation limit.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
