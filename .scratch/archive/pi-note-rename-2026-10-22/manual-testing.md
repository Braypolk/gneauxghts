# Historical manual testing guide

This guide records the original implementation checkpoint. Its separate-copy
recovery, automatic-title, ranked Atlas search and independent rename-permission
steps below are superseded. For current behavior see
[recovery into the original note](../draft-recovery-in-place-2026-10-22/README.md),
[retired automatic titles](../retire-ai-titles-2026-10-22.md),
[Atlas node filtering](../atlas-title-workflow-2026-10-22.md), and
[unified write permission and rename recovery](../pi-write-permission-2026-10-22/README.md).

Use a disposable vault with a few invented notes. Keep a normal text editor or
Finder open on that vault so you can compare filenames and file contents. For
tests that use AI, choose a configured provider you are comfortable sending the
test text to. A slow or failed provider request should never prevent ordinary
typing or saving.

This rename build uses history schema 15. Existing schema-14 history is rejected
under the repository's current version policy, rather than migrated or silently
reset. Start with a fresh test vault. **Settings → Note Timeline → Reset history**
requires confirmation and discards retained revisions, revision names and history
citations; canonical notes remain. No reset is required for a new empty vault.

On desktop, create an empty test folder, open **Settings → Vault → Choose
folder**, select it and choose **Apply for next launch**. Restart when prompted,
then check **Folder details → Running Vault** before making test notes. Switching
back later uses the same next-launch flow; selecting a folder alone does not
change the vault already running.

## Recoverable capture

Ordinary successful autosave retires its Recovery Copy, so closing and reopening
a successfully saved note will usually show no recovery banner. Recovery Copies
are a fallback for unfinished work, including title input that has not yet blurred.

The reproducible failure test uses the isolated browser fixture rather than
damaging a real vault:

```sh
pnpm agent:test --spec ./specs/draft-recovery.e2e.js
```

It temporarily fails the fixture's canonical save and backup calls, types an
idea, verifies **Retry backup**, restores backup storage, reloads and chooses
**Resume copy**. The resumed work must become a separate draft; the original note
must be unchanged. It also checks a title that is still focused and the disclosure
at a 390-pixel viewport. Native storage tests separately cover SQLite reopen,
vault isolation and delayed-write ordering.

If recoverable work appears during normal use, expand **Recoverable work**,
choose **Resume copy**, and compare the new draft with its original. **Discard**
must remove only that private copy. Do not force-quit valuable work to provoke
this state: backup coalescing leaves a roughly 400 ms quiet / 2 s continuous
typing interval before a copy reaches storage.

## Automatic titles

1. In **Settings → AI & Chat**, confirm **Automatic note titles** is initially off
   in a fresh vault. Turn it on explicitly and return to the editor.
2. Choose **New Idea**. Leave the title untouched and write several sentences,
   for example an idea for an observatory open evening. Let the note save and the
   provider finish. A concise title should replace the initial fallback title.
3. Make another idea and type your own title before the response arrives. Your
   title must remain. Repeat by typing a title and clearing it: having expressed
   title intent still prevents an automatic replacement.
4. While another title request is pending, change the body, leave the workspace,
   or switch the setting off. A late result must not overwrite newer work. The
   old body's response must be rejected; a later valid request for the newly
   saved body may still title an untouched note. The app should remain usable if
   the provider fails or returns an unsuitable title.
5. Restart normally and confirm the preference persists. Existing named notes
   should not be retitled by enabling it.

This is the useful live-provider acceptance test. Automated checks establish
opt-in, source guards and editor adoption; they do not establish whether you like
the model's title quality. Only the bounded saved body excerpt is used for the
title job; it does not use a chat or general note-editing permission.

## Search cues and passages

Make two text notes about the same subject and attach an image to one. Include
the same distinctive phrase twice in a long note, separated by several screens.

1. In dock Search, select **All notes** and enter a query. Try **All**, **Notes**
   and **Images**. Notes should show note matches; Images should show image
   matches. Opening each result should reach the expected source.
2. Try **Edited → 7 days**, **30 days**, then **Any time**. This means the file's
   modification time, not a YAML date. To exercise exclusion, use a disposable
   older fixture; setting the clock or changing real notes is unnecessary. The
   maintained native tests admit dates before ranking, rather than filtering a
   shortened result list afterward.
3. Change a cue while a request is pending. Old incompatible rows must disappear,
   and a late old response must not put them back. Clear the query: ordinary
   **Recent** / **Last edited** browsing should still work. Switch to **This note**:
   the all-notes cues should disappear.
4. Search the distinctive phrase, open the preview and confirm the editor reaches
   that passage. In **This note**, use next/previous occurrences and verify each
   occurrence. Return to writing and check that navigation feels predictable.
5. In **Atlas**, type the subject, use Up/Down and Enter to open a ranked row,
   then try a pointer click. The row previews and reason labels should be useful;
   map coordinates must stay in place. Try a narrow window and ensure **Fit map**
   and the results remain reachable.

For a deterministic cue/Atlas presentation replay:

```sh
pnpm agent:test --spec ./specs/retrieval-cues.e2e.js
pnpm agent:test --spec ./specs/atlas-ranked.e2e.js
```

## Formatting, Undo and composition

Use an invented note and try these as separate actions:

- Type `word`, place the caret inside it, apply Bold and then Italic. Undo once
  should remove Italic, then once more should remove Bold. A selection's explicit
  toolbar action must not merge with an earlier paste into one destructive Undo.
- Select text containing literal backticks, such as ``a `tick` here``, and choose
  **Code**. It should become one code span. Toggle Code off and check that the
  literal text is unchanged.
- Click the beginning and end of visibly bold text and type. The new character
  should stay inside that formatting. Try an empty Bold or Strike pair: it should
  remain ready for typing without turning following prose into unrelated chrome.
- Type `- [ ] idea`, press Enter once to continue the task list, then Enter again
  on the empty item to exit it. Each key press should do one action.
- Open the same note in both panes. Format in one and Undo from the other: both
  panes should agree, with one shared history.
- With a Japanese/Chinese/Korean IME, begin composing and try a formatting
  shortcut before committing. Composition should complete normally without an
  unexpected formatting operation. Check your actual OS keyboard: synthetic
  browser composition events cover the guard, not a complete physical IME.

Also enable the OS **Reduce motion** preference and repeat the selection-toolbar
actions. Controls should remain visible and usable with reduced transitions.

```sh
pnpm agent:test --spec ./specs/formatting-mechanics.e2e.js
```

## Dock motion and image Retry

Open Search, type enough text to show rows and cues, then resize between a wide
window and a phone-sized width. Open/close the popup and change result counts.
Look for flicker, jumping content, clipped controls or an unresponsive dock. The
maintained browser check also listens for the reproduced ResizeObserver feedback
error; a smooth-looking screenshot alone would miss that failure.

Drop an image while unrelated note text is selected. The insertion caret should
move to the drop location and the unrelated selection toolbar should close. The
reproducible upload-failure test is:

```sh
pnpm agent:test --spec ./specs/image-drop.e2e.js
```

It fails one fixture upload, verifies unchanged authored text, clicks the actual
**Retry** button and checks that only the failed image retries. A toolbar must not
cover that button. There is no need to break real storage or networking to test it.

## Shared search, tasks and authored properties

Shared query preparation and indexed task grouping mostly remove duplicate work;
they are not new visible controls. Compare a warm large task list and paired
note/image search in the same disposable corpus before and after a build, recording
several samples. Keep the model, corpus, query and machine load the same. The saved
reports contain fixture sizes and timings; do not expect the synthetic-provider
numbers to predict your model or vault's latency.

For behavior, verify task grouping order and toggles still work, and that chat
search respects its permitted scope. Chat and dock results need not be identical:
scope, pagination and limits remain separate. A chat source link should require
an actual read, rather than acquiring citation authority from a search preview.

For **Pi property editing**, create a note with one ordinary YAML property, grant
editing for that chat, and ask Pi to remove it. Review and apply the edit. The last
authored property should disappear while body text and app-owned identity/history
metadata remain intact. Also try changing one ordinary property while body text
contains literal escaped links; unrelated body text should not change. A YAML
`title` property is authored data, not the filename.

## Pi filename editing

The first tool is same-folder rename only. Use fresh disposable notes such as
`Observatory scratch.md`, `Observatory evening.md` and an intentionally occupied
`Already exists.md`. Keep **Review before applying edits** enabled.
Rename always requires its own exact approval, including when that ordinary-edit
review setting is off. You can test that separately with a disposable request:
turn the setting off and confirm that **Rename note** review still appears.

1. Open the source note beside Pi. Record its exact body/properties and make one
   Pi read/source citation before renaming. Grant ordinary editing in
   **Vault access** first and verify it does not silently include Rename.
2. Explicitly enable **Allow renaming notes**, then ask: “Rename the saved
   note Observatory scratch to Observatory evening. Keep its content unchanged.”
   The review must show the exact old and new relative `.md` paths, unchanged
   content/properties, and the warning that filename/path links can stop resolving.
   Disk must still have the old filename before approval.
3. Choose **Discard rename** once: neither file nor editor should change. Repeat
   the request and choose **Rename note**. The old path should disappear and the
   exact destination should exist with identical bytes. The editor must show the
   new title under the original note identity. Open the renamed note in both
   editor panes and continue editing: they must agree and save to the new path
   without recreating the old file. History should record Rename without an
   extra unchanged-content revision. The native task test separately verifies
   adoption while both editor panes are already mounted; the UI supports two
   visible panes, so they cannot coexist with a third visible chat review.
   Search the new title and open the note from any existing task: both should
   resolve the renamed note, without a duplicate stale-path entry.
4. Follow the earlier Pi source citation. It should still open the same note by
   identity. An ordinary filename/path link is not automatically rewritten; its
   destination may stop resolving. Other notes' text must remain unchanged.
5. Request `Already exists`. Both existing files must retain their exact bytes;
   the app must not overwrite it or choose an unreviewed numbered suffix. Repeat
   with a free destination, then create that destination externally after the
   review appears but before **Rename note**. The same preservation rule applies.
6. Prepare a rename, then change the source body or revoke rename permission
   before approving it. Approval must fail safely and preserve the newer state.
   A dirty source/destination or live title input in either pane should also
   block publication until it is settled and a fresh request is prepared.
7. Try an empty, hidden, case-only, path-separated or traversal name in the
   disposable vault. Expect an explicit rejection, not silently altered spelling,
   folder creation or movement outside the note's folder.
8. Repeat with a note in `Projects/`. In **Vault access → Allowed write folders…**,
   explicitly list `Projects` and save. A root-folder grant alone must not admit
   a rename in this exact-folder policy. The review must retain `Projects/` in
   both paths, and approval must rename inside that folder. A folder grant must
   not silently add its subfolders or change existing source-note selections.

If a rename commits but the editor cannot read its new location, the app should
say that the note was renamed and pause editing. **Retry editor refresh** must
remain clickable outside the paused workspace. It should verify and adopt the
already committed rename, without performing the rename a second time. The
native test below injects one frontend readback failure after an actual commit;
there is no need to damage a real file to provoke this warning.

The fast browser permission-form replay checks Save/Cancel, stale drafts,
preservation of the selected operations/notes, native-shaped errors, Settings
retry, and the complete form at 390 CSS pixels:

```sh
pnpm agent:test --spec ./specs/write-folder-permissions.e2e.js
```

Deterministic native acceptance uses a local synthetic provider with the actual
tool/review/publication owners and filesystem. It is separate from live-provider
prompt-following quality. After the E2E binary is built:

```sh
node e2e/support/buildNative.mjs
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/piChatRename.spec.ts
```

The owned native launcher uses a temporary vault/app-data namespace and runs in
the background. Its split-pane continuation uses a public CodeMirror input
transaction through the actual shared editor owner and ordinary autosave, then
checks the real destination file. It does not establish OS typing: test actual
keyboard input after rename manually in both panes as described above. Browser
fixtures alone do not prove canonical publication, two-path collision safety or
restart recovery. Interruptions at durable boundaries
belong to the native Timeline/proof tests; do not simulate them by killing a
personal-vault session. Physical-device IME, native focus/paint and live-provider
quality remain separate acceptance checks.
