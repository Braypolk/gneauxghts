# Replace pending approval coordination with Pi documents and tasks

Status: resolved
Type: prototype
Blocked by: 02

Follow [the spec](../spec.md). Add a Durable extension review task/document holding proposal identity, version, body/title/location/hunk checkpoint and decision. Reuse the actual document runtime and review UI; replace corresponding custom durable checkpoint/wait/continuation in the Pi path rather than mirror it. Keep native NoteTimeline publication and idempotent receipt reconciliation behind a narrow domain operation.

Implement create/update, direct Save without model execution, edit/checkpoint/switch/reopen, Keep/Discard, duplicate decisions, stale/refined version rejection and dirty-editor adoption. Bind Keep to the exact accepted payload/target; retain conflicts and explicit reapproval after a changed target. Mark safe-tool replay only when native outcomes can be reconciled.

Acceptance: both native platforms restore an edited pending review and correctly Keep/Discard; model failure after staging retains proposal; queued reviews and hunk edits survive acknowledged checkpoints; late output cannot settle another proposal; no duplicate publication after recovery. Record remaining custom policy and ownership, then continue issue 04.

## Comments

## Answer

The measured review slice passes on actual desktop and iOS WKWebView: model
create/update, direct Save, body/title/hunk checkpoints, queued review switching,
termination/relaunch and UI Keep/Discard. Pi document families/background tasks
own durable pending state; the real editor owns live state. Native NoteTimeline
publication remains behind an exact-payload effect ledger. Neither native generic
proposal nor session/run tables receive mirrored records. Implementation: `833c933`.

This resolves the prototype ownership question, not full production parity.
Dirty-editor/failing-checkpoint native UI injection, refinement, historical
revision navigation, full Save/context/projection behavior and other gaps are
explicit in [results](../results.md) and [validation](../validation.md). Those gaps
preclude adoption from this experiment. Continue to the recorded deletion verdict.
