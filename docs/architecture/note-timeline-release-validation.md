# Note Timeline release validation

Issue 23 covers the initial feature, including History Mode Version Restore and current-content chat evidence. Chat-requested restore grants/proposals remain deferred under issue 22. Production availability policy is owned by [ADR 0006](../adr/0006-keep-history-preparation-mandatory-in-production.md). This report owns reproducible methods, observations, and measurement limits; [issue 23](../../.scratch/note-timelines/issues/23-release-scale-availability.md) and [issue 35](../../.scratch/note-timelines/issues/35-close-release-latency-gaps.md) track actionable release status.

## Reproduce

Run from the repository root, sequentially. Frontend generation, Vite, native tests, builds, and other suites must not overlap a timed run. Vite/SvelteKit share generated files. Native tests need a desktop session and free test ports 1430 and 4445; the fixture runner refuses an occupied port.

```sh
pnpm test:timeline:fixture:create
pnpm test:timeline:fixture:reuse
pnpm test:timeline:stages
pnpm test:timeline:native:build
pnpm test:timeline:native
```

`create` builds 100,000 durable revisions through the production save command once, cleanly closes the synthetic vault, and seals its vault/app-data pair under the system temporary directory at `gneauxghts-timeline-fixture`. If it already exists, `create` validates and reuses it. Initial creation took roughly 40 minutes on the measured machine; subsequent backend/native runs clone it. `pnpm test:timeline:fixture:reset` removes only a recognized fixture, after which `create` rebuilds it. The cache is disposable test data, not an application backup. An explicit cache location can be supplied with `python3 scripts/timeline_fixture.py create --cache /absolute/test-cache` (use that option for later actions too).

The runner verifies file hashes, SQLite quick/FK checks, exact 100,000 revision / 10,000 hot-note / 1,000 head counts, canonical note identities, matching vault format/generation/store identity and app observations, and absence of unsettled intents/deletions. Every run gets a unique temporary clone; only stored filesystem paths relocate. Authored payloads, hashes, identities, generations, and observation attestations remain unchanged. Destructive clear/compaction runs cannot modify the master, which is checked again after cleanup. Native failures retain logs in a separately printed temporary directory. To audit the master manually, use `python3 scripts/timeline_fixture.py check`. The narrow `import` action adopted the stopped issue 23 synthetic writer through a SQLite backup; manual restoration at original temporary paths is obsolete.

The ignored Rust tests use disabled semantic indexing/events, real Markdown publication, and the production SQLite codec. They never substitute synthetic revision rows. `RELEASE_METRIC` and `RELEASE_NATIVE_METRIC` output sample counts, p50/p95/max and budgets. Null budgets are observations, not proof of a separate performance requirement. Redirect output when retaining another experiment. Historical failures and accepted runs remain in [the measurements JSON](note-timeline-release-measurements.json).

Correctness and isolated rendering checks:

```sh
pnpm check
pnpm test:timeline:fixture:checks
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:timeline:scale:render
pnpm test:e2e:native
```

## Measured scope

The master contains 1,000 managed notes and 100,000 production-written revisions, with 10,000 revisions on a 64 KiB hot note. Backend traversal visits every hot-note revision without duplicate pages. Its disposable clone also exercises a 1 MiB note with 128 small edits and 20 random-ASCII replacements, deep reconstruction, restore preview, preparation failure/retry, clean close, exhaustive restart attestation, clear, and a 256 KiB compaction pass.

The optimized native test uses a release Rust binary, real Tauri IPC, native WebKit, and a built production frontend served by Vite preview at the dedicated test URL. It measures actual History Mode button actions through ready DOM and two animation frames. It is not a packaged-asset startup benchmark. Cold mandatory attestation settles before warm interaction timing. The test window is shown/focused, and its test-only configuration disables WebKit background throttling to keep paint callbacks scheduled when desktop automation occludes it. Production window configuration is unchanged. Five samples per operation mean p95 equals the maximum; this is a local release check, not a statistical tail-latency guarantee.

Native measurements cover a 64 KiB/10,000-revision note at exactly 100,000 vault revisions, then a separately created 1 MiB note with 129 production-written revisions in that vault (100,129 total). **No 1 MiB note with 10,000 revisions was measured.** The changed-line diff is collapsed with expandable context; complete-replacement rendering has no measured release attestation. Browser-only rendering remains useful regression coverage but excludes Rust/IPC and cannot establish the native budget by itself.

Environment: arm64 macOS Darwin 25.6.0, Rust 1.93.1, Node 24.2.0, pnpm 11.21.0, Chrome 152.0.7977.77, native WebKit 605.1.15. Final timed runs had no overlapping compilers/test suites; other desktop activity is not controlled. Results are observations on this machine, not guarantees for every supported machine or combined limit.

## Diagnosis and corrections

Cold attestation previously reconstructed every revision independently, repeatedly replaying the same checkpoint chains. The exhaustive pass now walks each note's lineage once, retaining only its preceding verified payload within that operation. Every payload/result hash, base hash, UTF-8 structure, and checkpoint lineage is checked. A verified predecessor avoids hashing the same bytes again; neither read optimization introduces a cross-operation cache. Corruption regressions cover disconnected checkpoint lineage and invalid base/result hashes.

The paired write-stage experiment uses 128 small edits or complete replacements with matching 64 KiB/1 MiB sizes, regular approximately 76-character lines, and repetitive or deterministic random-ASCII content. Content generation is excluded from command timing. Before the fix, 1 MiB small edits spent about 62 ms p50 reconstructing their history base; repeated replay dominated the apparent small-edit penalty. Full replacements often checkpointed and avoided that growing replay shape.

An opaque prepared intent now carries the canonical authored bytes already read during that publication. Finalization may use them only after their hash matches the exact stored base revision inside its transaction. A mismatch or recovery without memory reconstructs from durable history. Tests cover mismatches and exactly-once recovery. Durable preparation, publication ownership, schemas, and availability policy are unchanged.

| Paired 1 MiB workload | Before total p50 / p95 | After total p50 / p95 |
| --- | ---: | ---: |
| Repetitive small edits | 91.3 / 142.5 ms | 28.5 / 33.7 ms |
| Random-ASCII small edits | 93.5 / 147.9 ms | 27.9 / 32.2 ms |
| Repetitive full replacements | 29.1 / 31.0 ms | 30.7 / 38.0 ms |
| Random-ASCII full replacements | 33.5 / 36.6 ms | 32.9 / 38.3 ms |

Afterward base acquisition costs about 0.48 ms p50 instead of 62 ms. Delta encoding for small edits costs about 0.64–0.77 ms versus 2.59–3.64 ms for full replacements. The remaining command work includes canonical parsing/publication, durable SQLite work, and required projection; it is not an isolated filesystem measurement. History append work responds to changed content and no longer pays repeated history replay on ordinary saves. Total saves still process a full canonical file, so these results do **not** prove literal end-to-end cost primarily proportional to changed bytes. Efficient retained payload size (7,166 bytes for the first 129 large-note revisions) is separate evidence from latency.

History Mode entry previously also awaited optional per-note and whole-vault diagnostics after its mandatory recovered page/diff reads. Browsing now exposes an explicit health/storage check with correlated results; stale replies cannot populate a later session. Restore/clear still refresh diagnostics after mutation. No health success is inferred from skipping that optional display work. The first valid optimized native run still failed the 1 MiB entry budget at 295 ms. Avoiding redundant hashes and owned UTF-8 copies of already verified read payloads closed that remaining interaction cost.

Earlier issue 23 corrections remain covered: collapsed unchanged diff context reduced a browser paint from 1,419.8 to 123.6 ms; operation-local page/parent reuse removed repeated reconstruction; linear revision-header ordering preserves disconnected-lineage rejection; dedicated native ports avoid unrelated dev servers; editor-owned focus restores selection correctly. Intermediate native startup, stale-process and suspended-paint failures are preserved in the JSON rather than treated as successful latency samples.

## Results

### Optimized native interactions

| Native operation | Samples | p50 | p95 / max | Budget |
| --- | ---: | ---: | ---: | ---: |
| entry 64k at 100000 | 5 | 102.0 ms | 124.0 ms | 250 ms |
| page 30 64k at 100000 | 5 | 50.0 ms | 91.0 ms | 250 ms |
| diff 64k at 100000 | 5 | 29.0 ms | 118.0 ms | 250 ms |
| entry 1mb at 100129 | 5 | 180.0 ms | 187.0 ms | 250 ms |
| page 30 1mb at 100129 | 5 | 79.0 ms | 110.0 ms | 250 ms |
| diff 1mb at 100129 | 5 | 85.0 ms | 86.0 ms | 250 ms |

### Optimized backend and cold recovery

| Backend operation | Samples | p50 | p95 | Budget |
| --- | ---: | ---: | ---: | ---: |
| page 50 across 10000 | 200 | 28.1 ms | 45.2 ms | 250 ms |
| diff 64k | 20 | 14.7 ms | 16.4 ms | 250 ms |
| reconstruct deep 64k | 20 | 7.2 ms | 8.6 ms | 1000 ms |
| restore preview 64k | 20 | 7.9 ms | 10.2 ms | 1000 ms |
| page 50 1mb | 20 | 80.6 ms | 80.9 ms | 250 ms |
| diff 1mb | 20 | 63.0 ms | 67.1 ms | 250 ms |
| restore preview 1mb | 20 | 61.2 ms | 65.7 ms | 1000 ms |

Cold first access including exhaustive integrity/recovery took **1.220 seconds**, and restart plus first page took **1.248 seconds**, versus the prior 68.63 / 74.07 seconds. These remain separate startup delays, outside the warm 250 ms target; they were single observations rather than a new cold-start SLO. Mandatory attestation remains synchronous before dependent work is admitted.

At vault scale, 1 MiB small-edit saves measured 32.5 ms p50 / 36.4 ms p95 (maximum 111.3 ms); full replacements measured 36.0 / 39.7 ms. The occasional save outlier remains in the evidence. Injected preparation failure returned in 2.94 ms with exact canonical bytes unchanged, followed by successful retry. Clean close took 12.70 ms. Clear retained exactly one hot-note baseline; compaction stayed within its 256 KiB reclamation budget. See the JSON for maxima and all intermediate runs.

## Failure and regression evidence

Controlled tests cover preparation failure without canonical publication (including exact existing-file byte equality and successful retry at scale), finalization failure returning committed content and recovering exactly once, retryable startup/canonical-read failures, missing/replaced/malformed/rolled-back stores, interrupted clear/purge and close, reset rebuild failure, unreconstructable Missing Notes, WAL restart, and clean-copy portability. Frontend coverage preserves a dirty draft on preparation failure and rejects stale health responses. Architecture checks guard canonical publication ownership, read-only History Mode, bounded chat access, and the private storage seam.

These tests do not estimate incident rates, MTTR, physical power-loss behavior, or user success rates. No background telemetry or private note prose was collected. Availability trade-offs and accepted behavior are specified only in [ADR 0006](../adr/0006-keep-history-preparation-mandatory-in-production.md).

| Final check | Result |
| --- | --- |
| `pnpm check` | 0 errors, 0 warnings |
| Fixture unit checks under `python3 -O` | 5 passed; validation remains enabled |
| `pnpm test` | 781 tests in 123 files passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 467 unit tests and 16 architecture checks passed; 4 opt-in scale diagnostics excluded |
| `pnpm test:e2e:browser` | 11 journeys passed |
| `pnpm test:timeline:scale:render` | Passed; 45.9 ms fixture-to-paint, excluding Rust/IPC |
| `pnpm test:e2e:native` | Shared TypeScript/Rust contracts, 3 lifecycle and 4 timeline journeys passed |
| Reused optimized backend/native scale runs | All numerical budgets and correctness assertions passed |
| Independent Standards and Spec review | No remaining findings after regression-tested corrections |

## Release decision

**The initial release gate is satisfied for the scope above.** The user delegated interpretation of the write-cost criterion; the spec now applies it to additional history work and requires the full-file canonical publication floor to be reported separately. This is an explicit scope clarification, not evidence of end-to-end changed-byte asymptotics. Small-edit history work no longer repeatedly replays retained history, paired small-edit saves are faster than complete replacements, warm native paging/diff/entry meet 250 ms, and exhaustive cold recovery is about 1.2 seconds.

Release attestation covers the separately exercised limits and active native window described above. It excludes a combined 1 MiB/10,000-revision note, complete-replacement rendering, packaged startup, cross-platform guarantees, and deferred chat-requested restore. Final correctness status is recorded above; availability policy remains in ADR 0006.
