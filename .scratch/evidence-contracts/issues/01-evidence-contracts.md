# Implement reliable evidence and read contracts

Status: resolved
Type: task

Implement the [plan](../spec.md) through the existing EvidenceSession, NoteTimeline and agent runtime seams. Preserve the earlier composable-capability changes in the working tree.

## Comments

- Started with the observed failure in “Find last week’s follow-ups”: plausible current tasks were attributed to last week's activity without querying passage history. That run used Codex filesystem tools, not the app runtime.


## Answer

Implemented the evidence/read contract plan and the user-approved retained-history
policy. [Validation](../validation.md) records the passing backend, frontend and
architecture checks. The native model scenario is implemented but answer-quality
validation could not run because the native test app did not expose a working
invoke bridge; [issue 02](02-native-activity-evaluation.md) records that remaining
validation work. Changes remain uncommitted for review.
