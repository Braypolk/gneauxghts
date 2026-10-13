# iOS next-launch vault switching

Implemented the safe next-launch workflow. Native `VaultInfo.canRelaunch` is false on iOS, independently of folder-picker capability. Settings explains closing Gneauxghts in the App Switcher and reopening it, shows Running Vault and Next-launch Vault Selection, and retains replacement/cancellation through Apply. Home/background keeps the Running Vault open. Desktop retains its restart button and save/settlement barrier.

Settings rejects repeated automatic restart requests on iOS without blocking editing. Native `prepare_restart` independently rejects before accessing lifecycle owners, without claiming timeline portability or authorizing resume: an ordinary exit could already be releasing the vault. No live rebinding or new persistence owner was introduced. Architecture and behavior invariants record the platform distinction; ADR 0005's immutable observation authority is preserved.

Validation: 46 Settings/AppStore/restart unit tests, four TypeScript IPC fixture tests, nine mounted Settings browser tests, two native vault-selection tests, one native manual-reopen guard test, five native lifecycle tests and the serialized event contract test pass. Native selection tests cover failed publication, replacing/cancelling a selection, retained writes to the Running Vault, and composing the selected vault on the next launch. Svelte and E2E type checks pass. The iOS simulator target compile-check passes with the existing unused-mut warning in `semantic/legacy_jina.rs`.

The browser suite also exposed a fixture bridge that restored its object without restoring the invoke function after a mock; restoration now resets both. The existing semantic setup browser test passes again.

Limits: this change was compiler-checked for iOS and exercised through browser/native test harnesses, not installed as a new simulator package. Physical-device close/reopen, abrupt termination and standard packaging remain in the device release gate. Manual force-quit does not guarantee pending frontend draft completion or portable clean close; background saves remain best effort.
