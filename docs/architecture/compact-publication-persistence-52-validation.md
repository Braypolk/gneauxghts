# Compact publication persistence: issue 52 validation

2026-09-06. This records schema-14 implementation evidence against the exact
post-issue-51 workspace snapshot at
`/tmp/gneauxghts-history-hardening-baseline/after51.tgz`. It does not replace
historical schema-13 reports or establish final scale/native acceptance.

## Implemented boundary

A publication's existing 26-byte random nonce is its private durable receipt key.
Full serialized boundary tokens remain scoped by store instance, generation,
Note Identity, deletion epoch, sequence, and nonce. Every callback, reserved
Revision Identity lookup, and restore-origin attachment validates that complete
scope before using the compact key.

Receipts own disposition kind, terminal status, liveness, and the exact original
CaptureOutcome. `prepared_intents` contains only unresolved operations;
`pending_window_preparations` contains their window-specific recovery assignment
and cascades away with its preparation. Point operations reserve public Revision
Identities before publication. Window preparations have no revision identity.
Retained revision, Lifecycle Event, restore-origin, and pending-endpoint references
point to receipts. The one retained window interval lives in
`revision_window_evidence`; completed preparations are never needed to verify it.

Capture/abandonment and preparation removal share a transaction. Fault tests stop
after recording the receipt outcome and after deleting the preparation to prove
rollback of both, for window and point captures. Retained PendingWindow outcomes
remain PendingWindow after sealing. Receipt retirement protects live/unresolved,
endpoint, revision, lifecycle, and restore references even below the watermark;
only the unreferenced terminal retry tail is bounded to 64 per note. Clear/purge
remove affected references and receipts with epoch invalidation transactionally.

Schema 13 and other unsupported existing stores fail before persistent writes.
Only the existing explicitly confirmed reset can rebuild current Markdown at an
advanced generation. Tests exercised reset on disposable test directories; no
user database was reset or converted.

## Completed checks

| Check | Result | Exact log |
| --- | --- | --- |
| Full Rust library suite, no default features | 542 passed, 0 failed, 9 ignored; 72.11 s | `/tmp/issue52-backend-all.log` |
| Focused NoteTimeline suite before final additional point-fault assertions | 200 passed, 0 failed, 8 ignored; 34.28 s | `/tmp/issue52-timeline-tests-2.log` |
| Final NoteTimeline suite after review follow-up | 200 passed, 0 failed, 9 ignored; 29.00 s | `/tmp/issue52-timeline-audit-followup.log` |
| Backend architecture fitness | 16 passed | `/tmp/issue52-architecture.log` |
| Frontend architecture, IPC and timeline contracts | 17 passed across 3 files | `/tmp/issue52-frontend-contracts.log` |
| Fixture Python checks | 8 passed | `/tmp/issue52-fixture-tests.log` |
| Native fixture preflight Node checks (no app launch) | 5 passed | `/tmp/issue52-fixture-node.log` |
| Small authentic publication fixture | 1 passed; 8.08 s | `/tmp/issue52-compact-fixture.log` |

The full suite includes action/proposal/restore/lifecycle, dropped finalization,
restart recovery, clear/purge/reset, reconstruction/provenance, immutable-object
export, citations, and portability regressions. New scope-forgery checks cover
all six token fields across finalize, abandon, release, reserved identity lookup,
and restore-origin admission. Existing orphan, retired-token, live-receipt below
watermark, pending-anchor/hash/time, and retained-evidence corruption cases remain
active. Failed intermediate runs are preserved in `/tmp/issue52-first-test.log`
and `/tmp/issue52-timeline-tests.log`; their schema/table assumptions were updated
without weakening the underlying corruption outcomes.

Commands:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features
cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness
pnpm exec vitest run src/lib/architectureFitness.test.ts src/lib/contracts/timelineContractFixtures.test.ts src/lib/contracts/ipcFixtures.test.ts
python3 -m unittest discover -s scripts/tests -p test_timeline_fixture.py
node --test e2e/support/currentScaleFixture.test.mjs
TMPDIR=/private/tmp GNEAUXGHTS_COMPACT_FIXTURE_EXPORT=/private/tmp/gneauxghts-compact-issue52-authentic cargo test --manifest-path src-tauri/Cargo.toml --lib release_compact_publication_fixture -- --ignored --nocapture
```

Independent Standards and Spec source reviews plus the orchestrator review passed.
The Standards follow-up removed two redundant retained-window outcome/interval
passes from `editing_windows::verify`: every revision already crosses
`verify_retained_revision`, which checks those same facts. The separate cross-record
check for a missing base, mismatched reference, or still-pending retained window
remains. The final 200-test NoteTimeline run passed with all existing corruption
checks still active. The earlier full 542-test result and small-fixture measurements
precede this deletion-only follow-up; their logs are preserved unchanged.

## Small authentic fixture

`/private/tmp/gneauxghts-compact-issue52-authentic` contains three 4 KiB notes
created through the production note command, each with 100 distinct ordinary
saves across four windows. The fixture retained 15 revisions, 12 interval records,
and 207 receipts: 15 retained references plus 64 unreferenced retries per note.
It retained zero preparations, pending window assignments, pending windows, or
preparation payload bytes. Every retained state reconstructed exactly.

The fixture's `compact-fixture.json` records its schema and public identities;
`allocation.json` records the main-file SHA-256, SQLite checks, foreign keys,
allocation detail, and query plans. Reads used SQLite immutable read-only mode
on this stopped disposable fixture. The new fixture kinds are
`gneauxghts-editing-window-v3` and `gneauxghts-current-scale-v2`; the small smoke
fixture has its own `gneauxghts-compact-publication-smoke-v1` marker and cannot be
mistaken for the authentic large-scale acceptance workload.

| Measurement | Result |
| --- | ---: |
| Main database allocated bytes | 339,968 |
| WAL bytes after clean close | 0 |
| SHM bytes while diagnostic connection was open | 32,768 |
| Allocated index pages | 155,648 bytes |
| Freelist bytes | 8,192 |
| Unused space inside allocated table/index pages | 230,867 bytes |
| Retained compressed revision payload | 990 bytes |
| Receipt key minimum/maximum/mean | 26 / 26 / 26 bytes |
| Receipt table allocated / payload / unused bytes | 61,440 / 45,072 / 14,974 |
| Unoptimized debug production save p50 / p95 / maximum, 300 samples | 14.21 / 88.02 / 238.14 ms |

`quick_check` returned `ok`; `foreign_key_check` returned no violations. Exact
receipt lookup uses the receipt primary-key index. Unresolved admission uses
`prepared_intents_pending_by_note`. Retirement scans the note/sequence receipt
index and checks every protected reference through its covering index, without
sorting or scanning unrelated notes.

These allocations are dominated by small-table minimum pages and retry tails.
Unused space inside pages is distinct from freelist bytes and is not claimed as
immediately reclaimable. No repack/VACUUM comparison or device-write/fsync
instrumentation was performed. Debug timings have no acceptance-budget assertion
and are not optimized, fresh-process, or native interaction measurements.

## Remaining release evidence

The old issue-49/50 masters, schema-13 reports, and issue-51 allocation experiment
remain unchanged. Final authentic 10k/100k generation, comparable optimized
storage/latency measurements, process-fault/native acceptance, and repacking
experiments belong to issue 55 after issues 53–54 stabilize. Issue 52 does not
change startup readiness or whole-vault verification policy.
