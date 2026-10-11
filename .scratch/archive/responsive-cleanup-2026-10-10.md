# Responsive code cleanup review — October 10, 2026

## Scope and baseline

Reviewed the responsive frontend changes against
`1060abba3358ed704ab6e20e82732316b9de5b82` with `git diff HEAD -- <scoped paths>`,
including untracked rail chrome and permanent responsive regression files.
Covered retained panes, pane/dock motion, focus and transient cleanup, header and
Related geometry, constrained overlays, main-tab responsiveness and task-group
ordering. Unrelated backend/chat changes and the separate scratch-retention pass
were excluded.

Requirements came from the approved responsive/rail interactions in this chat,
the responsive completed-work record and current behavior invariants. Standards
sources were `AGENTS.md`, `ARCHITECTURE.md`, applicable behavior invariants,
`CONTEXT.md` and the repository code-review skill's smell baseline. Independent
Standards and Spec reviews were followed by local integration inspection and
focused review of the corrections.

## Findings and resolution

**Spec/correctness, P2 — stale task reads could replace committed ranks.** A
background `list_tasks` read started before or during a reorder could return
pre-write ranks. The previous reconciliation checked view changes only after
the optimistic group array had been replaced; it missed a still-pending read and
reads already in flight when the reorder began. Persistence succeeded, but the
display could remain in its old order. This also affected the older drag path.

`TaskListStore.reorderNote` now advances the existing projection revision on
commit, invalidating older reads. If a concurrent read or group patch already
published, it refreshes the current view. The canonical order write runs once;
lifetime checks and rank-only failure rollback remain intact. Three deferred
regressions reproduced the failure before the fix and pass afterward, covering
reads begun before/during the write and both completion orders. The existing
new-filter-before-commit and failed-write projection tests remain in place.

**Standards/maintenance judgment — repeated clock sampling.** The pane
coordinator previously solved the identical dock easing curve for every animated
surface. It now computes the 81 samples once per operation and reuses them for
each surface's keyframes. Offsets, timing, interpolation and cancellation are
unchanged; no new clock, state owner or public abstraction was introduced.

No further confirmed hard standards violations or Spec defects were found in
the scoped review. Opening, switching and closing share one presentation
coordinator. Membership and document state retain their established owners;
effects, label snapshots, observers and listeners have teardown paths. Further
module extraction was not supported by a concrete maintenance problem.

## Validation

- All 56 targeted unit tests passed across task ordering, workspace navigation
  and the dock machine.
- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passed.
- `pnpm build`: passed, with the existing chunk-size advisory.
- All 73 scoped browser cases passed across the combined run and one focused
  rerun: 14 responsive layout, 19 rail, two task-menu, 20 shared dock, ten
  ordinary-pane and eight animation-cleanup cases. The combined run had 72
  passes and one rail setup failure: `chat_list_note_policies` reached an
  unmocked Tauri handler despite being supported by the browser fixture. The
  unchanged test passed on its focused rerun. This is consistent with the
  previously observed fixture IPC interception issue; its exact intermittent
  cause was not established by this review. No functional assertion was weakened.
- `git diff --check`: passed.

The review does not establish native WebKit behavior, real software-keyboard
layout or physical-device safe areas. Browser checks use the isolated desktop
Chromium fixture. Broader backend/chat validation remains outside this scope.

## Commit isolation — October 11, 2026

The responsive commit was checked from a temporary export of the Git index,
excluding unrelated working-tree changes. Mixed chat-header and architecture
files contributed only their responsive hunks; backend/chat-context changes and
the broader scratch-retention pass were excluded. Responsive completion records
and capture tools are self-contained in this commit.

That staged snapshot passed `pnpm check`, the production build and all 65 targeted
unit tests (task ordering, workspace navigation, dock machine, fixture IPC and
feature-host capabilities). All 43 selected browser cases passed together:
14 responsive-layout, 19 rail, two task-menu and eight cleanup cases. No focused
rerun was needed for this snapshot. The environment limits above still apply.
