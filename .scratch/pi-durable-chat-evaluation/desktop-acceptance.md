# First usable desktop acceptance

Ticket 08 remains open. This document describes a prepared fixture gate and the
remaining acceptance; preparation and pure tests do not establish native or live
provider success. Tickets 09–11 remain dependency blocked until 08 acceptance is
recorded by the orchestrator.

## Commands and receipts

The orchestrator owns the native build, application and simulator lease. Run the
normal workspace gate after recording acceptance of tickets 01–07:

```sh
env -u PI_PROTOTYPE_DATA pnpm pi:prototype interactive-gate
```

After the base journey passes, include the separately prepared failure phase:

```sh
env -u PI_PROTOTYPE_DATA PI_PROTOTYPE_INTERACTIVE_FAILURES=true pnpm pi:prototype interactive-gate
```

The command builds the isolated `pi-prototype,e2e-wdio` binary with the normal
workspace `/` entry. It always allocates a fresh generated temporary root and
refuses an inherited `PI_PROTOTYPE_DATA`. It refuses occupied fixture/dev/driver
ports rather than terminating unrelated owners. A native fixture-only flag and
`piInteractiveTest` query enable the driver; neither the ordinary installed app
nor the copied-vault entry runs it. The existing diagnostic route/gates retain
their separate baseline checks.

The gate records its root and `desktop-interactive-gate.json`. That receipt
contains the binary hash, phase reports, screenshots, synthetic provider requests,
model/protocol dispatches, cancellation/termination outcomes and transport
counters around deterministic Save. A failed phase records its error and bounded
visible UI text, and leaves the generated root for inspection. Do not commit a
copied user's vault or live request bodies as fixture evidence.

The fixture setup uses the public Pi API to create three fresh conversations,
and `save_note`/`finalize_note_editing_window` to create synthetic current/retained
note content through NoteTimeline. It never seeds generic native chat tables.
The selected-passage journey uses the normal split control to keep the selected
editor mounted beside chat; replacing a single editor pane with chat unmounts its
selection capability. Subsequent sends, conversation/model selection, permission decisions, source
navigation, review edits, Stop/Retry, whole-answer Save and Keep/Discard use the
existing ChatPanel, workspace and retained CodeMirror editor. The repeated-text
selection append uses explicit public Save inputs because the existing UI does
not collect a destination/heading; its review and Keep still use the ordinary
editor. That distinction is recorded in the gate receipt.

## Prepared fixture matrix

Every row below is **prepared, native execution pending** until a dated run
receipt is recorded. A phase pass alone is not completion of ticket 08.

| Behavior | Observable receipt/check |
| --- | --- |
| Source-free send/follow-up | Normal composer sends; fixture rejects missing prior source-free answer |
| Two conversation selection | Normal picker; B has its own single turn |
| Model change | Normal model picker; native request uses `pi-native-fixture-b` |
| Open note and selected passage | Current citation opens editor; selected canonical cursor is read before answer |
| Current citation | Delivered source selector; normal source button opens canonical note |
| Historical citation | Retained discovery/read; normal source button enters History Mode |
| Discovery/denial | Normal permission request; denial settles without a read |
| Allow once/read activity | Normal permission choice; native read produces admitted source and activity |
| Stop/Retry | Acknowledged visible partial; durable cancelled turn; normal Retry completes |
| Pending proposal editing | Actual CodeMirror/title edits; acknowledged version; switch retains text |
| Process termination/relaunch | Pending edits, model and interrupted partial survive; no request before Retry |
| Keep/Discard/dedup | Normal controls; duplicate Keep returns same canonical receipt |
| Whole-answer Save | Normal Save control; answer/origin preserved; ordinary review and Keep |
| Selection/existing-note addition | Explicit occurrence + Note Identity/heading; ordinary review; same target identity |
| Save makes no inference | Native transport counters equal around Save/Keep/duplicate/append |
| Open in chat | Actual saved wikilink, normal editor Mod-Enter, originating message visible |
| Failed checkpoint | Fixture-only persistence fault; visible error pins edited review during switch; clearing fault acknowledges exact bytes |
| Changed source | Dedicated note changes after admission; normal citation reports a stale-source error |
| Changed target | Dedicated target changes after review preparation; normal Keep conflicts and retains authored review |
| Dirty ordinary buffer | Bounded delayed proposal arrives during ordinary typing; buffer remains dirty and intact; later stale Keep preserves its autosaved bytes |

Pure implementation checks:

```sh
node --test scripts/pi-prototype/interactive-fixture.test.mjs
node --test scripts/pi-prototype/evaluation-data.test.mjs
pnpm check
```

The fixture contract checks both protocols without starting a server. They test
that unread discovery cannot produce a citation, historical selection chooses a
retained item, permission precedes reading, the source-free follow-up has its
previous answer, selection uses its exact cursor and retries are explicit.

## Remaining milestone evidence

- Execute the prepared native fixture gate and repair any integration failures.
- Execute the optional normal-UI failed checkpoint, dirty ordinary editor and
  source/target change phase; these are prepared checks, not observed outcomes.
  Focused implementation tests and the diagnostic gate are supporting evidence,
  not substitutes for the requested desktop observations.
- Run shared observable scenarios against old/Pi builds in separate generated
  roots. Compare identity, admitted state, publication count and visible outcomes;
  generated IDs/times may differ.
- Run bounded live local-compatible and hosted Responses journeys through normal
  settings: discovery/citation, source-free follow-up, reviewed mutation, Save,
  Stop/Retry and relaunch. Record unavailable external credentials/endpoints as
  explicit blockers. Configure keys through the separate app's Settings; never
  inspect Keychain contents or copied ordinary-app credentials.
- Smoke the persistent copied-vault entry and record unchanged-original proof.
- Record user feedback separately from agent observations. No user trial is
  claimed or required implicitly.

Research/compaction (09), attachments/web (10), managed transcripts/relocation
(11), expanded native faults and actual iOS acceptance (12), and replacement/
resource comparison/verdict (13) remain phase follow-ons. Branching, standalone
excerpts, import, physical-device acceptance and production adoption are deferred.
