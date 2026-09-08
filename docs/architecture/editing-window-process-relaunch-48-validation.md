# Actual interrupted-process relaunch: issue 48

All six disposable-vault cases passed on 2026-09-06. The accepted run created
**19 distinct native application processes** and acknowledged seven exact fault
boundaries. Every interrupted PID exited with `code: null, signal: SIGKILL`;
every relaunch spawned the native binary again against the same vault and
app-data paths. No application recovery defect was found and no production
behavior was changed. The only Rust changes are hooks compiled with `e2e-wdio`.

## Harness and identity

[The standalone runner](../../e2e/support/processRelaunch.mjs) launches and owns
the actual native child; WebDriver supplies command transport only. It refuses
occupied listener ports, checks that port 4445 belongs to its child before
creating a session, and checks `get_vault_info` against the canonical disposable
vault path before any write. App-data, documents, and vault paths are explicit
startup arguments. Native fault hooks additionally require all three paths to
match a marked, purpose-created temporary fixture. A unique control token, fault
name, fixture path, and native PID must match the acknowledgement before killing
the owned process. No global process termination or user database action occurs.

The optimized E2E binary is
`src-tauri/target/release/gneauxghts`, identifier
`com.braypolkinghorne.gneauxghts-e2e`, SHA-256
`e4de71c1b4cda86a697093e351067b8bd52e4f8e0cf46987db9562803fffddf7`.
The baseline is the complete uncommitted issue-47 tree in
`/tmp/gneauxghts-history-hardening-baseline/after47.tgz`, over HEAD
`fd38f83ae835a74efb7a8b14235f5634b2102074`. Source, baseline, frontend build,
logs, snapshots, and binary identities appear in the
[machine-readable evidence](editing-window-process-relaunch-48-measurements.json).

The accepted run lasted from `2026-09-06T19:43:35.856Z` through
`2026-09-06T19:44:17.540Z`. `IOConsoleLocked=No` was checked before execution;
every connected native webview passed genuine visible/focused guards. No
visibility, focus-state, clock, or animation-frame values were overridden. No
repository writes or concurrent checks occurred during native runs.

## Interruption matrix

Each case creates an `Anchor` revision. B is `Endpoint B`; C and D are distinct
external bodies. Counts below exclude the later continued-edit revision.

| Case / acknowledged boundary | Actual native PIDs in launch order | Durable state before interruption | Recovered history, oldest first |
| --- | --- | --- | --- |
| Prepared before publication | 92366 → 92471 → 92563 | Anchor bytes; exact B intent prepared; no pending window | Anchor only; exact B intent abandoned |
| Canonical published before capture | 92653 → 92743 → 92843 | B bytes; exact B intent prepared; no pending window | Anchor → B; same intent finalized |
| Successfully captured pending endpoint | 92934 → 93024 → 93201 | B bytes; one pending window; captured receipt | Anchor → B, exactly one window revision |
| Interrupted recovery after publication capture | 93291 → **93382** → 93387 → 93485 | First stop leaves published B prepared; 93382 acknowledges committed recovery capture and is killed again | Anchor → B, exactly once after both interruptions |
| Committed window sealing | 93576 → 93668 → 93765 | B revision/evidence committed; pending endpoint deleted | Anchor → B with the identical already-issued revision ID |
| Retained external C before newer disk D | 93856 → 94018 → 94113 | Captured pending B plus exact durable observation C; after death, harness writes D | Anchor → B → C → D; canonical bytes remain D |

PID 93382 reached `recovery-publication-captured` during native startup
reconciliation **before any WebDriver connection**. No replacement `AppState` or
driver session reconnect stands in for this process boundary.

Every case compares original canonical file bytes before and after native
recovery, reconstructs all retained bodies through production history commands,
and checks immutable revision IDs and ordering across a repeated explicit
recovery. It then saves `Continued after relaunch`, finalizes that window, kills
the second process, and verifies unchanged bytes and the complete identical
history in a third fresh process. This last check exercises production save and
finalization commands; it is not another frontend typing/paint measurement.

Receipt assertions cover exact interrupted intent status, terminal payload
retirement, released dead-process leases, no unresolved publications/windows/
observations, foreign-key integrity, and preservation of every revision's
referenced receipt. The captured-window case additionally performs 70 unchanged
saves: 64 unreferenced terminal receipts remain, the retirement watermark advances
to 8, the referenced endpoint's original outcome survives, and immutable history
is unchanged. There is one window-evidence record per recovered B endpoint and
no duplicate window identity. No pending identity becomes a revision identity.

## Storage observation and checks

The observer copies main plus any WAL while the original native child is still
live, verifies identical source bytes before/after the copy, and opens only that
copy. A WAL-mode copy without a nonempty WAL is opened immutable; a nonempty WAL
is never ignored. The copied main/WAL hashes and paths are recorded. These
observations establish the acknowledged durable state without opening or
modifying the interrupted original between its death and native relaunch.
Production commands on fresh native processes establish native/domain recovery;
SQLite reading the separate snapshot is not a substitute for that proof.

Commands ran sequentially:

```sh
node e2e/support/buildNative.mjs --release
caffeinate -dimsu node e2e/support/processRelaunch.mjs
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness
node /tmp/gneauxghts-issue48/cancellation-check.mjs
```

The build, accepted matrix, ordinary non-E2E check, all 16 architecture tests, and
cancellation controller exited 0. The cancellation controller intentionally sent
SIGTERM to its own runner PID 95068 after native PID 95097 acknowledged a parked
boundary. The runner exited 143; native 95097 and preview 95095 both exited by
SIGKILL. The signal raced with normal relaunch admission: the cancellation flag
rejected that new launch, no child spawned after the cancellation event, and both
ports were empty afterward. The temporary controller script and its hash are
retained with the evidence. The 533 Rust and 797 frontend tests from earlier
issues were not repeated for these feature-only hooks; no new claims are made
about those historical runs.

## Failed attempts and retained evidence

All attempts remain recorded; none of the following is presented as a recovery
pass:

1. Attempt 1 could not bind Vite on `127.0.0.1:1430` under the sandbox (`EPERM`).
   No native application was launched. The authorized local run was repeated
   with network/local-process sandbox escalation.
2. Attempt 2 reached the prepared-publication acknowledgement, then its original
   live database read-only observer failed (`SQLITE_CANTOPEN`). Only its owned
   child and preview were terminated. No original database was opened after death.
3. Attempt 3 used byte-copy observation but reproduced the read-only open failure
   on a WAL-mode main file with no WAL/SHM. Diagnostic operations used a separate
   copy only. Matching the existing fixture-reader rule—immutable only when no
   nonempty WAL exists—fixed the observer. Attempt 4 passed all six cases.

Accepted raw output is `/tmp/gneauxghts-issue48/process-attempt4.log`. Detailed
process events, native logs, production history results, snapshots, raw copied
files, and fixture paths are retained under
`/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-process-evidence-ezXfp0`.
The machine-readable evidence includes SHA-256 hashes for every supporting file
and each failed attempt. After the cancellation probe, process/listener inspection
confirmed no test app, preview, scoped caffeinate, or listeners on 1430/4445.
Evidence documentation began only after those processes stopped.

This is bounded **process interruption/relaunch coverage**, not physical device
power-loss, fsync-count, device-write-byte, or write-amplification proof. Native
checks inspect retained receipt outcomes and references; exact opaque-token
retry remains existing unit-test coverage, not a new native IPC capability.
Clear/reset/purge interruption, exhaustive transaction cut points, slower
hardware, large-history scale (49), and old-citation navigation (50) are outside
this ticket. The sealed issue-43/47 master fixture was not used or changed, and
all four historical release evidence files retain their issue-47 hashes. No user
vault/app was reset, deleted, or interrupted; no commit was created.
