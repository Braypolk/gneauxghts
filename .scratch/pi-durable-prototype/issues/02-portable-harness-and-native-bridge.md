# Run Pi-owned sessions through native desktop and iOS bridges

Status: resolved
Type: prototype
Blocked by: 01

Follow [the spec](../spec.md). Pin Pi Durable/AI/Chord 1.3.0 and implement an opt-in app path with Pi as the sole session/task owner. Provide asynchronous native SQLite transactions with rollback/commit semantics, native secure provider transport, committed-state projection and a small Durable notes extension. Avoid dual-writing generic state to ChatService.

First verify open/submit/read state/reopen through actual desktop webview and iOS WKWebView. Then demonstrate streamed conversation/follow-up, cancellation, a scoped read with admitted evidence, and both existing provider protocols through synthetic HTTP fixtures. Inspect request bodies for history/system/tool correctness without secrets. Do not begin broad proposal refactoring until native storage portability is established.

Acceptance: real native bridge evidence on desktop and simulator, durable session recovery, one read/citation, provider compatibility/cancellation and no second tool loop. Record any upstream/adapter limitation and proceed with independent work; issue 03 depends on a viable bridge.

## Comments

## Answer

The portable 1.3.0 harness owns native SQLite sessions on desktop and actual simulator WKWebView. Both native HTTP provider protocols pass streamed output, split tool arguments, scope-aware read/citation bindings, follow-up, cancellation, partial stream failure and relaunch. See [validation](../validation.md) and selected evidence. No Pi session/run is mirrored into ChatService. The native bridge is viable for issue 03; full structured-answer UI admission remains part of the integration checkpoint.
