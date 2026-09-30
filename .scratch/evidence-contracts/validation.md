# Evidence contract validation

Historical milestone record. The failed native startup attempts below were
followed by the completed [native chat validation](../chat-reliability/validation.md)
and [worker validation](../chat-reliability/worker-validation.md). The later
reliability milestone also made provenance expansion opt-in. See the
[chat index](../chat-reliability/README.md) for current results and open work.

## Implemented

- Read-only retained added/removed body and property lines for explicit activity ranges, including subsequently superseded text. Historical evidence binds the change event and the retained content revision independently.
- Canonical known-note reads, separately labeled working-note reads, backend-owned search/read continuations, default provenance, independent item failures, and distinct retrieval/delivery/provenance completeness.
- Read-time temporal support (`supported`, `uncertain`, `not_established`), shared composition instructions, current-status checks, and parent research results with the same temporal-support metadata and recoverable remaining selections.
- Historical citation labeling and navigation to the actual retained content revision. Access, canonical freshness, retained proof and history-clear invalidation remain enforced.
- ADR 0009 records the user's explicit historical-content decision. No canonical Markdown/history format or write-owner change.

## Automated checks

- Full Rust library suite: 671 passed, 0 failed, 15 existing live/scale opt-ins ignored (before final pagination metadata correction).
- Final focused evidence-contract suite: 5 passed, 0 failed. Includes retained removals/superseded changes, unchanged backlog, later completion, out-of-range attribution, revoked access, cleared history, forged excerpts, partial batches, canonical read continuations, excluded assistant transcripts, uncertain clocks, and three-page activity continuation with separate retrieval/delivery completeness.
- Final agent-tool tests: 12 passed, 0 failed.
- Architecture fitness: 19 passed, 0 failed.
- `git diff --check`: passed.
- Affected frontend suite: 39 passed, including historical navigation to the content revision before removal.
- Svelte check: 0 errors, 0 warnings. Final E2E TypeScript check passed after correcting the nullable historical navigation result.

## Practical limits

Retained change evidence is line-granular and covers body/unmanaged properties. It excludes title/lifecycle events, discarded Editing Window intermediates, cleared history, missing/forgotten/excluded notes, and uncaptured canonical states. A removed task does not prove completion. Current recorded status does not independently establish a real-world outcome.

Temporal support validates delivery/proof and recorded timing; it does not validate semantic entailment or enforce the model's final claims. Broad current reads cannot inherit whole-passage activity from isolated dated words. Large retained histories have not received a new scale benchmark; existing bounded work/candidate limits report incomplete coverage.

Historical citations deliberately remain coupled to current canonical freshness and access. Editing a cited note requires obtaining fresh evidence even when a retained revision still exists.


## Live evaluation attempt

The native E2E binary built successfully with the final source (debug, isolated
ports 1431/4446, binary SHA-256
`37903d43d67de1b9de1d63a649eb733aa0c7182b1aa3b3f7b196cb7f0c35ca7d`).
The documented local endpoint at `http://100.117.20.29:1234/v1` was reachable and
listed `qwen/qwen3.8-27b`.

Two native harness attempts failed during startup, before the fixture's first
note-title lookup and before any model request. The first lost its WebDriver
connection; the logging retry repeatedly reported `Tauri core.invoke not available
after 5s timeout` and was stopped. The embedded-driver diagnostics also warned
about a missing standalone tauri-driver; that warning alone does not establish the
root cause. No answer artifact was generated and no semantic-rubric pass is
claimed. The production vault/provider settings were not used or modified.

The reproducible synthetic scenario and semantic rubric are in
`e2e/specs/native/activity-followups.spec.ts`; invocation is documented in
`e2e/README.md`. Native startup diagnosis and live answer review are tracked in
[issue 02](issues/02-native-activity-evaluation.md). Logs for this attempt are
`/tmp/evidence-native-run.log` and `/tmp/evidence-native-retry.log`.
