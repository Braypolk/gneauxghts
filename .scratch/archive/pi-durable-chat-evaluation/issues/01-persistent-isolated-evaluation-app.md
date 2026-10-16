# Deliver a persistent isolated app for hands-on Pi chat

> Historical specification/issue record; outside the executable backlog. Original triage/dependency lines are a historical snapshot. See [outcome](../outcome.md).

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: none

Follow [the spec](../spec.md). The runner opens diagnostics, defaults to a fresh
temporary root and forces a synthetic vault. It is not the persistent evaluation
app the user requested.

## Work

- Provide one documented desktop entry that opens the actual workspace/chat
  directly. Keep diagnostics separately accessible and label the evaluation app.
- Preserve separate bundle, native credentials, data and databases. Reuse a stable
  disposable root across launches; resetting it is explicit.
- Add a copy/setup operation for a representative user vault. Copy notes/assets
  and consistent Note Timeline data needed for history tests. Resolve locations
  through the Running Vault; do not follow links into the original or copy live
  database/WAL files inconsistently.
- Start fresh Pi conversations. Copied legacy chat artifacts cannot trigger old
  import or grant transcript content evidence authority.
- Record old/Pi owner and resource baselines using equivalent disposable fixtures;
  retain environment and comparison commands for issue 13.

## Acceptance

- Two launches reuse evaluation notes, Pi data and settings without touching the
  normal app. A copy edit/Keep never changes the original vault.
- Failed setup does not adopt an incomplete Running Vault; retry/reset are
  documented and confined to evaluation-owned paths.
- Retained history uses a consistent copied store with preserved Note Identity/
  Revision meaning; generated history fixtures remain available for automation.
- Instructions distinguish private copied data from committable fixtures and
  identify the evaluation root without logging note contents.
- Record a reproducible comparison baseline. Existing fixture passes do not count
  as live-model acceptance; no ordinary app UI redesign is required.

## Starting points

`scripts/pi-prototype/run.mjs`, `scripts/pi-prototype/tauri.prototype.conf.json`,
`src/routes/pi-prototype/+page.svelte`, `src-tauri/src/lib.rs`, Running Vault
composition and the previous prototype README.

## Comments

### 2026-10-15 — isolated runner and safe setup implementation

Implemented a stable native app-data default, direct workspace entry, separate
fixture/diagnostic configurations and a fixture-only diagnostic mount guard, macOS `.app` output/installed entry, explicit
setup/status/reset commands and an OS lock around runner-owned roots. The existing
native fixed `PROTOTYPE-wipe-me/vault` override remains unchanged; no new Running
Vault owner or ordinary-app root selection was introduced.

The Python copy helper rejects symlinks/special files, overlapping roots, reported
open handles, nonempty WAL, open/non-current/mismatched history metadata and
unsettled history work. It never writes the source; staged publication validates
source hashes again and preserves history identity/payloads while rebasing copied
location columns. It omits app data/credentials, Chats and relocated managed chat
Markdown. Reset requires an evaluation marker and refuses open/unrecognized roots.
See [run instructions](../../../pi-durable-chat-evaluation/README.md) for private-data, retry and reset boundaries.

Focused evidence: `python3 -B -W error::ResourceWarning -m unittest discover -s
scripts/pi-prototype -p '*_test.py' -v` passes **12 tests**; `node --test
scripts/pi-prototype/evaluation-data.test.mjs` passes **3 tests**. These cover
copy/source isolation, retained payload/identity/path geometry, no legacy import,
open marker without WAL, nonempty WAL, pending work, mismatched identity, actual
open-file rejection, symlinks, nested/preexisting roots, atomic failure/retry and
operation lock. The runner test uses a stub pnpm executable, verifies two invocations
reuse one marker/root and normal UI config, and rejects fixture/gate use of the
persistent root; it is not a native app launch. MacOS `lsof +D` can emit a PID with exit 1; the helper requires both
exit 1 and empty PID output. Native builds/app launches were not performed by this
implementation agent. Real source portability, two-launch persistence and copied
edit/Keep isolation remain acceptance gates; a user statement that the vault is
ready is not substituted for a portable store marker. Comparison baseline is
tracked separately in [baseline](../../../pi-durable-chat-evaluation/baseline.md).

Manual visibility review: the development desktop entry explicitly sets
`GNEAUXGHTS_E2E_FOREGROUND=1` while diagnostic/gate environments remove that
flag. Manual `.app` builds use only `pi-prototype`, excluding `e2e-wdio` and its
automation server/background default; installed launch uses the native default
root and rejects `PI_PROTOTYPE_DATA` because those overrides are E2E-only. The
stub-pnpm runner test asserts this feature/visibility distinction and custom-root
rejection. Native visible launch remains a separate acceptance gate.

### 2026-10-15 — deliberate stopped-source quarantine recovery

After the ordinary app could not establish a portable close, added explicit
`setup --source ... --recover-stopped-source --observations ...` and
`setup --adopt-recovered ...`. Recovery exports only to a fixed sibling quarantine
with a distinct marker and no normal evaluation marker. It verifies immutable
no-WAL SQLite integrity/schema/manifest identity, empty pending work, stopped
handles, stable full source hashes, and an exactly matching original app-local
observation whose full hash is stable. Only that existing vault entry is copied;
no observation authority is synthesized, no credentials are copied, and neither
source nor destination portability is forged through SQL.

The native recovery utility must bind the isolated Running Vault/observation root
and cross ordinary NoteTimeline recovery plus clean close. Adoption requires the
same history identity, portable marker, higher clean-close watermark and matching
quarantine observation watermark before normal staged publication. A quarantine
cannot launch through the normal runner. ADR 0002/0005 guards remain intact.

Focused checks now pass **17 Python tests + 3 Node tests**. New tests cover open
quarantine preservation, exact existing-observation filtering, observation mismatch/
race refusal, pending/WAL refusal and adoption/advanced-watermark gating. Synthetic
close-receipt test writes do not establish native recovery. The orchestrator owns
execution of the authorized original-source export, native recovery and adoption;
this implementation agent performed none of those actions. See [recovery run
instructions](../README.md) for exact commands and limits.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Copy/recovery/setup and the separate persistent app are integrated. Matrix **M** records 209 copied files, repeated launches retaining model/history/review, approved synthetic edits leaving the original unchanged, and normal shutdown. This is bounded actual local-live evidence; agent observations are not user trial feedback.

Final comparison/resource and remaining platform gates stay open. See the [current validation matrix](../../../pi-durable-chat-evaluation/validation-matrix.md) for receipt provenance and scope; earlier preparation-only comments above are historical.

### 2026-10-16 — Final acceptance reconciliation

Implementation is integrated and bounded acceptance is complete under the [root semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json). [final manual](/private/tmp/pi-v51-manual-acceptance-20261016.json) passed two normal launches/quits, retained prior note/history/model and the same pending review, then approved synthetic Keep/canonical read-back, without setup/reset/recopy. Earlier M records the 209-file copy and permission/Save journeys.

Material limits: Final local UI observations extend the earlier manual scope; they are not user trial feedback or a new full permission/Save/cancellation cross-product. Original equality is limited to the fresh bounded manual interval.

The original triage/dependency lines above are historical; this record is outside the executable backlog. Default production adoption and migration remain deferred.

See [ticket 01 outcome](../outcome.md#ticket-01) for bounded acceptance and material limits.
