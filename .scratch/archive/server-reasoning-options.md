# Server-advertised reasoning options

Status: completed (2026-10-13)

## Cause and behavior

Local reasoning controls guessed Low/Medium/Extra High from Qwen model names.
LM Studio accepted `medium` at the compatible API boundary, then fell back to
`on` for the GSQ-RCO model, whose advertised options are only `off` and `on`.

`agent_runtime/local_reasoning.rs` now reads authenticated native model metadata
from `/api/v1/models`, matches model keys/variants or loaded instance IDs, and
provides server options and default to Settings and the composer. Model names
do not determine local options. Safe opaque identifiers can persist without a
schema migration. The runtime discovers metadata again and revalidates saved
preferences before inference, including research worker requests.

Unsupported saved values use the server default. The server fallback is distinct
from a valid saved profile default, so existing conversations display what the
runtime will actually use. Valid conversation/profile preferences are preserved.
Absent metadata hides the local picker and sends no override; explicit internal
`none` requests still disable reasoning for bounded summaries. Official OpenAI
uses its existing curated catalog because its model listing does not advertise
equivalent per-model options.

## Compatible transport limitation

Live probes against the user's LM Studio endpoint on 2026-10-13 established:

- GSQ-RCO advertises `off/on`, default `on`; regular Qwen advertises
  `off/low/medium/xhigh/on`, default `xhigh`.
- Literal `reasoning_effort=on` and `off` are rejected with HTTP 400.
- `reasoning_effort=none` succeeds with zero reasoning tokens.
- Omitting the override succeeds with reasoning enabled by the server default.
- Native-style top-level `reasoning` values are ignored by Chat Completions.

Thus Off maps to `none`; On is labeled **On (server default)** and omits the
override. On is not offered when the advertised default disables reasoning or
is unknown: this compatible endpoint cannot truthfully force it enabled with
the verified mapping. Other advertised values pass through unchanged.

Discovery has a two-second timeout, bounded response size, no redirects, and
rejects malformed/ambiguous metadata rather than inventing options.

Primary reference: [LM Studio list models API](https://lmstudio.ai/docs/developer/rest/list).
Transport mapping above is measured behavior, not a claim that the native and
compatible APIs accept identical parameters.

## Verification

- Configuration regression demonstrated the old hardcoded choices failing.
- 49 focused frontend tests pass, including dynamic options, old-value fallback,
  valid profile/conversation choices, controller persistence and API wiring.
- Ten focused Rust tests pass, including profile/conversation reload and a
  production `AgentRuntime::run` HTTP/SSE fixture that asserts authentication,
  native discovery and the actual Rig-serialized request for On/Off/level/no
  metadata cases. The HTTP fixture requires loopback socket permission.
- All 21 architecture fitness tests pass; Svelte/TypeScript check is clean.
- Rebuilt and exercised the isolated native development bundle through Computer
  Use. Both Settings and the composer show GSQ-RCO Off/On, replacing the old
  persisted Medium display. Regular Qwen Settings shows Off/Light/Medium/Extra
  High/On, retaining its valid saved Medium preference. Regular Qwen inference
  was not repeated here; metadata discovery does not require loading that model.
- Selected Off in the existing eight-turn test conversation: two model calls
  and one actual `read_notes` call completed in 8,303 ms, returning Aster's fresh
  approved status, KITE-417, a valid source button and the remembered
  `amber-otter` code. Selected On for a follow-up: one model call completed in
  5,538 ms and returned the correct code. Both runs persisted as completed.
- Saved the normalized On profile through Settings, then quit/restarted the
  development app. The saved conversation, answers, citation and On selection
  survived. Read-only SQLite inspection independently confirmed profile/run
  values. All native inputs used Computer Use; the vault contained only two
  synthetic notes, and the app used isolated temporary data/Documents paths.
- Local evidence: `/private/tmp/gneauxghts-reasoning-build.log`,
  `/private/tmp/gneauxghts-reasoning-check.log`, and
  `/private/tmp/gneauxghts-conversation-ui/vault/.gneauxghts/ai.sqlite3`.

## Slider presentation follow-up (2026-10-13)

The range preview also supplied the toolbar trigger's text. Changing that text
resized the trigger and moved the model control and anchored popup during input.
On commit, closing the popup cleared the preview before the persisted prop
arrived, briefly restoring the old label and moving the controls again.

`model-selector.svelte` now keeps slider preview inside the popup, holds the
accepted label through the asynchronous parent callback, and scopes that pending
presentation to its provider/model/selection. Hidden, inaccessible grid labels
reserve the widest advertised choice while retaining the narrow-width clamp.
Canonical configuration and persistence still belong to the chat controller.

Rebuilt the isolated development bundle and used native Computer Use to verify
pointer drags and keyboard range changes for GSQ-RCO's two choices and regular
Qwen's five choices, across narrow and wide windows. Final selections persisted,
popups closed, and controls/popup anchors retained their positions across label
changes. Restored GSQ-RCO/On afterward. No inference was needed for these controls.
All 20 relevant selector/configuration/controller tests pass; Svelte/TypeScript
checks report zero errors/warnings and the development app build succeeds.
Logs: `/private/tmp/gneauxghts-slider-build.log` and
`/private/tmp/gneauxghts-slider-check.log`.
