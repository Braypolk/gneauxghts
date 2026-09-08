# Validate compact storage and responsive startup

Status: ready-for-agent
Depends on: 54

## Acceptance

Validate the final compact format and startup behavior with authentic current production saves/windows/actions and actual interrupted-process recovery. Produce new sealed 10k/100k fixtures once final source is stable, preserving prior masters and reports. Compare allocated tables/indexes/payloads, in-page slack, freelist, disposable-copy repacking, write/read latency and process memory with the old-format baseline. Report measured savings, not inferred or relabeled fixture results.

Measure first visible/usable workspace, active-note verification/save readiness, and whole-history background completion separately. Demonstrate that unrelated retained history no longer determines the active note's readiness. Retain ordinary history and old-citation entry/paging/diff budgets, exact identities and workspace behavior. Use the verified isolated native artifact and actual visible/focused frames; clean up only owned processes.

## Checks

Complete relevant correctness, architecture, contracts, browser and native checks after earlier issue audits. Exercise real process interruption/relaunch around pending/finalized publication and background verification, scope/reset/close invalidation and late corruption. Record workload geometry, sample counts, raw logs, query work, source/build/master hashes, failed attempts and hardware/cache limitations. Repacking must remain a disposable experiment unless a measured need justifies a bounded maintenance change; no full VACUUM on normal startup. All issue 51–54 findings must be resolved and reviewed before final completion.

## Comments

- 2026-09-06: Final sequential acceptance; issues 22 and 24–26 remain deferred and no commit is requested.
- 2026-09-06: Harness planning audit: collect startup marks before `currentScaleNative.mjs` performs its first history read or reload. Record early visible/focused shell frames separately from an actually interactive restored workspace; collect note readiness and background completion from the real 53/54 contract without triggering exhaustive health. Keep frontend, backend and launcher clock origins distinct. Persist the same hot note as active before sealing each final fixture, or prepare and cleanly close a disposable clone before the measured fresh launch. Replace old `current_scale.rs` assertions that first access exhaustively attests the vault. Update `relaunchSnapshot.py` and process-relaunch settled-state assertions for compact receipts and pending-only preparation; reuse the six authentic small production cases and add background interruption. Existing native runners require an unlocked display; hidden frames are not paint acceptance.

- 2026-09-06 follow-up audit: `scripts/timeline_fixture.py` already declares schema 14/current-scale-v2 and validates pending-only preparation after issue 52; preserve those checks. The remaining process harness mismatch is specifically `processRelaunch.mjs` expecting completed status in `after.intents` instead of the compact receipt and `relaunchSnapshot.py` omitting pending-window-preparation evidence. Before long generation, exercise the small production interruption cases against final async command wrappers. Persist hot-note startup state in the generator before clean close; record its actual ID in the sealed manifest and use that same identity for both size comparisons. Verify current-scale first-page/citation probe assertions and metric descriptions no longer require or claim full-vault foreground attestation.

- 2026-09-06 issue54 audit decision: bootstrap starts canonical payload loading and event subscriptions together, then admits the editable session after both settle; this intentionally retains first-save event ordering without a new snapshot catchup mechanism. Measure the residual listener-admission interval honestly rather than claiming no listener wait. Whole-history work remains outside this path. Readiness polling measures observed transitions with its sampling interval; do not report an exact completion instant if only a bounded observation is available.

- 2026-09-06 backend timing harness note: issue53 disables automatic background-worker startup under `cfg(test)` to keep correctness fixtures deterministic. Fresh release Rust probes must explicitly enable the real worker if claiming production background timing; changing only old exhaustive-scan assertions is insufficient. Distinguish authentic production save/window fixture construction from background scheduling measurements, and compare runtime/launcher/frontend clock origins separately.
