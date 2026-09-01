# 06: Harden stable Note Identity

**What to build:** Notes retain one trustworthy identity across content and lifecycle changes, while copied or damaged files cannot overwrite another note's timeline association.

**Blocked by:** 05: Contract the legacy mutation seam.

**Status:** ready-for-agent

- [ ] Preserve Note Identity when authored content becomes empty and when a known file temporarily loses or damages managed identity metadata.
- [ ] Preserve identity across rename, move, forgetting, Forgotten-Note Recovery, temporary disappearance, and safe reattachment.
- [ ] Repair missing or damaged embedded identity only during the next app-owned commit rather than silently during external observation.
- [ ] When a copied file duplicates the identity of an existing note, preserve the original association and assign the copy a new globally unique identity.
- [ ] Prevent duplicate identity ingestion from overwriting an existing catalog or timeline mapping regardless of observation order.
- [ ] Use opaque globally unique identities for Note Revisions and Lifecycle Events, with explicit parent or predecessor relationships independent of database order.
- [ ] Add behavior tests for empty notes, damaged metadata, duplicate files, moves, forget and recovery, disappearance, reappearance, and restart.
