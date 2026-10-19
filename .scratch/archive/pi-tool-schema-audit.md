# Pi note-tool schema audit — 2026-10-18

The four ordinary chat tools share TypeBox JSON Schema and Pi's public
`constrainedSampling: { type: 'json_schema', strict: 'prefer' }` setting. Provider
serialization, strict-schema conversion and optional-null normalization remain
upstream Pi responsibilities. No model-specific argument translator was added.

## Audit

| Tool | Required inputs | Optional inputs and defaults | Semantic authority |
| --- | --- | --- | --- |
| `search_notes` | Nonempty bounded lexical `query` | `limit`: omitted/null uses native default 12; otherwise 1–50. `cursor`: omitted/null/empty starts page one; a nonempty native continuation token passes unchanged. | Native validates current read scope and cursor query/authority fingerprint. Search previews cannot issue citations. |
| `read_note` | Exact bounded `noteId` | `quote`: omitted/null requests a whole-note citation; a supplied quote must be nonempty, bounded, exact and unique. | Native canonical read and issued source/citation; no path or authority supplied by the model. |
| `edit_note` | Exact string `noteId`, `expectedReadSourceId`, Pi's `edits` array of `oldText`/`newText` replacements | No optional inputs. Pi's existing pure shape repair still runs before validation. | Native exact issued read base, independent update grant, review and publication proof. Pi applies unique non-overlapping replacements in the staging environment. |
| `create_note` | Nonempty bounded `title`, complete bounded `markdown` | `folder`: omitted/null defaults to root (`.`); an explicit value selects an existing visible vault-relative folder. Empty strings are not folder selectors. | Native create grant, safe filename, existing-folder checks, exact review and create-only collision protection. |

Every tool rejects extra top-level fields. Pi's strict wire conversion closes
nested edit objects as well. Native checks remain authoritative even when the
provider enforces the schema; schema compliance cannot establish permission,
current-source identity, quote uniqueness or a committed write.

The audit found a second configuration gap beyond the earlier empty-cursor bug:
our custom OpenAI model registration did not advertise strict-mode support. Pi
1.3.0 conservatively defaults that capability to false. The native hosted route
now clones Pi's complete built-in OpenAI model definition rather than maintaining
a hosted capability override. This inherits `compat`, input limits, input types,
reasoning capability, display name, cost and model limits. Native-selected effort
remains an application setting. Requests delegate to the built-in provider's
`stream`/`streamSimple` methods through the existing native fetch/admission wrapper.
An API-key-shaped nonsecret placeholder keeps Pi's API-key/subscription distinction
correct; real credentials remain native. Uncatalogued hosted models and unknown
local OpenAI-compatible servers retain conservative metadata and normal validation;
transport compatibility alone is not evidence of strict tool sampling support.

Pi's [provider factories](https://github.com/earendil-works/pi/tree/main/packages/ai#provider-factories)
are the source of built-in capability metadata. Adopting a newly supported provider
still needs native routing/authentication and app configuration, but its Pi model
definitions should be inherited through this wrapper rather than copied by hand.
Package updates can then update catalogued capabilities without a second app table.

The wire contract follows [OpenAI function calling strict mode](https://developers.openai.com/api/docs/guides/function-calling#strict-mode):
closed objects, every property required on the wire, optional values represented
as nullable. Pi performs that conversion without changing the source tool schema.
Descriptions now explain omitted/null semantics for all optional fields. Empty
cursor remains a documented first-page alias rather than weakening opaque-token
validation.

## Verification

- A new regression runs extension registration through a real Pi Durable Harness
  and real Pi AI provider serialization. It failed because hosted tools had no
  strict flag. Tool preferences alone still failed; declaring the known hosted
  capability made it pass. It verifies all four outgoing schemas, nullable
  optionals, closed nested edit objects, and local fallback without a strict flag.
- The built-in reuse regressions initially failed for missing catalog metadata and
  guessed strict support on an uncatalogued hosted model. After the correction,
  known models inherit the full capabilities, refresh does not mutate Pi's shared
  nested catalog objects, and unknown models do not borrow another model's flags.
  The existing provider tests verify native authority, cancellation, redaction,
  current reasoning selection, limits and protocol parsing through both entrypoints.
- Real Harness tool execution covers null search limit/cursor and null whole-note
  quote, plus omitted/null/root/explicit-folder creation through the shared
  publication flow. Existing authority, stale-source, review, cancellation,
  recovery, receipt and edit-shape tests remain green.
- `pnpm test`: 32 support tests and 1,307 frontend tests across 152 files pass,
  including all chat tests. `pnpm check`, production build and
  `git diff --check` pass. The build retains its existing chunk warnings.

Live acceptance is registered once in `e2e/support/piToolAcceptance.ts`, then run
through separate hosted/local specs with the same prompts and assertions. Each
run uses the current frontend, pinned debug native binary, generated disposable
vault, actual Pi tool/review tasks and native publication/citation navigation.
No Rust implementation changed. Provider credentials remain in process memory;
reports contain only generated-fixture tool calls/results and final answers.

| Actual model | Original walk edit | Four-page pagination and reads | Reviewed root creation | Tool errors |
| --- | --- | --- | --- | --- |
| `gpt-6-luna` | Pass | Pass | Pass | 0 |
| `qwen3.8-27b-gsq-rco` | Pass | Pass | Pass | 0 |

The initial audit completes hosted in 26.4 seconds and local in 56.6 seconds. Each run
executes three successful search/read/edit calls, four successful searches plus
four reads for pagination, and exactly one successful creation. The edit leaves
30 minutes on disk until approval, then publishes 45 minutes while preserving the
unrelated reminder; its fresh citation opens the edited note. Each four-page
search begins with the explicitly requested empty cursor, follows exact native
tokens, ends at null and reports all four codes. Creation leaves no file before
approval, then returns a read matching canonical bytes and a fresh cited source.
Luna emits null optional quote/folder values; the local creation omits folder.
Both produce the same intended native behavior without argument-error retries.

After adopting the complete built-in provider definitions and provider methods,
all three journeys pass again on each actual model, with zero tool errors:
hosted 26.0 seconds, local 47.4 seconds. These runs verify native routing,
publication and citations with the inherited capabilities active, rather than
only comparing metadata in memory. Their sanitized reports and logs are retained
separately at `/private/tmp/pi-builtin-provider-acceptance/`; elapsed times are
individual acceptance runs, not controlled performance measurements.

Reproduction: supply `OPENAI_API_KEY` to the debug native process and run
`GNEAUX_PI_HOSTED_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs hosted`.
For the configured local model, run
`GNEAUX_PI_LOCAL_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs live`.
The local lane also includes the existing streaming/read acceptance.
Sanitized reports and runner logs for this audit are in
`/private/tmp/pi-tools-acceptance/`. This is bounded desktop acceptance for the
two selected models; it does not establish every provider or physical iOS device.
