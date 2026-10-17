# Desktop Pi acceptance

Observed 2026-10-16. **Desktop acceptance passes after cleanup 09.** Current-source
native UI/runtime run 05 passes **10/10**, publication run 07 **6/6**, automatic
compaction fixture run 02 **2/2**, and actual local-model run 02 **2/2**. Actual
local-model compaction run 01 passed **1/1 before cleanup**; the unchanged standard
Pi compaction owner/path retains that evidence, without claiming a post-cleanup
live compaction rerun. Simulator acceptance is recorded separately in [ios.md](ios.md). This report makes
no iOS, physical-device or live hosted-provider claim.

## Environment and reproducible entry points

Ordinary `/` workspace with generated disposable Running Vault, isolated app-data
and documents roots; no original notes or direct live SQLite inspection. The final
native debug build uses `e2e-wdio`, SHA-256
`0916359747bf0ed5da732a240eca0032c8fe03bc2707e124d63ea3a9176a281b`,
recorded by `/tmp/pi-rebuild-cleanup-native-build.log`. The instrumented frontend
uses the shared working-tree source through Vite. Pi Durable/Pi AI/Chord are 1.3.0;
macOS WKWebView reports WebKit 605.1.15; Node 24.2.0/pnpm 12.9.1.
Current native harness setup is documented in [e2e/README.md](../../../e2e/README.md);
the historical environment plan was consolidated after completion.

Run `pnpm exec wdio run e2e/wdio.native.conf.ts --spec <spec>` after building the
isolated binary and coordinating its ports/lifecycle. Specs are in
`e2e/specs/native/`. `GNEAUX_PI_ACCEPTANCE_OUTPUT` retains sanitized receipts.

| Lane / spec | Gate | Final evidence |
| --- | --- | --- |
| Deterministic HTTP/SSE faults, `piChatNative.spec.ts` | `GNEAUX_PI_FIXTURE_ACCEPTANCE=1`, `GNEAUX_PI_PROCESS_RESTART=1` | Native run 05: 10/10, 34.2 seconds, actual different-process restart |
| Synthetic Pi tasks, real native writes, `piChatPublication.spec.ts` | `GNEAUX_PI_PUBLICATION_ACCEPTANCE=1`, restart gate | Publication run 07: 6/6, 24.9 seconds |
| Actual configured local model, `piChatLocal.spec.ts` | `GNEAUX_PI_LOCAL_ACCEPTANCE=1` | Live run 02: 2/2, 2 minutes 49 seconds |
| Automatic compaction, `piChatCompaction.spec.ts` | `GNEAUX_PI_COMPACTION_FIXTURE=1` | Fixture run 02: 2/2, 9.5 seconds |
| Actual local-model compaction, same spec | `GNEAUX_PI_COMPACTION_LOCAL=1` | Pre-cleanup live run 01: 1/1, 2 minutes 12.3 seconds; fixture-only Stop skipped |

Live lanes use `http://100.117.20.29:1234/v1`, model `qwen3.8-27b-gsq-rco`.
Deterministic model responses are separate from these live results. Embedded
WebDriver/DOM input reaches production controls/owners; this is WebView event
acceptance, not foreground OS keyboard, pointer or touch acceptance.

## Accepted desktop behavior

Native run 05 proves visible text/reasoning before terminal completion, actual
Pi progress, read receipts and terminal citation admission, visible tool errors,
queue withdrawal/Stop including background work, independent running chats,
composer drafts, terminal failure followed by a fresh New attempt, explicit
attached-note access, honestly historical reads, in-flight exclusion/source denial,
read narrowing into fresh context, and persisted chat/composer reopening in a
different Rust process without new inference. Title/list changes and conversation
switching do not trigger unsolicited provider requests.

Live run 02 separately proves source-free text and reasoning streaming in both
Pi progress and the rendered UI. Another conversation actually executes native
`search_notes`/`read_note`, answers the generated `LANTERN-742` fact, admits its
issued source and opens its destination. The observer records four provider
requests, 10666 actual Channel frames and 2898860 provider bytes across both
cases. Provider transport time totals 164667 milliseconds; this is a cumulative
native-fetch window, not a pure model-time or user-visible latency measurement.
No raw reasoning or provider bodies are exported by the observer.

Publication run 07 uses synthetic task inputs with real native NoteTimeline
create/update effects. It covers default review/exact approval and receipt replay,
explicit direct authority, changed-base rejection and a fresh authorized update,
revocation, Temporary authority surviving a real process restart only in its
original chat, and actual dirty-editor protection. Human Markdown remains intact;
the expected dirty-owner task fault occurs before any native publish invocation.

The sixth case parks a **real committed native acknowledgement**, navigates to
Settings and back in the same WebView, and verifies that replacement editors and
the new owner wait for predecessor canonical adoption. Release settles the
original task with one native publication; receipt replay makes zero publication
calls; a second real update succeeds through the replacement owner. This is
actual SPA acknowledgement/adoption/remount proof, distinct from crash/reopen
fault fixtures and from simulator suspension/termination acceptance.

Fixture compaction run 02 seeds 454214 generated source-free characters through
public Pi history APIs. An ordinary send installs a standard threshold summary,
reduces public model context from 457440 to 88273 characters, and sends a
continuation with summary/recent seed but no old seed (86691 message characters).
Human history remains retained. A held background compaction is stopped through
the UI and ends aborted without a late summary head. Fixture capacity 129280 is
explicit test metadata; absent fixture usage stays zero.

Pre-cleanup live compaction run 01 uses observed loaded capacity 129280, the same
generated-history method and unchanged upstream policy. Public model context
falls from 457675 to 90345 characters; the actual summary/continuation requests
contain 370857/87953 message characters. The continuation contains summary/recent
seed and omits old seed while durable human history remains. Pi reports 84805
input and 898 output tokens, including bootstrap, summary and continuation.
This source-free live compaction proof does not establish a single long-history
live note/tool/citation continuation journey. Native/parser authority and citation
checks cover those seams separately; semantic entailment is not asserted.

## Repository verification and retained failures

Final current-source checks: `/tmp/pi-rebuild-cleanup-ts-tests-03.log` passes
1109 tests in 139 files; `pi-rebuild-cleanup-pnpm-check-05.log` has zero Svelte
errors/warnings and passing E2E types; `pi-rebuild-cleanup-production-build-03.log`
passes the production static build. Native integration tests pass 24/24 in
`pi-rebuild-cleanup-native-integrations.log`.

The native unit aggregate is **702 passing, 19 ignored across two runs**, not a
single all-green current-source run: `pi-rebuild-cleanup-all-native-tests.log`
passes 701 with one stale serialization-contract assertion failing; after its
correction, `pi-rebuild-cleanup-native-serde-03.log` passes that current contract
1/1. No additional behavior failure was hidden by this aggregation.

Earlier native runs 01/02 failed containment/access selector/idle-frame checks.
Canonicalizing macOS `/var` aliases, dispatching actual select input/change and
waiting for Pi policy/list state resolved those checks. Publication dirty run 03
exposed a product defect: a refreshed WebView left its predecessor owner registered
and publication waited indefinitely. The owner rebind/failed-owner repair passes
focused dirty run 05 and full runs 06/07. Dirty setup run 04 failed because
programmatic focus did not reveal the split-button option; explicit delivery of
the existing pointerenter handler resolved setup, without weakening dirty-content
or native-effect assertions. Final driver afterSession cleanup warnings do not
change the passing spec results. Earlier evidence remains historical, not current
acceptance failures.

## Diagnostic observations and limits

These cumulative observer windows include inspection and generated-history
insertion. Serialized IPC envelopes exclude Tauri outer overhead. Adapter calls
include reads, writes and observation, not native internal SQL statement counts.
Elapsed invoke sums overlap and are not per-turn latency or model time.

| Final native run 05 observation | Before process restart | After restart |
| --- | ---: | ---: |
| `pi_sql` calls | 3853 | 30 |
| Provider requests | 19 | 0 |
| Channel frames / provider bytes | 112 / 12009 | 0 / 0 |
| Pi database / WAL / SHM bytes | 184320 / 4136512 / 32768 | 212992 / 0 / 32768 |
| App RSS, KiB | 168672 | 188992 |

| Final fixture compaction run 02 | Short bootstrap | After automatic compaction |
| --- | ---: | ---: |
| `pi_sql` calls / summed milliseconds | 191 / 187 | 643 / 465 |
| IPC argument/result bytes | 36858 / 9486 | 568795 / 2683194 |
| Pi database / WAL bytes | 4096 / 444992 | 4096 / 1961152 |
| App RSS, KiB | 163664 | 174144 |

The live run 02 window reports 11675 `pi_sql` calls, 1871872/532275 argument/result
bytes, database/WAL/SHM 290816/4132392/32768 bytes and RSS 179280 KiB. Its long
reasoning stream and observation window differ from the deterministic fixture;
these measurements are not a normalized comparison or acceptance budget.

Static inspection explains the main mechanisms: upstream SQLite storage executes
statements/transactions through the native adapter and retains immutable history;
public views and acceptance inspection also query it. Native storage uses WAL,
`synchronous=FULL` and explicit close checkpoints. WAL allocation/page reuse and
automatic checkpoints do not imply truncation. The smaller checkpointed database
and zero WAL after clean restart distinguish WAL allocation from retained logical
history. Measurements do not establish unbounded growth or exact amplification;
no batching workaround, fixed call-count test or permanent resource cap was added.

Pi owns submissions, queue, scheduling/cancellation, history, usage, parsing and
standard compaction. App code supplies native SQLite/provider routing/redaction,
note authorization/source/citation admission, canonical publication leases and
presentation. Product composition remains read-only with no model mutation tools.
Retirement is recorded in the [rebuild outcome](../pi-chat-rebuild.md);
[simulator results and limits](ios.md) are separate from this desktop proof.

## Evidence retention

Final logs: `/tmp/pi-rebuild-native-acceptance-05.log`,
`/tmp/pi-rebuild-publication-07.log`, `/tmp/pi-rebuild-compaction-fixture-02.log`,
`/tmp/pi-rebuild-local-02.log`; pre-cleanup live compaction:
`/tmp/pi-rebuild-compaction-local-01.log`.
Selected sanitized receipts under `/tmp/pi-rebuild-acceptance/`:
`pi-native-fixture-run05-passed.json`, `pi-publication-run07-passed.json`,
`pi-compaction-fixture-run02-passed.json`,
`pi-compaction-background-stop-run02-passed.json`, `pi-local-model-run02-passed.json`,
`pi-local-source-free-run02-passed.json`, `pi-local-read-run02-passed.json`,
`pi-compaction-local.json`. Earlier failure/repair receipts are retained there
for the comparisons above. These paths are ephemeral; preserve selected receipts
before host cleanup. No live databases, raw provider payloads or credentials are
required to reproduce these recorded conclusions.

## Final shared-native correction verification

Simulator acceptance exposed and corrected NoteTimeline admission after canonical
vault relocation. The rebuilt ordinary desktop E2E executable has SHA256
`28b61301ea88acb24b7601a95af39f2fda913b4ecd32a23dd001c09ad5289442`.
Affected publication run08 passes6/6 in28s, including real update, changed bases,
review/revocation, process reopening and held-acknowledgement SPA remount.
The current full native suite passes706/0fail/19ignored; frontend1109/139files and
support32/32, typecheck06 and normalproduction05 pass. Earlier live/compaction
journeys above remain unchanged-path evidence, not reruns on this new binary.
The final [check receipt](checks.json) records the current repository gates; [simulator outcome](ios.md) records the actual correction and
stronger changed-body recovery.
