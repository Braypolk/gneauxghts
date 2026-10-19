# Chat context visibility

Completed 2026-10-19.

The chat composer shows a context ring and percentage beside the model selector.
The existing Bits UI tooltip exposes used/remaining percentages and approximate
token counts through hover, focus or tap. Unknown model capacity is displayed
without a fabricated percentage. No new dependency was added.

The disposable conversation view reads Pi's public derived active context and
uses Pi AI's public token estimator. It reads capacity from the registered Pi
model catalog. Streaming output contributes an estimate; compaction changes the
active context while paging older transcript messages leaves usage unchanged.
New chat clears the estimate and reopening rebuilds it from Pi. There is no
second persisted context or usage owner.

Validation: `pnpm check` passes; 52 focused conversation-view, context-display
and chat-progress tests pass. The headless `chat-context-usage.spec.ts` browser
check passes for hover/tap/Escape, a 600px dock and New chat reset. Its narrow
layout screenshot was visually inspected. Native/provider execution was not
changed or rerun for that initial UI slice; token counts are estimates, not
tokenizer-exact measurements.

## Persist last-known local capacity

Completed 2026-10-19 following the unloaded-model report. Native `ChatDomain`
now persists the last positive loaded context window per normalized local base
URL and exact model ID in its existing configuration database. Unloaded,
unavailable, ambiguous or invalid metadata preserves the last observation.
Fresh loaded metadata replaces it, including a smaller configured window.
Advertised maximum context length is never substituted for observed capacity.

The existing native model-configuration command returns this retained value to
Pi. Successful local responses now refresh metadata even when capacity is
already known; concurrent responses for one model share a pending refresh.
The refreshed resolved model reaches the next Pi compaction decision and the
mounted context indicator before terminal delivery. Discovery remains bounded
to two seconds, and failed discovery leaves an otherwise valid answer intact.

Validation: 106 focused frontend tests, nine native transport tests, two retained
configuration tests, all 19 native architecture checks, 42 support tests and
`pnpm check` pass. Real SQLite tests verify retention across database-owner
recreation, server/model isolation, invalid/unavailable observations and smaller
replacement capacity. Three background native WebKit integration journeys pass:
unload/reload updates the actual mounted indicator from 32.8K to 65.5K; standard
threshold compaction retains human history and continues; Stop joins background
compaction. These use a deterministic HTTP model fixture, not live-provider
inference. Existing saved chats learn a capacity after their first successful
loaded-model observation with this implementation.
