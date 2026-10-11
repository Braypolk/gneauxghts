---
status: superseded in part by ADR-0009
---

# Limit chat history access to current content

The original decision kept removed historical prose out of ordinary model context while allowing Current-Content Provenance and activity metadata for currently permitted notes. [ADR 0009](0009-allow-scoped-retained-activity-evidence.md) supersedes that prose restriction for explicit, scoped activity queries.

Current chat can read retained added/removed authored changes through that scoped capability, subject to current access and evidence validation. It does not receive general History Mode administration or Version Restore authority.

The original design also reserved a narrow historical-read grant for explicitly requested complete Version Restore proposals. That capability remains deferred: no current-turn chat restore grant or restore tool is implemented. Any future implementation must retain explicit user intent, durable proposal review, and no direct agent restore commit. Partial historical recovery is outside that proposed capability.
