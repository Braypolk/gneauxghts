The transcript gate uses the ordinary mounted workspace under an isolated
synthetic fixture composition. Native builds, byte pins and simulator execution
belong to the root/native lease owner; pure checks below do not establish native
acceptance.

1. In the opt-in `src/routes/+layout.svelte` onMount dispatch, route
   `?piTranscriptTest=1` to the new `runIosTranscriptProbe` from
   `$lib/prototypes/pi/iosTranscriptProbe`. The other probe query parameters
   must be absent, so expanded/interactive probes cannot run concurrently.
   Keep the normal root workspace mounted.
2. In the diagnostic URL choice in `scripts/pi-prototype/run.mjs`, add an
   explicit `PI_PROTOTYPE_TRANSCRIPT_GATE=true` choice for
   `/?piTranscriptTest=1` before the existing expanded choice. Keep all
   isolation and ordinary workspace build paths. Pi-owned probe state and
   ui-report retain the existing persistence schema. Portable closure uses the
   fixture-only native `pi_probe_prepare_close` command described below.
3. Build through the established iOS workaround, using a generated build root:
   `PI_PROTOTYPE_DATA=/generated/empty/build-root PI_PROTOTYPE_DIAGNOSTICS=true
   PI_PROTOTYPE_EXPANDED_GATE=true PI_PROTOTYPE_TRANSCRIPT_GATE=true node
   scripts/pi-prototype/run.mjs ios`. Run the new driver with the prebuilt app:
   `PI_PROTOTYPE_SIMULATOR=<owned-booted-disposable-udid>
   PI_PROTOTYPE_IOS_APP=/generated/build-root/xcode/Build/Products/debug-iphonesimulator/Gneauxghts\ Pi\ Prototype.app
   node scripts/pi-prototype/ios-transcript-gate.mjs`.

The driver refuses a pre-existing prototype installation and occupied fixture
port. Preserve any prior evaluation before clearing its bundle; never remove an
unknown app container. The driver installs only the isolated prototype bundle
into the explicitly owned disposable simulator. Its initial container is fresh.
Its receipt-directed edits/deletes address only generated transcript paths.

The probe performs ordinary chat sends in both protocols, creates canonical
source data through native save, and stages Save/proposal reviews through public
ChatApi. It polls only DOM before external-edit/delete conflict observation.
Normal Convert and Restore buttons settle those conflicts. A separate edited
transcript, acknowledged pending proposal, and receipt-write-uncertain Keep are
retained before portable clean close. The driver stops the process, takes
read-only native receipt snapshots, copies the owned Documents/PROTOTYPE-wipe-me
vault and Library/Application Support/<prototype-bundle>/PROTOTYPE-wipe-me state
to its generated evidence root, then reinstalls and restores them into a new
sandbox. It rejects an unchanged container path. No settings or SQLite strings
are replaced.

`pi_probe_prepare_close` is compiled only in the Pi prototype. It rejects before
looking up or admitting `AppLifecycle` unless `PI_PROTOTYPE_HTTP_FIXTURE` is an
explicit literal `http://127.0.0.1` URL without credentials, query or fragment,
and both `PI_PROTOTYPE_INTERACTIVE_GATE` and `PI_PROTOTYPE_EXPANDED_GATE` are
exactly `true`. Driver ownership checks still establish the disposable bundle,
simulator and fresh container. The command dispatches the existing joining
`AppLifecycle::prepare_restart` operation on a blocking worker and returns its
complete receipt. That owner retains Pi quiescence, native storage release,
watcher/write settlement, `NoteTimeline.clean_close` and semantic shutdown.
There is no separate close owner, forced portability marker or relaunch action.

This is a test-only synthetic portable-close diagnostic, not a normal iOS UI
feature. Product `prepare_restart` still rejects iOS before lifecycle admission;
manual force-quit and backgrounding retain their existing semantics. Live gates
without the synthetic fixture environment cannot enter this diagnostic. Adding
the wrapper changes native prototype bytes and requires fresh build/byte pins;
do not describe the resulting native binary as unchanged. The transcript probe
records every returned close receipt before asserting portable readiness, so
`failed-ui-report.json` retains native failure details. It performs no Pi/API
read after portable closure; only the bounded diagnostic report is published
before the driver terminates the process.

On relaunch, the probe requires native known-root mapping, unchanged pending
body/title/version/decisions, watcher-visible true conflict, normal pending
review UI, explicit Keep recovery, duplicate Keep receipt equality, normal
source-button navigation, stable Origin lookup, unknown-root rejection and no
legacy artifact import. The driver compares original native accepted hashes,
target fields, identity, one timeline publication and exact canonical bytes
against the recovered receipt. Fixture request counts must not change during
restart/recovery/navigation. Driver phases publish screenshots and bounded
synthetic evidence; any probe error becomes a failed report.

Pure checks, authorized without a native lease:

```
pnpm exec vitest run src/lib/prototypes/pi/iosTranscriptContract.test.ts
pnpm exec vitest run src/lib/prototypes/pi/iosTranscriptProbe.test.ts
node --check scripts/pi-prototype/ios-transcript-gate.mjs
node --test scripts/pi-prototype/ios-transcript-gate.test.mjs
python3 -B -c "import ast,pathlib; ast.parse(pathlib.Path('scripts/pi-prototype/verify-ios-transcript-effects.py').read_text())"
```

Actual iOS acceptance remains pending until integration, build and execution.
This checks a real sandbox-path move under the fixed isolated composition; it
does not prove standalone Settings-selected vault moves. Programmatic UI events
do not prove touch gestures. Live endpoints, OS suspension/pressure, background
leases and physical devices remain outside this gate. Pending/uncertain review
UI may reveal a real composition bug; do not weaken assertions or rewrite
accepted authority to manufacture parity.
