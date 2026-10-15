# Persistent Pi evaluation app

This opt-in evaluation keeps the ordinary app, vault and Keychain service
separate. The desktop entry opens the existing workspace directly; it does not
run the diagnostic seeding route. This is an experiment under the [spec](spec.md),
not a production migration. See [baseline](baseline.md) for owner/resource
comparison commands and measured limits.

Run commands from this worktree with pnpm dependencies, Python 3 and macOS `lsof`
available. The default persistent app-data root is:

```text
~/Library/Application Support/com.braypolkinghorne.gneauxghts.pi-prototype
```

The Running Vault is `<root>/PROTOTYPE-wipe-me/vault`. Pi SQLite and native
publication receipts remain under `<root>/PROTOTYPE-wipe-me`; native settings and
history observations remain in the isolated app-data root. The bundle identifier
is `com.braypolkinghorne.gneauxghts.pi-prototype`, with the existing separate Pi
Keychain service. No source app-data or credentials are copied. Configure providers
in this app's Settings; importing old conversations is not supported.

## Setup and launch

First cleanly close the ordinary app using its supported exit/close path. A
force-kill or an absent WAL does not establish portability. Setup independently
checks the history store's portable marker and clean-close watermark.

```sh
pnpm pi:prototype setup --source /absolute/path/to/cleanly-closed/vault
pnpm pi:prototype desktop
```

`desktop` is the one development entry: it opens normal notes/chat, retains the
same root on subsequent launches, explicitly enables foreground visibility, and
labels the window as Pi Evaluation. This development entry includes `e2e-wdio`
so its explicit disposable-root arguments are supported. With
no setup it initializes an empty isolated vault. Setup requires an empty root;
if an evaluation already exists, reuse it or explicitly reset it first.

To build the separate macOS application bundle and run it without a dev server:

```sh
pnpm pi:prototype build
pnpm pi:prototype installed
```

The bundle output is
`src-tauri/target/debug/bundle/macos/Gneauxghts Pi Evaluation.app`; it may be copied
to a separate application location. Its normal default app-data identity matches
the runner's default root. This manual bundle is built with `pi-prototype` alone,
without `e2e-wdio`, so double-click launch is visible and has no automation server.
The `installed` command executes that bundle using its native default root and
holds the evaluation lock. It rejects `PI_PROTOTYPE_DATA`: a manual non-E2E
bundle does not parse root-override arguments. Use `desktop` for custom roots.
Unset `PI_PROTOTYPE_DATA` and perform setup against the default root before
using `installed` or double-clicking the bundle. A double-clicked
bundle does not hold the runner lock; setup/reset also require `lsof` to report no
open root files. Close every evaluation process before either operation.

For private development automation or a second disposable evaluation, use one absolute,
canonical path consistently for setup, launch, status and reset:

```sh
export PI_PROTOTYPE_DATA=/private/tmp/gneauxghts-pi-hands-on
pnpm pi:prototype setup --source /absolute/path/to/cleanly-closed/vault
pnpm pi:prototype desktop
pnpm pi:prototype status
```

Do not point this variable at the ordinary app-data directory or source vault.
Do not commit private evaluation roots, databases, note content, provider requests,
credentials or screenshots. A root outside the checkout is recommended. Generated
synthetic fixtures and bounded prose-free comparison summaries are separate from
private copied data. The helper prints only the evaluation root, counts and
history identities; it does not print note contents or per-note paths.

## Copy and failure contract

Setup rejects all symlinks and special files, overlapping source/evaluation roots,
open source handles, nonempty history WAL, unsupported history schema/format,
manifest/store identity disagreement, an open portability marker, and unsettled
history work. It needs a current schema-14 `sqlite-v1` history store marked portable
by the source app's clean-close operation. It does not fix, checkpoint, migrate or
write the original store, and does not implement a live SQLite backup.

The staged copy includes ordinary visible notes/assets, `.forgotten`, the vault
manifest and consistent Note Timeline store. It excludes `Chats`, other hidden
root entries, app-state/search/cache databases, and managed chat Index/Transcript/
Excerpt Markdown even if moved outside `Chats`. Legacy chat does not import or
become conversation evidence. The helper preserves Note/Revision identities,
revision payloads and hashes, generation and clean-close watermark. It rebases
only location columns in the copied history store to the copied Running Vault.
Historical paths outside the supplied source root fail closed; provide a reconciled
portable export instead of accepting external paths. This is a bounded schema-14
copy helper, not a replacement for the NoteTimeline storage seam.

Files are hashed before and after copying; a changed source aborts setup. The
source app must remain stopped throughout setup. A complete staged root is renamed
into place only after validation; failed setup does not select a partial vault.
Retry the same setup command after correcting the reported prerequisite. Interrupted
process termination can leave a sibling `<root-name>.staging-*` directory; it is
unselected private data and may be removed after checking its exact path. The
sibling `.pi-evaluation.lock` is an OS lock and can remain as an empty file without
blocking retry after the process exits.

```sh
pnpm pi:prototype reset
```

Reset deletes only a root carrying this helper's matching evaluation marker; it
refuses an unrecognized, symlinked or open root. It removes evaluation notes, Pi
sessions, settings and databases. It does **not** delete Keychain credentials;
clear those through the separate app's Settings if needed. Reset is explicit and
irreversible for that disposable root; it never edits the source. Run setup again
(or desktop for an empty vault) afterward. An existing root from the historical
prototype has no marker: choose a fresh explicit root rather than treating it as
safe to erase.

## Diagnostics and repeatable checks

```sh
pnpm pi:prototype diagnostics   # read-only diagnostic page, fresh background root
pnpm pi:prototype ui-gate       # native fixture/editor/restart gate
pnpm pi:prototype fault-gate    # native fixture faults
pnpm pi:prototype ios-ui-gate   # dedicated simulator fixture gate
python3 -B -W error::ResourceWarning -m unittest discover -s scripts/pi-prototype -p '*_test.py' -v
node --test scripts/pi-prototype/evaluation-data.test.mjs
```

Diagnostics/gates are separate from copied-vault use. The diagnostics page is
read-only/unavailable unless the native process has explicitly enabled the synthetic
HTTP fixture; use `gate`/`ui-gate` to execute it. Navigating to that route in the
manual app cannot seed Pi data. Gates reject a nonempty
explicit data root; their compiled entry remains `/pi-prototype`. Manual use rejects
inherited HTTP-fixture/UI-fault variables. The simulator entry retains the previous
SDK workaround and uses its own bundle container; desktop copied data is not
silently transferred into iOS. See the [historical validation](../pi-durable-prototype/validation.md)
for the existing fixture gate behavior; those earlier passes are not current live
provider or persistent copied-vault acceptance.

Current focused setup evidence: 12 Python safety/copy tests and 3 Node root/runner tests
pass on 2026-10-15. The SQLite fixtures in those tests exercise the copy contract;
they are not real NoteTimeline reconstruction acceptance. Two real native launches,
original-vault unchanged proof after copy edits/Keep, bundle installation, and
live-provider interaction must be recorded separately after source portability
and native build ownership are available. No such pass is claimed here.

## Deliberate recovery of a stopped interrupted source

When the original app cannot cleanly close, ordinary `setup --source` still
refuses its open history marker. User-authorized recovery can export a quarantine:

```sh
pnpm pi:prototype setup --source /absolute/stopped/vault \
  --recover-stopped-source \
  --observations /absolute/original-app-data/note-timeline-history-observations.json
```

This requires the original app to remain stopped, no reported open source handles,
no nonempty WAL, matching schema/manifest/store identity, and no pending history
work. Full source hashes must remain unchanged. The original app-local observation
must exactly match format, generation, store instance and clean-close sequence,
with no missing-store or pending-reset authority. The helper checks that file's
full hash again and copies only the existing entry for this vault; unrelated vault
observations, app settings and credentials are omitted.

The result is the fixed sibling `<evaluation-root>.stopped-recovery`, containing
`PROTOTYPE-wipe-me/vault`, that one observation entry and `pi-stopped-recovery.json`.
It has **no** `pi-evaluation.json` and cannot launch through the normal runner.
The copied store preserves its original open marker and watermark. Native
NoteTimeline must open this isolated Running Vault with the copied matching
observation, initialize/recover it and complete its production `clean_close` seam.
Without a matching original observation, ordinary initialization reports
`Note Timeline unsupported live copy requires explicit recovery`; the helper does
not fabricate an observation or set portability through SQL.

After the orchestrator's native recovery utility succeeds, adopt the clean copy:

```sh
pnpm pi:prototype setup --adopt-recovered /absolute/evaluation-root.stopped-recovery
pnpm pi:prototype desktop
```

Adoption requires the exact sibling quarantine marker, unchanged vault/generation/
store identities, a portable native history store, a strictly advanced clean-close
watermark and the same watermark recorded in quarantine observations. It then uses
the ordinary safe staged copy to publish the evaluation root. The quarantine is
retained as private recovery evidence and marked adopted. Until adoption, an empty
normal launch fails instead of silently creating an unrelated empty evaluation.
A failed export/adoption selects no partial Running Vault. This bounded recovery
currently refuses pending intent/window/observation/deletion work; it does not
purge that work, reset history, repair corruption or claim recovery of a nonempty
WAL. All source files remain read-only.

Recovery helper validation adds five focused Python cases (17 total): quarantined
open-state preservation and exact observation filtering, mismatched/racing
observation refusal, pending/WAL refusal, and adoption gating. Synthetic test writes
represent a close receipt solely to test helper admission; only the actual native
utility can establish real NoteTimeline recovery. No original-source export or
native recovery was executed by the helper implementation agent.
