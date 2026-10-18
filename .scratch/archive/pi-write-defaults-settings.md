# Pi write defaults in Settings — 2026-10-17

Completed the requested write permission controls under Settings → AI & Chat →
Note editing defaults. Users choose Off (allow per chat) or Always allow edits,
independently enable Review before applying edits, and save the editing defaults.
Both controls are searchable. Loading/saving errors are visible and failed saves
retain the user's inputs without claiming confirmed persistence.

These are the existing vault grant and review policy, exposed through native
AuthorityStore getters/setters without requiring or creating a conversation.
Settings and the chat Vault access menu use the same row and mutation helper.
Changes invalidate authority revisions under the existing effect gate and notify
mounted chats. No schema, Pi task, review continuation or publication flow changed.
Saving unchanged values does not invalidate pending work. Existing Always scope
is retained when only the review preference is edited.

Always and review affect existing and new chats. Temporary permission remains a
per-conversation explicit grant; switching the vault default Off preserves those
individual permissions. The UI explains this scope. Read permissions and exclusions
remain independent constraints. The behavior invariants document the shared owner.

## Verification

- 48 native Pi domain tests passed, including defaults before any conversation,
  persistence across reopen, inherited Always/review values, preservation of
  Temporary grants, invalid scope/Temporary-default rejection, and invalidation of
  previously prepared direct publication when Settings enables review.
- 19 native architecture fitness tests passed.
- 257 tests across 26 affected frontend files passed; Svelte diagnostics reported
  0 errors and 0 warnings; E2E TypeScript checks passed.
- Two browser journeys passed: Settings discovery and configuration without a
  chat, chat/menu synchronization, Temporary isolation, and failed save recovery.
- Nine actual macOS native editing journeys passed. The new journey saves Always
  and review-off through mounted Settings, restarts the fixture process, commits
  a model-driven edit without review, verifies a chat-menu change in Settings,
  then revokes Always while another edit awaits review and proves no publication.
  Existing edit, recovery, diff-layout, authority and source-navigation cases pass.
- Visually inspected the native Settings panel with both editing and review controls.

Native acceptance uses generated disposable notes and a fixture provider. The
embedded background driver's select-option click omitted its change event, so the
native test drives the mounted select's normal DOM change handler; the browser
journey uses WebDriver selection. An initial browser run was interrupted by Vite's
first dependency-optimization reload; the completed rerun passed. Existing embedded
driver restart-cleanup warnings remain. Physical-device testing is not claimed.
