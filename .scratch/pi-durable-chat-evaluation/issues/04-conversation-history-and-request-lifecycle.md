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

### 2026-10-15 lifecycle implementation (ticket04_lifecycle)

- Input entry metadata is admitted in Pi's submission transaction and retains authored input, safe prior history, exact model/reasoning/service tier/local endpoint/capabilities, original canonical selected-context proof, wall-clock timestamp and Retry lineage. Retry resolves the original submission directly, preserves interrupted output and uses its frozen history/settings/context after newer turns; credentials remain native.
- Source-free assistant/tool dialogue survives ordinary eight-turn history limits. Prior note-grounded assistant prose/raw tool evidence is omitted, and earlier assembled app context is replaced by the original authored question. Source-free output uses Pi committed partials; structured note output remains provisional until mandatory final admission.
- Projection pages conversation/submission/entry scans in batches of 128 without a 1,000-record cap, retains actual timestamps/order, reconstructs tool/plan/usage events from committed Pi entries and read/permission activity from per-request EvidenceRun documents, and revalidates source destinations. Terminal/reopened permissions become cancelled and stale live decisions are refused.
- Event/doc watchers exist only for active requests and are stopped at terminal/close, with attachment/retirement races guarded. Read-only reopen leaves Pi scheduling paused; no launch inference permission is reconstructed.
- Integrated ticket03 frozen native admissions, ticket05 context/evidence/permission helpers, ticket06 review helpers and ticket07 deterministic Save/origin helpers. Permission identity is derived by ticket05 inside its tool transaction from Pi's atomically admitted LiveDoc run input, avoiding a post-submit identity race.
- Validation: focused lifecycle/API/provider/evidence/Save suite passes 39 tests across five files. New behavior checks include >1,000 ordered records, failed atomic admission, original Retry snapshot after newer turns, real Harness slow-stream Stop retains acknowledged partial text and Retry after a newer turn preserves that output and original history, source-free follow-up after switching/reopen with exact timestamps and zero unrequested inference and zero retained event watchers through repeated switches, canonical app context omitted from authored-question replay, and unsupported-capability isolation. TypeScript reports no errors in the modified API/lifecycle files.
- Native crash/partial persistence faults, resource measurements, live providers and actual desktop/iOS UI acceptance are still pending orchestrator acceptance; no native/app/provider commands were run by this agent.
