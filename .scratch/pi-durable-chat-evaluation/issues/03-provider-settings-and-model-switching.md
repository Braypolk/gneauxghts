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
