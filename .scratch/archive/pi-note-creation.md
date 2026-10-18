# Pi note creation — 2026-10-17

Completed the user-requested concrete `create_note` slice. The first slice creates
one Markdown note in an existing visible Running Vault folder; the root is the
default. It does not expose arbitrary file types, folder creation, overwrites,
renames or deletion.

## Behavior and ownership

- Creation requires an explicit `create` operation grant. Existing update grants
  do not acquire it. Chat and Settings expose “Allow creating new notes” as a
  separate unchecked control. Duration changes preserve explicitly granted
  operations and scope. Review remains independent and on by default.
- Both tools share the Pi candidate adapter, task-scoped child reference,
  publication task, review document and native prepare/approve/publish/reconcile
  protocol. There is no creation scheduler or separate effect ledger.
- Native preparation fixes one destination, fresh identity, managed metadata and
  canonical bytes. The review shows the exact relative destination and full
  authored Markdown, with escaped untrusted content and bounded scrolling.
- NoteTimeline retains canonical publication/history ownership. The existing
  atomic create-only primitive prevents replacement even when another file
  arrives after durable proof recording. Occupied destinations block; no suffix
  or alternate destination is silently selected.
- A stable Pi tool request reopens the original native preparation after restart.
  Native proof reconciles lost acknowledgements before another effect, preserving
  one note, identity and receipt. A pre-effect interruption can resume using the
  same identity and bytes.
- Committed tool results attempt an independent authorized canonical read and
  return its citation. Creation does not widen read access; a failed read preserves
  success without inventing citation evidence or creating again.
- Discard and Stop before publication leave no file. A committed creation retains
  visible “Note created before the response stopped” feedback and repair warnings
  through Pi settlement and reopening.
- Publication task results retain the receipt and note identities needed for the
  post-publication read, plus optional warning presentation; canonical content and
  proof remain native-owned. The review/publish/abort phases and authority
  revision/scope validation are preserved.

The earlier deletion of the unused creation foundation remains historical.
This feature adds a concrete consumer with a create-only destination contract;
it does not restore the old orchestration or a retired payload decoder.
Architecture, behavior invariants and ADR 0012 describe the current ownership.

## Verification

- Red: native creation tests rejected the unsupported create operation; the new
  review test initially rendered an edit card. Implementation then passed both.
- 318 chat/frontend and Settings catalog tests in 25 files.
- 53 native Pi module tests, including six creation tests for operation permission,
  exact approval, folder scope, revocation, identity sanitization, symlinks, late
  collisions, pre-effect interruption and lost acknowledgement/reopen.
- 65 Rust publication tests pass (one opt-in test ignored), including shared
  NoteTimeline mutation/recovery checks.
- All 19 native architecture fitness checks pass. The old assertion prohibiting
  creation was replaced with a requirement to delegate it to NoteTimeline; direct
  filesystem publication remains prohibited in the chat owner.
- Five real macOS creation journeys pass: independent grant, review/fresh citation,
  discard/Stop, destination collision, and two process restarts around one creation.
- Ten existing macOS editing and six publication journeys pass, including restart,
  dirty-editor preservation, revocation and document-owner remount settlement.
  Receipt-field assertions were updated for the new opaque note reference.
- Two headless browser Settings journeys pass, covering default-unchecked creation,
  explicit enablement, settings/chat synchronization, retained Temporary permission
  and fresh-chat isolation.
- Desktop E2E build and `pnpm check` pass; no Svelte/type diagnostics. Native review
  screenshot inspected at `/private/tmp/pi-create-acceptance/pi-create-review.png`.

Reproduction: `node e2e/support/buildNative.mjs`, then run
`piChatCreation.spec.ts`, `piChatEditing.spec.ts` and
`piChatPublication.spec.ts` through `runNativeSpecs` with
`GNEAUX_PI_PROCESS_RESTART=1`. The creation suite is in the default native smoke
lane. All native journeys use generated disposable vaults and background windows.
Evidence is under `/private/tmp/pi-create-acceptance/`; focused unit/check logs are
`/private/tmp/pi-create-*.log`.

These are deterministic provider integration checks, not live-model performance or
tool-selection claims. New iOS/device acceptance was not performed.
