# Support normal provider settings and model switching with Pi

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 02

Follow [the spec](../spec.md). The harness registers one model ID per provider on
open despite the UI exposing normal native settings/catalogs.

## Work

- Use existing compatible/Responses configuration, catalogs, capability checks and
  draft/conversation settings. Honor supported reasoning/tool options rather than
  advertising ignored controls.
- Resolve/register models when configuration changes without losing Pi history.
  Freeze admitted routing/configuration so in-flight changes cannot alter a tool
  continuation; later turns adopt deliberate changes.
- Keep credentials/endpoints native and configure the separate namespace through
  normal settings. Do not silently export ordinary-app secrets to JavaScript or
  fixture requests.
- Preserve single-opening-system-message compatibility, SSE/tool argument assembly,
  deadlines, cancellation and explicit failures. Native dispatch is one inference;
  Pi owns sequencing/retry policy.

## Acceptance

- Both protocols pass native fixture checks with multiple models, switching
  before/after turns and after relaunch. A turn keeps its admitted configuration.
- Missing credentials, unknown models, endpoint failures and unsupported options
  are explicit with no false completion. Stop terminates native work.
- Bounded live smoke tests with existing providers show normal UI setup and a
  response; document exact external prerequisites. No new service integration is
  in scope. Broader live journeys are 08/12.

## Starting points

`src/lib/prototypes/pi/{nativeProvider,chatApi}.ts`,
`src-tauri/src/pi_prototype_transport.rs`, `secrets.rs` and model/settings services.
Use pinned APIs; document any justified version change.

## Comments

### 2026-10-15 — provider implementation, native acceptance pending

- Pi AI/Durable remain pinned at 1.3.0. Verified the installed provider/model
  APIs and real Responses/Chat Completions SSE parsers locally; the model registry
  now accepts refreshed model selections rather than binding one ID on open.
- Explicit Send/Retry admits one native configuration snapshot. An opaque
  process-local token retains endpoint, credential, model, reasoning mapping,
  service tier and capability choices through Pi tool continuations. Credentials
  are never serialized; synthetic fixtures skip secure-storage reads entirely.
  Explicit Retry may restore its persisted nonsecret endpoint/capabilities after
  restart while obtaining credentials only from the Pi app's native namespace.
- Native transport performs one SSE inference per dispatch, with no native tool
  loop or retry. It validates the admitted model, compatible opening-system
  contract and supported options; bounded connection/response/deadline failures
  remain explicit. Cancellation can precede dispatch; restart cancels and joins
  native work before storage closes. Policy changes cancel active dispatches.
- The provider boundary invokes mandatory evidence validation before dispatch
  and final admission. Ordinary source-free text can stream once; structured
  answers stay provisional until admitted. Forwarded messages omit thinking.
- Validation: `pnpm exec vitest run src/lib/prototypes/pi/nativeProvider.test.ts`
  passes 13 focused tests (both protocols, fragmented SSE/tool arguments,
  multiple models, stale admissions, ordinary streaming, policy failure,
  endpoint snapshot argument, abort before headers and explicit connection
  failure). `svelte-check` reported no errors in this ticket's files; its latest
  remaining error was in the concurrent evidence implementation.
- Prepared native tests in `pi_prototype_transport.rs` for both protocol config
  mappings, endpoint changes, mismatched model/tools, fixture isolation and
  restart cancellation/join. `providerProbe.ts` and the direct native probe now
  cover fixture admissions, unknown model/options, switching to a second model,
  relaunch/history retention, cancellation and partial-stream failure. The root
  orchestrator owns native build/app/simulator execution; these native checks
  have not yet been run for this change.
- Live smoke remains unverified. The separate Pi namespace had no configured
  credentials at the authorized metadata check. The user must configure Pi
  Settings explicitly; no ordinary-app keys were read/copied and no live
  provider requests were made by this implementation agent.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Frozen native provider routing and model refresh are integrated. Matrix **D** records normal model/protocol checks, **P** compatible and Responses prepared subsets, and **M** normal Settings with configured local inference. The earlier unconfigured-namespace/live-unverified comment is historical for that checkpoint.

The final both-protocol matrix remains open. Hosted live is explicitly user-deferred; synthetic Responses results do not establish hosted live. See the [current validation matrix](../validation-matrix.md) for exact artifact and coverage limits.
