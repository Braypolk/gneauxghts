# Remove unconditional browser screenshots

Status: ready-for-agent
Progress: complete
Owner: root

Final ledger review found EH10 success screenshots in Settings and note-tags still creating shared /tmp artifacts. Remove these nonasserting calls; retain semantic and geometry assertions and central failure diagnostics. Record failure screenshots under a unique disposable run directory, only on failure.

Removed11 unconditional success screenshots across Settings/note-tags. Central afterTest now captures only failures into a unique mkdtemp directory and prints its location alongside sanitized diagnostics. All existing assertions preserved; E2E TypeScript passes.
