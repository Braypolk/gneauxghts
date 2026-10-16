# Prepared old/Pi observable parity subset

Preparation only. No native application, build, port or provider has been run for
this driver. Unit tests validate the fixture dialects and read-only effect proof;
they do not establish product parity. The native owner executes this after a
frontend/artifact freeze and inspects the generated report and screenshots.

By default the driver pins the original old artifact from
`/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts/gneauxghts`
to SHA-256 `435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3`
and requires an explicitly hashed Pi artifact. An alternate old artifact requires
`--old-sha256` with exactly 64 lowercase hexadecimal characters matching the actual
file bytes. This option is inherited from the shared argument parser; omitting it
retains the original pin. It imports only stable argument validation,
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
| Create and human review | Normal composer asks for creation; actual lane proposal tool stages it; retained editor changes the body in both lanes and title only when the normal title input permits editing; normal Keep publishes those exact admitted fields. |
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
For an alternate baseline built with `e2e-wdio,e2e-chat-fixture`, retain its old
source revision, exact build command/features, build log and artifact digest;
pass that artifact path and its verified digest through `--old-binary` and
`--old-sha256`. The override changes the artifact provenance of the comparison;
it does not prove a run, equivalence to the earlier binary, or a source-to-binary
binding. The generated lane report records the actual binary SHA-256.

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
`--first pi` to alternate order. Old artifact SHA validation remains mandatory,
using the original pin or explicit verified override. A failed lane is recorded
before trying the second lane. Final status
can pass only when all prepared checks in both lanes pass. Driver/fixture/browser
source hashes, lane source/lockfile/binary hashes, provider operation receipts,
canonical identities/bytes, NoteTimeline counts and final screenshots are retained.

The NoteTimeline verifier requires one generated `history.sqlite3` and counts
exactly one publication for the created note, and two for the saved note (whole
Save plus selected append), before and after duplicate Keeps. Both measurements
require the owning native process to have exited. The driver captures the full
browser state, invokes retained native `prepare_restart`, requires both `ready`
and `timelinePortable`, deletes the old WebDriver session, waits for owned process
exit and driver port release, then measures. It relaunches the same artifact and
data root against the same frontend, obtains a fresh session, initializes from
the complete captured state and verifies no provider dispatch before running
public duplicate Keeps. A second portable stop precedes the second measurement.
Failed preparation, unexited children, restoration inference or duplicate
inference cannot yield a passing proof. Soft and forced child exit waits are
bounded; the driver only stops children it created.

The shared `closed_sqlite_read` helper uses an immutable read for a closed database
without sidecars. For a closed database with WAL/SHM/journal files it recovers a
complete disposable copy with query-only reads, preserving all original bytes.
It is never called while an app writer is alive. This counts canonical domain
effects without equating the old chat SQL layout and Pi documents. The report
retains both snapshots, full restoration state and both native shutdown receipts.

Explicit comparison limits:

- The old baseline exposes a read-only proposal title. Its review retains that
  original title while editing the body; Pi edits both body and title through
  normal inputs. Each lane records `reviewedTitle`, `draftTitleEditable` and
  `titleEditing`; final Keep must preserve the admitted title. A Save that keeps
  its original title does not unnecessarily edit its title input. No DOM
  read-only override or API rename bypass is used.
- Old `agent_permissions.rs::production_requirements()` is empty, and its model
  interface has no `request_note_access` or title-only `discover_notes` tool.
  Pi's per-read Deny/Allow once dialog therefore has no old equivalent. It is a
  capability difference, not a passing paired dialog test. Persistent approved
  grants are compared through each public ChatApi; grant UI itself is omitted.
- Source-free send/follow-up and Stop remain in the existing shared resource
  gate. This driver adds only the portable restart and no-inference restoration
  boundary needed for its closed canonical effect comparisons.
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
node --test scripts/pi-prototype/paired-parity-fixture.test.mjs scripts/pi-prototype/paired-parity-lifecycle.test.mjs
python3 -B scripts/pi-prototype/paired-parity-effects.test.py
```
