# Five-tool chat interface

Reduce the model-facing interface from ten tools to five: find_notes, read_notes, propose_note_change, research_notes, update_plan. Context continues inferring relevant notes; no current-note picker or active-note tool.

find_notes combines passage discovery and distinct-note activity. result=notes requires an explicit activity range; cursor-only continuations retain result kind and filters. read_notes uses explicit purpose=answer (canonical citations/history) or purpose=edit (pending working copy). propose_note_change uses operation=edit/replace/create; preserve current proposal payloads, hashes, access checks, full-read replacement coverage and Keep before writes. Research remains separately bounded and costly, with evidence-only find/read operations; it cannot use edit reads, create proposals, plan or delegate.

Keep backend ownership and persisted formats. Update safe recovery feedback, worker instructions, activity summaries and architecture documentation. Test through actual registration/streaming/tool path with disposable vaults; demonstrate missing new interface before implementation. Verify branch parsing, current vs pending content, fresh hash/full coverage, exclusions, creation, range/cursor semantics and worker capability restrictions. Measure the complete assembled request and run the same capped eight-case live matrix after offline validation, using the saved Keychain credential without logging secrets.

Baseline: ../chat-context-reduction/live-behavior.json and its corrected offline rubric results; request-before.json/tools-before.json copy that phase's final ten-tool assembly. Only the new phase is in scope; earlier changes are retained.

Implementation and validation are complete. See [evaluation](evaluation.md) for measured savings, live output inspection and the remaining extra-search case.
