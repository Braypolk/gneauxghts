# Transcript recovery validation

- Confirmed the original startup behavior by temporarily disabling the recovery
  admission: the deletion/restart regression failed with zero chats instead of one
  (Cargo test exit 101). Recovery admission was restored immediately afterward.
- All seven recovery regressions pass through normal ChatService construction.
  Coverage includes complete `.gneauxghts` deletion, exact message content and
  surviving file bytes, stable identities and part order, multiline remembered
  quotes, source links, idempotent reopen, continued transcript publication,
  genuine external edits, existing database precedence, repaired missing parts,
  atomic ID-collision rollback, duplicate/malformed candidates, symlinks, and
  attachment inventories without fabricated attachment bytes.
- Full Rust suite: 707 passed, 16 ignored; all 19 architecture fitness tests passed.
- Formatting of the changed chat module and its children passed
  `rustfmt --edition 2021 --check src-tauri/src/chat.rs`; `git diff --check` passed.
- Tests used disposable vaults and data directories under the system temporary
  directory. No live provider calls or production vault writes were needed.
