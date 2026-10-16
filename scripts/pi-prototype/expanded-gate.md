# Expanded native acceptance preparation

These files prepare ticket 12; they do not record a native or iOS pass. Run the
shared desktop milestone first. The expanded follow-ons and bounded live checks
remain required, as listed in `expandedProbeContract.ts`.

`ios-interactive-gate.mjs` installs only the isolated Pi bundle into an explicitly
selected, already booted disposable simulator. It always allocates fresh synthetic
data, uses the existing normal workspace journey and captures native receipts,
canonical synthetic bytes, SQLite backups, request observations and screenshots.
The existing `run.mjs ios` build retains its Xcode SDK/runtime workaround; this
driver neither selects another compiler nor modifies the generated Rust phase.
The wrapper never invokes inference on launch recovery itself. Its reused shared
relaunch phase first verifies an interrupted partial, then clicks explicit Retry.
It next invokes the shared `failures` phase for checkpoint handoff failure,
stale citations, changed targets and dirty ordinary-editor retention.

Required integration, owned by the main implementation agent:

- Return `report` at the end of `runInteractiveProbe`, after native report writing.
- Return `expandedGate` from `pi_probe_config`, reading `PI_PROTOTYPE_EXPANDED_GATE`.
- Under the existing `VITE_PI_PROTOTYPE` condition, import/run `expandedProbe` only
  for the explicit `piExpandedTest` query. Its native fixture/interactive/expanded
  checks all have to pass before any journey starts.
- For `PI_PROTOTYPE_EXPANDED_GATE=true` in diagnostic iOS builds, use the normal
  workspace window URL `/?piExpandedTest=1`; do not mount `/pi-prototype`.
- Add `ios-interactive-gate` to `run.mjs` modes and dispatch this new driver.
  The driver builds through `run.mjs ios` unless `PI_PROTOTYPE_IOS_APP` points to
  an already built isolated app with that query embedded.

After integration and native lease admission:

```sh
PI_PROTOTYPE_SIMULATOR=<owned-booted-simulator-uuid> pnpm pi:prototype ios-interactive-gate
```

Existing `ios-gate.mjs` remains the separate earlier diagnostic baseline. This
new gate's `passed` status covers its shared fixture observations only. Its
`ticket12Status` and `unobserved` fields explicitly retain unfinished required
checks. Protocol presence in a mixed journey does not establish full flow parity
for each protocol. The synthesized editor chord for Open in chat is not a touch
gesture. Launching Preferences establishes background/foreground observation,
not OS suspension, pressure, physical radio or distribution guarantees.

Pure preparation checks (no native app, simulator or port):

```sh
pnpm exec vitest run src/lib/prototypes/pi/expandedProbe.test.ts src/lib/prototypes/pi/expandedProbeContract.test.ts
node --test scripts/pi-prototype/expanded-report.test.mjs
python3 -B -m unittest discover -s scripts/pi-prototype -p 'test_verify_workspace_effects.py'
node --check scripts/pi-prototype/ios-interactive-gate.mjs
```
