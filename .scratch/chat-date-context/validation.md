# Chat date integration validation

Date: 2026-09-30. Baseline: `1c48f66`, which includes date feature `0466937`.

## Implemented contracts

Sends and retries capture current editor locale, numeric Gregorian date order,
hour cycle and IANA timezone. Backend validation precedes chat mutations; the
optional configuration lives only for the run. Parent and research share the
reference timezone and reading semantics, while reviewed edit guidance stays
with the parent. Current conventions never establish old authoring provenance.

Current canonical body reads expose bounded task deadline metadata using the
existing Markdown and annotation parsers. Supported duplicates use first-valid
precedence, children retain independent dates, and completed/undated tasks stay
explicit. Historical reads omit current deadlines. Metadata uses existing access,
freshness, citation and payload checks, and reports clipped, excess or recognized
but unprojectable checkbox lines as incomplete. No new workflow tool, storage
schema, scheduling feature or direct-write authority was added.

## Offline validation

- Initial frontend API regression failed because date context was absent.
- Initial canonical read regression failed because deadline metadata was absent.
- Initial full Rust library suite: **693 passed, 0 failed, 15 ignored** (163.02 seconds).
  A final full run after exact-line metadata and both new regressions also passed;
  **695 passed, 0 failed, 15 ignored**, in **160.36 seconds**.
- Final focused regressions: **3** strict/legacy date-context tests, **1**
  unprojectable-checkbox coverage test, **1** worker prompt isolation test and
  **2** real canonical deadline/budget tests passed after those corrections.
- Architecture fitness: **19 passed**.
- Frontend date context, chat API, editor date commands and task dates:
  **42 passed**. Regional fixtures cover US, British and Japanese conventions.
- `pnpm check`: Svelte **0 errors, 0 warnings**, and E2E TypeScript passed.
- `git diff --check`: passed.

The broader library suite caught repeated explanatory read metadata consuming
an existing prose-evidence budget. The explanation now lives in shared model
instructions and non-task reads omit deadline metadata. The existing window/read
contract module subsequently passed **102 tests**, followed by the full suite
above. Independent Standards review found no actionable defects; Spec review
found the unprojectable-checkbox omission, which was fixed and independently
verified.

## Native model validation

The opt-in `e2e/specs/native/chat-dates.spec.ts` uses an owned disposable vault,
explicit local provider/model configuration and British date order. It checks
current deadline answers, actually delivered research evidence and an exact
pending proposal for `01/02/2027` → `@due(2027-02-01)`. The canonical note must
remain unchanged; children and unrelated text must be preserved. A private
canary checks exclusions, and body citations must resolve.

The first live run passed all three mechanical scenarios in **2m47s**, with
validated worker evidence, resolving current body citations, an exact February 1
proposal and unchanged canonical bytes. Semantic inspection found one error:
the research answer's final summary included the fenced example among open
undated tasks, despite correctly labeling it as non-task code earlier. Shared
reading instructions were tightened to use complete checkbox metadata for the
task inventory and discuss fenced examples separately. A second run passed the
mechanical scenarios in **3m33s**, but semantic inspection still found a fenced
example labeled open in one parent table and inconsistently included in a
research summary. Instructions alone did not resolve that model error.

The read contract was then improved to include exact canonical checkbox text
alongside each deadline/status entry, rather than only byte coordinates. This
uses the existing full-envelope budget; delivery can still be partial. The
canonical read regression verifies each entry's text equals the delivered
excerpt at its recorded coordinates. Final full Rust budget/contract validation passed **695 tests**, with 15 existing
ignored tests, in **160.36 seconds**.

### Final native outcome

The final native suite passed its three scenarios in **2m28.8s** using
`qwen/qwen3.8-27b` through the configured local provider. It ran in an owned
synthetic vault on dev port 1430 and embedded driver port 4447.

Manual semantic inspection confirmed in both direct and research answers:

- Child due September 29 is the only open overdue task.
- September 30 is due today; the parent's first valid October 1 date is tomorrow.
- The parent's duplicate October 7 annotation does not override October 1.
- Four open tasks have no supported deadline: undated child, plain date/time,
  invalid February 30 and inline-code annotation. The fenced example is excluded
  from the task inventory, not labeled open.
- The checked task is completed and not actionable overdue work.

Research delivered validated read evidence; all referenced body citations
resolved, and excluded canary text was absent. The pending proposal resolved
British `01/02/2027` to February 1, consolidated the parent's supported duplicates,
preserved every other line and left the canonical note bytes unchanged.

Local final artifact: `artifacts/native-final.json` (ignored by Git). It includes
an explicit semantic rubric, answers, events and proposal preview. This is one
successful final model sample per scenario, following the recorded earlier
semantic failures; it does not close the broader
[citation/answer entailment follow-up](../chat-reliability/issues/07-citation-entailment.md).

Final binary SHA-256:
`8c084ee3ab186c31861e7d2a63d283d0a624afa340a8aae88d56de8c6ad10b16`.
Final artifact SHA-256:
`e0cd6522a2f67122496c67fa7368bcaa8317a9305d2a91e43927bc147f31a3fd`.

Native startup emitted existing standalone-driver/window-discovery diagnostics;
the configured embedded driver completed the suite successfully. Final E2E
TypeScript and diff-whitespace checks passed.

Initial local artifact: `artifacts/native-baseline.json`. It is ignored by Git.
Passing citation/proposal assertions alone is not a semantic-answer guarantee.

Concurrent user edits in `SlashMenu.svelte` and `blockTypes.ts` were excluded
from this integration's review and left intact.
