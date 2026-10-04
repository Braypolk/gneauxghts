# Independent UI Standards review — issues 04, 06, 07

Status: ready-for-agent
Progress: Review complete; both findings corrected and independently reread; owner final regression run 43/43 passed.
Reviewer: audit_agent

## Scope

Compare current source to `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-architecture-baseline-eaf0pf9r`, not Git HEAD. Inspected controller.svelte.ts and its aggregate machine, ChatComposer/ChatPanel integration and draft persistence, AppStore/settings store operations, and Atlas activation/refresh/disposal. Standards sources: repository code-review/codebase-design skills, CONTEXT, ARCHITECTURE owner map, behavior invariants, and issues04/06/07. This is independent Standards/correctness inspection, not a rerun of all UI tests. No reviewed source edits by reviewer.

## Findings

### P2 — activation still presents a retained Map as fresh during visibility/bootstrap awaits (issue07; corrected)

`atlasStore.svelte.ts:#initialize` awaits `#loadChatVisibility()` and `appStore.bootstrap()` before setting `isStale = Boolean(this.response)`. After deactivation with a ready response, reopening can therefore render the retained graph with `isStale=false` and `isLoading=false` for the entire settings/bootstrap delay, despite detached observation listeners during inactivity. The issue07 invariant is stale-on-activation followed by backend revalidation. Set stale at activation before either await, and cover a deferred visibility request rather than only deferred graph loading. Sent to UI owner.

### P2 — retaining only the latest terminal request permits older events to be admitted again (issue04; corrected)

`controllerMachine.ts:transitionRequest` rejects an idle terminal/started event only when its ID equals `lastTerminalRequestId`. Trace: complete R1, complete R2, receive duplicate completion for R1. The event is accepted, its old conversation summary can replace the newer count/preview, and the completion effect fires twice. A delayed delta/source/agent event for R1 takes the same idle-to-started path and can resurrect a completed run as streaming. Immediate-duplicate and stale-terminal-while-another-run-is-active tests do not cover this idle-after-two-runs ordering.

The aggregate retains terminal messages, so use that existing durable correlation at backend admission to reject retired events without a separate unbounded request cache. Preserve legitimate new retry-message identities and started-before-receipt handling. This is a traced retained weakness in the former idle bypass that the new aggregate must close; no pre-change executable failure is claimed by reviewer. Sent to UI owner.

## Standards assessment

The aggregate now owns admitted conversation, proposals, lifecycle/selection/request state and its projected flags. Controller effects dispatch complete domain results rather than separately patching request flags and conversation fields. Selection and configuration revisions live with the aggregate; named selection completions reject retired operations. The small metadata event excludes conversation/proposals/request flags and is not a replacement universal state patch API. Native adapter and specialized agent-event reduction keep their existing purposes.

First send creates and admits the durable conversation inside the controller. Composer promotion uses explicit draft identity, preserving unsent text when durable creation succeeds but sending fails; the public create-then-send protocol and effect-timing flag are removed. Root's two reentrancy findings were reread in source: send retains the created conversation/selection identity and checks it after admission, and completion effects read the state admitted for that event rather than a later subscriber-mutated selection.

AppStore owns settings-view invoke/admission and next-launch selection staging, with private per-slice revision tokens. Settings receives only its local diagnostics and re-reads shared admitted state; its lifecycle and write/history operation guards remain. Atlas owns complete backend/local cache clearing. A stage-only vault change compares Running Vault identity and does not discard the graph. Refresh sequence/lifetime, one-in-flight coalescing, visibility and search invalidation remain; backend generation compatibility is authoritative once activation completes.

Full smell baseline applied: no additional actionable Mysterious Name, Duplicate Code, Feature Envy, Data Clump, Primitive Obsession, Repeated Switch, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chain, Middle Man or Refused Bequest finding. The aggregate's private projection helpers and narrow event switch own real invariant work; replacing them with a generic event/policy framework would increase caller burden. The remaining findings concern actual stale admission, not file size or formatting.

## Readiness

No remaining actionable finding in the bounded Standards review. Coordinator owns full frontend, E2E typecheck and browser/native acceptance. No claim of live-provider or optional native measurement execution.

## Correction reread

Atlas `initialize` now marks any retained response stale synchronously before starting asynchronous visibility/bootstrap admission. The expanded test delays visibility itself. Backend chat admission now checks the retained message at the event's message ID and rejects matching request IDs whose message is completed/cancelled/error, before the request transition. This covers delayed terminal, delta, citation and agent-event channels without another retired-ID cache. The regression completes two requests then replays the older terminal and delta, asserting unchanged conversation identity, idle state and exactly two completion hooks. Reviewer reread these corrections; owner reports focused287 passed before the final added delta assertion, with final rerun pending. No remaining source-level actionable finding.

Final follow-up: owner reports `.scratch/architecture-simplification/ui-review-regressions.log` **43/43 passed**, including the older terminal/delta replay and a legitimate retry reusing a message ID. Reviewer reread `upsertTerminalMessage`: when request identity changes it materializes the new durable message rather than retaining prior request/run provenance; same-request terminal delivery still preserves streaming evidence. This keeps the new retired-event guard effective after retry. No reviewed source edits by reviewer.
