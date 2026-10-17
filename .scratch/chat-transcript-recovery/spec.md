# Historical transcript recovery

> Superseded by [the Pi rebuild](../archive/pi-chat-rebuild-scope.md). No old-chat import, managed transcript projection or migration is required. Existing authored transcript files are preserved; the former importer and its tests are retired. The original implementation contract below is historical.

When `.gneauxghts` (including `ai.sqlite3`) is removed, startup must discover
surviving app-generated conversations in the Running Vault's `Chats` directory.
The previous startup path initialized an empty database and never read these
transcripts, so they remained visible as files but disappeared from chat history.

`ChatService` imports only missing conversation identities, committing each
conversation's messages and projection hash receipts in one transaction. Recovery
never rewrites the surviving files and never replaces an existing database chat.
Stable conversation/message identities, titles, creation dates, ordered parts,
visible statuses, source links, and explicitly remembered passages survive.
Incomplete, malformed, duplicate, and colliding records are skipped without
partial import; the next startup can retry after the files are repaired.
Filesystem symlinks are not followed. Forgotten chats outside `Chats` stay forgotten.

Legacy projections do not include per-message timestamps, provider configuration,
vault permissions, attachment bytes, activity events, proposals, branch ancestry,
or evidence provenance. Recovery uses the conversation creation date for message
ordering timestamps and current default provider/model configuration. Vault access
starts at None; assistant history is conservatively marked as potentially based on
note evidence. Sources remain display links without fabricated provenance.
Attachment inventories remain visible text with an unavailable-content notice.
Remembered quotes restore explicit recall choices without claiming old byte offsets.
A moved conversation folder is detached to prevent writes to an inferred location.

Regression coverage enters through normal ChatService startup after deleting the
entire disposable vault-data directory, verifies exact surviving transcript bytes,
reopens a second time, continues projection publication, and confirms real external
edits still detach. Further checks cover existing database precedence, missing parts,
transaction rollback, and malformed/duplicate/symlinked candidates.
