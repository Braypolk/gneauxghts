# iOS vault switching

Status: needs-triage
Priority: P1

## Scope

Replace the iOS dependency on process relaunch with an explicit reopen or safe next-launch workflow. Preserve immutable Running Vault ownership, Next-launch Vault Selection, save barriers, rollback observations and clean-close ordering.

## Acceptance

Read the architecture and ADR 0005 before selecting the lifecycle. Test failures before and after terminal release, repeated requests and successful opening of the selected vault.
