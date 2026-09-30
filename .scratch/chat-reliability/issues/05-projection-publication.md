# Preserve follow-ups across managed transcript publication

Status: resolved

## Evidence

The real composer request and rendered citation navigation passed, then the
follow-up was rejected as an externally edited transcript. The test wrote only
ordinary synthetic notes. A controlled production-sink regression reproduced
classification of newly published chat bytes against the previous SQLite hash
receipt before publication had completed.

## Change

Serialize chat projection publication and conflict classification. Recheck live
bytes against committed receipts for queued managed projection observations;
retain real external-edit/deletion conflicts. Repeat the native follow-up and
research scenarios after rebuilding.

## Answer

Publication and conflict checks serialize; queued managed projection observations recheck committed canonical bytes. The production-sink regression passes, genuine external edits still detach, all 56 chat tests pass, and the native fresh cross-note follow-up completed. See [validation](../validation.md).
