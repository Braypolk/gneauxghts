# Separate chat-default and Atlas-visibility writes

Status: ready-for-agent
Progress: Implemented and independently reviewed. API29 tests pass; real SQLite interleaving proof passes in the full746-test Rust suite. Production and frontend/e2e typechecks pass. Native acceptance pending.
Owner: coordinator

## Finding and decision

Atlas loads the complete ChatSettings then writes it back with visibility changed. ChatSettingsPanel independently retains and saves a complete snapshot. ChatService.set_settings unconditionally replaces all ten fields. Thus an old Defaults form overwrites a newer visibility, and Atlas can overwrite newer defaults with its read snapshot. This is a direct read-modify-write lost-update protocol, independently of SQLite serialization.

Replace the full-record write with two named domain operations: set_defaults(ChatDefaults) updates only the nine default fields; set_atlas_visibility updates only visibility. Read shape stays ChatSettings. The native command and typed frontend API express the split, and both production writers migrate together. No generic optional-field patch language, new settings store, schema change, or frontend mutex. The backend owns atomic column updates.

A separate nine-field request DTO deliberately distinguishes defaults from the read projection; this small boundary type is justified by the independent durable write authority. Preserve existing model/provider/reasoning/base-URL validation. Validate visibility against existing accepted modes. Update transport fixture to assert defaults never sends visibility; prove actual service interleaving with stale defaults and visibility writes preserves both dimensions. Retain existing default persistence checks.

Root owns chat.rs/settings methods+DTO/tests, commands/chat_commands.rs settings-only region, lib.rs command registration, chat/api.ts/api.test.ts/chatTestSupport.ts, Settings/ChatSettingsPanel.svelte and browser backend contract if needed. UI owner migrates Atlas default saver to setAtlasVisibility. Other owners must not edit these regions concurrently.

## Implementation notes

Removed the full-record write command/API. ChatDefaults intentionally excludes Atlas visibility. `chat_set_defaults` updates only nine defaults columns; `chat_set_atlas_visibility` validates and updates only the visibility column. No schema change. Both commands return/use existing settings authority; no frontend get-modify-write for visibility remains after UI integration. The existing transport test now asserts both narrow payloads, and the existing Rust flex persistence test now interleaves a stale defaults form with visibility changes and verifies both survive. Test case count did not grow.

The lost-update finding is from the actual call/SQL trace; no pre-change executable reproduction is claimed. API validation:08-api.log,29 passing. Rust service proof will run after shared backend compilation.

## Final integration

Both remaining opt-in native fixture callers migrated to `chat_set_defaults`/`defaults`, excluding visibility. Independent reviewer verified no old `chat_set_settings` reference remains in source, e2e or native command callers. Full backend acceptance passed; final frontend1137 tests and Svelte/e2e typecheck pass. Live-provider and optional measurement lanes were not executed.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
