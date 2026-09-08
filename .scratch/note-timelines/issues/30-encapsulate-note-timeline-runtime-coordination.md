# 30: Encapsulate Note Timeline runtime coordination

**What to build:** Note Timeline exclusively coordinates history operations, recovery, integrity checks, and replay so callers cannot accidentally bypass ordering or assemble only part of the consistency protocol.

**Blocked by:** 12: Expose history health and recovery controls; 19: Recover and expire Missing Notes.

**Status:** ready-for-agent

- [x] Move operation serialization, recovery latching, integrity attestation, and replay coordination behind one private Note Timeline runtime interface.
- [x] Let application state hold the canonical Note Timeline owner without separately owning or manipulating its coordination primitives.
- [x] Preserve mutation ordering, fail-closed history behavior, prepared-intent replay, recovery convergence, and clean shutdown behavior.
- [x] Make invalid runtime transitions unrepresentable or return a closed Note Timeline error rather than relying on caller ordering.
- [x] Add architecture and concurrency tests proving all history coordination enters through the canonical owner and remains correct across interruption and restart.
