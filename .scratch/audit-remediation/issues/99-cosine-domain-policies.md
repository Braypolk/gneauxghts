# 99-cosine-domain-policies

Status: ready-for-agent
Progress: complete
Findings: Sol AA-14 numerical half
Owner: editor agent, root-authorized ledger follow-up

## Evidence and policy

similarity.rs uses exact-zero f32 norms; atlas.rs duplicates cosine with squared-norm EPSILON rejection and clamping. Both admit NaN/infinite output for non-finite vectors; finite huge values can overflow f32 arithmetic. Tiny retrieval vectors can underflow to zero despite a valid direction. Retrieval ranking and stored edges need finite bounded scores; Atlas geometry must not receive NaN distances. Existing Atlas near-zero centroid rejection is intentional conservatism and will remain distinct from scale-invariant retrieval.

## Plan

Share arithmetic behind named retrieval and Atlas entry points. Preserve Atlas squared-norm epsilon floor; retrieval rejects only genuinely zero vectors. Accumulate finite f32 input in f64, reject empty/dimension mismatch/non-finite components to neutral0, clamp finite result to[-1,1]. Add explicit independent policy tables for empty/mismatched/zero/tiny/subnormal/nonfinite/ordinary/opposite/huge inputs; preserve Atlas grouping, ANN, ranking and edge fixtures. No model catalog changes.

## Validation

Focused numerical and full semantic module tests; record remaining platform/native ownership accurately. Update AA-14 ledger/report links. Correct AA-10 bookkeeping to implemented real evidence composition/issue61 without changing production evidence code.

## Outcome

Implemented shared finite f64 arithmetic behind named `cosine_similarity` retrieval and `atlas_cosine_similarity` geometry policies. Atlas squared-norm epsilon rejection remains; retrieval handles nonzero tiny/subnormal vectors scale-invariantly. Both reject nonfinite/invalid input with neutral0 and clamp scores to[-1,1]. Pure policy tables cover requested boundaries independently. Atlas callers use the explicitly named policy; no model catalog edits. Full semantic module validation:123passed,2ignored,1.71s; existing Atlas geometry/ANN/edge fixtures remain green. Log: ../semantic-validation/semantic-numerical-final.log. Atlas module extraction proceeds independently under99b; root owns final combined/native rebuild.
