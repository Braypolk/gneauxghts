# Research reliability

Status: resolved

See [spec](../spec.md) for acceptance and sequencing.

## Answer

Strict selection remains authoritative: unread IDs and malformed/empty selections
never become sources. Failures return explicit partial outcomes and direct-evidence
recovery; only delivered selected proofs enter parent evidence. The final native
worker returned `partial/empty_selection`; its parent disclosed the failure,
read/cited all three historical changes and both current notes, and correctly
reflected vendor completion and the Rhea task. This establishes recovery success,
not worker success. Worker usefulness is tracked in issue 09. See
[validation](../validation.md) and `../artifacts/native-final.json`.
