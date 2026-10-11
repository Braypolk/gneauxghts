# Dialogue omission and title validation fixes

Implemented the two follow-ups authorized after the offline audit: [issue 01](issues/01-hint-history-omission.md) and [issue 02](issues/02-title-match-validation.md). The [original audit](audit.md) and [original trace](offline-trace.json) describe the behavior before these fixes.

Editor hints still bind to canonical content for freshness/access checks, but no longer mark the assistant response as note evidence. Ordinary dialogue therefore survives terminal storage, next-turn history and compaction. Actual note reads and explicit body context save their durable omission marker before delivery, including when source cards are later removed or excluded. A marker-save failure stops content delivery and grants no full-read proposal coverage.

Lexical matches now carry a typed title/body location from index construction through discovery and canonical validation. Title candidates bind to the canonical title, including when identical text appears in multiple body paragraphs. Stale or ambiguous body passages remain withheld; access, exclusions, ranking and citation validation remain enforced. The index is in memory, so this adds no persistent index migration.

The correction applies to new responses. Existing omission flags remain intact because an old hint-only response cannot safely be distinguished from note evidence whose sources have since disappeared.

## Verification

The regression suite exercises real registered tools, actual terminal storage, recent history and compaction using disposable synthetic vaults. Red runs reproduced hint-only dialogue omission, lost omission after a direct-read source was excluded, fresh-title validation failures, repeated-body title collisions, and explicit body delivery despite a failed durable-marker write. No paid provider calls were made.

- Affected agent-tool, evidence, lexical, note-catalog and chat tests: **124 passed**, including all seven new regressions; two opt-in tests ignored.
- Architecture fitness: **21 passed**.
- Opt-in offline diagnostic: **passed**; retained separately as [fixed trace](fixed-trace.json). The hint-only marker now remains 0 → 0 with zero sources (originally 0 → 1). The synchronized scoped lexical query now has no coverage gaps.
- Rust formatting, diff whitespace, local artifact links and excluded-content canary checks: **passed**.

Reproduce the affected checks from the repository root:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib -- agent_tools:: services::evidence:: lexical:: services::note_catalog:: chat::tests
cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness
GNEAUX_CONTEXT_SELECTION_AUDIT_OUTPUT="$PWD/.scratch/chat-context-selection/fixed-trace.json" cargo test --manifest-path src-tauri/Cargo.toml --lib context_selection_offline_audit -- --ignored
```

Standards review found no actionable violations. Spec review found the marker-write failure edge case; the correction was independently reviewed with no remaining concerns. [Phase patch](fixes-phase.patch) isolates this work from existing and concurrent workspace changes.

Context coverage/reuse was subsequently implemented as [issue 03](coverage-and-reuse.md). Live trace collection and repeated provider comparison remain issue 04. Neither was part of this dialogue/title fix phase.
