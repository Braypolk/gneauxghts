# Bounded citation context — issue 50

Completed 2026-09-06. A Revision Citation now opens its immutable Note/Revision target with at most 31 surrounding timeline records. It makes one context request and one selected diff request, without walking from the newest page. Both current-format scale fixtures and their visible native checks passed. [Raw measurements and identities](citation-context-50-measurements.json) include samples, SQL work, query plans, source/build hashes, preserved fixture manifests, test logs and failed attempts.

## Behavior and bounds

`HistoryModeAccess.revision_context` retains mandatory recovered read admission and the private History Mode grant. The concrete SQLite store seeks the Note/Revision pair, follows at most 15 indexed successors, and reads at most 31 predecessor-linked records plus one boundary validation. Lifecycle Events retain their true position even when timestamps disagree. Successor queries read at most two matches and reject ambiguous lineage; internally missing lineage is typed corruption and latches later publication admission. Missing anchors and stale caller continuations remain distinct errors.

Two rebuildable predecessor indexes are added only after current-format, vault, generation and installation admission. The retained schema, identity issuer, capture contract and ordinary chat capabilities are unchanged. Index construction is a one-time whole-store cost. Warm context lookup uses a fixed number of indexed seeks; it does not count a target's rank, use OFFSET, sort retained tables or traverse newer pages.

Context ordinals are signed positions relative to the cited revision. Opaque continuations bind the anchor, Note Identity, Vault Identity and history generation, and revalidate anchor retention on every page. Ordinary page cursors cannot enter this coordinate space. Newer/older context pages replace the viewport, preserving the selected diff with at most 31 timeline rows; refresh stays anchored. Successful clear/restore leaves anchored paging. A separate citation-origin flag preserves the independent target across subsequent refresh, retry and lifecycle changes, even when the invoking pane belongs to another note.

Entry checks request identity after flush, finalization, context and diff awaits. Obsolete completions stop further work and cannot restore a newer workspace. Failed-entry restoration and ordinary exit share the existing completion barrier. Duplicate entry while an entry is already admitted retains the existing admission behavior. Current-content citation delivery/revalidation and capability scope are unchanged; the delivered-citation browser journey still withholds removed prose from chat while allowing explicit History Mode inspection.

## Backend evidence

The unchanged issue-49 sealed masters supplied disposable clones: 10,000 revisions in one note, and 100,000 revisions across 901 notes with a 10k hot note. They retain authentic schema-13 Editing Windows, two production saves per window and 64 KiB repetitive Markdown. No histories were regenerated or relabeled. Both masters passed their complete hash/identity checks afterward; all 12 pre-50 architecture validation/measurement files match the after-49 snapshot byte-for-byte.

| Measured result | 10k fixture | 100k fixture |
| --- | ---: | ---: |
| Direct context samples | 30 | 120 |
| Adjacent page samples | 40 | 160 |
| Maximum response rows | 31 | 31 |
| Maximum serialized context, bytes | 15,913 | 15,913 |
| Maximum context SQLite VM steps | 6,272 | 6,272 |
| Context full-scan steps / sorts | 0 / 0 | 0 / 0 |
| Slowest context + parent diff, ms | 42.04 | 37.06 |
| Fresh recovery + full attestation + first page, ms | 846.98 | 6,947.48 |

Actual SQLite PROFILE counters cover the complete context SQL path, including admission and revision summary reconstruction; counters reset at every statement completion. Both successor branches use indexed SEARCH. Tests also assert bounds for every adjacent page. Backend selection, independent content reconstruction and fixture validation are untimed setup/checks. The hot note samples creation, index 1, index 50, middle, penultimate and newest targets five times each. The 100k probe also samples short-note indices 1, 450 and 900; their index 50 duplicates the midpoint, giving five distinct short-note ages among six nominal selections.

Initial predecessor-index statements cost 110,153 VM steps / 54 ms in the 10k process and 1,110,053 VM steps / 50 ms in the 100k process. Those profiler wall durations include scheduling and coarse timing effects; they are not isolated CPU/I/O measurements. Index construction and mandatory all-record startup attestation are reported separately from warm navigation.

## Visible native and integration evidence

Each native run exercised hot-note indices 0, 50, 5,000 and 9,999 three times through the actual chat-pane citation binding, with exact immutable targets, adjacent paging and workspace return. Each produced 12 entry, 9 older-page and 12 newer-page samples: 33 visible/focused final surfaces per fixture. All stayed within 31 timeline rows. Selected target, note content, pane identity/order and editor selection checks passed.

| Native p95 including Rust, IPC, ready DOM and two frames | 10k | 100k | Budget |
| --- | ---: | ---: | ---: |
| Citation entry | 139 ms | 139 ms | 250 ms |
| Older context | 33 ms | 41 ms | 250 ms |
| Newer context | 35 ms | 45 ms | 250 ms |

Native citations are constructed after evidence delivery from verified retained IDs and excerpts present in both historical and current content. This measures the real navigation binding, not a complete model-generated conversation. The independent browser journey covers delivered citation → old target → newer/older pages → unchanged chat workspace, including removed-prose isolation. Exact request counts come from session and browser checks; native paint does not intercept Tauri IPC.

Validation passed: 97 focused frontend/contract/chat-adapter tests; zero Svelte errors/warnings; 196 Note Timeline tests (eight ignored fixture/probe tests); nine history-command tests; 16 architecture checks; the delivered-citation browser journey; optimized admitted native build; both backend and native scale probes. This includes missing/cleared anchors, scope/generation mismatch, forgotten notes, interleaved lifecycle ordering, ambiguous/broken lineage, post-attestation corruption blocking publication, cross-note clear/restore retry, cancellation at every entry await and obsolete results after exit/new entry.

## Provenance and limits

Native execution used the isolated hash/profile/feature-admitted artifact, all three absolute contained roots, exact owned listener PID and selected-vault verification. Its SHA256 is `dbe001505c2f07c78bcc73702c31a183055393dec82278acfdbc86ef350fbc11`; an evidence copy and build manifest are retained under `/tmp/gneauxghts-citation-context-50-evidence`. All owned app, Vite and caffeinate children stopped. Final checks found no listeners on 1421/1430/4445. No user vault was opened, reset or altered by these tests.

The initial browser attempt could not bind its sandboxed test port; the authorized rerun passed. Actual display checks initially found a locked desktop, so no native app launched then. Later unlocked checks admitted both runs. One native attempt rendered a citation but failed a harness-only request-count assertion because Tauri's `invoke` property is read-only. The ineffective hook was removed; that failed attempt and its cleanup are retained separately. Product code did not change between that attempt and accepted native runs.

This is one Apple M4 Pro / 24 GiB / macOS 26.6.2 machine with warm OS caches and normal background processes. Native tests use the hot note in each vault; backend tests add representative short notes. Rendering/reconstruction still depends on authored content size, while timeline context work is independent of citation age. No slower-hardware, combined 1 MiB/10k, OS-cold storage, cumulative device-I/O or power-loss claim is made. [Reproduction commands](../../e2e/README.md) use the preserved current-format masters. No commit was created.
