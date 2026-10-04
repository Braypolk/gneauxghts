# Cross-cutting fitness, contracts and residual utilities

Baseline and scope: see [spec](../spec.md). Findings are based on current code, not earlier architecture-cleanup plans.

## CC-01 — P2: architecture fitness mixes ownership guards with obsolete source spelling

Evidence: `src/lib/architectureFitness.test.ts:180-202,246-291,316-346,397-458,575-583`; `src-tauri/tests/architecture_fitness.rs:35-58,121-189,683-748`.

Both suites legitimately enforce documented ownership. However, many checks also require exact call spelling, whitespace, property order, removed local identifiers or a fixed assignment count. A wrapper/helper extraction can fail without changing ownership; an unused function or comment containing the expected call can pass without exercising routing. `rust_function` counts braces in bytes without distinguishing strings/comments. Its function slices can stop at an embedded brace even though Rust remains valid.

Recommendation: retain narrow ownership/import/visibility/registration guards; replace migration-era spelling checks with behavior at existing document, pane, task, timeline and chat seams. Consolidate source reads/parses per file within the suite only if measurements demonstrate material cost. Do not delete fitness wholesale: architecture explicitly requires it. Do not introduce a new parser dependency solely for cosmetically cleaner assertions.

Migration: classify each assertion as invariant vs implementation spelling, map behavior to a retained test, remove the latter only after demonstrating that a forbidden bypass or behavior regression still fails. Run fitness plus type checks and affected seam tests. Confidence high for brittleness; speed benefit unmeasured.

## CC-02 — P2: a legacy-field test constructs a second TypeScript program

Evidence: `src/lib/architectureFitness.test.ts:468-570` constructs a whole-project program/type checker, although `pnpm check` already performs Svelte/TypeScript validation and removed NoteDraftState properties are rejected on typed accesses.

Recommendation: assess measured cost and unique enforcement before removing this test. It deliberately identifies typed receiver symbols, so it may provide a dedicated diagnostic; do not replace it with an untyped regex. Most source parses elsewhere are small, and compiler startup may dominate. If retained, isolate this architecture/type lane from fast behavior tests and use explicit ownership scope. No timing claim until baseline report exists.

## CC-03 — P2 confirmed: malformed history error states accept inherited object properties

Evidence: `src/lib/contracts/historyCommand.ts:66-77` uses `value in COMMAND_FAILURES`; `historyCommand.test.ts:7-49` checks only valid `stale` and malformed string input. `constructor`, `toString`, and `__proto__` therefore pass the claimed closed-vocabulary predicate. Reading `COMMAND_FAILURES[state]` supplies an inherited value rather than a product error, producing an empty/malformed error instead of the stable unavailable fallback.

Recommendation: use own-property membership and table-driven malformed-state cases, preserving identity for an existing HistoryCommandFailure and redaction for unknown backend errors. This is a localized contract correction, not a domain-ownership change. Validation: history command and timeline/IPC fixture tests, full frontend checks. Confidence high (direct JavaScript prototype semantics).

## CC-04 — P2: TypeScript timeline fixture lists do not prove exhaustiveness

Evidence: `src/lib/contracts/timelineContractFixtures.test.ts:15-40,149-157`: `as const satisfies readonly SomeUnion[]` ensures listed values belong to the union, but a new union member need not appear. Unlike `HISTORY_COMMAND_ERRORS`, most fixture vocabularies are independently copied arrays.

Recommendation: an explicit `Exclude<Union, typeof LIST[number]>` compile-time exhaustiveness assertion or an existing canonical record keyed by every union member. Keep Rust serialized-fixture checks, which test a different boundary. Do not generate IPC from an ad hoc new schema solely to save these small lists. Confidence high; drift potential, not a currently missing member.

## CC-05 — P2: custom managed timestamp parsing has thin boundary coverage

Evidence: `src-tauri/src/note.rs:562-635,641-648` hand-rolls civil-date arithmetic, checks day only against 1..31, and tests one valid round trip plus a non-date string. `2026-02-31T00:00:00Z` is admitted and normalized through arithmetic; indexed creation/update times consume this parser (`index.rs:1383-1390`, `semantic/atlas.rs:909-912`).

Recommendation: define the accepted managed timestamp grammar explicitly (currently exact second-resolution UTC), add leap-year/month-boundary/malformed inputs, and consider replacing private date arithmetic with the already-present chrono dependency while retaining emitted bytes and precision. A broad RFC3339 acceptance change requires an explicit decision, since the current function intentionally recognizes the app's UTC format. Confidence high for invalid day acceptance; user impact is malformed metadata, not ordinary app-created timestamps.

## Reviewed files and retained coverage

Deep inspection: frontend architecture fitness; IPC/timeline/history-error contracts; vite/package/tsconfig and sole GitHub workflow; Rust architecture fitness; Rust note.rs, path_utils.rs, time.rs, tags.rs, search.rs, lexical.rs, secrets.rs and their inline tests. All test names and bodies in the residual utility files were read. Source fixture, search ranking, lexical removal/pending-catalog behavior, tag patching and classification tests cover different seams; no deletion recommended solely for overlap. Path collection and collision-safe path helpers lack direct tests but have indirect lifecycle callers; any change should add focused filesystem cases rather than a blanket new suite.

Frontend appSettings/editorTextSize and small shared UI tests were spot checked; their primary module audit belongs in the app/editor reports. Rust proposals received the additional detailed review recorded below; command modules are covered by timeline and backend-boundary supplements. The only CI workflow updates OpenWiki; it does not execute project checks. Add test CI only after deciding supported platform/dependency budget, not by copying the entire desktop gate onto an incompatible runner.

## Limits

Static source counts are not coverage. Runtime baseline and gates are recorded separately. The audit does not establish native UI behavior, live-model quality, power-loss durability, or a reliable speedup percentage. Lower-risk routines received structural rather than exhaustive adversarial exploration.

## Coverage reconciliation supplement — 2026-10-03

Read all 12 `proposals.rs` test bodies (:896-1213), preview/rewrite/UTF-16 hunk generation, targeted edit resolution, canonical publication helpers and all commit caller sites. The original residual pass did not include this detailed proposal review; this supplement records that distinction. Production commit commands use the prepared publication functions through Note Timeline ownership (`commands/proposal_commands.rs:95-149`); no competing production writer defect is claimed.

### CC-06 — P2 confirmed: overlapping text occurrences bypass proposal ambiguity rejection

`proposals.rs:768-786,833-838` uses `str::match_indices` to collect replacement candidates. That iterator omits overlapping matches. For working body `banana`, replacement oldText `ana` and no context, it returns offset 1 only, although offsets 1 and 3 both match. The resolver therefore proposes the first replacement instead of returning its documented ambiguous-target error. A contextBefore of `ban` should select offset 3, but filtering the incomplete candidate set incorrectly reports no target. A standalone Rust control-flow probe reproduced `[1]` versus `[1,3]`; this is not a live agent/UI run.

Tests mostly cover successful disk-backed preview composition and one pure null-oldText error. None covers overlapping occurrences, ordinary ambiguity/context disambiguation, overlapping edits or missing anchors directly. Add a small pure resolver matrix with ASCII and Unicode boundaries, and retain disk-backed UTF-16 preview, folded proposals, unchanged canonical bytes and publication tests at their existing distinct seams. Enumerate all character-boundary occurrences before applying contexts; do not broaden the default to arbitrary first-match selection. Validate unique and disambiguated matches remain accepted and ambiguous ones remain safe. Confidence high for algorithm behavior; no existing user data-loss incident established.

### CC-07 — P2: legacy proposal commit wrappers retain unused normalization and test paths

`commit_note_review` (:386), `commit_note_creation` (:510), and `commit_note_creation_at_path` (:548) are annotated `cfg_attr(not(test), allow(dead_code))`. All current callers are proposal/chat inline tests. Production command composition uses `commit_prepared_note_review` and `commit_prepared_note_creation_at_path`, preserving exact prepared bytes and Note Timeline coordination. Review and fixed-path creation wrappers share the actual lower canonical core, so these are narrower than BT-02's fully separate save replica. The standalone `commit_note_creation` instead owns its own automatic unique-path retry publisher; that wrapper-only behavior is obsolete relative to production's reviewed fixed-target conflict semantics.

Migrate stale-hash, fixed-path/frontmatter, creation collision and chat commit-recovery test scenarios to the production prepared/command paths, then remove unused wrappers and their extra preparation/unique-path policy. Preserve low-level exact-byte checks where the same canonical core remains in production. Creation's preview path remains a prediction; production commit-at-path collision behavior must be the replacement oracle rather than adopting the legacy test's fresh automatic path recalculation by accident. Global app-data fixtures in pure preview cases can be reduced only after tracing watcher/fault consumers, not by broadly removing environment guards. Confidence high for unused caller paths, design judgment for migration grouping.

### Explicit residual inventory paths

Detailed residual test/target review includes `src/lib/architectureFitness.test.ts`, `src/lib/contracts/historyCommand.test.ts`, `src/lib/contracts/ipcFixtures.test.ts`, `src/lib/contracts/timelineContractFixtures.test.ts`, `src-tauri/tests/architecture_fitness.rs`, `src-tauri/src/note.rs`, `src-tauri/src/path_utils.rs`, `src-tauri/src/time.rs`, `src-tauri/src/tags.rs`, `src-tauri/src/proposals.rs`, `src-tauri/src/search.rs`, `src-tauri/src/lexical.rs`, and `src-tauri/src/secrets.rs`. This explicit list reconciles shortened file references in the original prose with the static inventory. Proposal detailed review was added during reconciliation as stated above; the other residual bodies were read during the initial pass.
