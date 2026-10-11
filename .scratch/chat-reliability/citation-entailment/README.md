# Citation claim evaluation

Offline evaluation established 2026-10-10 for [issue 07](../issues/07-citation-entailment.md).
The [validation report](validation.md) records the baseline and next experiment.
The [current-model pass](current-validation.md) records the subsequent paid
fixed-evidence run and its two citation failures.
The [production-reference check](production-reference-validation.md) records
repeated baseline/candidate answers and fresh-case calibration. Reference
conversion preserved raw answers; the candidate did not improve reliably and
was not promoted.
The [native reproduction](native-validation.md) then captured a malformed
reference and an excerpt-only scope violation, plus an unrestricted read that
passes. One Flex failure remains separate from semantic grading. A native
harness terminal-status bug was repaired offline; production behavior is unchanged.
The subsequent [structured-answer prototype](../structured-answer-prototype/README.md)
compares six paired fixed-evidence answers: explicit source associations improve
the observed table coverage, with 15.3% more reported tokens and no text deltas
through the formatter used in that historical experiment. Readable structured
streaming was subsequently [integrated on Rig 0.44](../structured-streaming-integration.md);
compact formatting was rejected. Semantic entailment remains open.
The offline review CLI makes no model requests. Semantic judgments are explicit
reviewer annotations; Python validates their integrity and accounts for them.
An optional, explicitly invoked app-runtime generator is documented below.

## Fixed cases

[fixtures.json](fixtures.json) contains 13 synthetic, model-independent cases
with 13 positive and 15 negative authored controls. Controls exercise the rubric
and accounting, not model performance. Source IDs are evaluation selectors, not
live app grants or citation destinations. Metadata describes the evidence facts
needed for review; it is not a serialized production tool response.

| Case | Required distinction |
| --- | --- |
| `title_is_not_content` | A title supports identity; retained body changes support text addition and its date. |
| `event_date_is_not_edit_date` | Explicit event date versus later spelling edit; missing citations and evasive uncertainty also fail. |
| `missing_report_is_not_failure` | No reported outcome leaves occurrence unknown. |
| `wording_edit_is_not_completion` | Current checked state and marker change versus later wording edit and real-world completion. |
| `restore_and_reopen` | Restored historical checkbox versus new accomplishment and current reopened state. |
| `deadline_inventory` | First valid deadline, independent child, fences, invalid dates and completed status. |
| `editing_window_uncertainty` | A bounded edit interval cannot become an exact insertion timestamp. |
| `idea_is_not_execution` | Added idea and later cancellation do not establish execution. |
| `superseded_approval` | Explicit later hold supersedes approval; a planned drill is not an outcome. |
| `conflicting_reports` | Competing reports remain unresolved without explicit correction. |
| `related_note_attribution` | Answer from a related note with its citation and explicit attribution. |
| `preview_is_not_read` | Matching preview text does not grant read/citation authority. |
| `partial_read_absence` | Absence within selected passages does not establish whole-note absence. |

## Review rubric

Read the full question, answer, source text, supplied metadata and coverage before
grading. Split note-based statements into atomic claims, including dates and
qualifiers inherited from headings, table columns, introductions and summaries.
Record an exact answer substring as `quote` and the complete interpreted assertion
as `proposition`. Annotate the actual inline passage IDs supporting that claim;
do not automatically associate the closest link or borrow a source cited for a
different fact. A shared paragraph/section citation can support multiple claims
when its scope is explicit. Multiple sources can jointly establish one claim.

Score these dimensions separately:

1. **Presence:** does the claim have an inline citation? `[citation unavailable]`
   does not count. Procedural suggestions need not cite note evidence; mark
   `requiresCitation: false` only for statements that make no note-based claim.
2. **Membership and authority:** are all cited IDs in the supplied source set and
   admitted reads? Preview text cannot grant authority, even when it matches.
   In historical snapshots, admission is reconstructed from delivered ChatSources;
   this does not revalidate their disposable-vault citations today.
3. **Semantic support:** do the cited passages, their supplied metadata and fixed
   question context establish the asserted entity, action, polarity, state, time
   and scope? A valid link alone cannot establish this. Use the verdicts below.
4. **Required coverage:** mark each case requirement `covered`, `missing`, or
   `unreviewed`, with a reason. Covered means the required detail is correctly
   addressed; it does not itself require a citation, which is scored separately.
   A wrong answer to the topic is missing coverage. A supported but evasive
   answer fails when evidence supplies the required fact. Explicit unknowns are
   correct only when evidence warrants them.
5. **Consistency and completeness:** review every note-based claim, including
   repeated summaries. A correct paragraph does not cancel a false table row.
   Check source identity, historical versus current scope, partial versus whole
   note coverage, event versus edit timing, and recorded state versus execution.

| Verdict | Meaning |
| --- | --- |
| `supported` | Cited evidence establishes the entire interpreted assertion, with appropriate qualifications. |
| `unsupported` | Cited evidence does not establish the assertion; it need not prove the opposite. |
| `contradicted` | Cited evidence establishes an incompatible fact. Lack of evidence alone is insufficient. |
| `unassessable` | No usable cited evidence permits support review, for example a missing citation. |
| `unreviewed` | Annotation is pending; it cannot pass. |

A preview may have a `supported` textual relationship while failing read authority;
this deliberately keeps semantic matching and authorization separate. Similarly,
an uncited correct fact can satisfy question coverage while failing citation
presence. All complete claim judgments, authority checks and required coverage
must pass for a full answer to pass.

`claimInventory: "full"` is the default. The reviewer must enumerate every
note-based claim. The script checks that every inline passage link is assigned,
but cannot discover an omitted natural-language claim. A completed full review
therefore remains a reviewer assertion, not an automated proof.
`claimInventory: "focused"` reviews only the explicitly selected claims;
`wholeAnswerPass` is always null. The recorded baseline uses focused reviews.

## Run the offline checks

From the repository root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .scratch/chat-reliability/citation-entailment -p 'test_*.py' -v
python3 .scratch/chat-reliability/citation-entailment/evaluate.py check --verify-traces
python3 .scratch/chat-reliability/citation-entailment/evaluate.py report --output .scratch/chat-reliability/citation-entailment/baseline-summary.json
```

[recorded-baseline.json](recorded-baseline.json) retains full synthetic answers,
questions and delivered source snapshots. Each selection records its original
trace SHA-256, JSON pointers and snapshot digest. The original traces are ignored
Git artifacts. Without them, plain `check` can still validate the retained corpus,
but reports origin verification unavailable; `--verify-traces` requires them.
The citation regex validates the simple curated Markdown in these cases; it does
not replace the app's general Markdown renderer or runtime citation validation.

## Review future answers on unchanged evidence

Answer generation is a separate future experiment. Capture an array in a JSON
file with one entry per case/repeat, preserving the answer exactly:

```json
[{"caseId":"event_date_is_not_edit_date","variant":"baseline","repeat":1,
  "model":"actual-configured-model-id","answer":"Exact captured answer including passage links."}]
```

Record actual usage as an optional `usage` object; omit it when unavailable.
Preserve the exact instruction/tool/guidance version and generation settings in
the experiment's report. Give the model the case question, context and source
evidence with its metadata; withhold authored controls, requirements and rubric.

```bash
python3 .scratch/chat-reliability/citation-entailment/evaluate.py prepare /tmp/citation-answers.json --output /tmp/citation-review.json
python3 .scratch/chat-reliability/citation-entailment/evaluate.py grade /tmp/citation-review.json --output /tmp/citation-grade.json
```

Between commands, manually fill each result's `claims` and `coverage`. A claim
has `id`, exact `quote`, full `proposition`, `citationIds`, `requiresCitation`,
`verdict`, `reason`, and `failureTags` (an array, empty for supported claims).
Copy the shape of an authored control, not its verdict, to annotate new answers.
Pending claims/coverage cannot pass; unassigned inline links are rejected.
`prepare` refuses to overwrite an existing review. `grade` verifies the corpus
and prepared-answer hashes before accounting. Keep one report per variant;
the aggregate does not split variants automatically. The script does not certify
generation provenance or independently verify reviewer judgments.
For a separately frozen corpus, pass `--corpus PATH` before `prepare` or `grade`.
The review binds that corpus by hash; grading with a different corpus fails.

## Opt-in app-runtime generation

[citation_evaluation.rs](../../../src-tauri/src/chat/citation_evaluation.rs) is a
test-only harness around the real streaming `AgentRuntime`. It gives the model
the current shared preamble, no-tools supplement, normalized fixed evidence,
case context, and structurally applicable current interpretation guidance.
Authored controls, requirements and rubric are withheld from the model input.
The output retains exact inputs, settings, answers, reported usage and elapsed
runtime latency. It captures neither private reasoning nor credential values.

Default generation is one-response synthesis with synthetic passage links.
`--production-references` instead uses the real reference preparation and renderer
on synthetic delivered ChatSources, retaining `rawAnswer`, rendered `answer` and
`citationSources`. Only the citation representation changes in model input.
Neither mode exercises retrieval, the app's complete read envelope, freshness
validation or citation navigation. Read authority and current scope are supplied
fixture facts. No-tools synthesis omits production tool definitions, including
their guidance; the latest report documents a limited calibration of that gap.
These limits apply even to passing answers.

The macOS [launcher](run_live.py) reads the existing Gneauxghts OpenAI credential
into process memory. Supply a non-secret settings snapshot containing `provider`,
`model`, `reasoning_effort`, and `service_tier`. It requires explicit opt-in:

```bash
python3 .scratch/chat-reliability/citation-entailment/run_live.py --run --settings /tmp/gneaux-citation-settings.json --output /tmp/citation-runtime.json
```

Default is one attempt per corpus case, stopping on the first provider/runtime
failure. Each run has a 120-second runtime deadline. The output is checkpointed
after each attempt and existing outputs cannot be overwritten. To resume after
a failure, use a new output and repeat `--case CASE_ID` for only unfinished cases.
Keep failed attempts as separate evidence and respect provider retry timing.
The launcher does not switch pricing tiers or rerun completed cases automatically.

Optional experiment controls are `--production-references`, `--repeats 1|2|3`,
`--preamble PATH` (a full test-only replacement), `--variant LABEL`, and
`--corpus PATH`. Supply a fresh output for each variant. Freeze any held-out cases
before generation and record prompt/source hashes; never treat those overrides
as an app instruction change. Tests remain ignored without explicit live opt-in.

## Opt-in native reproduction

The [native probe](../../../e2e/specs/native/citation-reliability.spec.ts) uses a
real disposable WebKit/Tauri app with production context, tools and reads. Build
the current E2E binary first, then explicitly launch the bounded four-case probe:

```bash
node e2e/support/buildNative.mjs
node e2e/support/citationReliabilityNative.mjs --run --settings /tmp/gneaux-citation-settings.json --output /tmp/citation-native.json
```

The non-secret settings snapshot contains `provider`, `model`,
`reasoning_effort` and `service_tier`; the saved Keychain credential stays in
memory. An existing output cannot be overwritten. Optional repeatable `--case`
accepts `deadline-1`, `partial-selected`, `partial-unrestricted`, `deadline-2`;
use a fresh output and preserve the failed attempt if resuming. The probe captures
raw text and stored rendered answers, delivered sources and passage resolutions.
Native IPC submission does not establish composer interaction or visual citation
navigation. Review semantics separately; see the report for exact scope changes
and retained failure/harness limitations.
