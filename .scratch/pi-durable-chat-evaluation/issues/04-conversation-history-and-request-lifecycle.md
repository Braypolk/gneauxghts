# Restore ordinary conversation and durable request behavior

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 02, 03

Follow [the spec](../spec.md), ADR 0009 and request/interruption invariants. The
provider drops every earlier assistant/tool message, breaking source-free follow-ups.

## Work

- Preserve source-free dialogue under ordinary history limits. Omit earlier
  note-grounded prose/raw evidence according to domain policy while retaining
  authored questions and safe continuity metadata; retrieve fresh factual evidence.
- Project committed Pi state into normal conversation/message/configuration UI and
  correlated streaming, tool activity, plans, usage, terminal/error events. Retain
  timestamps/order and read-source activity through relaunch.
- Make admission/terminal success durable units. Preserve acknowledged ordinary
  partial text; keep structured drafts/sources provisional until final validation.
- Support Stop/Retry, exact durable retry context, traceable continuation, session
  switching and interrupted startup without implicit inference replay.
- Replace hard 1,000-record scans with correct paging/iteration where needed and
  release listeners/resources when their owner retires.

## Acceptance

- “Expand your second point” works for source-free dialogue after switching/
  relaunch; earlier note evidence never becomes fresh authority.
- Stop, partial stream, failed admission/terminal persistence and termination give
  correct durable/visible states without duplicate accepted turns or false success.
- Retry after newer turns uses the original admitted input/context and preserves
  interrupted output. Startup makes zero unrequested network calls.
- Concurrent sessions cannot cross-deliver text, sources, activity or Retry.
  Reopened activity/usage contains neither secrets nor hidden reasoning.
- Histories beyond 1,000 submissions remain reachable in order; repeated switching
  does not accumulate watchers. Long-context compaction follows in 09.

## Starting points

`src/lib/prototypes/pi/{chatApi,nativeProvider,notesExtension}.ts`, ChatController/
event contracts and native request/answer admission seams.

## Comments
