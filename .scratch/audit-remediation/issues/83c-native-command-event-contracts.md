# Real native command/event consumer acceptance

Status: ready-for-agent
Progress: complete; real native acceptance 2/2 passed, E2E typecheck passed and Svelte diagnostics 0/0.
Owner: audit_ui_semantic
Findings: BB-05

## Verified boundary and plan before source edits

The fixture codec tests do not invoke the registered Tauri handlers or EventBus.emit. `save_note`/`save_task_note` dispatch through on_app_worker and post-publication emits `note-saved`; task save selects MutationSource::TaskAction. `toggle_task` emits `vault-note-changed` with source `taskMutation`. `set_vault_directory` stages the preference and emits actual VaultInfo with unchanged runningPath. AppStore receives/adopts these Tauri events and fans them to feature consumers.

Add a narrow read-only/reset E2E probe on the existing Notepad automation bridge, subscribing to production AppStore fanout and reading its admitted snapshot. It neither emits fake events nor installs another native listener policy. It is gated by the existing explicit E2E build flag and disposed with the bridge. Add a deterministic native spec invoking real commands, asserting canonical saved ID/path/revision, taskAction durable history content, taskMutation source/documentKind/path payload, and staged vault event/admitted snapshot without moving running writes. Restore staged selection in finally. Add the spec to the deterministic native lane; no provider or native run by this owner. Root owns serial execution.

Verification: E2E TypeScript, Svelte check; native runtime execution required and explicitly assigned root. No unconditional runtime feature or rollback-on-notification behavior.

## Native acceptance

Root serial execution passed **2/2** cases. Evidence: `../validation/native-command-events-final.log`. Initial restoration path spelling mismatch was corrected using returned canonical receipt plus filesystem identity; both full restoration event and admitted snapshot are now asserted. No runtime event policy changed.
