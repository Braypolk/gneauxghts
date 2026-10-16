# Native expanded follow-on integration

Prepared code, not an acceptance receipt. No native build, app, simulator, port,
credential or live provider was used to prepare these files.

`expandedFollowonsProbe.ts` uses the mounted normal workspace and shared ChatApi.
Parent history, research, and fresh evidence follow-ups use the normal composer.
Attachment and forced web checks use the public API and say so in the report.
It creates 30 synthetic canonical notes through `save_note`. Both protocols run
seven source-free warmups, parent continuation, a scoped research child that reads
the actual notes, and a fresh canonical follow-up. The normal compaction policy
must initiate real parent and worker summary requests. The fixture charges one
synthetic input token per serialized byte; no policy or harness owner is bypassed.

The public attachment checks cover text on both protocols; compatible image,
audio and video; hosted image and PDF; exact explicit Retry identities/bytes; and
malformed data, compatible PDF and local forced web rejection before acceptance.
Media samples are opaque synthetic transport bytes, not a live interpretation
test. Hosted web checks observe forced initial selection and its release after
an ordinary canonical tool call, separate source kinds, and whole/selection Save
links with no additional inference.

Only the main agent should apply the following edits after its source freeze.

1. In native `pi_probe_config`, return `followonsGate` only when the fixture,
   interactive and expanded gate are enabled and
   `PI_PROTOTYPE_FOLLOWONS_GATE=true`. This is an opt-in gate, not a new default.
2. In `chatApi.ts`, retain the `followonsGate` flag from that config. Only for this
   opt-in fixture, expose capabilities: both providers tools/images/files true;
   local audio/video true; hosted audio/video false. Accepted MIME types must
   include text/plain and image/png, plus local audio/wav and video/mp4 or hosted
   application/pdf. Reasoning stays off. Keep the regular fixture capabilities
   unchanged. Native request admission still validates the actual byte policy.
3. In `interactive-fixture.mjs`, import `planFollowonsReply` from
   `./followons-fixture.mjs`. Replace the planner assignment with:

   ```js
   const followons = process.env.PI_PROTOTYPE_FOLLOWONS_GATE === 'true';
   const reply = (followons ? planFollowonsReply(body, compatible, attempt) : undefined)
     ?? planInteractiveReply(body, compatible, attempt);
   const inputUsage = reply.usageInput ?? 8;
   const outputUsage = reply.usageOutput ?? 8;
   ```

   Use inputUsage/outputUsage in both protocols' terminal usage frames, including
   their sum as total_tokens. Keep request body/size/model/journey/tool/completion
   recording. Preserve all original synthetic plans and interruption timing.
4. In `expandedProbe.ts`, extend its report with `followons?: unknown`. Immediately
   before `runNativeStorageFaultProbe`, while the owners remain open:

   ```ts
   const { runExpandedFollowonsProbe } = await import('./expandedFollowonsProbe');
   const followons = await runExpandedFollowonsProbe();
   if (followons) {
     if (followons.status !== 'passed') throw new Error(followons.error ?? 'Follow-ons failed');
     report.followons = followons;
   }
   ```

   An enabled follow-on gate must produce this report. The wrapper's final report
   overwrites intermediate UI reports, and remains under the native 16KiB bound.
5. In both desktop and iOS expanded drivers, propagate the explicit env flag to
   the fixture process and the native app/simulator. After the final report:

   ```js
   import { verifyFollowonsReceipts } from './followons-fixture.mjs';
   const followonsChecks = verifyFollowonsReceipts(fixture.requests, report.followons);
   ```

   Persist the returned checks alongside the provider requests and existing UI
   receipts. The verifier requires completed parent and worker summaries in each
   protocol, real read/selection and native attachment wire types, identical Retry
   wire user content, and forced web release. UI success alone cannot pass it.
   Allow up to ten minutes for the expanded relaunch stage on a simulator.

Pure checks:

```sh
node --test scripts/pi-prototype/followons-fixture.test.mjs
pnpm exec svelte-check --tsconfig ./tsconfig.json --output human
```

Pending native evidence remains explicit: neither pure test results nor the
prepared report establish desktop/iOS acceptance, live media interpretation,
live hosted search, permission races, research cancellation or forced process
termination during compaction. Transcript conflict and relocation checks remain
the main agent's separate driver filesystem work.
