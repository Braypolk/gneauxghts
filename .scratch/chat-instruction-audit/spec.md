# Chat instruction reduction

Status: ready-for-human

Reduce unconditional instruction text while preserving source accuracy, reviewed changes, privacy and bounded execution. The assistant infers relevant notes from context; the user does not manage a current-note mode. The reviewed core and specialized delivery contracts are now implemented. See validation.md for measurements, verification and the remaining model-evaluation boundary.

## Draft artifacts

- [Shared assistant prompt](core-draft.txt): proposed replacement for the three unconditional parent instruction layers.
- [Supporting guidance](supporting-guidance.md): exact specialized text, owner and delivery conditions.
- [Rule preservation](preservation.md): every distinct existing behavior accounted for, with intentional changes identified.

The header marker is removed, and automatic editor context now carries a bounded identity/selection hint. Access policies, canonical write boundaries, evidence validation, guardrails and provider routing remain enforced.

## Current instruction baseline

The audit compiled the current Rust instruction builders in an isolated temporary executable and measured their returned UTF-8 strings. Counts exclude tool definitions, user context, note bodies, history, provider templates and generated output.

| Component | Bytes | Words |
| --- | ---: | ---: |
| Assistant base | 3,216 | 490 |
| Capability composition and evidence | 3,756 | 512 |
| Date conventions | 2,288 | 342 |
| Deadline editing | 421 | 61 |
| Grounding rules | 5,259 | 779 |
| OpenAI parent assembled with separators | 14,946 | 2,184 |
| Local parent with tools enabled | 15,487 | 2,267 |
| Local parent with tools disabled | 15,638 | 2,293 |
| Research worker separate instructions | 4,518 | 666 |

The tool-disabled parent still receives instructions to use tools. Date/deadline and grounding text totals 7,968 bytes, over half of the parent baseline. Repeated citation, current-status, proposal and recovery rules add further unconditional text.

Bytes are not token counts. A smaller core is not the same as lower total request usage: tool definitions and retained specialized guidance still consume context, and additional reads or repeated guidance can offset savings. Do not claim model quality, latency, exact token savings or cost reduction from static size checks.

## Draft measurement and checks

The proposed core is 2,937 UTF-8 bytes and 418 whitespace-separated words, an 80.3% reduction from the unconditional parent instruction baseline. This compares the core text only. Compact reference context, tool definitions and any retained result guidance are additional, so the complete assembled reduction must be measured during implementation.

The preservation map contains 115 behavior entries across the main prompt, capability guidance, date/deadline rules and grounding text. Static review retained source-handle integrity, current/pending-content distinctions, temporal uncertainty, actor attribution, scoped access, user review and recovery limits. Local artifact links and whitespace checks pass. This was the draft-stage result. Subsequent implementation checks are recorded in validation.md; no paid model requests have been made.

## Proposed assembly

Keep one shared assistant core. The actual available tools and compact run reference context define the capabilities for each request. Consolidate tool mechanics into their existing descriptions/schemas; do not add new wrapper tools or a question-specific router. Tool-disabled requests omit all tool-oriented descriptions and supplements.

Supply interpretation rules with the first structurally relevant evidence result in each runtime, rather than embedding every edge case in all conversations. The supporting draft specifies exact triggers and text. The evidence/backend owners retain permission, lineage, freshness and current-status enforcement. Parent and worker keep independent contexts and the current shared allowance.

The guidance-delivery path is implemented behind the existing evidence seam, with per-session markers, retained tool history and complete byte admission. Guidance must never contain note-authored instructions or bypass evidence allowance checks. Complete destinations and their checks before deleting their production sources. Update architecture documentation if implementation changes the runtime seam or evidence-delivery contract.

## Acceptance before production adoption

Use offline checks first. Confirm the final assembled tool-enabled and disabled instructions have one consistent authority, all rule destinations exist, every source rule is mapped, and the descriptions/schemas continue matching the real tools. Count the whole assembled request, including schemas and specialized result guidance, instead of reporting only the new core. Retain targeted evidence, temporal-support, task-date, scope, freshness, proposal and architecture regressions.

Preserve these behavioral cases in a later bounded evaluation, using synthetic notes and the production runtime/tool path:

1. Ordinary conversation with an unrelated open note does not search the vault or make that note its subject.
2. A clear reference to selected text/current note resolves without making the user choose a note; a material unresolved ambiguity is clarified.
3. A named topic in a different note is discovered without fabricated IDs/folders, and excluded notes remain unavailable.
4. A short known-note question reads only needed evidence, supports its answer with the correct passage, and stops.
5. A cross-note follow-up obtains fresh current evidence without treating older answers or query metadata as facts.
6. Checkbox completion, restoration, wording-only edits, uncertain marker time and code examples retain their distinct meanings.
7. Prose completion preserves actor, event date, finished substeps, later corrections and unknown timing; later-authored records of earlier events remain discoverable.
8. Deadline answers use current parsed task dates and local calendar semantics; proposed date edits preserve unrelated/child content and review.
9. Research reuses delivered reads, reports gaps and obeys shared limits; all branches handle stale evidence and nonretryable failures without loops.
10. Working-copy edits use current pending content; rewrites read all pages; neither changes canonical notes before Keep.
11. Tool-disabled responses receive no directions to execute unavailable tools and neither claim search nor note changes. The web-tool citation clause is included only when that capability is available; supplied web source material still retains its provenance.

No paid requests are required for drafting or static verification. Live model evaluation remains a separate authorized step after reviewing the instruction changes.

## Implementation outcome

The authorized instruction/context cleanup is implemented. See [validation](validation.md)
for final complete-request measurements, actual offline checks and resolved review
findings. The model-behavior cases above remain the broader rubric. A subsequently authorized
[six-case live smoke evaluation](live-evaluation.md) passed after fixing a provider
schema retry bug. Native UI, broader research/temporal cases and paired old-prompt
cost comparison remain untested; the offline mock results do not establish those outcomes.
