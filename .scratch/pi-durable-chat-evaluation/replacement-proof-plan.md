# Replacement proof and paired resource capture record

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

Current checkpoint: 2026-10-16. Ticket [13](../archive/pi-durable-chat-evaluation/issues/13-replacement-proof-and-evaluation-verdict.md)
retains its ticket-12/native and final handoff dependencies. This record separates
actual current evidence, retained older observations and the historical capture
contract. The [spec](../archive/pi-durable-chat-evaluation/spec.md), [progress](progress.md), [ledger](replacement-ledger.md)
and [desktop matrix](desktop-acceptance.md) define scope. No production adoption,
net maintenance reduction or overall performance win is established.

## Current source and acceptance checkpoint — v51, 2026-10-16

Frozen source commit `81f3bf7` is captured at
`/private/tmp/pi-removal-final-20261016-v51`, canonical manifest
`f81a1549fca48d8ed191168acf4e4f924761d2f007046d5c2284bce6fde89a57`:
1585 captured files,1533 retained files and **52 actual legacy-file absences**.
The [v48→v51 delta](/private/tmp/pi-removal-final-20261016-v51/v48-v51-source-delta.json)
is nine diagnostic packaging/probe/test paths, with no Rust or product-runtime
change. Whole frontend digest is now
`3262311db05903e4009d630beb8008405bc4e3119333422f466a9795d566bbe2`;
it differs from v48/v49 because the diagnostic probe is included. **Fresh final
desktop/history/iOS/manual artifacts are selected; no desktop equivalence reuse
is the final index.** Retained v48 observations below stay separately pinned.

| Actual v51 artifact | Recorded result / pin |
| --- | --- |
| [Desktop compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/desktop-build.json) | Compiled with three exclusion checks passed; `pi-prototype,e2e-wdio`; SHA `6d39bbdd56b7f8e2d35b79f60e16a2d7e9d0cc03107b712dc7588b07ac150858` |
| [iOS compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/ios-expanded-build.json) | Compiled; `pi-prototype,e2e-chat-fixture,tauri/custom-protocol`; SHA `b3c224070042409b995f29a763227da31c822a28912971125fcf7796e45fb135` |
| [Manual compiler](/private/tmp/pi-removal-final-20261016-v51/artifacts/manual-build.json) | Compiler receipt; `pi-prototype`; SHA `78154483e2ed80efbf573a35775d55d364e34785bf87fcdba3e98a1c9996a48c`; ordinary two-launch/quit/root-retention acceptance passed (manual receipt below) |

**Whole v51 iOS expanded gate passed**,178 synthetic requests:
[BTSO9O receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json).
First14 and relaunch10 shared checks passed, followed by parent/worker compaction,
research/fresh reads, attachments/exact Retry/web follow-ons, exact latest-draft
refinement/restart and both-protocol source-after-read races/active worker Stop/
clean new research (14 requests per protocol). Fresh **same-launch post-CONT UI**
observed ordinary authored-note bytes, exact review version10 and acknowledged
partial without replay; following durable relaunch also verified retained state.
An active native transaction was armed424ms before STOP, then held across about
14 seconds against the10-second lease TTL: stale COMMIT rejected `Revoked SQLite
owner`, zero rejected durable rows, stale owner revoked and fresh owner one row.
These are actual fresh observation/lease proofs, not the old static suspension
report. Controlled STOP/CONT remains distinct from actual OS pressure.
[Closed100-file backup](/private/tmp/pi-owned-simulator-v51-passed-whole-20261016/backup-receipt.json)
was retained and only the owned simulator app uninstalled.

**All five separate iOS crash/publication cases passed**,11 synthetic requests:
[yw2Vaa receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-publication-yw2Vaa/ios-publication-fault-gate.json).
The `after-intent`, `after-publication`, `after-receipt`, `prepared-review` and
`transport-completed` boundaries retain fresh launch/nonce/process ownership,
independently predicted exact drafts/canonical receipts and one-effect checks;
prepared outcomes and acknowledged partials restore without implicit replay,
then explicit Retry continues. These are bounded actual simulator fixture proofs,
not hosted/physical acceptance. The last case's
[closed45-file backup](/private/tmp/pi-owned-simulator-v51-passed-faults-20261016/backup-receipt.json)
was retained; root reports owned simulator shutdown exit0. Fresh post-CONT,
lease-spanning-STOP and these five boundaries now have actual v51 evidence; keep
their distinct protocol/fixture/platform limits. Final manual handoff is recorded below.

[Current v51 linked history](/private/tmp/pi-history-render-v51-20261016/history-render-revalidation.json)
passed on a copy of the closed generated v38 scale-v6 corpus. Exact1005
conversation identities/all2010 API and mounted DOM message IDs/content/order
matched before/after restart. Long-history ready observations were
**14023ms/13993ms**; obsolete rendering observed at192/2010 cancelled into an
empty conversation unchanged through200ms. Zero fixture/provider requests;
closed scoped counts identical (9053 current documents,1005 inputs/Meta), and
original corpus/receipts and tested source/artifact pins unchanged. This is current
restored-data/UI coverage, **not** new provider reseeding/compaction or comparative
resource measurement. DOM/timer checks do not prove physical paint/focus;
`frontendReceiptVerified:false`, recovered readiness retries and root closure
attestation requirements remain explicit.

**The initial v51 desktop whole attempt failed** at the first failure-slice CREATE before
admission, with the correct composer observed and cause unproven:
[xyySVL receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-xyySVL/desktop-interactive-gate.json),
[log](/private/tmp/pi-v51-desktop-supplement-native-20261016.log).
The serialized controlled identical-driver retry **passed**, exit0 and178
synthetic requests:
[O7czrc receipt](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json),
[log](/private/tmp/pi-v51-desktop-observed-retry-native-20261016.log).
[Operational provenance](/private/tmp/pi-v51-desktop-observed-retry-20261016)
retains frozen driver imports, immutable executable and matching Vite cwd with
catch-only read observation; no product/input change or mechanistic repair is
claimed. The first xyySVL attempt (receipt above, `xyySVL`) stays **failed**:
an unexplained flake, cause unproved. The retry is its own actual whole pass,
not borrowed v48 or iOS evidence.

[v51 pure checks](/private/tmp/pi-v51-pure-checks-20261016.json) bind the capture:
fresh support38/Vitest1711 in201 files/frontend and types zero errors/warnings,
e2e TypeScript passed; Node204 reuses exact unchanged v49 inputs, Python90 exact
unchanged v41 inputs. The static receipt's `native-unrun` field describes its
recording time; later native receipts have their own status. Native compiler
input bytes, generated ACL deltas and required diagnostic packaging remain
separately recorded; no temporary runtime diagnostics or cost claim follows.

**Final normal manual handoff passed on the actual v51 bundle:**
[manual acceptance](/private/tmp/pi-v51-manual-acceptance-20261016.json) binds the
source manifest and manual executable above. Both normal launches restored exact
`pi-review-163`, “Pi final handoff scratch” / `PI FINAL HANDOFF READY`, with one
hunk and normal Keep enabled; normal Keep on launch2 published the exact Markdown
body. Both READY responses completed through normal UI, both Cmd-Q owner runners
exited0, and prior synthetic note/history survived without reset or recopy.
[Known synthetic canonical readback](/private/tmp/pi-v51-manual-synthetic-canonical-20261016.json)
retains the initially incorrect diagnostic whole-file/body assertion and its
corrected frontmatter-separated exact-body check; no product change followed.
This is local-model manual acceptance, not hosted acceptance or a new full
permission/Save/cancellation cross-product. The earlier
[v50 preparation](/private/tmp/pi-v50-manual-preparation-20261016.json) keeps its
own preparation scope.

[Root final native closure](/private/tmp/pi-v51-final-native-closure-20261016.json)
records `nativeClosed:true`, closed persistent/original apps, both manual owner
exits, free owned ports, owned simulator shutdown/uninstall with retained backups,
and identity-verified owned caffeinate cleanup. These are scoped root observations,
not independent OS-wide write tracing.

[Final evidence index](/private/tmp/pi-v51-final-evidence-index-20261016.json) now
exists and binds final source/builds, five selected proofs and retained failures.
Its `acceptanceVerdict:null` is intentional hash binding, not semantic acceptance.
[Root final semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json)
records `passed-bounded-evaluation-delivery`, all13 implementation tickets and
`boundedRequiredAcceptanceComplete:true`, with the decision narrow/continue
isolated evaluation and deferred default adoption. Archive reconciliation is
complete; the [archived outcome](../archive/pi-durable-chat-evaluation/outcome.md)
contains the 13 final ticket reconciliations outside the executable backlog.

**Recommendation: narrow/continue isolated evaluation; defer default adoption.**
Material bridge/storage regressions and remaining hosted/physical/measurement
limits support that bounded recommendation, not a performance win or net
maintenance reduction. Hosted live is user-deferred; physical device/radio/
distribution, real OS pressure, private disposal/collection and full IPC/process
memory remain unverified. Native/manual terminal evidence and root bounded semantic acceptance are complete
within these recorded scopes. Archive reconciliation is complete; the historical tickets and spec are outside
the executable backlog. Real user feedback remains separate; production default runtime/ADR0001 remain intact.

### Retained v48 desktop/history and default-smoke evidence

Actual v48 source commit`02d6111`, canonical
`c76d594904d38c5c9e206f6fcbb3fc32e2d719e09a1d58ab490655dfd6f4fcb2`
(1583 captured/1531 retained/52 absent), desktop
`a930ca9adeaf42097521b593cb89280a85c054d00c27795bc07af9ab7d6b3467`,
frontend`46006fd4223669dd229ee83ec2e9342b7c7128f34268152129fe57ab7d475fa0`:
[whole KCwTai](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-KCwTai/desktop-interactive-gate.json)
passed178 requests, exact normal refinement7→8→10/restored10/Keep canonical and
three after-read source races plus active worker Stop/clean new research under
both fixture protocols (eight checks,14 requests/protocol). Its
[linked history](/private/tmp/pi-history-render-v48-20261016/history-render-revalidation.json)
passed2010 before/after restart,13040/8592ms,96/2010→empty cancellation, zero
requests and unchanged corpus. These remain actual historical passes; the separate v51 desktop retry above
now has its own whole pass, preserving the initial failed attempt.

[Current-frontend default smoke](/private/tmp/pi-v48-current-frontend-default-smoke-20261016.json)
passed14 in4 specs with one preexisting optional cursor-paint skip. It served
v48/v49 frontend46006fd4…bbe2 using retained v38 default-native
`d308c7aa0986ec00ecbea9a0a7c07a3328910e3919b3e3688b8694e68c673761`;
no new default compilation or v51 whole-frontend equality is claimed. The
original v38 extra-LF failure remains failed/cause unresolved. The ordinary
deliverable still retains its default runtime; comparison-tree removals are not
production source deletions or demonstrated maintenance savings.

### Retained failures and original-vault observation

- [v48 iOS l8ZTxK](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-l8ZTxK/ios-interactive-gate.json) failed after first14 at CSP control `Load failed`, before suspension; [49-file closed backup](/private/tmp/pi-owned-simulator-v48-failed-suspension-20261016) retained. Its compiled executable `59f0b539ec78a4eaa98ff2255825e4ba8aa031a07c2c316766d0c92d927ed412` is not a successful iOS gate.
- [v49 iOS tDkt12](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-tDkt12/ios-interactive-gate.json) failed canonical-conflict setup at retained CodeMirror review lookup after actual fresh-CONT/lease partial proofs; [57-file closed backup](/private/tmp/pi-owned-simulator-v49-failed-review-20261016) retained. Partial proofs are not a whole pass.
- [v50 iOS y7PETc](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-y7PETc/ios-interactive-gate.json) failed later web Save presentation; [90-file closed backup](/private/tmp/pi-owned-simulator-v50-failed-web-save-20261016/backup-receipt.json) retained. Its partial checks are not a whole pass.
- [v47 failure/closure](/private/tmp/pi-v47-native-failure-and-history-closure-20261016.json) retains failed whole desktop and linked history stalled624/2010. Earlier guard/Retry/loading/foreground-requested failures remain failed; actual focus and cause are not inferred from later passes.

The [final opaque original-vault observation](/private/tmp/pi-original-vault-final-observation-20261016.json)
was made after the user closed the ordinary app:388 files, read-only hashing,
no SQLite connection/source mutation. SHA
`759e94ba60290d368e6edcb3b15a11d55fe2db32216a1538086acd7a9b9a105c`
differs from prior`66a085d2…1863`, cause unestablished. Record scoped evaluation
agent-write isolation by owned roots/actions; do not assert continuous/final
original byte equality or attribute the difference from this observation alone.

[Post-v51-manual original observation](/private/tmp/pi-original-post-v51-manual-20261016.json)
records388 files and aggregate `759e94ba60290d368e6edcb3b15a11d55fe2db32216a1538086acd7a9b9a105c`,
equal to the fresh pre-v50-manual baseline only across that bounded manual interval.
It opened no SQLite connection or mutated source. Historical-seal inequality and
its unestablished cause remain; this does not prove continuous original equality.

## Retained measured comparison and full scale

Three controlled v38 paired core-resource runs passed, Pi/old → old/Pi → Pi/old,
24 bounded compatible requests. [Summary](/private/tmp/pi-v38-controlled-resource-summary-20261016.json)
and [table](/private/tmp/pi-v38-controlled-resource-summary-20261016.md) retain
exact lane pins, ranges and limitations: median warm module calls old26/Pi1085
(**41.7×**), logical storage old684378/Pi2059929 bytes (**3.01×**), one Pi null
response size/run, slower observed first-visible and Stop intervals. Module/JSON
proxy/debug/cache/observer/provider-partial/app-only-RSS limits prevent full IPC,
wire, all-process-memory or causal attribution claims. Lower startup/app-PID RSS
is not an overall win. Old/Pi prepared functional subsets and API grants do not
establish permission-dialog or full product parity. These costs remain pinned to
v38, not remeasured on v48; the older v8 measurement section below is historical.

[Full scale v6](/private/tmp/pi-product-scale-20261015-v6/product-scale-gate.json)
passed on its frozen v38 binary/frontend, exit 0 at 08:17:40 UTC: exact
1005 conversations/1005 inputs/2010 messages, 1005 answers plus six validated
synthetic compaction summaries/1011 requests, exact identities before/after
restart, ten archive/restores and no replay. [Accounting/limits](/private/tmp/pi-v38-scale-final-analysis-20261016.md)
and [native closure](/private/tmp/pi-v38-scale-root-native-closure-20261016.json)
remain separately bound. Final current documents9053; logical files64797047
bytes; private watcher/collection/IPC, full-process RSS, actual focus and compiled
frontend provenance remain unknown. Archive is not collection. The current linked
history check above is targeted restored-data/UI verification, not another full
provider/compaction or comparable resource run. Historical scale v5 remains failed.

## Historical preparation contract — 2026-10-15

The preparation worker operated no native application, build, provider, port or
simulator; its execution claims below are pure tests/offline counter smoke only.
Native observations above were produced later by the root native owner. The
following command templates and candidate matrix describe the reusable plan,
not an instruction to relabel historical source/binary pins or repeat every
already-passed gate regardless of the actual input delta.

## Evidence boundaries

- Pre-replacement source is `4b5ff2de500db089787b3d7adefb40d99f13a574`.
  Its pinned `e2e-wdio` binary has SHA-256
  `435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3`;
  canonical private receipts/binary live under
  `/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts`.
  Mutable `src-tauri/target/debug/gneauxghts` is not this artifact.
- `/private/tmp/pi-old-startup-baseline-SWnxTV/startup-baseline.json` is the
  existing single old startup preparation observation. Its incomplete renderer
  RSS and uncontrolled cache mean it cannot establish all-process memory or an
  improvement. Do not pair it with a differently observed Pi startup.
- The generated long fixture describes 1,005 submissions / 2,010 messages. An
  offline fixture file is not native history. Seed both owners through admitted
  APIs, verify exact totals and early/middle/late navigation, and separately
  create 1,005 conversations to exercise conversation-list pagination.
- Earlier diagnostic desktop/iOS results and zero generic lifecycle rows support
  only their recorded scope. Final startup, research, attachments, transcript and
  default-path checks require fresh evidence on the final source/builds.

## New capture helper

[`resource-capture.py`](../../scripts/pi-prototype/resource-capture.py) augments
[`measurement-report.py`](../../scripts/pi-prototype/measurement-report.py),
reusing its validation and timing/provider/IPC summary. It does not change that
helper's accepted schema or turn unknowns into zero.

| Command | Input / behavior | Limitation |
| --- | --- | --- |
| `pin` | Explicit already-owned app/renderer/helper PIDs; reads `/bin/ps -p <allowlist> -o pid=,ppid=,rss=,lstart=` with `LC_ALL=C`; outputs hashed start identities and roles | No discovery, args, env, names, signals or provider calls. Ownership and WKWebView attribution must be established independently. |
| `sample` | Pinned manifest, fixed requested cadence and bounded duration; retains numeric per-process RSS/PPID, PID/start hash and monotonic offsets | RSS timestamps follow each ps read. Collector clock is independent from the journey clock. It is a sampled maximum, not physical footprint or OS lifetime peak. |
| `storage` | One explicit generated root; aggregate SQLite/WAL/SHM/Markdown/other metadata through the existing safe-tree counter | No DB connection, SQL, checkpoint, file content or names. Logical sizes are non-atomic; allocated bytes and DB rows remain unknown. |
| `assemble` | Original closed journey input, shared comparison conditions, optional RSS/storage/native observer counters | Only validates/combines supplied observations. It neither instruments the app nor verifies the truth of a build/coverage attestation. |
| `compare` | Old/Pi bundles paired by scenario and positive pair index; median/min/max and paired differences | Requires equivalent conditions and verified-build attestations. Each metric still needs its own complete coverage. No performance threshold, tail-latency or adoption verdict is generated. |

`allProcessRssBytes` and its peak require both process and renderer coverage
`attested-complete`, plus a digest of the native owner's independent membership
evidence. A missing process or reused PID makes the capture's all-process peak
unknown even if later samples recover. Unknown/partial coverage retains observed
subset/app values without naming the subset an all-process total. `lstart` has
one-second precision, so same-second PID reuse cannot be excluded by this helper.
Native ownership must also rule out such ambiguity. On macOS, WebKit helpers may
be reparented or shared: descendant enumeration alone is insufficient. Include
every attributed renderer, networking/GPU/helper process needed by the chosen
definition, use the same definition in both lanes, and mark unknown if attribution
or transient membership cannot be established. The static manifest does not
discover newly created helpers; independent membership evidence must cover the
whole sampling interval, not only its beginning.

The sampler begins after the already-launched PID is pinned. For startup, attach
immediately after spawn and record the uncovered launch-to-attachment interval.
Do not claim a launch-to-ready memory peak when that interval is unobserved.
Whole-journey timing still starts before spawn in the native harness. Do not
merge collector `atMs` values into journey events without an explicit clock
calibration. Sample old and Pi with the same observer overhead and cadence.

All output files use exclusive creation. Existing evidence is never overwritten.
Inputs are closed counter schemas: command names, SQL, arguments, note paths,
prose, raw SSE, error text and credentials are not accepted. PIDs/start hashes
are local diagnostic identities, not Note Identities or durable app ownership.

## Runnable capture sequence for the native owner

Use fresh canonical `/private/tmp` roots and already pinned builds. These are
commands for the native lease owner after applicable acceptance dependencies;
the preparation worker has not run `pin`/`sample` or any native gate. The native
owner supplies shell variables from its own process handles, never from unrelated
process searches or stale receipts.

```sh
python3 -B scripts/pi-prototype/resource-capture.py pin \
  --app-pid "$comparison_app_pid" \
  --renderer-pid "$comparison_renderer_pid" \
  --output /private/tmp/pi-resource-pair-001/old-owned-pids.json

python3 -B scripts/pi-prototype/resource-capture.py sample \
  --owned-pids /private/tmp/pi-resource-pair-001/old-owned-pids.json \
  --interval-ms 100 --duration-ms 5000 \
  --output /private/tmp/pi-resource-pair-001/old-rss.json

python3 -B scripts/pi-prototype/resource-capture.py storage \
  --root /private/tmp/pi-resource-pair-001/old/data --state closed \
  --output /private/tmp/pi-resource-pair-001/old-storage-before.json
```

Repeat `--renderer-pid` and `--helper-pid` for the exact owned inventory. If
independent membership evidence proves complete attribution throughout the
interval, add `--process-coverage attested-complete --renderer-coverage
attested-complete --membership-evidence-sha256 <digest>` at `pin`; otherwise the
default unknown coverage is correct. Restart creates fresh PIDs/manifests.
`--duration-ms 0` is a single read. The example cadence/duration are capture
settings, not a performance target. Start sampling around the real scenario from
the owned harness; do not serialize the scenario after sampling has finished.

Capture matching after-storage at the same lifecycle state, using the real clean
close/checkpoint seam. `--state closed` is an assertion supplied by the native
owner, not something metadata alone proves. Never label a forced kill closed or
checkpoint only one lane. For separate nonoverlapping vault/app-data roots, run
separate snapshots and comparisons; do not sum overlapping roots twice. DB row,
family/collection and watcher counters come from bounded admitted read-only
counter probes, never from opening private copied vaults or inventing DB rows.

Create the original journey using the existing helper's template and populate it
from native observations; use the original startup/short/long/cancel case and an
additional `scenario` below for reopen/source/review/Save. The base journey case
remains an honest description of that journey. Additional operation spans belong
to `observer.operations` and never pretend to be send/completion boundaries.

For the old binary, the existing snapshot helper's source inspection describes
the directory containing that helper, not retroactively the binary's build.
Populate old journey provenance from the pinned old source/build/frontend
receipt. Do not set old `revision` to the current worktree just because the
capture helper ran here. Independently bind both binary digests, source revision
and exact dirty-source snapshot/diff, feature/config flags, lockfile and served
frontend state. Static frontend hashes and Vite-served source/config/dependency
hashes are different receipt kinds; the helper compares only the supplied digest.

The conditions input has this exact shape. `null` denotes an unobserved value;
the example is intentionally unverified and cannot produce comparable results.
Replace values only with evidence, without claiming these template settings are
measurements. Hash model routing and settings identifiers without including keys.
The shared configuration digest covers provider/protocol/reasoning/output policy,
semantic mode and comparable app configuration; lane-specific runtime feature and
bundle identity stay in each build receipt.

```json
{
  "scenario": "short",
  "pairIndex": 1,
  "order": 0,
  "buildVerified": false,
  "buildReceiptSha256": null,
  "modelSha256": null,
  "configurationSha256": null,
  "retentionOperationSha256": null,
  "semanticMode": "disabled",
  "windowState": "background",
  "rendererObservation": "two-animation-frames",
  "seededSubmissions": null,
  "seededConversations": null,
  "operationCount": null,
  "outputBudget": null,
  "samplingIntervalMs": 100
}
```

`order` is 0 for the first lane in a pair, 1 for the second. Reverse it in
alternating repetitions. `buildVerified: true` is permitted only after the native
owner verifies that exact receipt and hashes it; this helper cannot perform a
compiler/linker proof. Model/config/fixture/environment hashes, cache/provider/
protocol/build profile, output budget, seed counts, operation count, window/
semantic/paint observation and sampling cadence must agree. The comparator is
conservative about lockfiles: differing dependency locks refuse a numeric paired
comparison and require separately documented investigation. Build/frontend
digests may differ across lanes but must be pinned within a comparison series.
Use separate series for cold/warm, compatible/Responses, fixture/live, model or
build changes. `retentionOperationSha256` is required for a retention scenario;
other scenarios can use `null`.

The optional observer input has this closed shape; empty maps are valid unknowns:

```json
{
  "schema": "gneauxghts-pi-resource-v1",
  "operations": {
    "reopen": {"startMs": null, "settledMs": null, "observation": "two-animation-frames", "uncertaintyMs": null},
    "source": {"startMs": null, "settledMs": null, "observation": "two-animation-frames", "uncertaintyMs": null},
    "review": {"startMs": null, "settledMs": null, "observation": "two-animation-frames", "uncertaintyMs": null},
    "save": {"startMs": null, "settledMs": null, "observation": "two-animation-frames", "uncertaintyMs": null}
  },
  "transport": {"coverage": "unknown", "before": {}, "after": {}},
  "counters": {}
}
```

For each operation use one monotonic clock: start at the caller action, settle
after authoritative state and the real mounted destination is usable for two
animation frames. Reopen means the requested committed conversation is rendered;
source means the current or retained destination and exact passage is admitted;
review means the requested editable review and checkpoint barrier are ready;
Save means its deterministic pending review is ready, measured separately from
Keep/publication. Record paint/polling uncertainty honestly; a polling result is
not a paint timestamp. Operation observation must match conditions. Each map
contains at most one span per operation; repeated churn uses separate captures or
a separately defined aggregate scenario, not an overwritten endpoint.

Transport before/after accept only cumulative nonnegative `chunks`, `bytes`,
`frames`, `frameBytes`. Take deltas from the same instance; reset/decreasing
counters are refused. `nativeTransportStats.chunks/bytes` measure native provider
body chunks, not all Tauri IPC envelopes/frames. Missing frame counters stay
unknown. Original journey `ipc` events count every shared invoke boundary with
category/request/response UTF-8 byte counters; attach before the interval in
both paths. No SQLite cross-IPC calls in old can mean zero only under complete
invoke coverage. Provider transport interval union is not pure model inference,
and outside-provider elapsed includes bridge/tools/storage/observer work.

`counters` accepts only `listeners`, `watchers`, `documents`, `documentFamilies`,
`retiredDocuments`, `collectedDocuments`, `retainedMessages`, `retainedSubmissions`,
`retainedConversations`, each with optional numeric/null `before`/`after`.
Use equivalent definitions and admitted scopes in both lanes. Negative growth
after explicit collection is valid. A cumulative `collectedDocuments` counter
cannot be substituted for live documents or recoverable decision families.

```sh
python3 -B scripts/pi-prototype/resource-capture.py assemble \
  --journey /private/tmp/pi-resource-pair-001/old-journey.json \
  --conditions /private/tmp/pi-resource-pair-001/old-conditions.json \
  --rss /private/tmp/pi-resource-pair-001/old-rss.json \
  --storage-before /private/tmp/pi-resource-pair-001/old-storage-before.json \
  --storage-after /private/tmp/pi-resource-pair-001/old-storage-after.json \
  --observer /private/tmp/pi-resource-pair-001/old-observer.json \
  --output /private/tmp/pi-resource-pair-001/old-bundle.json

python3 -B scripts/pi-prototype/resource-capture.py compare \
  --old /private/tmp/pi-resource-pair-001/old-bundle.json \
        /private/tmp/pi-resource-pair-002/old-bundle.json \
        /private/tmp/pi-resource-pair-003/old-bundle.json \
  --pi /private/tmp/pi-resource-pair-001/pi-bundle.json \
       /private/tmp/pi-resource-pair-002/pi-bundle.json \
       /private/tmp/pi-resource-pair-003/pi-bundle.json \
  --output /private/tmp/pi-resource-comparison.json

python3 -B scripts/pi-prototype/resource-capture.test.py
python3 -B scripts/pi-prototype/measurement-report.test.py
```

Repeat assemble for Pi and each pair. Missing/partial metric inputs remain null,
even when other metrics are comparable. App-only/subset RSS, observed-only IPC,
live logical storage and original broad storage-growth diagnostics never receive
numeric paired deltas as retained/all-process results. Retained/category storage
differences require identical closed/checkpointed states across all boundaries.
The comparison reports known/total pairs and individual observations. Three
paired repetitions with alternating lane order are the minimum protocol, not a
statistical guarantee. Warmups are separate and excluded from cold comparisons.
No tail-latency, resource savings or zero-overhead conclusion follows automatically.

## Shared native resource scenarios

| Scenario | Same old/Pi workload and settlement | Counters and acceptance evidence |
| --- | --- | --- |
| Startup cold/warm | Before-spawn to actual workspace/chat usable + two frames; distinguish new process from same-process reopening and OS/provider cache state | App and attributed renderer/helper RSS; no build/server-setup time; attachment gap and observation uncertainty |
| Short send/follow-up | Identical source-free generated turns, provider/model/protocol/reasoning/output policy and UI state | First visible admitted answer, durable/displayed terminal, provider union/outside-provider/post-provider interval; all invoke counts/bytes and stream deltas |
| Long retained conversation | 1,005 real admitted submissions, short bounded context where appropriate; reopen early/middle/late messages and continue | Exact retained totals vs provider context, paging completeness/latency, transient documents/watchers, DB/WAL/SHM growth before/after identical close |
| Conversation list | 1,005 separate admitted conversations, list/navigate first/middle/last, restart and repeat | Complete list/cursor coverage; no silent cap; idle/churn listener/document/family count |
| Stop/retry/restart | Identical partial stream, Stop at equivalent observable point, durable cancellation, restart without network replay, explicit Retry | Stop-to-visible + durable settlement, transport end, no late publication, exact retained partial/retry context; cancellation RSS/storage |
| Reopen/source | Same committed conversation; ordinary current and retained citation destinations; access/source changes during work | Reopen/source spans; exact identity/proof/position and denied/stale behavior; no stale source authority |
| Review/Save | Create/update, dirty ordinary document, edit/checkpoint/switch/refine; whole-answer and repeated-selection Save, explicit append, duplicate Keep | Review/Save spans measured apart from provider/Keep; no-model Save delta, single canonical effect and stable Note Identity; retained pending/terminal families |
| Research/compaction/follow-ons | Both fixture protocols and bounded live journeys after 09–12 acceptance; attachments/web/transcript/relocation | Child isolation/cancellation/permissions/evidence; no Rust loop fallback; safe history/summary policy; transcript derived-only; asset/storage scope |
| Churn/retention | Identical fixed open/switch/close counts, idle settlement, same documented retirement/collection operation, restart | Before/after/idle listener + watcher + live/retired/collected family counts; verify needed receipts/history survive collection; retained bytes separately from logical deletion |

The current source uses `scanAll(..., 128, cursor)` and a stoppable watcher map in
`chatApi.ts`. That supersedes the earlier 1,000-scan/retained-set implementation
observation; it is not native proof of pagination or bounded idle resources.
Measure real owner lifetime through churn and retirement, including event/evidence
streams, mounted UI subscriptions, API instances, Harness/tasks and SQLite leases.

## Prepared shared core gate and native scale probe

The orchestrator requested an executable shared native starting point while it
holds the native lease. New
[`shared-resource-gate.mjs`](../../scripts/pi-prototype/shared-resource-gate.mjs)
is prepared for that owner; only its syntax and four pure planning/environment
tests have run here. Importing the module does not bind ports or run processes.
CLI execution verifies the pinned old digest and supplied Pi digest, requires a
fresh generated root and canonical source paths, refuses Vite `.env` files,
serves each exact source on its required dev port, and drives the real mounted
workspace/composer sequentially. Its child environment is an explicit allowlist
with exact dummy local/OpenAI debug overrides, so it does not read or replace
real keys. The local fixture accepts only absent or that exact dummy Authorization;
unexpected values are neither retained nor echoed. There is no `setApiKey` call.

```sh
node scripts/pi-prototype/shared-resource-gate.mjs \
  --root /private/tmp/pi-shared-core-pair-001 \
  --old-source /private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de \
  --old-binary /private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de/baseline-artifacts/gneauxghts \
  --pi-source /Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts \
  --pi-binary /absolute/canonical/pinned/pi/gneauxghts \
  --pi-sha256 <verified-current-Pi-binary-digest> \
  --first old
```

Use `--first pi` for the alternating pair. Ports 1430, 1442, 1443 and 4445 must
have no unrelated owner. The gate never terminates an existing port owner. It
starts only its own Vite/native children and fixture. No builds occur in the
gate, and old/Pi served source digests and dependency locks are captured and
checked for changes during execution. The old source directory must still match
its archived frontend receipt. `frontendReceiptVerified` remains false because
the gate itself cannot retrospectively bind that source tree to a prior binary
build. A source mutation/binary replacement refuses the result. Root coordination
must keep sources stable while this runs.

The old artifact pin remains
`435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3` by default.
An alternate baseline artifact can be supplied with `--old-binary` and optional
`--old-sha256`; the latter must contain exactly 64 lowercase hexadecimal
characters and match the actual file SHA-256. Omitting it never bypasses the
original pin. The paired parity driver inherits this same parser and supports
the same override. For a separately built baseline using features
`e2e-wdio,e2e-chat-fixture`, retain the source revision, exact build command and
feature flags, build log, artifact path and verified digest alongside the gate
report, whose lane records the actual binary hash. This identifies a different
artifact; it does not establish equivalence to the originally pinned binary or
claim execution. Paired Responses still separately refuses an artifact without
its loopback fixture override capability. All existing fresh-root, sealed-source,
dummy-key and artifact-change checks remain required.

This prepared core gate observes startup, a normal source-free send, a follow-up
that must receive the earlier assistant answer, visible partial-stream Stop,
durable terminal status, crash/restart with the exact committed message count,
and no implicit provider requests. It records app-only RSS samples, shared invoke
counts/byte events, server-side fixture stream frames/bytes and renderer-clock
calibration uncertainty. UI detection polls at 50ms then waits two frames;
startup polling uncertainty is 100ms. Native invoke polling is included in the
observed workload. All-process/renderer RSS, initial bootstrap IPC, native
transport envelopes, full client provider intervals, long/product paging,
source/review/Save and live/Responses journeys remain unproven. Fixture handler
intervals omit the client queue/upload/network, so `providerCoverage` deliberately
stays partial even with complete server-side observations: no overhead claim can
be derived from them. The output labels only `passed-core-fixture` or failed,
never ticket/phase acceptance. First native execution may reveal an adapter/UI
constraint and must be recorded as a failure. Raw local logs stay in the fresh
generated root; counter reports contain no requests, answers or credential text.

For scale preparation,
[`scaleProbe.ts`](../../src/lib/prototypes/pi/scaleProbe.ts) exports
`nativeScaleProbe('seed')` and `nativeScaleProbe('verify')`, with defaults of
1,005 engine conversations and 1,005 admitted submissions / 2,010 messages in
one long conversation. The native owner calls it through its existing WebDriver
async execution in a **separate fresh generated Pi fixture app**, before opening
chat or seeding other conversations:

```js
const { nativeScaleProbe } = await import('/src/lib/prototypes/pi/scaleProbe.ts');
return await nativeScaleProbe('seed');
```

After termination/relaunch into that same generated root, call `'verify'` instead.
The probe checks `pi_probe_config.fixture`, closes live ChatApi Harness owners,
opens native SQLite through the retained facade, and refuses seed when any
conversation already exists. Every identity comes from `Harness.createConversation`
and every turn from `Conversation.submit(...).wait(...)` with a faux provider;
there are no hand-authored lifecycle SQL rows or model/provider requests. It
pages real owner records and validates exact counts and early/middle/late inputs,
answers and conversation navigation, then persists an app-defined Pi marker via
`Harness.commit`. Verify reads that marker and records absence of provider replay.
The native owner must separately preserve the process/restart/SQLite receipts.

This is **engine/native storage scale**, not full ChatApi product parity: these
engine conversations do not receive the product Meta/evidence/review documents.
Its counter scopes explicitly report session and long-conversation documents;
all-document/family totals remain unknown. It is not an old/Pi resource comparison,
retention pass or a populated product conversation-list proof. Keep the required
product 1,005-conversation and long admitted ChatApi fixtures in the final matrix.
Its pure MemoryStorage tests prove real Harness admission and scans for small
turns plus 1,005 conversations; they do not stand in for native SQLite/WKWebView
or 1,005 native submissions.

## Final architecture and bounded removal proof matrix

Each row needs final-source compiler/structural evidence **and** native behavior.
An absent table row or source substring search alone cannot pass a row. Record
paths, exact symbol/function inventory, binary/source receipts, command/result and
private artifact digest for each final lane and removal lane.

| Concern | Excluded/retained candidate and one authoritative owner | Required final proof |
| --- | --- | --- |
| Startup and durable conversation/run state | Pi `lib.rs` composes `ChatDomain`; default `ChatService::new_managed` is cfg-excluded. Pi owns submissions/history/tasks; retained domain settings/drafts/access do not store lifecycle state | Pi graph and compile exclude `chat.rs` legacy owner/store/admission/recovery/runtime; real startup/restart has no legacy recovery/construction or mirrored conversation/run/message/proposal writes |
| Model/tool/research execution | Exclude `AgentRunCoordinator`, `AgentRuntime::run`, `agent_tools` including `agent_tools/research.rs`, default guardrails/permission broker; Pi owns parent and child execution | Compiled graph/removed-source build plus both-protocol parent/child/tool/cancel native journeys; no hidden direct native research/model/tool loop reachable beneath Pi |
| Frontend dispatch | Exhaustive `createPiChatApi` and lazy public ChatApi; named retained settings/key/access delegates | Supported conversation/retry/review/follow-on operations reach Pi; deferred branching/excerpts/import fail explicitly. No Proxy catch-all or native lifecycle fallback; complete interface checked on final code |
| Permissions/evidence | `ChatDomain`, `pi_prototype_notes`, retained current/activity/provenance/citation services; Pi documents hold issued bindings | Mandatory provider/tool/final-navigation validation, edited/renamed/excluded/revoked source races, policy cancellation and child scope; hook exceptions cannot bypass authorization |
| Proposal durability and canonical effect | Pi review documents/tasks own pending decisions; existing `ProposalReviewSession`/document runtime owns live text; native effect intent/receipt + `NoteTimeline` owns publication | Dirty/checkpoint/refine/switch/restart and every intent/publication/receipt/terminal fault settle to one effect or retained conflict. No legacy proposal lifecycle owner; Discard never publishes |
| Deterministic Save | Retained promotion/citation policy, Pi Save origin/review, canonical target by Note Identity | Whole/selection/append, exact repeated occurrence, ordinary source links/backlink, duplicate Save/Keep/restart and target rename/revocation; Save makes no model call |
| Attachments/web | Pi staged payload state and capability mapping, native transport/native asset/metadata effects | Both supported protocols, exact retry attachment identity/bytes, explicit unavailable capabilities, no native agent loop reinstated |
| Managed transcript/relocation | Pi committed-state projection and bounded native filesystem/relocation service | Transcript never becomes a second run store or instruction/evidence authority; conflicts/failures/relocation preserve committed identity and no legacy transcript-import recovery |
| Restart/iOS | Pi quiesce and joined owner work; native transport/SQLite owner closure before `NoteTimeline.clean_close`; immutable Running Vault | Missing/stale quiesce acknowledgement fails safely, lease disconnect/rollback/COMMIT failure cannot late-commit; actual iOS background/foreground/termination/relaunch and essential flows under 12 |
| Policy and maintenance cost | Retain editor/document/workspace machines, evidence/policy/NoteTimeline, native effect recovery, provider/SQLite bridge and Pi adapters/dependencies | Ledger counts responsibilities removed/excluded/retained/new separately; include Pi review/evidence/stream/history/compaction/projection state machines, task cancellation, leases and receipt reconciliation |

For the bounded experiment, the orchestrator first captures an exact reviewable
source snapshot of the **final integrated** implementation and its dirty/untracked
contents. In a separate disposable comparison source directory only, remove the
known cfg-excluded legacy owner/module files and their exclusive subtrees, including
legacy command modules. Preserve the exact removal patch and before/after path/
symbol inventory, source digest, dependency locks, frontend/config, commands and
build receipts. Do not remove shared leaf files reached by Pi `#[path]` attributes:
`chat/citations.rs`, `chat/date_time.rs`, `chat/structured_answer.rs`, plus retained
`proposal_policy.rs`, provider settings/utilities and required types. Derive the
actual removal list from the final Rust module graph, not a directory-name guess.

Build/test the real Pi app with those files physically absent, then run all
required desktop/iOS journeys on its pinned binary/frontend. Record compiler
errors and any extracted leaf obligations honestly. A source-test pass is not a
successful app link or runtime check. The current native source checker covers a
known cfg/path module graph and retained schemas/shutdown ordering; it does not
replace compiler evaluation across target/platform/features. Strengthen its final
coverage when 09–11 add new seams. A source checker that reads a deliberately
removed file may need to run on the retained pre-removal snapshot as supporting
evidence; the decisive removal evidence is compilation and behavior without it.

Record **actual removed functions in the comparison source** separately from
**conditionally excluded functions in the deliverable branch**. No production
function removal is claimed yet. Record omissions/deferred capabilities separately
from replacement. Added Pi adapters and native durable effect/lease/recovery
policy remain maintained app complexity, not automatic library savings. Physical
line/file counts are secondary to state owners, recovery paths and caller duties.
The deliverable retains the ordinary default runtime and ADR 0001 unchanged.

## Historical default-regression and final-gate run plan

These are historical command templates for the orchestrator's serialized native lease.
Current actual passes and remaining obligations are at the checkpoint above. Run
pure checks after final edits; compile/link the final source with separate output
receipts, and never treat a previous target-cache binary as the requested lane.
Do not change ordinary credentials or run the ordinary vault for these tests.

```sh
pnpm exec vitest run src/lib/architectureFitness.test.ts \
  src/lib/features/chat src/lib/features/proposals src/lib/prototypes/pi
pnpm check
pnpm test:support
node --test scripts/pi-prototype/evaluation-data.test.mjs
python3 -B scripts/pi-prototype/evaluation_data_test.py
python3 -B scripts/pi-prototype/measurement-report.test.py
python3 -B scripts/pi-prototype/resource-capture.test.py

cargo test --manifest-path src-tauri/Cargo.toml --features pi-prototype --test pi_lifecycle_exclusion
cargo test --manifest-path src-tauri/Cargo.toml --features pi-prototype --lib
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib
cargo build --manifest-path src-tauri/Cargo.toml --features pi-prototype,e2e-wdio
cargo build --manifest-path src-tauri/Cargo.toml --features e2e-wdio
```

The two final build commands illustrate the distinct lane flags; separate Cargo
output directories and native config/frontend receipts are required in execution.
Run each native command sequentially. Default `--lib` covers the altered retained
domain delegation and existing chat/proposal/NoteTimeline behavior. The Pi library
test total must include all integrated follow-ons and failures from 12. Preserve
ignored/live-test limits instead of counting ignored cases as passes.

Default native UI smoke uses the existing generated-root harness and freshly
built default artifact: `pnpm test:e2e:native:run` (app lifecycle, command/events,
images, chat-to-note). Retain supported default startup/settings/model routing,
proposal document handoff, background saves and history contracts. Additional
context/citation/research comparisons and live tests use explicit existing native
specs only when their isolated endpoints/credentials are configured; unreachable
live prerequisites remain unpassed. Pinned old is the behavioral baseline, while
the final default build proves the extraction did not regress production wiring.

For Pi/removal artifacts, `desktop-interactive-gate.mjs`, `desktop-gate.mjs` and
`fault-gate.mjs` currently expect the cwd's `src-tauri/target/debug/gneauxghts`;
their `run.mjs` wrapper also rebuilds and can overwrite that path. Bind the
isolated source's exact binary/frontend before direct gate execution and hash
before/after. Do not run the wrapper against a different artifact and call it a
removal pass. `ios-gate.mjs` can take `PI_PROTOTYPE_IOS_APP` for a verified supplied
app but uninstalls its separate bundle/container: use only its disposable fixture
simulator, never the persistent hands-on evaluation. Legacy diagnostics do not
cover the expanded normal-workspace matrix; ticket 12 must supply every required
new essential flow and fault on actual WKWebView, both fixture protocols and
bounded live journeys.

## Hands-on and verdict closure

After automated acceptance, retain the persistent evaluation app and its copied
vault for the user's ordinary hands-on use through [README](README.md). Repeat
source-free follow-up/model switching/reopen/restart, context/discovery/deny/grant/
current+retained source navigation, edited/queued/refined Keep/Discard, whole/
selection/append Save and backlink, Stop/Retry, research/compaction, supported
attachment/web behavior and transcript/relocation. Checkpoint pending reviews
and restart without implicit requests. Separate the user's dated feedback from
agent observations and synthetic provider output.

The bounded evidence-based result is **narrow/continue isolated evaluation; defer
default adoption**. Current v51 whole iOS/history, five iOS fault cases, serialized
desktop retry and final two-launch normal manual handoff passed, preserving the
initial failed desktop attempt and retained v48/v38 pins. Final root native closure
is recorded above. The final evidence index and separate root semantic acceptance
now exist and record bounded required acceptance complete. Archive reconciliation
remains with its owner; this record does not assert archive creation.
Material bridge/storage regressions and hosted/physical/measurement limits support
the bounded outcome; no reduced coordination, savings or full parity claim follows.
Record
real user feedback separately when available and explicitly disclose its absence;
the spec does not make receipt of user feedback a prerequisite for technical
acceptance or an evidence-based evaluation verdict.
Disclose material regressions, unknown renderer/IPC/storage coverage, scale and
unresolved external prerequisites; do not invent an adoption threshold. A future
pass does not authorize merge/default enablement, original-data migration,
distribution, physical-iPhone guarantees or revision of ADR 0001. Reconcile
progress and archive the outcome only after phase completion; retain selected
prose-free fixtures/reproduction receipts and bounded failure evidence.

## Preparation validation

- `python3 -B scripts/pi-prototype/resource-capture.test.py`: 19 pure tests pass.
- `python3 -B scripts/pi-prototype/measurement-report.test.py`: 8 pure tests pass.
- `node --test scripts/pi-prototype/shared-resource-gate.test.mjs`: 4 pure tests
  pass, without binding a server/port or querying a process.
- `pnpm exec vitest run src/lib/prototypes/pi/scaleProbe.test.ts`: 2 pure Harness/
  MemoryStorage tests pass; one creates 1,005 real engine conversations.
- `node --check scripts/pi-prototype/shared-resource-gate.mjs`: passes.
- `pnpm exec svelte-check --tsconfig ./tsconfig.json --output machine`: 6,138
  files, zero errors/warnings after the new probe. This is static validation.
- CLI `assemble`, `compare`, `storage` offline smoke passes under
  `/private/tmp/pi-resource-offline-smoke-v6pnelwy`; deliberately unverified empty
  counter inputs yield no numeric comparison claims and an unproven verdict.
- No native measurements, build/removal/default/iOS/live checks or user feedback
  are included in these validation claims.

## Historical paired core resource checkpoint — v8, 2026-10-15

The native owner's closed, exit-0 receipt at
`/private/tmp/pi-shared-resources-20261015-v8/shared-resource-gate.json`
records **paired core fixture PASS**, old then Pi, with explicit foreground debug
apps and generated data roots. This extends the v7 core receipt at
`/private/tmp/pi-shared-resources-20261015-v7/shared-resource-gate.json` with a
bounded long-output journey and closed storage metadata; earlier receipts and
failures remain evidence. It is not replacement acceptance, long-history/context-
cap proof or a performance win. That historical receipt records
`unproven-pending-acceptance`; the current bounded outcome is recorded above.

Both lanes completed short, source-free follow-up and exact 256-line/9,215-byte
long output, then stopped a provisional answer through normal UI controls.
Each journey made exactly one provider request; all eight requests across both
lanes stayed within the 262,144-byte request, 16,384-byte output-content and
32,768-byte SSE-frame budgets, with no fixture refusal. Both restarted with eight
committed messages and no implicit inference replay. The long fixture measures
output length, not a large conversation collection or context limit.

| Warm journey | Old send→visible / terminal (ms) | Pi send→visible / terminal (ms) | Module IPC calls old / Pi | Request JSON proxy bytes old / Pi | Response JSON proxy bytes old / Pi |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short | 227 / 278 | 307 / 339 | 7 / 294 | 571 / 68,691 | 7,214 / 156,625 |
| Follow-up | 191 / 224 | 258 / 291 | 6 / 280 | 528 / 59,056 | 11,805 / 268,115 |
| Long output | 215 / 248 | 240 / 271 | 6 / 277 | 524 / 98,113 | 38,271 / 378,996 |
| Stop | 197 / 263 | 299 / 415 | 7 / 308 | 564 / 94,128 | 62,076 / **unknown** |

For Stop, the terminal column means cancelled settlement; request→settlement was
66 ms old / 116 ms Pi. Both displayed the expected provisional acknowledgement
before Stop. Old cancelled terminal content was empty (0 bytes); Pi terminal
content was 28 bytes. Exact cancelled-content equality was **not** asserted in
either lane, so this is not equal durable-partial preservation. One rejected Pi
invoke result has unknown response bytes: its cancel known subtotal of 789,563
bytes must not be reported as a complete response total.

| Other recorded measurement | Old | Pi |
| --- | ---: | ---: |
| Initial launch→workspace (ms) | 1,961.655334 | 2,477.642417 |
| Restart launch→workspace (ms) | 613.595167 | 913.513042 |
| Sampled app-only peak RSS (bytes) | 218,546,176 | 180,568,064 |
| Local fixture server interval, short (ms) | 42.888250 | 45.142041 |
| Local fixture server interval, follow-up (ms) | 42.819834 | 43.301292 |
| Local fixture server interval, long (ms) | 42.346458 | 44.480000 |
| Observed warm module IPC calls, total | 26 | 1,159 |

All warm journey collectors verified a real ordinary `getSettings` crossing and
recorded zero observer failures. The counts cover only the actual
`@tauri-apps/api/core` module invoke boundary after setup, under the same generated
Vite observation overlay. Pi includes 946 `sqlite` calls and 213 `domain` calls;
old records 26 `domain` calls. Native-internal SQLite operations are outside this
boundary, so these are not complete cross-lane database-operation counts. Sizes
are UTF-8 JSON argument/result proxies, not native wire bytes. Direct injected
bridge and startup IPC coverage remain unknown. Server intervals are complete
local HTTP observations; provider coverage remains partial and these intervals
are not live model inference latency. UI detection polls at 50 ms plus two
frames, startup at 100 ms; clock-calibration uncertainty was ±0.410–0.766 ms.
Renderer/helper/all-process RSS and OS-cache control remain unknown. This is one
ordered synthetic run with observer/polling overhead, not a statistical comparison.

Storage starts at zero in both fresh roots and ends after final owned process
closure (`closed:true`, `forced:false` in both lanes). Only generated app/document
root file metadata was counted; driver logs and overlay/config files are outside
that boundary.

| Logical storage growth (bytes) | Old | Pi |
| --- | ---: | ---: |
| SQLite | 671,744 | 663,552 |
| WAL | 0 | 1,351,392 |
| SHM | 0 | 32,768 |
| Markdown | 10,301 | 9,884 |
| Other | 2,333 | 2,333 |
| **Total** | **684,378** | **2,059,929** |

Both metadata captures are complete for their closed roots; no file contents,
SQL or database inspection were used. Allocated bytes and checkpoint state are
unknown, and `checkpointPerformed:false` in both lanes. Pi's retained WAL
dominates the logical-size difference; the data do not establish equivalent
checkpoint state, allocation cost or retained-growth bounds at scale.

The receipt records frozen source/binary/overlay hashes (Pi binary
`024dad84fbdc2b35c6358fd662c7d7bbdc5c82990f74b1dd7ddae379810e13a5`),
while `frontendReceiptVerified:false` remains explicit in both lanes. This
checkpoint supplies bounded short/long-output, cancellation, sampled app RSS,
module IPC and storage observations only. Live, full-history/pagination,
listener/retention, removal/default/iOS and final verdict obligations remain
separate gates; no resource-savings or adoption conclusion is implied.
