# Coverage and reuse

Implemented [issue 03](issues/03-context-coverage-and-reuse.md) after the [dialogue/title fixes](fixes.md). The model-facing interface remains five tools, with no new settings or user context picker.

Answer reads now distinguish `coverage.scope=canonical_note` from `selected_passages`. `complete` applies to the original selection across its continuation pages. The canonical-note selector remains attached to every page; an earlier unavailable passage prevents a later successful page from claiming full coverage. Selected-passage completeness never claims the whole note, all retained history, or a complete real-world record.

Search coverage identifies retrieval, while delivery identifies previews. Search limitations remain truthful. Explicit linked bodies report body completeness; attachments report selected-excerpt completeness. Clipped context includes a valid `read_notes` answer selector for canonical recovery. Short linked bodies remain included; changing that policy needs the live comparison.

Discovery and read items carry `alreadyRead=none|partial|full`. EvidenceSession computes this from the union of exact delivered ranges under the same note, canonical version, location and historical proof. Intersecting text must match, including titles whose body hash is unchanged. Tracking starts only after successful source/reference admission or actual explicit canonical body delivery. Previews, editor hints and working-copy proposal reads cannot grant answer reuse. Independent workers start without the parent's delivered text; only returned parent evidence counts there.

Reuse reports text overlap, not provenance completeness or citation authority. Content remains available on explicit reads, with normal budgets, canonical validation and exclusion checks. This phase adds no fixed search cutoff, question parser, open-note scope lock or automatic content suppression.

## Offline cost

Compared with the post-dialogue/title [baseline trace](fixed-trace.json), using the same synthetic inputs and scripted tool choices:

| Starting request | Before assembled bytes | After assembled bytes | Added bytes |
| --- | ---: | ---: | ---: |
| Greeting | 12,627 | 12,740 | 113 |
| Plain named note | 12,654 | 12,767 | 113 |
| Short linked note | 12,946 | 13,109 | 163 |
| Selected text | 12,684 | 12,797 | 113 |
| Long linked note | 15,332 | 15,577 | 245 |

The fixed tool definitions grow by 113 bytes, from 8,400 to 8,513; system messages remain 2,976 bytes. Link coverage adds 43 bytes for the short body and 115 for the clipped body, before JSON escaping in the assembled model request.

The fixed three-request search/read trace grows from 46,399 to 47,052 assembled input bytes (+653, 1.4%). The four-request trace with extra searches grows from 69,093 to 70,229 (+1,136, 1.6%). These are complete assembled inputs before provider formatting, not billed token counts. The scripts make identical choices, so they measure metadata overhead and repeated transmission rather than whether a model stops sooner. Live token savings, cache behavior and answer-quality effects remain untested; [issue 04](issues/04-live-selection-traces.md) owns that comparison.

See [compact measurements](coverage-summary.json) and [full synthetic trace](coverage-trace.json). Original audit and post-fix traces are preserved. No credentials, private notes or paid provider calls were used.

## Verification

Seven registered-tool regressions cover selection scope, complete note continuations, previews versus reads, repeated citations, independent worker state, range unions, changed content, exclusions, short/long linked context, attachments and failed admission. A service-level continuation regression checks that an earlier unavailable passage remains incomplete on a later successful final page. Existing guidance bootstrap, mixed/research reads, shared budgets, history omission and proposal boundaries remain in the affected suite.

Both independent Standards and Spec reviews found no actionable issues. A strengthened test initially deadlocked because it retained one process-wide TestVault environment guard while opening a second fixture; releasing the first fixture fixed the harness without changing application behavior.

Final affected suite: **132 passed**, including all eight new regressions; two opt-in tests ignored. Architecture fitness: **21 passed**. The opt-in offline diagnostic passed after the final compact description changes. Rust formatting, diff whitespace, artifact links and excluded-context canary checks passed.

Reproduce:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib -- agent_tools:: services::evidence:: lexical:: services::note_catalog:: chat::tests
cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness
GNEAUX_CONTEXT_SELECTION_AUDIT_OUTPUT="$PWD/.scratch/chat-context-selection/coverage-trace.json" cargo test --manifest-path src-tauri/Cargo.toml --lib context_selection_offline_audit -- --ignored
```

The [phase patch](coverage-phase.patch) compares against saved pre-coverage files and excludes existing/concurrent workspace work.
