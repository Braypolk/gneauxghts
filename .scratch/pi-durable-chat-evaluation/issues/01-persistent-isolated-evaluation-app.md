# Deliver a persistent isolated app for hands-on Pi chat

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: none

Follow [the spec](../spec.md). The runner opens diagnostics, defaults to a fresh
temporary root and forces a synthetic vault. It is not the persistent evaluation
app the user requested.

## Work

- Provide one documented desktop entry that opens the actual workspace/chat
  directly. Keep diagnostics separately accessible and label the evaluation app.
- Preserve separate bundle, native credentials, data and databases. Reuse a stable
  disposable root across launches; resetting it is explicit.
- Add a copy/setup operation for a representative user vault. Copy notes/assets
  and consistent Note Timeline data needed for history tests. Resolve locations
  through the Running Vault; do not follow links into the original or copy live
  database/WAL files inconsistently.
- Start fresh Pi conversations. Copied legacy chat artifacts cannot trigger old
  import or grant transcript content evidence authority.
- Record old/Pi owner and resource baselines using equivalent disposable fixtures;
  retain environment and comparison commands for issue 13.

## Acceptance

- Two launches reuse evaluation notes, Pi data and settings without touching the
  normal app. A copy edit/Keep never changes the original vault.
- Failed setup does not adopt an incomplete Running Vault; retry/reset are
  documented and confined to evaluation-owned paths.
- Retained history uses a consistent copied store with preserved Note Identity/
  Revision meaning; generated history fixtures remain available for automation.
- Instructions distinguish private copied data from committable fixtures and
  identify the evaluation root without logging note contents.
- Record a reproducible comparison baseline. Existing fixture passes do not count
  as live-model acceptance; no ordinary app UI redesign is required.

## Starting points

`scripts/pi-prototype/run.mjs`, `scripts/pi-prototype/tauri.prototype.conf.json`,
`src/routes/pi-prototype/+page.svelte`, `src-tauri/src/lib.rs`, Running Vault
composition and the previous prototype README.

## Comments
