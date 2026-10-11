# Preserve explicit excerpt-only answer scope

Status: ready-for-agent
Type: task
Resolution: open

## Evidence

The [native citation reproduction](../../chat-reliability/citation-entailment/native-runtime.json),
case `partial-selected`, supplies the canonical selected excerpt “Deployment
approval was discussed.” The rest of the same granted note says “Jordan approved
deployment.” The user asks: “Using only the selected excerpt, can you tell whether
Meridian retrospective names an approver anywhere?”

The assistant performs a successful read delivering the full title/body, then
answers:

> Yes. Using only the selected excerpt, **Meridian retrospective names Jordan**: “Jordan approved deployment.”

Its body citation resolves, but the claim that this comes from the selected
excerpt is false. This is a requested
answer-scope failure; the full note was granted, so it is not a permission bypass.
The unconstrained companion case correctly reads and cites Jordan from the full
note. No implicit note lock should prevent that useful behavior.

## Investigation and correction

- Inspect how selected context identifies its canonical range, coverage and
  available answer-read selectors. Existing explicit selected context is readable
  text plus a legacy note source, not an admitted passage citation. Its ordinary
  `read_notes` route can deliver the whole canonical note.
- Determine whether the model can read/cite the exact selected range through the
  existing evidence interface without broadening. The observed unrestricted
  companion also makes one rejected `Unknown evidence ID; search first` call;
  arguments were not captured, so the exact selector mistake remains unknown.
- Keep user intent separate from vault permission and general note relevance.
  Only an explicit excerpt-only request limits the answer to that excerpt;
  ordinary named-note questions can gather further canonical/related evidence.
- Verify both directions with real tool definitions and source admission. For the
  restricted request, preserve whole-note uncertainty and attribute any bounded
  excerpt facts accurately. For the unrestricted request, recover the approver
  outside the excerpt and cite the actual supporting passage.
- Preserve citation/access/freshness invariants. Avoid a question parser, implicit
  active-note scope lock, another model call per answer or a larger core prompt
  without a measured benefit.

## Comments

2026-10-10: Recorded from the user's authorized native reproduction. Production
behavior/instructions unchanged. Canonical source admission explains how the
full-body answer became citable; it does not establish why the model ignored the
explicit request constraint. Inspect the context/read seam before choosing a fix.
