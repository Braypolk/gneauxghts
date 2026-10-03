# Protect image imports and interactions across document lifetimes

Status: resolved
Type: task
Depends on: 01, 02, 03, 04, 05

## Scope

Harden paste and combine image interaction with document/pane lifecycle as described in [the specification](../spec.md). Retain selected text until image storage succeeds; bind jobs to DocumentHandle/runtime lifetime and mapped replacement range. Preserve partial successes for retry rather than storing duplicate assets. Show actionable error/cancel/retry UI.

Audit every mutation and active resource against read-only/proposal review, clean external replacement, Version Restore, navigation, pane close, restart, and History Mode. Align percent-decoded local asset references with Rust history missing-asset detection without changing note-history format.

## Main files

- `images/imagePaste.ts`, injected resource/job helpers.
- Existing document/pane lifecycle and editor capability seams as needed.
- `src-tauri/src/services/note_timeline/history_mode.rs` and its reference-extraction tests when decoding needs adjustment.
- `src-tauri/src/commands/asset_commands.rs` only for necessary contained-path/import reliability changes.

## Acceptance

- Failed imports preserve selected authored text; successful replacement/insertion is one shared undo action.
- Delayed results cannot insert into another note or a replacement runtime.
- Partial retry reuses successful stored assets and resolves failed files explicitly.
- Undo/delete/cut never garbage-collect assets referenced by current or retained note content.
- All resources/gestures/viewers release on departure or takeover; canonical content saving still crosses the established Note Timeline seam.
- Backend and frontend agree on encoded asset references and missing-image warnings.

## Comments

Historical image-byte versioning and automatic orphan cleanup remain separate features.

## Answer

Imports retain selected text until all files save, reuse partial successes on retry, and discard completion after job/range/view lifetime changes. Read-only takeover clears jobs and cancels presentation. Delete/cut/undo retain asset files; persistence uses existing shared runtime/save/Timeline paths. Historical asset decoding now handles percent encoding, escaped punctuation and used reference definitions. Delayed-navigation, partial-retry, contained assets and native persisted-reopen checks pass.

Evidence: [implementation validation](../validation.md).
