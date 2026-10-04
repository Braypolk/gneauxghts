# 99c-task-date-passage-contract

Status: ready-for-agent
Progress: complete
Finding: Sol frontend-editor.md unnumbered P2 task-date metadata supplement
Owner: editor agent, root-authorized ledger follow-up

## Evidence and plan

`passage_task_dates` is an evidence response boundary distinct from canonical date editing. Existing shared fixture proves authored date behavior and one test proves unprojectable checkbox completeness; successful JSON output, clipping and cap boundaries remain untested. Add compact production-function tests for completed/effective dueDate/null values and exact UTF8/CRLF byte offsets, fully included versus clipped lines,16versus17 tasks with incomplete flag, and no eligible markers. Preserve real parser/canonical identity behavior. No production rewrite is presumed.

## Validation

Only focused services::task_dates::tests; root owns final native/build integration. Fix production only if these external-contract assertions expose a defect.

## Outcome

Added three compact production-function contract tests; all nine task-date tests pass in0.01s. Exact JSON covers completed/open tasks, first effective due date versus duplicate later annotation, dueDate:null, UTF8 byte offsets and CRLF-excluding end positions. Full-content boundaries succeed without CRLF; clipped start/end omit partial lines and mark incomplete while retaining another complete line.16items remain complete,17items cap at16 and mark incomplete. Empty/prose/fenced/inline examples and empty range return null. No production defect was found; implementation retained. Log: ../semantic-validation/task-date-passage-final.log.
