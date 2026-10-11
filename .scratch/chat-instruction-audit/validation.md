# Chat instruction cleanup: implementation and validation

Implemented October 9, 2026, against working-tree baseline `1060abba`. The original validation below was offline. A subsequently authorized live smoke evaluation and provider fix are recorded in [live evaluation](live-evaluation.md).

## Result

One [assistant core](../../src-tauri/src/chat/assistant_instructions.txt) replaces the three unconditional parent layers. Its file is 2,937 UTF-8 bytes and 418 whitespace-separated words, 80.3% below the former 14,946-byte parent instruction bundle. The runtime trims its final newline. Tool mechanics remain in registered descriptions/schemas; date interpretation accompanies the shared run reference; prose, checkbox and deadline interpretation arrives with structurally relevant reads.

The current-note header subtitle is removed. Automatic adjacent-editor context carries an allowed canonical note ID, bounded title and validated selection as a relevance hint. It sends no note body, creates no primary-evidence source and grants no rewrite read coverage. Canonical hash/access revalidation and source-sensitive history tracking remain. Explicit working-note reads, selected context, privacy permissions, proposal review and normal editor routing retain their existing boundaries.

## Complete request measurements

The offline audit runs the actual streaming AgentRuntime with the actual ten registered tools and a MockCompletionModel. The paired first-request fixture says Hello with a saved four-line adjacent note, no conversation history, no web and no editor-convention override. The production assembly's reference semantics and automatic context change between variants, as intended.

| Component (UTF-8 bytes) | Before | After |
| --- | ---: | ---: |
| System messages | 15,007 | 2,976 |
| Tool definitions (10 tools) | 11,776 | 13,217 |
| Conversation/reference/editor context | 807 | 1,203 |
| Documents container | 2 | 2 |
| Complete assembled input | 27,592 | 17,398 |
| Serialized request including outer metadata | 27,765 | 17,571 |

The assembled input is **36.9% smaller**. Tool definitions grew because specialized contracts moved out of the global prompt; this table includes that cost. Large adjacent note bodies can change the comparison further; no universal percentage is claimed. These are serialized byte measurements before provider formatting, not exact tokens, latency, cost or a model-quality result. Provider templates/hidden overhead remain outside this measurement.

Counter-only captures: [before](request-before.json), [after](request-after.json), [requests after evidence reads](read-requests-after.json). They contain no prompt, note or credential text.

The separate controlled read-loop fixture measures complete subsequent requests, including retained result guidance:

| Request | Input bytes | Retained tool-result bytes |
| --- | ---: | ---: |
| 1 | 17,185 | 0 |
| 2 | 20,539 | 3,150 |
| 3 | 22,663 | 5,070 |

That fixture reads the same short note twice to verify retention and non-duplication. The final forwarded request retains one prose contract, exact passages and short citation references. It demonstrates instruction delivery through real tool dispatch; the scripted mock does not demonstrate whether a model chooses efficient retrieval. This read-loop fixture is not paired with a pre-change read-loop measurement.

## Specialized owners and bounded delivery

| Rules | Production owner |
| --- | --- |
| Shared intent, relevance, source integrity, citation entailment, uncertainty and review | chat/assistant_instructions.txt |
| Discovery, temporal scopes, exact read references, cursors and coverage | agent_tools/evidence.rs descriptions and schemas |
| Complete working-copy reads, localized/full rewrites, exact anchors, Gregorian deadlines and Keep | agent_tools.rs operation descriptions and existing enforcement |
| Date/time conventions, Gregorian dates, Latin digits, calendar semantics and fixed text | chat/date_time.rs through query_anchor_label, shared with workers |
| Prose actor/action/event time, checkbox status timing/restoration, parsed current deadlines | services/evidence/guidance.rs through reads.rs |
| Research selection, remaining IDs, fallback and closed worker authority | agent_tools/research.rs and existing structured errors |
| Web links | Parent preamble only when web capability is enabled |

Each independent EvidenceSession tracks which app-authored contracts reached its runtime history. Worker forks reset that state while sharing the existing allowance. Research transfers validated candidates to the parent without admitting them, then sizes and admits the handoff using the parent's delivery state. Worker state cannot suppress parent instructions.

Normal and research pages include all pending guidance before their size/reservation checks. Failed delivery consumes neither citations nor guidance. If guidance crowds out an otherwise deliverable passage, a bounded partial bootstrap supplies guidance and leaves the source unadmitted. A normal cursor or research remaining IDs resumes it. Both the bootstrap and conservative followup envelopes must fit the shared allowance. The 6,000-byte page and 24,000-byte run limits are unchanged.

Tool history is retained within a runtime. Between-turn compaction creates a new EvidenceSession and delivers applicable contracts again; it cannot retain a delivery marker after discarding its instruction. No question keyword classifier or workflow router was introduced. Architecture and behavior invariants document these boundaries.

## Verification

- Backend library suite: 800 passed, 22 ignored, with one sandbox-only failure because the existing capacity-probe fixture could not bind localhost. That single test subsequently passed with socket permission. All 801 non-ignored cases therefore passed across the suite and isolated rerun. The ignored live/scale cases were not run.
- Final targeted checks: 19 evidence tests, 12 research tests and 9 real-tool/streaming tests passed. Coverage includes full-envelope budgets, long/dense tasks, independent worker/parent guidance, retained citations, exclusions, canonical freshness, working-copy proposals and rewrite read requirements.
- Backend architecture fitness: 21 passed.
- Frontend chat plus architecture tests: 182 passed across 22 files.
- pnpm check: zero Svelte errors/warnings; e2e TypeScript check passed.
- pnpm build, cargo fmt --check and git diff --check passed.
- Independent Standards/Spec reviews found and resolved parent/worker guidance leakage, disabled-context retrieval imperatives, dense-passage capacity blocking, conservative continuation sizing and cross-case evaluation contamination. No remaining findings from the reviewed fixes.

The former grounding supplement is retained only as grounding_baseline.txt for the ignored local evaluation harness. That harness now chooses candidate guidance per case and explicitly compares old/new supplements on the new core; it is not a full pre/post production-prompt comparison.

## Remaining evaluation boundary

At the original offline checkpoint, no live model behavior, retrieval choices, semantic citation quality, latency or billed token reduction had been established. The later [six-case smoke evaluation](live-evaluation.md) now provides limited live evidence and identifies a fixed provider-schema retry bug; it does not establish broad model reliability or a paired billed-token reduction. The eleven cases in spec.md remain the rubric for a later bounded model evaluation. In particular, automatic note inference and stopping after sufficient evidence are instructions whose effectiveness must be measured with the chosen model; mock responses cannot establish them.
