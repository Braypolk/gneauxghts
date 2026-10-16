# Product scale acceptance preparation

Prepared 2026-10-15; updated to the current driver contract. Native v4 is
**pending**, and earlier failed runs do not establish scale acceptance. This adds a
product-path scale gate to the engine-only `scaleProbe.ts`; it does not replace
that check or constitute ticket 12/13 acceptance. No native build, launch,
provider, port, Git command or real-data operation was run by this preparation
agent. The native owner is the root agent.

## Files and commands

Prepared tooling:

- `src/lib/prototypes/pi/productScaleProbe.ts`: writes through public ChatApi;
  verifies public Meta/list/history/navigation; archive/restore; fixture-only
  closed storage scan.
- `src/lib/prototypes/pi/productScaleProbe.test.ts`: mock-public-API assertion
  tests, explicitly not product implementation/native acceptance.
- `scripts/pi-prototype/product-scale-gate.mjs`: standalone native owner driver,
  no launch on import. Imports the existing shared driver's pure environment,
  source digest and exact dummy authorization helpers without editing that driver.
- `scripts/pi-prototype/product-scale-gate.test.mjs`: pure fixture/storage tests.
- `scripts/pi-prototype/product-scale-continuation.mjs` and its `.test.mjs`:
  guarded, linked diagnostic continuation of an eligible closed generated run.

Root must finish its active native gate and own ports 1442 (frontend), 1443
(synthetic provider), 4445 (WebDriver) before this command. The binary must be a
pinned Pi fixture-capable native artifact, served from the matching reviewed
frontend source. The driver verifies the supplied binary digest before and after
the run and hashes the served source before and after. It does **not** assert the
build/source binding independently: `frontendReceiptVerified` remains false.

```sh
node scripts/pi-prototype/product-scale-gate.mjs \
  --root /private/tmp/pi-product-scale-UNUSED-SUFFIX \
  --source /Users/bray.polkinghorne/.codex/worktrees/2e20/Gneauxghts \
  --binary /absolute/path/to/pinned/Pi/gneauxghts \
  --sha256 REPLACE_WITH_PINNED_64_HEX_DIGEST
```

Choose a nonexistent root; the driver refuses an existing one. It refuses Vite
`.env`, `.env.local`, `.env.development`, `.env.development.local` by existence
only, without reading them. It supplies an explicit child environment allowlist
and only exact dummy provider overrides. It calls no API-key setter and never
copies an inherited credential environment. The fixture accepts only absent or
exact `Bearer gneauxghts-resource-fixture-dummy` authorization. Only a loopback
compatible route and synthetic text are admitted. The CLI launches processes;
it is for the native owner alone, not a pure validation command.

The generated root contains `product-scale-gate.json`, mode 0600 private identity
receipt `private-product-identities.json`, native/frontend logs, and fresh native
data/documents under `data`. No preexisting vault or provider configuration is
selected. A failed run's generated root is retained for diagnosis. The ordinary
gate refuses overwrite or resume; rerun with a fresh root. The separate guarded
continuation below cannot turn an original failure into a pass. Native logs remain
private artifacts; do not paste them without reviewing their synthetic scope.

## Concrete acceptance path

1. Boot a fresh native workspace. Public `listConversations(true)` must be empty.
   Close the product owner, count the empty store through upstream Storage scan
   APIs, close its facade, and reload to obtain the next normal product owner.
2. Public `createConversation` creates exactly 1005 conversations with unique
   synthetic titles and actual product Meta. Creation uses explicit local
   fixture model, reasoning off and vault access none.
3. Public `sendMessage` admits exactly 1005 sequential input submissions into the
   first conversation. The exact fixture reply for turn *i* includes *i*; the
   fixture requires the previous actual assistant answer in provider history
   for every turn after the first. It rejects unknown prompts, duplicates,
   replay, out-of-order dispatch, unbounded bodies and unexpected credentials.
   Automatic native safe-summary work remains enabled. Any summary admission
   must match the actual isolated summary envelope, completed input/answer pairs,
   prior issued summary and current original request. The fixture returns bounded
   JSON within the requested UTF-8 limit; it supplies no evidence or permissions.
4. Public API verification checks every conversation identity/title and summary
   message count, every input/reply content/status/order, all 2010 unique message
   identities, no active request, and early/middle/late conversation navigation.
   It accepts arbitrary list sort order. Correct total length cannot conceal an
   interior missing row or substituted identity.
5. Reload the ordinary mounted controller to discover the API-created Meta.
   Use the real Conversations menu to select first, middle and last titles. In
   the first conversation, verify early/middle/late assistant DOM destinations
   by the real public message IDs and exact synthetic content. Wait two animation
   frames after each selection; polling detection uncertainty is 100 ms.
6. Archive ten empty conversations through public `archiveConversation(id,true,1)`.
   Active list must shrink by ten while include-archived list retains all 1005.
   Restore through the public API and reverify all history/Meta. This proves
   visibility and retention, not retirement or physical collection.
7. Close all live Pi product owners, join their queues, and count committed
   conversation/input/task/current-document records using upstream Storage APIs
   with page size 128. Count exact session, every conversation and every task
   scope. Meta must equal 1005 and input submissions 1005. No SQL seed, task
   forging, generic state reconstruction or second live Harness is used.
8. Kill the quiesced app, restart the same generated data root, verify every
   original conversation/message identity and content again, and repeat mounted
   early/middle/late navigation. Provider accounting must contain exactly 1005
   completed answer admissions in order, plus separately validated summary
   admissions, with at most 1100 total requests and no failed or unknown request.
   This total must remain unchanged throughout public verification, UI navigation,
   archive/restore, restart and a one-second idle observation; implicit replay
   fails. Close and rescan the restarted store and reverify the same accounting.

The first conversation is deliberately long; the other 1004 are empty. This is
not a claim about 1005 simultaneously active conversations, 1005 nonempty
conversations or 1005 concurrent watchers. Public ChatApi exposes aggregate
`listConversations` and `getConversation`; it has no cursor argument. The probe
therefore proves completeness of those product returns above 1000 and exercises
upstream storage paging through that adapter. It does not invent a public paging
UI or silently limit the list/history fixture.

## Resource accounting and limits

The run records generated storage metadata at the empty baseline, every five
seconds during seed, after seed, archive/restore, closed owner, restart and final
process close. No file contents are read by storage capture. Counters separate
SQLite, WAL, SHM, Markdown and other logical bytes. They do not measure allocated
disk blocks. Capture does not issue a checkpoint; natural close behavior may
shrink WAL, so live and closed observations must be compared at like boundaries.

An `ENOENT` between directory enumeration and metadata capture is tolerated only
for an entry enumerated as a regular `.db`, `.sqlite` or `.sqlite3` WAL/SHM sidecar
beside a still-present regular, non-symlink database. The receipt records its path
and kind as `partial-disappeared-sqlite-transients`; total files/bytes and the
affected sidecar total become null, with observed counts retained separately.
This is partial coverage, not a zero-byte or atomic complete snapshot. Missing
roots, directories, other files/databases, other errors, symlinks and special
files still fail. No checkpoint is added to stabilize the capture.

A successfully installed hook verified by an actual native probe of
`window.__TAURI_INTERNALS__.invoke` hook aggregates call counts,
UTF-8 JSON request/response byte proxies, failures and coarse command categories.
These proxies are not wire bytes. If the native property is immutable or the
hook is unverified, counters are null and coverage unavailable, never a measured
zero. This scale observer is separate from the paired resource module observer.
Payloads and SQL text are not retained. SSE server frame counts/bytes and actual
native stream chunk counts/bytes are separate units. Startup/early imported
module work predates the observation boundary and is not claimed complete.
Counter snapshots have `browserEpoch`; subtract only within the same epoch,
since reload/restart resets observer and transport counters. Observer operations
themselves add IPC and latency.

The probe subscribes once to completed/cancelled/failed and correlates terminal
events by request ID, including events delivered before the send receipt.
Probe-owned subscriptions must return from three to zero. Private adapter
listener/watch totals are unavailable and remain null. Native event listen and
unlisten invocation counts are observed deltas, not global live listener totals.

Closed-store scans count live current scoped documents, live keyed instances,
distinct current kinds and exact Meta, conversation, task and input totals.
`currentDocumentGrowth` subtracts the real closed empty baseline. Retired rows,
historical versions and physical collection are not inferable from current
membership scans and remain null. There is no product collection API in the
current interface; archive is not a collection acceptance substitute.

RSS sampling reads only the explicitly launched app PID with
`ps -p PID -o pid=,rss=,lstart=` and a pinned hashed process start identity at
250 ms. It reads no command arguments, process environment or secrets. The
observed app peak, number of samples and failures are recorded. Renderer,
helper and all-process RSS are unknown; no all-process memory claim is allowed.

Execution budgets are explicit failure bounds: 1005 inputs, at most 1100 provider
requests, 4 MiB per request, 1 GiB aggregate request bodies, 60 seconds per
terminal/DOM operation, 120-second WebDriver operation and two-hour seed budget.
The synthetic fixture admits source-free answers and strict native automatic
safe-summary requests separately; it does not bypass native compaction execution
or forge summary tasks. This tests the bounded synthetic summary protocol, not
real-provider context capacity or summary quality. Current public
API/history/transcript work can grow quadratically during this workload because
each request reconstructs a growing history; a successful run establishes no
latency, asymptotic, memory or disk acceptance threshold. If any configured
budget is exceeded, investigate rather than reduce the fixture and call it pass.

The driver reports `passed-bounded-product-scale-fixture` only after its bounded
checks succeed. It always reports `productParity:false` and
`verdict:unproven-pending-acceptance`. Any native failure is useful acceptance
evidence, not permission to substitute engine-only scale results. Full lifecycle
retirement/collection, private watcher bounds, default architecture removal,
matching old/Pi resource comparison and the remaining ticket 12 journeys are
still separate requirements. See `replacement-proof-plan.md` for that matrix.

## Guarded diagnostic continuation

The separate continuation requires an explicitly confirmed closed native owner,
an original **failed** receipt and a fresh output root. It accepts only a failure
at the first mounted navigation deadline after the seed and complete public
verification: exactly 1005 conversations, 1005 inputs, 2010 unique messages,
every history position and Meta identity, detached probe listeners and complete
validated provider accounting. Archive/restart must not have started, cleanup
must have succeeded, and the recorded closed storage must still match.

It pins the original binary and frontend digests, receipt and private identity
hashes, then copies only the closed generated data with identical bytes and
modes. Original receipts/data remain unchanged. Its fixture admits model-list
GET only and rejects every inference POST. Normal foreground mounted navigation,
public verification, archive/restore, closed scans and restart run on the copy;
no new inference is permitted. A successful result is only
`passed-linked-diagnostic-continuation`, with `originalRunPassed:false`,
`productParity:false` and no IPC resource acceptance. It never repairs the
original gate verdict. Failed v3 lacks the required completed seed, identity and
accounting proof and is ineligible.

## Historical preparation validation

Executed without native apps, builds, providers, ports or Git:

```sh
node --check scripts/pi-prototype/product-scale-gate.mjs
node --test scripts/pi-prototype/product-scale-gate.test.mjs
pnpm exec vitest run src/lib/prototypes/pi/productScaleProbe.test.ts src/lib/prototypes/pi/scaleProbe.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json --output machine
```

Initial preparation results: driver syntax clean; four pure Node tests passed;
four mock-public-API assertion tests plus two separate real in-memory engine
tests passed; static
check 6147 files, zero errors and zero warnings. These historical counts do not
describe the subsequently expanded tooling. None proves the native product
workload passed. The native owner must run the prepared command and review the
generated receipt before changing acceptance or evaluation status.
