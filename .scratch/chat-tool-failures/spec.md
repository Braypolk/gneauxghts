# Chat tool failure diagnosis

Investigate the recent activity/follow-up chat and make recoverable tool failures actionable to the agent and visible in the existing durable activity log. Keep arbitrary internal errors redacted. Do not relax note access, historical evidence validation, or citation admission.

## Evidence

Read a temporary snapshot of the production chat database; no production writes or new provider requests. The September 29 evening activity run issued 36 tool calls. It discovered ten notes, read passages successfully, then repeatedly failed searches and reads. Saved tool errors contained only “Could not complete this action”. Successful reads displayed zero notes despite delivered passages. Research diagnostics separately recorded `unread_selection`: eight selections, zero read or delivered passages.

Earlier attempts independently failed before tool execution with a local-provider connection error and a secure credential storage error. These are distinct from retrieval/access failures.

## Confirmed causes

Rig 0.41 normalizes custom tool errors via `ToolExecutionError::from_error`, which redacts their model feedback. Our tools used that default for application-authored validation and recovery messages. The activity summarizer additionally looked only for JSON messages and discarded text error feedback. The new read contract omitted the legacy `notesRead` field, which the summarizer defaulted to zero.

## Changes

All registered application capabilities pass through one error adapter. Exact known application errors receive safe recovery feedback; unexpected OS/provider/dependency diagnostics stay redacted. The existing durable activity summary reads safe text feedback, counts distinct delivered note IDs, and describes incomplete delivery. No new log of raw arguments, note contents, or provider diagnostics is introduced.

## Limits

The old traces cannot recover discarded error reasons or reconstruct the original tool arguments. Historical-search mode mismatch and evidence-budget exhaustion remain plausible explanations for individual calls, not proven diagnoses. New feedback allows correction and makes a repeated failure diagnosable. A fresh app run is required to verify the original provider/user-data scenario.
