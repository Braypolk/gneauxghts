# Test suite and implementation audit

Status: needs-triage

## Request and baseline

Audit the complete first-party test inventory and the implementations it targets;
group related findings by module, including duplication, inefficient coverage,
missing behavior, and substantial simplification opportunities. Persist findings
and review them before changing production or test code. Implementation is
authorized after that audit gate; recommendations need not all be implemented in
one pass.

Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, initially clean worktree.
User-facing date: 2026-10-02 (America/Denver).

## Scope and method

- Frontend unit, reducer, controller, component and contract tests under `src`.
- Rust inline/module tests and architecture integration tests, excluding vendored
  third-party implementations.
- Browser/native E2E, opt-in live/scale probes, test utilities, and runner scripts.
- Read target production call paths and ownership documentation, not just test names.
- Static inventory is exhaustive by file; deep inspection and sampling are recorded
  in each report. Static counts are estimates, not runtime-expanded test counts.
- Separate confirmed defects, design judgments and unmeasured performance hypotheses.
- Require replacement coverage before deleting a test that protects a distinct
  invariant. Keep canonical writes, recovery and freshness boundaries intact.

## Audit work allocation

| Report | Scope |
| --- | --- |
| `reports/frontend-coordination.md` | Documents, workspace, pane/session orchestration, proposals, History Mode |
| `reports/editor-and-discovery.md` | Editor/Markdown/images/search/related/wikilinks/tasks |
| `reports/backend-agent-and-evidence.md` | Chat, runtime, agent tools, evidence/retrieval, proposals |
| `reports/backend-persistence-and-timeline.md` | Canonical writes, Note Timeline, state, catalog, watcher, task persistence |
| `reports/ui-settings-and-indexing.md` | Shared UI/app/chat/settings/atlas and backend search/semantic/indexing |
| `reports/harness-and-suite.md` | Runner discovery, architecture fitness, E2E fixtures, cross-module gaps and measurements |

## Completion gate

All six reports must exist before production/test edits. Root review must reconcile
overlap, challenge candidate findings, choose bounded implementation work and record
the decision in `review.md`. Final `README.md` indexes priorities, handoff issues,
measurements, implemented changes and validation limitations.
