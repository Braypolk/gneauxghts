# Accepted proposals falsely reported as external changes

Completed 2026-10-12.

The reported “Changed outside the app” resolver could appear after accepting
chat edits because acknowledgement compared canonical editor read-back against
the submitted review text. A proposal starting with a heading matching its
filename reproduces this: the normal note reader removes that heading, so the
app mistook its own published content for an external edit.

Proposal commit results now include editor-visible Markdown derived from the
exact `NoteTimeline` mutation result through the existing note-session builder.
Acknowledgement compares read-back against this committed receipt. Submitted
review text remains the reference for preserving typing during publication.
Real disk mismatches still retain local text and present conflict choices.

Validation:

- The composed proposal/editor regression failed with `conflict` before the fix.
- Frontend coverage exercises normalized acceptance, later typing, genuine
  external edits, retained reviews, route disposal, and existing adoption paths.
- The backend command regression stages and commits a real proposal in a
  temporary vault, then verifies its receipt against the normal note reader.
- `pnpm check` passes with zero errors or warnings; 132 focused frontend tests
  pass, including contract and architecture checks.
- All 24 backend tests selected by `cargo test --lib proposal` pass.
- All 21 backend architecture fitness checks pass; `git diff --check` is clean.

The installed app's mounted UI has not been exercised for this change. The
frontend and Rust backend must both be rebuilt together to use the new receipt.
