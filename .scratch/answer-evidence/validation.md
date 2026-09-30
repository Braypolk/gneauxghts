# Answer evidence validation

## Result

Removed the composer preview toggle, `/sources` dispatch, restricted preview tool
set, alternate prompt/history/streaming behavior, clause-selection JSON contract,
and its terminal renderer. Source/quotation requests now use ordinary chat.
Historical message text and saved citation destinations remain unchanged.

Show evidence reuses the existing answer disclosure. It shows delivered excerpts
as escaped literal text, distinguishes current passages from historical additions
and removals, shows recorded time evidence and uncertainty, and warns that the
selection may not cover all relevant evidence. Opening this disclosure requires
no model call. Existing note/revision navigation remains in its existing owner.

The exact excerpt equality check now applies to every read-reference admission.
The evidence panel uses validated passage bytes rather than model-written quotes;
this does not establish the semantic correctness of the model's answer.

## Checks

- Rust chat/citation suite: 64 passed, 0 failed; 1 existing opt-in ignored.
- Frontend evidence/message/Markdown/navigation tests: 44 passed.
- Architecture fitness: 19 passed.
- Svelte check: 0 errors and 0 warnings; E2E TypeScript check passed.
- Focused browser integration: passed. Verified no preview composer control,
  expansion/collapse with the exact source excerpt and historical label, no new
  chat-send invocation, and revision navigation with workspace restoration.
- `git diff --check`: passed.

Native scenarios now use ordinary requests and natural-language evidence requests.
They retain semantic rubrics, citation resolution and exclusion checks. Live model
answer quality was not re-evaluated in this change; the earlier native startup
blocker remains tracked under `.scratch/evidence-contracts/issues/02-native-activity-evaluation.md`.

Changes remain uncommitted and preserve the earlier capability/evidence work.
