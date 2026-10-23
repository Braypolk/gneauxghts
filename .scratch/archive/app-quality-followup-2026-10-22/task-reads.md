# Task-read cleanup outcome — 2026-10-22

The master task list, recent tasks, and per-note patches now reuse the running
note catalog for persisted UI-state pruning. The same helper already used by
note-session reads owns cold/warm lookup policy. Master/recent queries refresh
the interactive index before pruning; a cold command therefore pays its required
index refresh once, without another pruning walk over every Markdown file.

`group_task_records` keeps the ordered result vector and adds a private
`note_id -> vector index` map. First-seen group order, within-group record order,
counts, visibility, and collapsed state are unchanged. The map is local to one
query; it is not a second task store or state owner.

## Preserved boundaries

- Repeatable task reads still use NoteTimeline's bounded current-content
  read/retry and final eligibility gate. Persistent invalidation remains a
  failure rather than an empty list.
- Indexed pruning still validates that resolved paths are eligible Markdown
  files in the Running Vault. Unknown ids are retained while the catalog is
  cold, matching the existing session policy; task list/recent calls explicitly
  warm/refresh it before obtaining preferences.
- Current source refresh, hidden-note/task handling, task filters, recent limits,
  and SQLite ordering remain with their existing owners.
- Task mutation preparation/publication, dirty-editor handling, Note Identity,
  and canonical note bytes are untouched. `TaskMutationService` and NoteTimeline
  remain the canonical mutation path.

No new architecture contract or ADR is needed. The shared wrapper is private
to the native commands module in `commands/note_session.rs`.

## Matched measurements

Measured before and after in the same workspace using an isolated temporary
vault, a Rust debug test build, disabled semantic inference, 500 notes with 10
tasks each, 500 explicitly ordered note ids, 10 hidden notes and 10 collapsed
notes. Each note also contains 24 ordinary prose lines. Five warm samples follow
one cold index preparation. The existing SQL/task projection cleanup from the
earlier pass is present in both runs.

The list measurement includes index admission, persisted-state reading/pruning,
the task projection query, and grouping. It excludes the Tauri bridge,
NoteTimeline's outer current-content read gate, and frontend rendering. Cold
preparation includes index admission plus persisted-state pruning. These are
focused pipeline measurements, not app-wide latency benchmarks.

| Work | Before | After |
| --- | --- | --- |
| Cold preparation | 24.782 s | 25.301 s |
| Warm list median, 5 samples | 70.408 ms | 53.809 ms |
| Pruning work per warm list | 1 vault walk; 500 Markdown read attempts | 0 vault walks; 0 Markdown reads; 520 indexed path checks |
| Pruning work during cold preparation | 1 vault walk; 500 Markdown read attempts | 0 vault walks; 0 Markdown reads; 520 indexed path checks |
| Grouping only, 40,000 records / 4,000 groups | 560.297 ms | 56.756 ms |

Warm samples before: 86.801, 69.235, 69.932, 70.408, 71.690 ms.
After: 54.085, 53.809, 53.744, 54.573, 53.677 ms.

Pruning counts are test-only, thread-local instrumentation, excluding unrelated
background work. Indexed path checks still perform file metadata checks; the
change does not claim zero filesystem access. The larger grouping input is
ordered by note with 10 records per note. The previous linear search performs
80,016,000 note-id equality comparisons for that input; the new path performs
40,000 map lookups and 4,000 insertions (algorithmic work counts, not measured
hash-probe counts).

The repeated byte reads and quadratic group search are eliminated. Cold setup
is dominated by existing full index preparation, and this single run shows no
cold-start latency improvement. Timings are local exploratory results and do
not establish production or mobile latency, sustained contention, or a formal
performance guarantee.

Reproduce the after measurement with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib task_read_work_measurement -- --ignored --nocapture
```

## Verification

- `commands::task_commands::tests`: 7 passed; 1 explicit measurement ignored
  by default. The measurement was run separately before and after and passed.
- Added an actual-command cold/warm regression comparing full serialized
  results and verifying recent limits, hidden/collapsed state, ordering, zero
  pruning Markdown reads, external source edits, missing notes and forgotten
  notes. Warm indexed preferences also match disk-pruned preferences in that
  stable fixture.
- Added an interleaved-record regression preserving first-seen order even when
  a group's first task is hidden, while retaining task order and counts.
- Existing note-session tests: 2 passed.
- Existing cold/warm persistence lookup regressions: 2 passed.

The matched measurement intentionally avoids a timing assertion in the regular
suite. Tests assert behavior and removed disk work instead.
