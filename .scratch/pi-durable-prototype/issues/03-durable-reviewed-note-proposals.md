# Replace pending approval coordination with Pi documents and tasks

Status: historical; superseded
Type: prototype
Blocked by: 02

Preserved original experiment ticket, not executable work. See the
[completed prototype](../../archive/pi-durable-native-prototype.md) and the
[accepted ordinary-chat rebuild](../../archive/pi-chat-rebuild.md) for outcomes
and validation limits. The original instructions follow.

Follow [the spec](../spec.md). Add a Durable extension review task/document holding proposal identity, version, body/title/location/hunk checkpoint and decision. Reuse the actual document runtime and review UI; replace corresponding custom durable checkpoint/wait/continuation in the Pi path rather than mirror it. Keep native NoteTimeline publication and idempotent receipt reconciliation behind a narrow domain operation.

Implement create/update, direct Save without model execution, edit/checkpoint/switch/reopen, Keep/Discard, duplicate decisions, stale/refined version rejection and dirty-editor adoption. Bind Keep to the exact accepted payload/target; retain conflicts and explicit reapproval after a changed target. Mark safe-tool replay only when native outcomes can be reconciled.

Acceptance: both native platforms restore an edited pending review and correctly Keep/Discard; model failure after staging retains proposal; queued reviews and hunk edits survive acknowledged checkpoints; late output cannot settle another proposal; no duplicate publication after recovery. Record remaining custom policy and ownership, then continue issue 04.

## Comments
