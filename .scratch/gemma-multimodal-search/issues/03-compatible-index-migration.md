# Migrate every text embedding with compatible generations

Status: needs-triage
Type: task
Depends on: 02
Triage reason: representation pins and provider contract follow tickets 01–02.

## Deliverable

A resumable Jina→Gemma migration that never compares vectors across incompatible spaces. Read architecture/invariants and applicable ADRs before changing persistence and publication.

## Work

Version representation identity in durable vectors, ANN manifests, note aggregates, edges and descriptor/name caches. Include compatibility in `prepare_note_content` and `prepare_chat_recall_content` reuse checks; unchanged text hashes and equal dimensions cannot bypass re-embedding. Separate text and vision preprocessing revisions so image-only changes do not force text re-indexing.

Build text/chunk/note indexes in a staging generation and reconcile new work before activation. Include immutable remembered-chat excerpts from ChatService; filesystem scans alone do not cover this corpus. Regenerate Related Notes, Atlas geometry and labels through their existing owners. Keep text-only note aggregates.

Use the single-runtime migration/fallback policy in the spec: keyword search remains available, retained responses are stale/rebuilding, old files remain recoverable, and incompatible old vectors cannot answer new Gemma queries. Capture one compatible provider/index bundle per reader and atomically activate the current generation; publish Atlas separately through its existing owner. Resume only compatible staging work and bound retries/supersession. Restore the previous provider/generation after failure or rollback.

## Acceptance

Tests prove identical hashes/dimensions still invalidate vectors after model/prompt changes, both corpora migrate, crashes restart safely, concurrent edits/deletes win, readers see coherent generations, and rollback retains compatible Jina data. No stale generation can resurrect forgotten/deleted notes or silently become current.
