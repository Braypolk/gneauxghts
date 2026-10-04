# 04 — Make ChatController own admitted state and first send

Status: ready-for-agent
Progress: implemented; focused tests passed; frozen for coordinator integration verification. See ../ui-implementation.md and ../ui-metrics.json.
Owner: audit_ui_semantic
Design: ../ui-design.md (UI-A)

Replace flags-only machine plus independently mutated conversation projection with one aggregate transition. Preserve the Readable/getSnapshot caller seam, transport adapter, ListenerScope, specialized agent-event reduction, permission/retry/privacy contracts. Native stream events and operation completions enter one state transition; selection identity retires pending open/create/branch/configuration on draft or conversation replacement. Notification happens once after acceptance. Remove parallel rune fields, field-by-field patch protocol, synthetic started-plus-message writes and idle-terminal bypass.

Controller send owns draft creation and request admission; remove its public createConversation method and the composer's create-then-send effect-timing workaround. Expose explicit promotion identity and a send outcome so only the originating draft clears after successful send. Preserve durable creation if send later fails, active-note save barrier, unsent text/attachment recovery, and cancel orphaned permissions on disposal.

Validation: retain existing controller/native-adapter/lifetime/receipt tests; migrate creation contracts to first send; reproduce late selection/new draft, branch/new selection, duplicate terminal, local capability/new draft and send failure/navigation cases through the controller boundary. Focused tests and typecheck before coordinator browser acceptance. No Notepad.svelte writes; coordinate its owner if integration is needed.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
