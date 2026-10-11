# Reliable context selection

Implementation of the [approved plan](reliability-plan.md), scoped against the [pre-phase snapshots](reliability-baseline/) in [this patch](reliability-phase.patch). Earlier working-tree changes and historical evaluation artifacts are preserved.

## Implemented boundaries

Read coverage now exposes `wholeNoteComplete` separately from the existing scoped `complete`. It can only be true after a complete canonical-note read across its continuation pages, with no earlier unavailable passage. Complete selected passages remain false even if the excerpt happens to cover the body. Normal current selected passages provide exact canonical `nextReads` selectors; canonical pagination provides its exact cursor. Temporal selected reads and research handoffs do not suggest broader canonical reads. All fields enter envelope sizing before admission and charging. These are suggested actions, not automatic retrieval or new access.

The tool boundary issues compact evidence selectors with a random context namespace, replacing long hashes only in discovery/read selector fields. Exact resolution happens before the evidence owner performs ordinary candidate, freshness, scope and exclusion checks. Mixed compact/canonical duplicate arguments deliver one passage; the original raw eight-selector cap remains. Unknown or foreign references fail with a recovery message and consume no evidence allowance. Legacy canonical selectors still work. Durable passage IDs and `[S#]` citation authority remain unchanged.

Cloned tool contexts share their selector registry. Later runs and research workers receive independent registries. Worker hints are remapped to worker selectors but grant no read/selection authority. A worker can select only actually read evidence; parent handoff revalidates durable identities and issues parent selectors. No new tool, note picker, adjacent-note body injection, question parser, forced scope, or successful-call cutoff was added.

The shared core instructions remain **3,161 bytes**, unchanged in this phase. The adopted scope rule is 319 bytes versus 268 before (+51), delivered once on the first relevant evidence read rather than in the starting system message. The scope experiment changes only the once-per-session `Source scope` rule at the model boundary. Its revised candidate treats a named note as the starting point for factual questions and permits discovery for unresolved facts even when no related lead has yet appeared.

## Offline validation

The initial real-tool reproductions failed on missing whole-note coverage and full-length evidence selectors. After implementation, **75 affected tests passed, 3 opt-in diagnostics/evaluations ignored** (`cargo test --manifest-path src-tauri/Cargo.toml --lib -- agent_tools:: services::evidence::`). Coverage includes selected versus canonical reads, multi-page continuation, unavailable earlier pages, clipped explicit context, mixed duplicate selectors, later-run/worker rejection, hint versus read authority, stale/excluded content, canonical citations and shared delivery budgets.

**21 architecture fitness checks passed.** Formatting and whitespace checks passed.

Independent Standards and Spec reviews found no remaining actionable production or experiment-boundary defects. A fixture deadlock and incorrect persistence-path argument in newly added tests were corrected before live evaluation.

## Live evaluation

The coverage screen passed manual review in both arms: **3/3 each**. Explicit record omissions followed canonical retrospective reads. Current made eight tool calls across three runs versus seven with the new fields removed; one extra call established whole-note coverage of the approval note without changing the answer. Provider-reported estimated totals were $0.00193955 versus $0.00186755. This tiny sample shows neither an answer-quality gain nor savings from coverage metadata. The fields remain useful as a truthful, actionable application contract.

The reference screen also passed manual review **3/3 in each arm**, with no copying errors in either arm. Short-reference runs used nine tool calls and 49,203 input tokens versus eleven calls and 54,285 input tokens with durable IDs. Estimated totals were $0.00191626 versus $0.00245184. Those are directional observations, not an established savings rate: retrieval choices and caching differ, and only one paired repetition was run. One current cross-note answer used citation-title attribution without explicitly naming the supplying note in prose; the citation displays Meridian approvals in the application.

The three-arm scope screen passed manual review **3/3 current, 3/3 revised, 2/3 removed**. The removed-rule explicit-record answer inferred an unnamed approver from selected passages without canonical coverage despite truthful whole-note metadata. The revised rule retained that boundary and used seven tool calls versus ten for current; estimated totals were $0.00171060 versus $0.00198702. This promising screen was followed by three held-out paired phrasings before selecting a production change.

The source screen's automated test fails because the revised factual answer uses citation-only attribution; manual review accepts its title-bearing citation and records prose attribution false. Conversely the removal arm passes smoke checks but fails manual canonical-absence grading. Both raw smoke results remain preserved.

The held-out scope comparison passed manual review **3/3 revised versus 2/3 original**. Both explicit record answers obtained full canonical retrospective coverage. In the genuinely absent-actor corpus, original wording searched repeatedly and attempted a ninth tool call, which the existing eight-call execution guard rejected; no final answer was returned. All five admitted provider calls reported usage, retained even though final aggregate usage was unavailable. Revised wording canonically checked the retrospective, returned its supported findings and kept the approver unresolved, without claiming exhaustive vault absence. Its three runs used eight tool calls versus fourteen attempted calls for original (including the rejected ninth); estimated totals were $0.00166419 versus $0.00225056. A second false smoke result in the original source-record answer is grammar/checker-only and correctly receives a manual pass.

Across the initial and held-out scope cases, manual results are **6/6 revised versus 5/6 original**, with the removed-rule arm **2/3**. The revised rule is now adopted in production. This is small directional evidence and a policy-aligned clarification, not a statistical reliability guarantee or a general savings rate. Future experiment arms explicitly preserve `scope_original` and `scope_revised`; historical traces retain the pre-adoption `current` label. Production guidance goes through normal envelope accounting, with all 75 affected offline tests passing again after adoption.

The final adopted production implementation passes **3/3** additional manual checks: named-note lookup with an unrelated adjacent editor, highlighted text, and the recovery code beyond a clipped long linked body. The last case follows all three canonical pages and cites the tail passage. These are new phrasings of prior fixtures, not independent real-world datasets.

**30 synthetic runs were retained**, including the two manual failures in comparison arms and every smoke discrepancy. Provider-reported usage estimates total **$0.01859235**, including the original tool-limit failure. Every admitted provider request has a usage record in this phase; no unreported request cost is assumed zero. Pricing uses the preserved October 9 standard-rate check and is an estimate rather than an invoice. Rig exposes no separate OpenAI cache-write usage; reasoning is already included in output tokens. Earlier experiments' costs and unknowns remain in their own reports.

Every run uses disposable synthetic notes, the real streaming runtime and actual tools, bounded by six provider calls, eight tool calls, 60 seconds, 64,000 serialized request bytes, 1,024 output tokens per call and 40,000 aggregate tokens. No private notes, credential values or private reasoning are recorded.

Coverage and reference comparisons each remove only their own presentation change; the underlying production admission always remains current. The scope comparison uses current, revised and removed hints with identical shared instructions, tools, coverage and references. This is an isolated presentation comparison, not a complete historical implementation replay. Initial cases distinguish explicit source record, factual related-note inquiry and explicit cross-note investigation. Manual claim-level review and canonical absence coverage determine quality; smoke checks alone do not.

## Retained artifacts and practical limits

| Experiment | Trace | Claim-level review | Usage/quality summary |
| --- | --- | --- | --- |
| Coverage only | [raw](reliability-coverage-trace.json) | [manual](reliability-coverage-manual-review.json) | [summary](reliability-coverage-summary.json) |
| References only | [raw](reliability-references-trace.json) | [manual](reliability-references-manual-review.json) | [summary](reliability-references-summary.json) |
| Three scope hints | [raw](reliability-scope-trace.json) | [manual](reliability-scope-manual-review.json) | [summary](reliability-scope-summary.json) |
| Held-out scope phrasings | [raw](reliability-scope-holdout-trace.json) | [manual](reliability-scope-holdout-manual-review.json) | [summary](reliability-scope-holdout-summary.json) |
| Adopted production shortcuts | [raw](reliability-shortcuts-trace.json) | [manual](reliability-shortcuts-manual-review.json) | [summary](reliability-shortcuts-summary.json) |

Each review is bound to its trace SHA-256. Independent Spec review verified all coverage/reference/scope/held-out claim grades. Both reviewers checked the adopted production rule and preserved original/revised experiment mapping. The offline [review helper](review-reliability.py) extracts supporting material without assigning semantic judgments; [summarization](summarize-live.py) makes no provider calls.

The fixture uses lexical fallback with semantic search disabled. Enabled semantic ranking, other models, broader conversations, real private vaults, UI interaction and final durable chat completion were not tested live. Worker isolation and handoff were tested offline. The historical narrowed-title failure with no useful related lead was not independently replayed under constant discovery results in this screen; the new wording permits that discovery, but its success on that exact branch remains unproven.

The named identifier holdout still searches again after resolving a title, rather than directly reading its known note ID. Long-link canonical recovery still repeats an already-delivered prefix. These traces therefore do not establish that all extra retrieval is gone. Whole-note checks can legitimately repeat selected text; repeated overlap alone is not proof a read was unnecessary. Ranking/grouping and recovery-offset changes were not justified by this phase's small screen and remain separate opportunities.
