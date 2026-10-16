# Prepared old/Pi observable parity subset

Preparation only. No native application, build, port or provider has been run for
this driver. Unit tests validate the fixture dialects and read-only effect proof;
they do not establish product parity. The native owner executes this after a
frontend/artifact freeze and inspects the generated report and screenshots.

The driver uses the pinned old artifact from
`/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts/gneauxghts`
and an explicitly hashed Pi artifact. It imports only stable argument validation,
environment and source-digest helpers from `shared-resource-gate.mjs`; it changes
none of that driver's scenarios or measurements. Existing files and production
frontend behavior are unchanged.

Each lane receives fresh generated native app/documents roots, a clean environment
with exact dummy credentials, its own source tree/dev server (old 1430, Pi 1442),
and a sequential exclusive WebDriver session. The loopback fixture uses 1443.
Occupied required ports cause refusal; the driver never terminates their owners.
Only children it creates are stopped. The old runtime is never called by Pi.

The same user scenarios and public outcomes run in each lane:

| Scenario | Initiation and observed result |
| --- | --- |
| Current note evidence | Normal composer sends a known note request; fixture invokes the lane's real read tool; admitted citation opens the canonical seven-pear-tree note in the retained editor. |
| Adjacent selected context | Normal split editor selects `seven pear trees`; normal composer sends the request; fixture requires the actual canonical selection cursor and reads it; answer has admitted citation. |
| Retained change evidence | Normal composer asks about orchard history; actual discovery and read tools issue references; answer selects an actually delivered source ID; normal historical citation opens History Mode. |
| Approved scope | Public revoke, normal composer denied read with zero citations, public grant, normal composer allowed read with admitted citation, public revoke. |
| Create and human review | Normal composer asks for creation; actual lane proposal tool stages it; retained editor changes body/title; normal Keep publishes those exact bytes. |
| Faithful whole-answer Save | Normal answer Save control stages its exact completed answer and Open in chat link; retained editor adds the explicit append heading; normal Keep publishes it; repeated public Save preserves proposal identity. |
| Second repeated selection append | Public Save selects occurrence 1 of `Echo phrase.` and names the saved Note Identity and heading; retained editor reviews; normal Keep appends once to that same canonical identity. |
| Duplicate Keep | Exact final acknowledged hunk-decision version is supplied explicitly; stale version must reject; two duplicate Keeps must return equal committed receipts, dispatch no inference, change no canonical bytes, add no NoteTimeline publication, and leave one file per Note Identity. |

The dialect adapter is explicit. Old reads use `read_notes` with
`purpose=answer`; Pi direct reads use `read_note`. Old creates use
`propose_note_change` with `operation=create`; Pi uses `propose_note`. Old final
answers use the offered formatter's actual name/schema; Pi grounded answers use
the structured text envelope. Both historical flows call `find_notes`, then
`read_notes` with only a reference actually returned by discovery. Source IDs are
copied only from actual tool outputs, never invented by the fixture.

Compatible and Responses are separate bounded runs. Responses refuses an old
artifact without the literal debug `GNEAUXGHTS_OPENAI_FIXTURE_URL` capability;
the fixture override is loopback only. It must not silently contact a live
provider when that old binary was compiled without `e2e-chat-fixture`.

Example for the exclusive native owner (replace Pi digest with the actual pinned
artifact hash, use fresh absolute output roots, and retain the whole reports):

```sh
node scripts/pi-prototype/paired-parity-gate.mjs \
  --protocol compatible \
  --root /private/tmp/paired-parity-compatible-20261015 \
  --old-source /private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de \
  --pi-source /Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts \
  --old-binary /private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts/gneauxghts \
  --pi-binary /Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts/src-tauri/target/debug/gneauxghts \
  --pi-sha256 ACTUAL_64_CHARACTER_SHA256
```

Repeat with `--protocol responses`, a different fresh root and optionally
`--first pi` to alternate order. The existing pinned old SHA validation remains
mandatory. A failed lane is recorded before trying the second lane. Final status
can pass only when all prepared checks in both lanes pass. Driver/fixture/browser
source hashes, lane source/lockfile/binary hashes, provider operation receipts,
canonical identities/bytes, NoteTimeline counts and final screenshots are retained.

The NoteTimeline read-only verifier requires one generated `history.sqlite3` and
counts exactly one publication for the created note, and two for the saved note
(whole Save plus selected append), before and after duplicate Keeps. It reads
with `mode=ro`, including committed WAL state, and never writes a database. This
counts canonical domain effects without equating the old chat SQL layout and Pi
documents.

Explicit comparison limits:

- Old `agent_permissions.rs::production_requirements()` is empty, and its model
  interface has no `request_note_access` or title-only `discover_notes` tool.
  Pi's per-read Deny/Allow once dialog therefore has no old equivalent. It is a
  capability difference, not a passing paired dialog test. Persistent approved
  grants are compared through each public ChatApi; grant UI itself is omitted.
- Source-free send/follow-up, Stop and restart remain in the existing shared
  resource gate. This driver does not repeat them.
- Update-existing-note model proposals, dirty editor conflicts, faults,
  compaction, research, attachments, web search, managed transcripts and iOS are
  outside this bounded subset and retain their separate acceptance requirements.
- The Save control and review/Keep use normal UI. Explicit selection destination
  and occurrence are public API inputs because the current UI does not collect
  those inputs. This limitation applies equally to both lanes.
- No live-provider, latency, memory, performance or adoption conclusion follows
  from this fixture driver. Resource measurements remain separate.

Pure preparation checks:

```sh
node --test scripts/pi-prototype/paired-parity-fixture.test.mjs
python3 -B scripts/pi-prototype/paired-parity-effects.test.py
```
