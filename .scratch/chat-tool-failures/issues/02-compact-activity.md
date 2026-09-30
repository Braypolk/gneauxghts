# Make activity details useful

Status: resolved

The activity panel repeated the same running state in the message header, outer panel, nested tool card, and body. Replace it with a compact activity line. A single action without meaningful details has no expander; multiple actions or useful summaries expand into one flat list. Collapse by default, remove raw millisecond timings, suppress duplicate summaries, and retain failure/recovery messages and accurate status labels. Hide the duplicate message-header activity while a tool runs.

## Validation

Existing ChatMessage rendering suite: 7 passed. Svelte check: zero errors/warnings; E2E TypeScript check passed. Screenshot layout reviewed against the component changes; no native visual run performed.
