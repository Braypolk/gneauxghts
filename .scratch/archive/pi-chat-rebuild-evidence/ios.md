# iOS Pi simulator acceptance

Observed 2026-10-16. **ACCEPTED for the user-approved simulator scope.** The shared
Pi/native composition passes actual local-model streaming/read/compaction,
deterministic fault and authority journeys, real native publication/recovery and
different-process queued-work recovery. Final native validation passes 706 tests,
zero failures and 19 explicit ignored tests in one full current-source run.
Physical-device validation remains explicitly deferred. Desktop acceptance is
recorded in [08](desktop.md) and [09](../pi-chat-rebuild.md).

## Environment and evidence boundary

iPhone 17 Pro simulator, iOS 26.4.1, UDID
`FBAC4D90-9149-4B49-B40D-EA5B90B7069C`; isolated bundle
`com.braypolkinghorne.gneauxghts.pi-acceptance`, fresh generated `Documents/Notes`.
The actual local provider is `http://100.117.20.29:1234/v1`, model
`qwen3.8-27b-gsq-rco`. The model runs at that endpoint, not on the simulated phone.
Acceptance uses the shared production Pi/native owners with simulator-only probes;
synthetic deterministic provider responses are identified separately below.

`scripts/pi-chat/ios-acceptance.mjs` drives bounded phases and retains sanitized
receipts. Programmatic DOM actions establish WebView controls/runtime behavior;
they do not establish touch or software-keyboard behavior. The orchestrator
separately observed actual Simulator touch, source → read revision → back
navigation, software-keyboard `Hello` input/send, Home and Lock through CUA.
Those observations are separate from machine phase receipts. Actual Home/return
during live compaction was followed by visible terminal completion; this does
not establish physical-device suspension.

## Completed observations

- Actual local-model source-free chat terminates successfully with visible answer
  text and provider reasoning while Pi is busy, both in Pi progress and rendered
  UI. Reasoning is collapsed at terminal inspection. `liveSourceFree` records
  one provider request, 6,873 Channel frames and 1,865,974 provider bytes in its
  cumulative observation window.
- Actual local-model read chat executes native `search_notes` then `read_note`
  against the generated lantern note and terminates with an admitted source.
  Phases 20/21 bind the source to the actual native Note Revision, with one
  rendered source and collapsed reasoning. Its observation window records three
  provider requests, 366 Channel frames and 98,330 provider bytes. These are
  transport/observation totals, not normalized latency or model-time measures.
- Deterministic restriction journeys exercise read defaults, explicit note
  attachment, restricted reads and exclusion retirement. Phases 40/41 deny an
  unattached note (`unavailable_note`) and permit the attached lantern note.
  Exclusion retires affected authorities; phases 43/44 report the original
  authority retired and deny its issued source (`retired_authority`). Human
  history remains inspectable. `/tmp/pi-rebuild-ios-restrictions-03.log` retains
  the final restriction journey; earlier helper failures remain historical.
- Deterministic queue journeys withdraw a queued submission and Stop running
  work (phases 54/55), then complete independent foreground work and a queued
  follow-up in another chat (phases 61–63). The latter terminal receipt has two
  user entries, two terminal assistant entries and an empty queue. The script's
  final selection step timed out because a title-based helper encountered a
  duplicate title; this is not a completed full-script pass. Conversation-ID
  selection was corrected and exercised by actual stopped-chat reopening in
  phases 75–77. That reopening occurs in a different process, selects conversation
  99, preserves its original entries and aborted assistant, and has no active
  task or queued submission.
- Actual local-model standard compaction installs head `pi.compaction` with
  reason `threshold` (phase 74). From 454,214 generated source-free characters
  and 457,925 pre-compaction context characters, public context falls to 90,227.
  The actual continuation request contains 88,183 message characters, includes
  the summary/recent seed and omits the old seed; all 16 human-visible synthetic
  history entries remain. The first helper incorrectly expected `pi.summary`;
  corrected offline assertions pass in
  `/tmp/pi-rebuild-ios-live-compaction-02-assertions.log`. This is source-free
  compaction evidence, not a combined long-history note/citation journey.
- A deterministic fixture exposes an actual invalid-note `read_note` tool error;
  phases 101/102 retain it and expand the visible tool details. The network
  journey closes actual fixture connections with `closeAllConnections`, then
  delivers a quota HTTP 429 on a subsequent request. Phase 111 retains 24 partial
  answer characters and terminal error entries. After restoration, New attempt
  (112/113) preserves the failed entries, appends a second user entry and
  terminates successfully. This is explicitly a combined connection-cut/quota
  fault, not isolated network-only failure attribution.
- A real held background compaction task is stopped through the shared UI.
  Phases 120–123 retain no compaction head and the task settles terminal/aborted;
  no late summary is accepted in that observation.
- Synthetic task inputs exercise real native create publication. Write Off is
  safely denied (`write_off`, phase 83). Phases 85–95 prove default review denial,
  exact approval, committed create and receipt reconciliation/replay, followed
  by an explicitly authorized direct create. Final build 07 repeats and expands
  these checks in second-session phases 7–50: default Off, required review/exact
  approval, receipt replay with zero additional native publication, authorized
  direct create, stale-base `changed_base` denial, fresh authorized update,
  revoked `stale_authority` denial, Always inheritance by a new chat and return
  to Off all pass with real native effects on generated notes.
- Second-session phase 50 holds the WebView acknowledgement after a real native
  update commits. The orchestrator verifies process 49572 terminated, then
  relaunches as 49937. Phases 51–61 settle original task 335 terminal/completed,
  reconcile the same receipt/content hash and make zero
  `pi_chat_publish_mutation` calls after restart. The same Temporary authority
  remains valid only in original conversation 323; new conversation 336 is Off.
  This is actual lost-acknowledgement recovery, not mocked publication.
- A stronger changed-body repeat (second-session phases 77–89) finalizes a
  distinct generated baseline, then interrupts committed task 365 before its
  acknowledgement. Verified process 50401 terminates and 51603 recovers the same
  receipt with zero additional publication calls. The body hash changes, all
  four prior revisions remain, and exactly one new revision exists after recovery.
  `ios/changed-body-recovery.json` in the evidence archive records that assertion.
- A second actual termination interrupts reasoning streaming with one durable
  queued follow-up in conversation 348 (second-session phases 62–65). Pi and
  the UI show reasoning while busy; answer text has not yet streamed. Process
  49937 is verified terminated, then 50401 reopens the same unretired authority.
  Phases 66–68 finish the original work and follow-up with no active task, an
  empty inbox and exactly two unique user entries: the original ID/hash remains
  intact and the queued user occurs once. History preserves the aborted
  zero-text reasoning attempt and two completed 34-character answers. The settled
  CUA screenshot shows both completed responses and collapsed reasoning, including
  the original interrupted attempt. This proves Pi recovery under
  valid authority without duplicating queued submissions.

The first gesture screenshot briefly appeared blank while measured WebView
geometry remained valid; a later screenshot repainted without another interaction.
That observation alone does not support a product defect or product fix.

## Packaging failures and correction

The first package attempt failed because SwiftPM's new build backend selected an
incompatible SDK. A temporary shim selecting supported `--build-system native`
corrected the environment. An unsigned simulator app then failed secure-store
configuration; signing only the main executable was rejected. Normal Xcode ad-hoc
signing with simulator entitlements passed and enabled ordinary secure-store
configuration. These are build/signing environment observations, not a credential
bypass or physical-device signing acceptance.

Final signed simulator build 07 is
`/private/tmp/gneauxghts-pi-ios-build-nsvq1E`. Build evidence includes
`/tmp/pi-rebuild-ios-build-01-sdk-failed.log`,
`/tmp/pi-rebuild-ios-build-02.log`, `/tmp/pi-rebuild-ios-package-03.log`,
`/tmp/pi-rebuild-ios-build-04-layout.log`,
`/tmp/pi-rebuild-ios-build-05-selection.log` and
`/tmp/pi-rebuild-ios-build-06-save-diagnostic.log` and
`/tmp/pi-rebuild-ios-build-07-relocation.log`. Build completion alone does
not establish a post-install run-wide acceptance pass.

## Resolved product failure and final verification

After signed replacement, an ordinary save of an existing generated note failed
generically in phase 98. Phase 126's diagnostic reports
`window_path_transition_required`: native history retained an absolute iOS
container path that differed after replacement. The native worker corrected the
path reconciliation, then fresh review found and corrected a concurrent-save
race. All three focused `publication_location_reconciliation` checks pass,
including deterministic concurrency, and the positive relocation regression
passes in the full native suite. Review cleared the correction.

After actual signed replacement, second-session phases 1–6 immediately save the
same generated note successfully. Native history records the move from container
`05A0DE8A-5D94-4635-B6BF-8B213794C6E0` to
`D37845C7-9959-4293-87CB-1823C60E56DD`, preserving Note Identity and its original
revision; unchanged Markdown creates no duplicate revision. Subsequent native
update and lost-acknowledgement journeys above pass on that corrected build.

Current-source native tests: 706 passed / zero failed / 19 ignored in
`/tmp/pi-rebuild-native-final-ios-fix.log`. Final frontend tests pass 1,109/139 files and Node support32/32
(`/tmp/pi-rebuild-final-frontend-tests-05.log`). The sandboxed attempt04 stopped
on localhost-listener EPERM before Vitest; host-access05 passed. Final typecheck
has zero errors or
warnings (`/tmp/pi-rebuild-final-check-06.log`); simulator-controller tests pass
7/7 (`/tmp/pi-rebuild-ios-controller-tests-07.log`). The ordinary production build
passes (`/tmp/pi-rebuild-final-production-build-05.log`) and bundle inspection
finds no acceptance probes. Affected desktop native publication reruns pass 6/6
in 28 seconds (`/tmp/pi-rebuild-publication-08-relocation.log`). These checks
support the shared correction without implying complete platform parity.

Second-session phases 94–96 restore the actual Qwen local-provider metadata and
leave a fresh blank chat idle. A settled CUA screenshot verifies that ready view.
The owned fixture provider and acceptance controller are closed; the isolated app
remains open with its actual local model. No requested simulator gates remain.

## Diagnostic observations and limits

Across the cumulative workload, main database bytes rise from 712,704 after
session one to 1,085,440 after final run 07. WAL remains 4,173,592 bytes and SHM
32,768 bytes in both snapshots. Main app-process RSS is 288,128 KiB at final
inspection. These snapshots include generated long history and publication
fixtures; they are not normalized workload comparisons, do not include WKWebView
helper-process memory and are not clean-close/checkpoint measurements. Fixed WAL
allocation does not imply fixed logical history size or prove unbounded growth.

Physical-device validation is deferred by explicit user instruction and is not a
completion gate. Simulator results do not establish physical-device memory,
suspension, device signing, distribution behavior or performance. No live hosted
provider, full platform parity or performance win is claimed. Bridge calls and
serialized bytes describe adapter observation, not internal SQL counts or Tauri
outer overhead; cumulative transport time is not pure model time. No permanent
numeric budget follows from these diagnostics.

## Evidence retention

Selected durable sanitized evidence is retained under
[the rebuild evidence archive](.), with
`ios/` and `desktop/` subdirectories. Raw first-session sanitized phase receipts
remain at `/tmp/pi-rebuild-ios-phases-run01/`; second-session receipts are at
`/tmp/pi-rebuild-ios-phases/`. Identities and selected terminal observations are
also retained there. The first session's immutable closed controller
record is `/private/tmp/pi-rebuild-ios-receipts-eHwlrM/ios-acceptance.json`.
The replacement controller output root is
`/private/tmp/pi-rebuild-ios-receipts-dP9OEi/`.
The first controller retains configuration/selection deadline interruptions
(4/64) and an old-launch ready race (124), with
`underlyingProductMayContinue: true`. These are test-harness faults: a controller
deadline is not a terminal product failure or proof of cancellation.

Journey logs: `/tmp/pi-rebuild-ios-real-read.log`,
`/tmp/pi-rebuild-ios-restrictions-03.log`, `/tmp/pi-rebuild-ios-queue.log`,
`/tmp/pi-rebuild-ios-stopped-restart.log`,
`/tmp/pi-rebuild-ios-live-compaction.log`,
`/tmp/pi-rebuild-ios-live-compaction-02-assertions.log`,
`/tmp/pi-rebuild-ios-network-02-terminal.log`,
`/tmp/pi-rebuild-ios-network-02-recovery.log`,
`/tmp/pi-rebuild-ios-background.log`, `/tmp/pi-rebuild-ios-publication.log`,
`/tmp/pi-rebuild-ios-save-diagnostic-02.log` and
`/tmp/pi-rebuild-ios-relocation-positive.log`,
`/tmp/pi-rebuild-ios-publication-07.log`,
`/tmp/pi-rebuild-ios-publication-interruption-07.log`,
`/tmp/pi-rebuild-ios-publication-recovery-07.log`,
`/tmp/pi-rebuild-ios-queue-interruption-07.log` and
`/tmp/pi-rebuild-ios-queue-recovery-07.log`. Diagnostic snapshots are
`/tmp/pi-rebuild-ios-storage-after-run01.json` and
`/tmp/pi-rebuild-ios-storage-final07.json`. Raw `/tmp` paths are ephemeral; the
archive retains selected evidence needed for the accepted conclusions. Private controller
metadata, credentials, raw provider bodies and live databases are not needed to
support this outcome.
