# Remaining old-chat compatibility cleanup — 2026-10-17

The user deleted older chats and authorized another audit and removal pass.
This follows the [link-only citation cutover](pi-link-only-citations.md).

## Removed

- Native authority column upgrades and the old conversation-grant wrapper rewrite.
  Fresh initialization declares the current authority/vault grant schema directly.
- Publication task v2 migration and its transient restored-review checkpoint.
  Current task version 3 uses the atomically seeded `EditReviewDoc` directly.
- Decode-only retired-create mutations and optional raw-base hash. Native stored
  payloads use the strict update-only request type and require the exact base hash.
- Forgotten Notes' retired chat variant, conversation fields, schema upgrades,
  command rejection branches, note/chat badge and obsolete recovery test. Note
  rows, identity matching, lifecycle ownership and captured retention remain.
  Existing SQLite tables may retain unused extra columns; the app no longer
  reads or writes them, and this cleanup performs no destructive database rewrite.
- Prototype localStorage last-chat pointer import/cleanup. Navigation loads only
  the current app-state SQLite pointer and can open a fresh chat when absent.

Settings copy now describes forgotten notes. Current Pi chat forgetting remains
reversible presentation metadata in Pi, independent of the native note lifecycle.

## Deliberately retained

Current lost-acknowledgement/proof reconciliation, exact approval, editor leases,
permission retirement/restriction and pending review reopening are required by
current effects. They do not exist to support deleted chats. Current task/doc
versions, provider protocol adaptation, settings defaults and optional completion
timing also remain necessary. App-state schema initialization still adds the
current navigation columns to an existing notes/settings database; it neither
imports old chats nor reads their messages. Note identity/history upgrades and
preservation of authored Markdown are outside this chat-only removal.

## Verification

- **351 distinct frontend tests passed** across chat, architecture fitness,
  Settings, composed note forget/recover and navigation (33 files). The current
  review reopen/lost-ack and argument validation coverage remains; migration-only
  v2 review cases were removed.
- **635 Rust library tests passed, 19 ignored**. Covers note lifecycle retention,
  collisions, stale rollback, restart, publication proof recovery and native
  read-backed citation admission. The retired-create and forgotten-chat-only
  compatibility cases were removed.
- **19 native architecture fitness tests passed**.
- **9 real macOS native editing journeys passed**, including Settings defaults,
  canonical changed-base protection, exact approve/discard/stop, fresh post-edit
  citations, historical source navigation and the same pending review after a
  real process restart. All fixtures use a disposable vault.
- **6 real macOS native publication journeys passed**: exact review and receipt
  replay, explicit direct authority, changed base, revocation, Temporary grants
  across a real process restart, dirty editor protection and lost-ack/canonical
  adoption through a Settings remount.
- `pnpm check`: **0 Svelte errors/warnings**; E2E TypeScript checks passed.
- `git diff --check` passed. The embedded macOS driver emitted its known missing
  external tauri-driver diagnostic and restart session cleanup warnings while
  successfully completing both suites. No new physical iOS or live-provider
  acceptance is claimed.

The first broad native run caught a parameter-index change needed after removing
forgotten-chat columns; the full library suite passed after the correction.
An initial UI attempt stopped on a missing screenshot output directory; that
harness setup was fixed before the successful fresh-vault editing rerun.
No live vault data, authored notes, credentials or note history were reset.
