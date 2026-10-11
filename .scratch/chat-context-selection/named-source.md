# Related evidence, source attribution and gathering

The user's clarified rule is to use relevant related-note evidence and tell the user which note supplied the answer. A mention of a note does not automatically restrict factual investigation to that note. The earlier strict in-note grading of the multipart question was a policy assumption, not evidence that the supported Mateo answers were fabricated.

The current change makes related-note prose attribution explicit and adds a once-per-evidence-session source/sufficiency reminder. It has **not demonstrated reliable gathering or answer-quality improvement**. Issue 05 remains open; do not treat this as a passing live regression gate or a proven token-saving fix.

## Current change

The shared core now gives the concrete wording “According to [note title], …” and asks chat to distinguish what a named record leaves unrecorded before adding supplementary related findings. It grows from 2,937 to **3,161 UTF-8 bytes**, still below the existing 3,200-byte contract. The new 268-byte evidence rule is delivered on the first nonempty evidence-tool read and budgeted through the existing reservation/admission mechanism. It is not an extra tool or a question parser. It preserves cross-note access, canonical coverage, reuse, worker isolation and existing runtime limits.

The rule is not injected through the linked-note or selected-context shortcut; the shared core applies to those paths. Existing app-owned passage citations already display note titles in the UI (`chatMarkdown.ts`); explicit prose attribution is an additional clarification, not the only user-visible source identification. We did not change the UI or citation authority.

Offline compatibility now explicitly verifies that complete named-note coverage leaves cross-note discovery and reading available. The mixed read-budget test sweeps up to the documented 6,000-byte read limit: 3,000 was only its old fixture search threshold. Production budgets are unchanged.

## Final comparison

[Raw combined trace](named-source-trace.json), [hash-bound manual review](named-source-manual-review.json), [usage summary](named-source-summary.json), [scoped patch](named-source-phase.patch).

Three paired repetitions of three synthetic requests used `gpt-6-luna`, the saved app Keychain credential, the actual streaming AgentRuntime and note tools. No private vault content, credential text or private reasoning was retained. Same note identities within each pair, fresh contexts, alternating order. Baseline uses the preserved original core and removes only the new Source scope hint; current uses both changes. This measures their combined effect, not either component alone. Caps remain six admitted model calls, 1,024 output tokens/call, 64 KB serialized input/call, eight tool calls, 60 seconds and 40,000 aggregate tokens/run.

| Measure | Baseline | Current |
| --- | ---: | ---: |
| Scheduled/persisted runs | 9 | 9 |
| Final answers returned | 8 | 8 |
| Answer-intent review passes | 6/9 | 6/9 |
| Strict manual passes, including canonical absence coverage | 6/9 | 5/9 |
| Explicit related-note prose attribution among Mateo answers | 0/8 | 6/7 |
| Related-note title visible through valid app citation | 8/8 | 7/7 |
| Tool calls | 28 | 21 |
| Admitted provider calls | 34 | 29 |
| Reported input tokens | 141,780 | 108,722 |
| Reported output tokens | 3,170 | 2,851 |
| Estimated reported cost | $0.00591016 | $0.00507979 known subtotal; one unknown |

All returned factual claims match the inspected synthetic passages: Priya completed checksum verification on September 18, the entire launch has no recorded completion, and Mateo's approval is recorded in `Meridian approvals`. Correct factual support alone does not establish that every requested distinction was answered.

The current explicit source-record answers distinguished the retrospective's missing approver in two of three repetitions. Only one also obtained complete canonical coverage before the absence claim. The other delivered `selected_passages` coverage, which explicitly is not whole-note coverage. A third answer named the related source but omitted the requested distinction about the retrospective's own record.

In the original factual question, current found and explicitly attributed Mateo in two of three repetitions. The remaining repetition narrowed discovery to the retrospective, read it completely, then stopped with its unknown approver. It should have investigated the factual gap across relevant notes. Baseline answered this broader factual question in all three repetitions, with valid title-bearing app citations but without explicit prose note names.

The explicit cross-note request succeeded in all three baseline repetitions and two current repetitions. Current repetition 1 failed before any tool call, with no provider usage reported; the artifact retains only the fixed `runtime_failed` marker. Its cause is not established. Baseline source-record repetition 1 hit the model-call cap after invalid evidence IDs, repeated reading and recovery. It remains a failure, not an excluded observation.

The aggregate live test processes exit nonzero because smoke/behavior checks fail. Repeat 1 also had a smoke false negative for valid “does not name” wording; the checker was corrected before repeats 2–3, and the original raw score remains intact. The smoke checker requires explicit prose names for the multipart case, whereas manual review also recognizes the existing UI's title-bearing citations. The table therefore does not misclassify baseline citation-only answers as lacking user-visible attribution.

Fewer observed calls and tokens do not establish an improvement: one current run failed immediately, one missed a relevant answer, the sample is small, cache reuse differs, and answer quality is not consistently better. Costs apply the previously verified standard rates to reported categories, not an invoice. Missing usage and interrupted in-flight calls are unknown. Rig exposes no OpenAI cache-write category; output already includes reasoning tokens.

## Retained experiments

Earlier candidates and raw scores remain separate from the final comparison:

| Artifact prefix | Persisted runs | Reported-cost estimate | Finding |
| --- | ---: | ---: | --- |
| `named-source-attempt1` | 12 | $0.00816585 | Strict in-note policy did not hold; one current broad run capped. Prompt reverted. |
| `named-source-attempt2` | 12 | $0.00684662 | Same policy failure; one current broad run capped. Prompt reverted. |
| `named-source-attempt3-part1` | 4 | $0.00243342 | Strict policy still failed. Prompt reverted. |
| `named-source-guidance-part1` | 4 | $0.00275195 | Hint-only screen did not improve strict source behavior. Hint revised. |
| `named-source-aborted-wiring` | 2 | $0.00116480 | Review caught omitted case 5 and hint removal from both variants. Aborted; excluded from comparison. Its original method description is inaccurate for actual wiring. |
| `named-source-brief-attribution` | 7 | $0.00476575 | Brief wording was inconsistent, including malformed citations in one answer. Stopped; concrete example replaced it. |
| Final concrete wording, two preserved parts | 18 | $0.01098995 known subtotal | Mixed outcome detailed above. |

Total across these disjoint artifacts: **59 persisted runs, $0.03711834 in reported-cost estimates**. This excludes unknown usage, including any in-flight work at interruption. The combined trace is a view of its two parts, not additional paid work. The earlier issue-04 comparison is separate and not included. Historical strict policy scores were retained; the user's clarification changes future intent grading, not old raw outputs.

## Verification and remaining work

The final affected offline suite passed **96 tests**, with five explicit opt-in diagnostics ignored. Architecture fitness passed **21 tests**. Rust formatting and whitespace checks passed. Independent Standards and Spec review caught and verified both final harness wiring fixes; final wording and supplement citation allowances had no remaining review findings.

Issue 05 remains open for reliable context-selection behavior. The next focused work should reproduce the narrowed-discovery/unknown-answer path and invalid evidence-ID recovery at the model boundary, without assuming that all related-note reads are unnecessary or adding more broad instructions. Canonical rereads that establish whole-note coverage serve a different purpose from an already-delivered passage. Any future retrieval change should preserve that distinction and be evaluated against complete answers, not token counts alone.
