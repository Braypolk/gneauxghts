# Pi filename editing — 2026-10-22

Implementation and integrated macOS/native and browser acceptance are complete.
This archived outcome records the accepted behavior, evidence and remaining
platform/manual validation limits.

## Result

Pi exposes `rename_note({ noteId, expectedReadSourceId, title })` for an explicitly
requested same-folder filename change. It keeps the canonical Markdown bytes,
managed Note Identity and history chain. Update/Create permissions do not include
Rename. Rename defaults off and always requires exact old/new filename approval,
even when ordinary edit review is disabled. A filename or path link may stop
resolving; ID-based references keep their identity. Other notes are not rewritten.

Vault access and Settings expose the existing folder policy through a shared
Save/Cancel editor. Rename requires its current folder to be explicitly listed;
the root `.` grants only root renames. Update/Create keep their existing subtree
policy. Saving folders preserves operation grants and selected source identities;
chat saves check the originating authority revision. Both forms surface native
validation errors. The dialog uses the shared floating-panel positioning and body
mount to stay inside the
viewport, including at 390 CSS pixels; full rectangle bounds supplement button
clickability checks. The browser fixture serializes only its write-defaults
payload like native JSON IPC, so reactive Settings arrays follow the same wire
semantics.

The implementation extends the existing Pi Publication Task, Note Timeline,
Document Editing Service and canonical file owner. It adds no general filesystem
tool, second publication queue or chat-to-note action. Edit/Create/Rename share
their tool publication adapter while retaining typed native admission.

## Publication and recovery

The native owner retains both paths and exact source proof before an atomic
no-replace move. Occupied destinations are never overwritten or given an
unreviewed suffix. Darwin and Linux primitives fail closed when unsupported;
there is no copy/delete fallback or destructive rollback. Rename records the
existing Lifecycle Event, without an unchanged-content revision. A watcher-missed
external content change is observed separately before movement.

Recovery observes the original effect and settles projections; it never repeats
the move. A durable exact-effect witness lets history finish an already observed
rename after a subsequent external edit. Before that witness, ambiguous source
or destination states retain their proof. Foreign files at either location remain
untouched.

Both locations participate in editor admission. Open views preserve their Document
Handle, shared editor root, selection and Undo. Reconciliation freezes matching
views before asynchronous proof queries. New effects require clean, settled
buffers; recovery can preserve newer human text while adopting a committed path
with an explicit conflict. An editor refresh error retains the committed result
and exposes **Retry editor refresh** outside the paused workspace. Retry reconciles
and adopts through the same owner without publishing again.

Ordinary editor/task saves now carry their captured Note Identity. The native
owner rechecks its retained location after preflight under the file lock, blocking
a delayed old-path save after rename. New notes can still use a free former name,
and explicit recreation after external deletion retains existing behavior.
Identity-based read/open validates both path/catalog hints and the final bytes;
a foreign replacement cannot rebind a retained document. Missing metadata retains
catalog continuity only at a location admitted by Note Timeline. Path-only reads
still intentionally follow their filename.

## Testing and limits

The [manual guide](manual-testing.md) explains the rename flow and the earlier
recoverable capture, opt-in automatic titles, retrieval cues/passages, formatting,
dock/image Retry and measured cleanup. The [contract](spec.md) records the accepted
scope. [ADR 0015](../../../docs/adr/0015-prove-agent-renames-across-both-locations.md)
and the architecture documents describe current ownership.

The history schema is now **15**. Under the existing no-migration policy, schema-14
development histories are rejected. Use a fresh disposable vault. An explicit
confirmed reset in **Settings → Note Timeline** discards retained revisions,
revision names and history citations while preserving canonical notes; this work
never resets a user's store automatically.

Native acceptance uses macOS, a local synthetic provider and temporary vault/app
data with the actual Pi/runtime/authority/filesystem owners. It establishes neither
live-provider prompt quality nor Linux/iOS runtime acceptance. Windows rename is
unsupported. Background native testing does not establish foreground focus,
animation smoothness or physical-device IME behavior.

The split-pane continuation dispatches a public CodeMirror input transaction
through the mounted shared editor owner and waits for ordinary autosave at the
real destination file. It establishes released admission, shared document
continuity and current-path persistence. Background WebKit does not establish OS
keyboard typing; manual foreground typing in both panes remains in the guide.

The editor-adoption warning belongs to the existing live document owner. Running
tasks reconcile after reload; already terminal tasks gain no new durable replay
queue. Startup uses identity-based session resolution and native stale-save
protection. This does not promise persistence of the transient warning itself.

Independent Standards and Spec reviews found and corrected lost committed-result
reporting, delayed reconciliation/stale saves, filename display ambiguity and
identity reads following reused filenames. No confirmed review findings remain.

Current integrated verification:

- Full frontend checkpoint: 143 support checks and 1,664 Vitest tests passed; one
  remains skipped. The final activity-label correction then passed all 53 focused
  activity/rename tests: only a proven receipt is labelled **Renamed note**. Final
  ChatPanel/fixture widget checks passed all 17 tests after the folder-layout fix.
- `pnpm check`: no Svelte errors/warnings; E2E TypeScript checks passed.
- Production build passed; the existing large-chunk warning remains.
- Native: 709 tests passed; 22 explicit fixture/diagnostic tests remain ignored.
- Architecture fitness: 19 checks passed. Python fixture tooling: 16 passed.
- Non-test native build with `e2e-wdio` passed; Rust formatting and whitespace
  checks passed.
- Native Pi rename acceptance: all eight journeys passed in 41.1 seconds, using
  the real native filesystem, authority, publication and editor owners. These
  cover update-only denial, exact review/Discard, occupied destination, exact
  nested-folder permission, commit/identity/history/earlier citation, a collision
  arriving after review, committed readback recovery, and both mounted panes with
  ordinary autosave at the new filename.
- After the final folder-panel placement fix, the native nested-folder journey
  passed again (1/1, 11.1 seconds), including viewport bounds and actual folder
  permission/publication. Its full-window screenshot was visually inspected.
- Final fresh maintained browser replay: all **77 cases across 21 spec files**
  passed in 3 minutes 55 seconds. The four folder-form cases cover Save/Cancel,
  stale authority and preserved operations/notes, structured errors with complete
  viewport bounds at 390 CSS pixels, and Settings save/error/Retry. The regenerated
  phone screenshot was visually inspected. These fixtures establish frontend
  behavior; canonical filesystem publication belongs to the native checks above.

The native run used `e2e/specs/native/piChatRename.spec.ts` and the E2E binary with
SHA-256 `fb753993234591e686c68642dbec17ffcf350d7904098da1fea3bf75381b6ece`.
Its final log is `/tmp/gneauxghts-pi-rename-native-final.log`. The exact review,
nested-folder grant and enabled Retry warning were visually inspected in the
selected screenshots under `/tmp/gneauxghts-pi-rename-native-acceptance/`. The
owned app/driver/Vite processes exited and their ports were released.
The focused post-layout run is recorded in
`/tmp/gneauxghts-pi-rename-native-folder-final.log` with its full-window evidence at
`/tmp/gneauxghts-pi-rename-native-acceptance/pi-rename-folder-grant-window.png`.

The final browser log is `/tmp/gneauxghts-pi-rename-browser-all-final.log`; selected
phone evidence is
`e2e/agent/.wdio/screenshots/write-folder-permissions-390.png`. Its owned browser,
driver and fixture server exited, with no owned process/session leftovers and no
listener on the owned port. Final source checks/build completed before this fresh
replay; only outcome documentation changed afterward. Earlier checkpoint counts
belong to their individual reports.
