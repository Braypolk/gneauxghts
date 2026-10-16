Root/native-lease owner runs the publication crash gate after the normal workspace
checkpoint. It requires the current `pi-prototype,e2e-wdio` debug binary with the
Pi configuration's `/` window entry. `run.mjs fault-gate` now builds this entry;
a direct run reuses the existing binary:

```sh
env -u PI_PROTOTYPE_DATA node scripts/pi-prototype/fault-gate.mjs
# Or rebuild first under the native lease:
env -u PI_PROTOTYPE_DATA pnpm pi:prototype fault-gate
```

The driver refuses occupied ports 1442/1443/4445 and private evaluation roots.
It allocates fresh generated roots, starts only its own background processes,
uses embedded native WebDriver (`tauri`, status-ready, port4445), and waits for
the actual normal workspace. It does not mount the older diagnostic route or
replace the existing frontend. Each failure retains `fault-gate.json`, native and
frontend logs, synthetic request records, phase information and screenshots.
Cleanup has bounded graceful/forced shutdown and never kills an unrelated port
owner.

For each native `after-intent`, `after-publication` and `after-receipt` boundary,
the existing composer sends `PI_UI:CREATE` to the current interactive fixture.
The original proposal review mounts in the normal editor. CodeMirror body edits
and the existing title field produce the acknowledged retained draft and mapped
hunk decisions. The gate verifies those decisions through the native checkpoint
validator before arming the fault; the real Keep control starts publication.
After process loss, read-only closed-database snapshots distinguish the exact
boundary. Relaunch preserves the edited draft and original assistant source.
Explicit public Retry Keep uses the retained accepted version; duplicate Keep
must return its original identity. This uses the public API on restart because
accepted hunk decisions may leave no unresolved UI hunks.

Proof requires the accepted payload hash, intended hash, identity, effect key and
location to remain unchanged, exactly one eventual timeline publication, one
canonical file and one effect row. Already-published canonical bytes must retain
their SHA256. Keep, recovery reads and duplicate Keep must make no inference
requests. The existing `verify-effects.py` independently counts retained effects,
files and timeline receipts after the native process closes.

The during-model case uses the fixture's held `PI_UI:INTERRUPT` stream. Pi must
acknowledge partial text with streaming status before SIGKILL; the response must
close without completing. Relaunch/read must make no new request and preserve the
partial interrupted answer. The exact message's normal Retry button makes one
fresh request with identical admitted user input and model and completes.

Pure validation does not open ports or launch apps:

```sh
node --check scripts/pi-prototype/fault-gate.mjs
node --test scripts/pi-prototype/fault-gate.test.mjs
python3 -B scripts/pi-prototype/publication-fault-proof.test.py
```

Prepared driver coverage is not native acceptance evidence until root executes
all cases successfully. This gate covers synthetic desktop publication/process
boundaries; transport-before-terminal, native storage faults, iOS, and live-provider
validation retain their separate gates.
