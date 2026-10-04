# Admit a ready main webview before native command scenarios

Status: ready-for-agent
Progress: complete
Owner: root

## Evidence and plan

Native feature build passes. Lifecycle boots/reconnects/bridge3checks pass. The
next fresh Timeline invocation issues its first save before checking the native
IPC bridge and immediately fails; subsequent assertions lack the app navigation.
Require a main-window bridge readiness condition with a bounded timeout in shared
native setup; preserve scenario-specific boot/editor readiness assertions. Add
failure URL/title/body diagnostics. Re-run Timeline, then remaining native smoke;
investigate further if the bridge never appears.

WDIO's custom launcher service must be registered as an array tuple; TypeScript
accepted a bare class but runtime validation rejected it. Corrected tuple is
exercised by actual native runs. No external tauri-driver install is required for
the configured embedded provider; its generic diagnostic is not an admission
failure (real lifecycle3tests passed).

## Verified outcome

Root repeated native lifecycle3/3 and timeline4/4 with ordered admission. All seven smoke files subsequently have passing final executions, including real command/event2checks. See ../validation.md for composed-run evidence and the independent owned restart check.
