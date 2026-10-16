The root/native-lease owner runs `node scripts/pi-prototype/native-transcript-gate.mjs`
after rebuilding the normal-workspace `pi-prototype,e2e-wdio` debug binary and
finishing the default checkpoint. The driver refuses occupied standard ports
1442/1443/4445 and private `PI_PROTOTYPE_DATA`. It launches only its owned Vite,
fixture and binary, records screenshots and synthetic request bodies, closes the
application before SQLite inspection, and reports failures in its generated root.

Pure preparation checks (no native launch, build, ports or Git):

```
node --check scripts/pi-prototype/native-transcript-gate.mjs
node --test scripts/pi-prototype/native-transcript-gate.test.mjs
python3 -B scripts/pi-prototype/verify-transcript-effects.test.py
python3 -B -c "import ast,pathlib; ast.parse(pathlib.Path('scripts/pi-prototype/verify-transcript-effects.py').read_text())"
```

The desktop journey uses both provider protocols through native transport. Normal
chat/review/conflict buttons operate on canonical native files. Node writes the
external edit and deletion. It requires watcher-driven conflict display without
polling the conversation getter, an ordinary copy of the external edit, exact
restoration, acknowledged pending review display, no implicit inference,
same-identity relocation, citation navigation, stable Origin lookup, inert copied
legacy Markdown, unknown-root rejection, and one native publication for an
uncertain Keep reconciled by explicit UI Retry. Closed before/after snapshots
retain original payload hashes, target fields, proof, receipt and canonical byte
hashes. Native proofs/accepted JSON are never rewritten by the driver.

Relocation moves the **entire generated evaluation data root**, including its
vault and Pi/native state, after `prepare_restart` returns portable/ready and the
process stops. The current opt-in native composition fixes the Running Vault
below the generated root, so a standalone Settings-selected vault move is not
established. The driver does not replace strings in settings or SQLite.

iOS follow-on remains pending. The existing `ios-interactive-gate.mjs` has no
WebDriver execution seam and boots an embedded shared probe; porting desktop
JavaScript into that driver would not exercise its WKWebView. Extend the shared
normal-workspace probe with explicit transcript-first/relocated phases, emitted
phase receipts and native `prepare_restart`, then have the root lease owner stop
the disposable simulator app, perform external Markdown edits from its synthetic
container, and relaunch to operate the same normal conflict/review controls. iOS
currently fixes its isolated vault at Documents/PROTOTYPE-wipe-me; relocation
there requires a retained identical vault manifest plus its app-local Pi/native
state, with composition remaining within the isolated container. Record actual
SDK/runtime/build constraints, screenshots, native effect snapshots, and both
protocol request counts. Until that probe executes, this driver supplies desktop
evidence only and cannot satisfy ticket12 or live-provider requirements.
