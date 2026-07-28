# Pane capability and transient UI audit

Audit snapshot: 2026-07-28.

This note counts behavioral decisions, not every repeated boolean token. A
render branch that exhaustively handles a discriminated union is not itself a
capability check.

## Canonical modules

- `paneCapabilities.ts` is the sole policy table for behavior that varies by
  live pane kind. It defines four capabilities for both current pane kinds and
  owns the workspace rules for kind changes and pane removal.
- `paneTransientUiState.ts` is the state machine for pane-owned editor
  transients. Its state is exactly one of `none`, `slash-menu`,
  `selection-menu`, or `wikilink-autocomplete`.
- `PaneTransientUiController` owns one writable discriminated state, and
  presentation reads that canonical union directly.

## Duplicate counts

Capability policy:

- 40 decisions now route through the canonical policy: three workspace-store
  rules (remove, change kind, retain an editor), one pane-role navigation rule,
  one document-binding gate, three title/view-model derivations, pane
  close-action visibility, and 31 orchestration decisions (30 direct kind
  predicates plus the legacy kind-transition wrapper).
- 0 direct `getPaneKind(...) ===/!== "editor"/"chat"` comparisons remain in
  orchestration. A fitness test scans the orchestration directory to preserve
  this boundary.
- 0 direct live-pane comparisons remain in `Notepad.svelte`; presentation
  behavior now also routes through the capability policy.
- 8 nearby orchestration comparisons against `NavLocation.kind` or the
  captured `WorkspacePaneState.kind` remain intentionally. They are exhaustive
  persisted-data conversion/dispatch discriminants, not capability decisions.
- The two legacy transition-policy exports in `paneRoles.ts` were removed.
  `canSetPaneKind()` and `canRemovePane()` are now the only workspace
  transition policy APIs.

Transient UI:

- Before this slice, one controller exposed 3 independently writable nullable
  owners: slash menu, selection menu, and wikilink autocomplete.
- After this slice, it exposes 1 writable union state and no parallel owner
  fields or controller aliases. Conflicting active-owner combinations cannot be
  constructed through the controller.
- `Notepad.svelte` reads 1 canonical derived union and renders its mutually
  exclusive variants with one discriminated branch.

## Remaining wiring checklist

1. If the pane-command picker must be mutually exclusive with editor
   transients, add a `pane-command` variant and route
   `WorkspaceStore.beginPaneCommand/resetPaneCommand` through the same
   coordinator. That product-level exclusivity is not currently explicit, so
   this slice does not assume it.

## Test coverage

- The pane capability table is exhaustively checked for every capability and
  current pane kind.
- Pane kind transition and removal matrices cover sole editor, multiple
  editors, chat/editor mixes, same-kind transitions, and unknown pane IDs.
- Workspace close tests prove preparation completes before removal and that a
  preparation/save failure leaves the pane present and undisposed.
- The open-note barrier test proves a failed previous-document save prevents
  target loading and workspace mutation.
- Every transient kind is opened from every possible prior state, closed
  globally and by matching owner, and checked against every non-matching kind.
