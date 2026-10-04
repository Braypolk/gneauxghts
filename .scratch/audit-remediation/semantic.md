# Semantic execution remediation

Status: ready-for-agent
Progress: complete; final integrated acceptance recorded in validation.md
Owner: editor agent (semantic follow-up)

All seven findings assigned to semantic in findings.json have implemented or coordinated dispositions below. Plans 90–97 were written before their source changes. Root owns command composition and broad integration; no full suite or network distribution download was run here.

## Findings and dispositions

| Finding | Disposition | Implementation and evidence |
| --- | --- | --- |
| Local UIX-08 | Implemented | `semantic/indexer.rs`: SemanticWorkQueue owns change notification and admission-aware waits. Staging and quiescence/shutdown wake deadline waits; no unconditional worker sleeps remain. Existing processing owner now accepts a private wait callback. Retry test asserts 100/200ms decisions without sleeping; snapshot test asserts 2s debounce decision without sleeping. Separate causal tests observe the waiter while holding the admission mutex and prove both new work and shutdown release it. Existing update/delete/move/rebuild merge matrix and quiescence tests remain. |
| Local UIX-09 | Implemented | Production single-recall indexing runs with SQLite's per-instruction progress callback. Default 32 vs 320 chunk fixtures allow at most 100 extra instructions, assert one scanned/embedded recall and no ANN/edge rebuild. This guards SQL work growth; it does not claim to instrument arbitrary Rust iteration or every other connection. Original 20k distribution remains an explicitly ignored opt-in test using the same oracle; it passed separately in 0.43s. |
| Local UIX-10 | Implemented; wholesale merge not justified | New test-only semantic/test_support.rs owns normal/in-memory database schema setup. ann/note_ann/indexer/db/atlas/status use central TestDir RAII; Atlas no longer leaks temp directories on assertion failure. Atlas labels use shared in-memory setup. Chunk and note ANN manifests, delta recovery, identity rules and last-good generation tests remain separate. Providers with different recording/failure/dimension behavior remain local rather than introducing a configurable mock framework. |
| Local UIX-11 | Implemented | embed.rs parses optional values through pure context-size/thread/parallel functions; debug.rs parses explicit RSS options and can test disabled sampling without reading global state. All process-environment writes removed from these tests. Default/invalid/minimum/whitespace/valid inputs retained. Affected tests also pass with nondefault parent-process overrides, without writes or restoration requirements. |
| Local UIX-13 | Implemented | runtime_install.rs verifies child startup with 10s deadline and kill+wait on timeout/error; stdout/stderr go to null to avoid pipe backpressure. Local tar archives prove executable success then publication/discovery and nonzero failure remains undiscoverable; reader tests cover exact budget/overflow/interruption plus staging Drop cleanup. Unix executable timeout regression runs locally. Original official archive test remains ignored because shipped binary/dylib authenticity is distinct from installer logic. |
| Sol AA-06 | Implemented | chat_commands typing test replaces 2s sleep / 250ms machine assertion with a held index lock, release-on-unwind guard, bounded dispatch and an actual independent draft IPC completed before release. activity checkpoint uses wait-arrival observation; permissions use event notification instead of 1ms polling. Capacity server has shutdown guard, nonblocking accept deadline, bounded header/read and joined worker. |
| Sol AA-07 | Implemented jointly | Embedding/RSS changes above remove unsafe writes. audit_agent replaced diagnostics environment mutation with explicit Measurement::enabled and run_model_with_measurement. That runtime contract test passed again here; preserved its app-owned runtime seam. No global reader lock or alternate runtime owner introduced. |
| Root BB02 follow-up | Implemented jointly | Scoped semantic helper now accepts Option<DocumentKind>. Eligible labels are selected by notes metadata before scoring/truncation, also intersecting allowed paths. Root wires Some(Note) in search command. Composition test seeds 80 perfect chat chunks and one lower-scoring ordinary note, builds actual ANN, then checks limit 1 ordinary result, unfiltered/unscoped chat result, path intersection and current-path exclusion. No internal semantic query cache requires a new kind key. |

## Validation

Logs are retained under `semantic-validation/`.

- `cargo test --lib semantic:: -- --test-threads=2`:121 passed, 2 ignored, 1.71s test execution. This includes query-kind composition and all scheduling/installer/ANN contracts.
- After shared in-memory fixture extraction, Atlas labels:17 passed, 0.54s.
- Permission broker:5 passed, 0.00s.
- Independent IPC progress test:1 passed, 0.04s (replaces previous mandatory 2s wait).
- Capacity metadata fake-server test:1 passed, 0.03s. First attempt was sandbox-denied at loopback bind; approved escalation passed. No product failure inferred from that sandbox error.
- Opt-in 20k SQL-work fixture:1 passed, 0.43s.
- Embedding tests with context 4096 / threads 3 / parallel 2 process overrides:2 passed.
- RSS parser/sampling tests with `GNEAUXGHTS_PROFILE_RSS=1`: 2 passed, 0.00s.
- Runtime diagnostic measurement contract:1 passed, 0.03s.
- `git diff --check` clean at handoff. Compilation completed; removed fixture imports introduced during extraction.

## Review and limits

The queue continues to own admission, coalescing, and restart settlement; the private wait dependency does not mirror worker algorithms. Large worker decomposition was not needed to remove sleeps or make outcomes observable and would increase integration risk without additional measured benefit. Existing restart and immutable-generation tests remain.

The kind-filtered semantic path now exactly scores eligible chunks instead of allowing chat-dominated ANN overfetch to starve ordinary notes. This is a deliberate correctness tradeoff approved by root: work scales with eligible chunks. A future ANN filtered-search implementation must preserve admission-before-limit and the new composition test. The scoped path already used exact allowed-path candidates; unrestricted mixed-document callers retain ANN behavior.

Unix script archives validate installer logic on this host, not Windows executable loading or official distribution shared libraries. Those remain platform/distribution acceptance responsibilities. The timeout test validates bounded verifier return; production explicitly kills and waits before returning. No claim of model retrieval quality or browser latency is made from these deterministic tests.

## BB02 lexical admission follow-up (issue 98)

The independent review found the same candidate starvation below the command boundary: catalog fallbacks admitted only Note documents, but indexed `search_locked` ran `TopDocs(limit * 4)` over every document kind. A real `build_indexed_note` → `LexicalIndex::upsert_note` → `search_with_catalog` regression with 200 strongly matching chat paragraphs and a lower-scoring ordinary body failed before the fix. The ordinary-note kind term is now mandatory before the collector. The fixture confirms both catalog fallback and indexed results return the ordinary note at limit 40; the separate evidence helper still returns three chat passages from over 160 matches admitted by chat ID.

Root also approved the analogous current-note exclusion fix. A second real fixture with 200 strongly matching current-note paragraphs returned zero candidates instead of the other ordinary note before the fix. The exact current path is now a MustNot term in the query before TopDocs, replacing post-collector path rejection. The separate evidence query remains unchanged and retains its own ID scope.

Final lexical tests: 5 passed in 0.08s; both red failure logs and final green log retained in semantic-validation. Compilation completed without warnings and diff check passed. Only lexical.rs source changed for this follow-up; public interfaces are unchanged. Root owns the final native build.

After both lexical fixes: search command scope 14 passed in 3.68s; existing current-evidence integration fixture 1 passed in 0.42s. Logs retained alongside lexical red/green evidence.

## AA-14 numerical policy follow-up (issue 99)

Ledger review caught the numerical half missing from catalog-only completion. `similarity.rs` now shares cosine arithmetic while preserving two named domain policies. Retrieval remains scale invariant for every nonzero finite vector. Atlas keeps its prior squared-norm epsilon floor so near-zero centroids provide no direction. Both return neutral 0 for empty/mismatched/zero/nonfinite vectors and clamp finite scores to [-1,1]. f64 accumulation avoids f32 finite overflow and subnormal underflow manufacturing NaN or zero norms. Atlas calls the explicitly named policy; no policy was silently unified and no catalog values changed.

Independent pure tables cover empty/dimension mismatch/zero, tiny/subnormal, identical/opposite/orthogonal, maximum finite and NaN/+infinity/-infinity inputs. Full semantic module: 123 passed, 2 ignored in 1.71s, including existing grouping/geometry/ANN/edge fixtures. No production schema change. Final Atlas private-module extraction is owned by issue 99b and needs root's combined verification after that source move. AA-10 ledger reference was separately corrected to issue 61 and agent.md now explicitly names its already-existing real evidence composition regression.

## Unnumbered task-date metadata supplement (issue99c)

The Sol frontend-editor audit's final P2 supplement is additional to the153 numbered ledger rows. Added three small tests of the actual `passage_task_dates` evidence boundary: successful completed/open item JSON and effective first due date; null deadline; exact UTF8/CRLF byte boundaries; clipped start/end and mixed complete/partial lines;16versus17item completeness cap; empty/prose/code/no-marker null output. All9 task-date tests pass in0.01s. No production defect was exposed, so the function remains unchanged. Shared authored-date fixture and canonical unique-text mutation cases remain distinct. Log: semantic-validation/task-date-passage-final.log. Task-date source is frozen; this change is test-only.

AA-12 Atlas follow-up is now implemented by agent owner under issue99b: private publication/query/geometry modules preserve all27 original test bodies by hash; owner reports Atlas27/architecture23 passing and no compile warnings. See agent.md for extraction evidence; root owns final integrated/native verification.

## Final coordinator acceptance

All delegated work in this report is resolved. Earlier integration-pending notes
are chronological evidence; [validation](validation.md) records the completed
combined and targeted checks. Additional ledger discoveries and their closures
are documented in [ledger review](ledger-review.md). No external/live/scale
performance or model-quality result is inferred from deterministic acceptance.
