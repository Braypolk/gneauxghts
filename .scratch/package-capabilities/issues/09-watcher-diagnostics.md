# Watcher health in Vault Settings

Status: resolved
Type: task
Resolution: status-and-guidance slice implemented, 2026-10-27

The user selected status and guidance only, in Settings → Vault, with callback
warnings retained until restart. Native health, bootstrap/event admission,
Settings presentation and focused regressions are implemented.

See the [completed outcome and validation limits](../../archive/watcher-health-2026-10-27.md).
Current ownership and behavioral constraints live in
[ARCHITECTURE.md](../../../ARCHITECTURE.md) and the
[watcher invariant](../../../docs/architecture/behavior-invariants.md#file-watching-health-describes-the-running-vault).

Manual retry and periodic scanning after failed registration remain separate,
unselected recovery work. This resolved record is not an implementation queue.
