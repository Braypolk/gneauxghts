# Evaluation and release gates

Status: needs-info
Updated: 2026-10-06
Blocked by: 03, 05, 06, 07

## Scope

Complete official-framework and quantization parity, fixed judged text/chat/Related Notes/Atlas and cross-modal quality evaluations, screenshots/small text, actual resource/device measurements, migration/source/race/security contracts, and browser/native navigation/cancellation tests. Retain Jina if any gate fails. The initial comparison already failed text top-one and MRR regression gates; do not treat passing basic image fixtures as release approval.

## Implementation state

Implemented reproducible text/image controls, native parity/resources/migration probes, visual screenshot/diagram/chart/small-text fixtures, ANN benchmark, deterministic contracts, and focused browser checks. Local implementation validation is recorded in the report. Broader corpus, official BF16/FP32 parity and other-platform validation remain unresolved; the tiny text quality regression remains documented.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
