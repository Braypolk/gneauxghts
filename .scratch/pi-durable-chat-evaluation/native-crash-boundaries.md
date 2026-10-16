# Native command and transport crash gate

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

Prepared command for the native lease owner, after rebuilding the normal `/`
entry binary with `pi-prototype,e2e-wdio`:

```sh
env -u PI_PROTOTYPE_DATA node scripts/pi-prototype/native-crash-gate.mjs
```

The gate always allocates generated roots, refuses occupied ports, retains native
and frontend logs, and runs both local-compatible and Responses protocols. It
uses the actual workspace composer, exact-message Retry, proposal Review and Keep
controls. Conversations are created through the Pi API. Each boundary/provider
pair has its own root and explicit scope nonce; no private evaluation root or
credentials are accepted.

Native faults require all of: `e2e-wdio` compiled in, native interactive fixture
activation, an explicit IPv4 loopback provider fixture, the exact requested
boundary, and its scoped `PI_E2E_CRASH_<nonce>` marker in the relevant title or
current user input. A synced bounded native receipt precedes exit code 86.

| Boundary | Exact observation |
| --- | --- |
| `prepared-review` | Native preview has been prepared, but command reply/tool outcome has not reached Pi |
| `transport-completed` | Native HTTP stream reached EOF; ordinary partial events were delivered but protocol terminal events were withheld before Pi can persist completion |

The terminal fixture holds network completion until the driver observes both
visible text and Pi's partial projection, then explicitly releases the provider
stream. This is a transport observation, not an upstream runtime hook or an
inferred failed Pi transaction. The crash build does not change authorization,
provider choice, production completion ordering or ordinary SSE forwarding.

After restart without crash flags, the gate requires no provider requests before
an explicit Retry, an interrupted durable turn, and retained ordinary partial
text for the transport boundary. Retry must send the same original user/context
and model; expected inference/tool-continuation counts are exact. Prepared-review
Retry stages one proposal. Normal Keep plus duplicate Keep must return the same
Note Identity; read-only SQLite/filesystem verification requires one effect,
one canonical ordinary file, and one NoteTimeline publication receipt. Managed
chat transcript projections are excluded from ordinary-file effect counts.

Receipts live in `native-crash-gate.json`, per-case screenshots, native logs,
and `PROTOTYPE-wipe-me/e2e-crash-<boundary>.json`. A missing crash, mismatched scope,
unexpected terminal state, automatic replay, altered Retry, duplicate effect or
fixture contract error fails the gate. Pure provider planner tests pass four
checks; native execution remains the root orchestrator's responsibility.

This adds no iOS or live-provider claim. Run the separately prepared real SQLite
fault phase last; existing publication crash gates retain their after-intent,
after-publication and after-receipt checks.
