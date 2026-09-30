# Composable chat validation

This records the earlier chat milestone, whose research journey established
parent fallback. The subsequent worker milestone demonstrates actual gathering
and delivery in five native scenarios; see [worker validation](worker-validation.md).

## Method

The opt-in native suite starts the Tauri application in a disposable synthetic
vault and uses the explicitly selected `qwen/qwen3.8-27b` model at the configured
local provider endpoint. The first request goes through the Svelte composer;
rendered citation navigation must open and highlight its exact current passage.
Subsequent turns use production chat IPC. Source access, retained history,
current status, exclusions, tool events, and citation resolution use production
services. Answer semantics are reviewed separately from the automated assertions.
No production notes or chat settings are changed.

## Demonstrated regressions and corrections

- Appending paragraphs changed the final newline of unchanged proposal text,
  which appeared as retained added/removed activity. A real timeline regression
  failed, then passed after normalizing only line terminators for comparison;
  excerpts and UTF-8 coordinates retain the exact source bytes.
- A read consumed passage allowance before rejecting its oversized response
  envelope. The budget regression failed at 600 bytes remaining. Complete pages
  are now prepared and sized before reservation/admission, including research
  metadata. Mixed-page and research-budget regressions pass.
- Research candidate transfer admitted selected but undelivered passages. A
  regression failed before the fix; candidates now transfer separately from
  delivered proofs.
- The native composer answer and rendered citation succeeded, but its follow-up
  was rejected as an externally edited transcript. A controlled production-sink
  regression reproduced own publication being compared with the previous hash
  receipt. Publication and conflict checks now serialize, and managed watcher
  events recheck live canonical projection bytes. The regression passes and
  still detects a genuine external edit.

- Native UI citation checks later failed because writing the evaluation JSON
  under `.scratch` triggered a Vite page reload. The captured DOM had returned to
  a blank note; the Vite log named the report as the reload trigger. Scratch
  artifacts are now excluded from the dev watcher. The citation-rendering
  assertion is retained, with safe DOM diagnostics available on failure.

## Baseline answer review

The original native baseline completed with retained and current citations and
no excluded canary. It incorrectly promoted the unchanged weekly-exports idea
into interval activity and an outstanding task. The first rebuilt answer found
only the three changed lines and explicitly excluded weekly exports as an idea.
It correctly treated the report as recorded complete, onboarding as superseded
by vendor review, and the pilot as canceled. This improved run exposed the
transcript conflict before the follow-up, so it is retained as
`artifacts/native-before-projection-fix.json` rather than reported as a passing whole suite.

## Contract and UI checks

The full frontend suite passed: 131 files, 945 tests. Svelte and E2E TypeScript
checks reported no errors or warnings. Architecture fitness passed 19 tests.
After precise envelope accounting, the exhaustive checkbox-lineage fixture uses
independent bounded read sessions to inspect every discovered range; it does
not claim that one agent run can exhaustively read all ranges under the shared
24,000-byte allowance. Dedicated regressions enforce that allowance and partial
delivery.

The full Rust suite after the transcript fix passed 674 tests with no failures
(15 opt-in tests ignored). After removal of an unused helper, all 56 chat tests
passed again. The tested native binary has SHA-256
`7706f6a68459c1c31289d868e45a7fc6fe05fe692ab179bcbda439fce3f427f7`.

## Live repeat and semantic limitations

The repeated run completed the composer temporal answer, exact current body
citation navigation, and the fresh cross-note follow-up. The new note recorded
vendor review complete and an outstanding Rhea contract; the follow-up read it,
reported both correctly, and distinguished weekly exports as an idea. No private
canary appeared and all cited IDs resolved. Those completed answers are retained
in `artifacts/native-ui-and-followup-passed.json`.

The second independent temporal request exceeded the 300-second request deadline.
The previous helper did not preserve its pending answer, so the cause is not
established. Timeout capture is now present; see issue 06.

A subsequent answer linked the pilot's historical insertion claim to a current
note-title passage. Identity resolution succeeded, but entailment failed. This
is preserved in `artifacts/native-citation-mismatch.json` and tracked in issue 07. The UI
harness also incorrectly assumed this title citation had a body selection; it
now explicitly chooses a cited current body passage for highlight verification.
Neither model answer quality nor repeated-run reliability is claimed universally.

## Stronger read-contract gate

A complete native journey passed its original execution checks in 6m 9s, retained
as `artifacts/native-discovery-only-research.json`. Its research call supplied a topic as a
folder filter and returned `partial/empty_scope`. The parent recovered current
status but quoted historical discovery previews without reading the historical
passages. This is a semantic failure, despite successful execution/citation
resolution. The stronger gate correctly rejects that preserved answer.

Shared capability instructions now require read evidence for factual claims,
claim-supporting citations, and discovered metadata for folder/note filters.
The final research assertion requires a read, cited historical passage from
research or direct fallback. All 14 agent tool tests and E2E TypeScript checking
pass after this change. The rebuilt native binary SHA-256 is
`933be804824cadcba04bc50dbfdf40a3d32777223d77495ef0ba65679e6e65c9`.

In the rebuilt run, the activity answer read/cited all three changed passages and
opened/highlighted its current body citation. The fresh cross-note answer acquired
vendor completion and the Rhea task. It reached the shared evidence allowance
and disclosed gaps, but still used discovery previews for some surrounding claims.
The activity answer also paraphrased a checked report as “sent,” which exceeds
recorded-status evidence. Semantic quality therefore remains open (issue 07).
Evidence efficiency in small cross-note requests is tracked separately (issue 08).

## Final compact-read validation

Ordinary `read_evidence` now defaults to compact delivery; expanded per-range
lineage requires `include_provenance=true`. Exact canonical validation, retained
historical identity/timing and backend activitySupport remain present. Per-item
provenance coverage records whether expansion was requested. The eight-edit real
fixture failed before this change: 192 bytes of current content required paging
lineage. It now returns complete current content in one read, while explicit
expanded provenance and validated historical support remain available.

The final full Rust suite passed **675 tests, 0 failed, 15 opt-in ignored**.
All seven real timeline evidence-contract tests pass. The unchanged frontend
suite passed 945 tests in 131 files, architecture fitness passed 19 tests, and
Svelte/E2E types passed with no errors or warnings. `git diff --check` passes.

The final native test passed **one complete three-request journey in 7m 37s**
against the same selected local model, using binary SHA-256
`c841aa6401198ced6f565c19d8e6e7041156bb95068ef7527c0d9fee74615252`.
Its stronger assertions require both read/cited historical evidence and the
newly added current status note; the preceding saved answer fails that new gate.

- The composer activity answer read/cited all three retained additions, checked
  canonical current status, kept old backlog separate, and opened/highlighted an
  exact current body passage. The report was recorded complete, onboarding
  superseded, and pilot canceled.
- The follow-up read/cited both current notes in two successful read calls,
  reflected vendor completion and Rhea's outstanding contract, and separated
  weekly exports as a proposal. It did not exhaust the evidence allowance.
- Research returned `partial/empty_selection` with no delivered worker evidence.
  The parent disclosed research failure, directly read/cited all three historical
  changes and both current notes, and reflected vendor completion plus the Rhea
  contract. This is **fallback success, not worker success** (issue 09).
- Every cited passage resolved through production validation and no excluded
  canary appeared. `artifacts/native-final.json` and `artifacts/native-final-answer.png` retain the
  actual answers, events, and UI state.

Two transient WebDriver async polling timeouts occurred during the final run.
The app remained responsive and recovered. A one-second process sample showed
active conversation validation/serialization, without an established mutex
cycle. The concurrent full Rust suite makes this unsuitable as a controlled
latency measurement. The earlier independent-request timeout remains recorded
in issue 06. Semantic entailment and coverage wording still require broader
model evaluation (issue 07); this small passing journey is not universal proof
of answer correctness.
