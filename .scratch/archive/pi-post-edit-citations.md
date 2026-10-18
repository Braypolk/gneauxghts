# Fresh citations after Pi note edits — 2026-10-17

The prior navigation fix correctly separated successful historical-source
feedback from chat errors, but final edit confirmations still had only the
pre-edit read to cite. The user identified the missing post-edit read.

After the publication child confirms a commit, `edit_note` now performs the
same authorized native canonical read as `read_note`. It returns that read's
Markdown, source metadata and citation alongside the committed receipt. Tool
instructions direct final confirmations to that fresh read. Subsequent edits
may use its source identity as their exact base. No source is manufactured from
the staged candidate or publication receipt, and old sources remain historical.

Read failure is separate from write outcome: a proven commit remains successful
and returns an explicit `readError` without fresh content/source evidence. The
agent must read again before describing current content. Native permission and
canonical eligibility checks still apply. No publication phase, persistence
schema, second scheduler or native write path was added.

## Verification

- **236 chat tests passed**, including post-commit content/source delivery,
  unavailable post-edit read preserving a successful receipt, and existing
  Harness recovery/lost-acknowledgement tests supplying fresh citations without
  a second publication.
- **Eight native macOS editing journeys passed**. The normal final citation's
  exact source ID matches the post-edit read, contains the saved replacement,
  and opens with no changed-content notice. An intentionally historical final
  citation retains the neutral feedback behavior. Single-pane note/return,
  direct mode, changed-base protection, grant scope and actual process restart
  also pass.
- **Nine frontend architecture checks** and **32 support tests** passed.
- Svelte and E2E TypeScript checks pass; no whitespace errors.

The native provider is a deterministic protocol fixture; live-model citation
choice and physical-device behavior are not claimed. Native admission continues
to validate issued source identity and permission, not semantic entailment.
