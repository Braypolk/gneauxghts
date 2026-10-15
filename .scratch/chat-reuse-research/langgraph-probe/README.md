# LangGraph browser feasibility fixture

Research only, 2026-10-15. Uses published `@langchain/langgraph@1.5.0`, resolved `@langchain/core@1.2.18` and checkpoint `1.2.0`; transitive versions are retained in `package-lock.json`. No models, credentials, native bridge, or production dependencies.

Copy this directory to a temporary directory and install with `npm ci --ignore-scripts --no-audit --no-fund`. Use a separately installed Chromium via `CHROMIUM_PATH` if the recorded local executable is absent. Run `node run.cjs` for the standard dynamic interrupt attempt and `node run.cjs --static` for the bounded static alternative. A loopback-only HTTP server provides a browser origin; the server and browser close after each run.

Observed:

- Browser bundling succeeded without Node polyfills.
- Standard dynamic `interrupt()` failed: `Called interrupt() outside the context of a graph.` Installed core falls back to MockAsyncLocalStorage, whose `getStore()` returns undefined. No custom context shim was added.
- Static `interruptBefore: ['commit']` passed: pending node `commit` restored after reload; edited approval produced `human edited draft`; rejection produced `rejected`; simulated effect count was 1. Unminified fixture bundle was 2,820,970 bytes; this is not a production bundle-size comparison.
- Official docs recommend dynamic interrupts for human approvals and discourage static breakpoints for that use. Therefore the second pass is feasibility evidence, not a recommendation to ship a static-breakpoint approval protocol.

The localStorage saver serializes MemorySaver implementation fields solely for this experiment. It is neither a supported production checkpointer nor a recommendation to persist real vault data in localStorage. The effect uses a toy receipt key; no crash-after-effect fault was injected and no exactly-once guarantee is established. Real native SQLite transactions, checkpoint errors, multiple concurrent runs, provider transport, cancellation and WKWebView/iOS termination remain untested.

Sources: [web environments](https://github.com/langchain-ai/langgraphjs/blob/main/examples/how-tos/use-in-web-environments.ipynb), [interrupt semantics and static-breakpoint guidance](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [upstream browser test context shim](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/browser.ts). The last source is a test helper, not evidence that an ambient single-store shim safely isolates overlapping asynchronous runs.
