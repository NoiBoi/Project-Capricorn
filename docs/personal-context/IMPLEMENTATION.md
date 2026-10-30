# Personal-context prototype

Historical prototype report. The native features described here are now shipped
and installed in 0.3.1; see `../RELEASE_0.3.1.md` for the current release status.
The later real local Honcho comparison is separate from the initial interface
checks recorded below.

Implemented separately from the installed 0.3.0 release on `experiment/personal-context`.
The baseline is release commit `71ce364`, which is pushed to
`origin/capri-lachy-integration` and tagged `v0.3.0`.

## Working behavior

- The existing durable user memories, project threads, shared episodes and Capri
  tastes remain in place. A new working-context view connects explicitly named
  current work to those same project IDs and aliases. It does not infer a project
  or progress from an open app.
- User-reported whereabouts/current work have source quotes, source times,
  validity intervals, supersession and expiry. Fresh reports can contextualize a
  real return to PC input. Input returning alone cannot establish arriving home,
  where someone went, sleep, or an accomplished task. Requested historical
  whereabouts remain explicitly historical.
- Short intentions have explicit waiting, eligible, mentioned, completed,
  cancelled and expired states. Conditions can be a matching delivered reply,
  user-reported completion of a named prerequisite, or an explicit nearby time.
  General conditions use the existing bounded learning request. A narrow direct
  path catches bedtime-after-this-reply before deferred extraction can miss it.
- A five-minute grace and current activity are required for a commitment to
  become an unsolicited candidate. Quiet/focus/sleep/private exchanges, direct
  conversation, game/fullscreen, visibility and existing model budgets still
  govern delivery. Two quiet considerations at least thirty minutes apart are
  the maximum per intention. A delivered callback is not repeated. A cancelled
  or expired intention cannot be inferred to have failed or succeeded.
- Due projects can provide their own conversational opening through the existing
  behavior lane. Actual delivered callbacks consume the existing project
  follow-up allowance, including a pronoun-based check-in. Paused, completed and
  dismissed subjects stay quiet.
- Capri's existing tastes now carry the original supporting quote into prompts,
  including an actually stated reason. The learning prompt preserves reasons
  when expressed and does not manufacture one. User preferences cannot become
  Capri's tastes.
- Memory has a Working understanding section with source quotes, condition and
  status, transition receipts, Mark done, Stop follow-ups, Forget intention and
  clear controls. Clear history, Forget all, Reset all and saved-history privacy
  also clear the appropriate new context. No production profile was imported
  into this experiment.

## Framework mechanisms used

| Reference | Adapted mechanism | Integration choice |
| --- | --- | --- |
| [Graphiti](https://github.com/getzep/graphiti) | Time-aware facts with source evidence and supersession | Small local store; no graph database or Python service |
| [Letta](https://github.com/letta-ai/letta-code) and [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) | Separate durable profile, episodes and compact working context; bounded consolidation | Extended the existing learning/context paths; no new continuous reflection loop |
| [XState](https://stately.ai/docs/transitions) | Explicit event-driven lifecycle and persisted state | Implemented the small lifecycle directly; did not add a runtime dependency for it |
| [Honcho](https://github.com/plastic-labs/honcho) | Observer/target perspective, original message authorship, background readiness and sourced recall | Optional comparison adapter using the official TypeScript SDK 2.7.0, separate from the desktop runtime |

No framework implementation was copied wholesale. The Honcho SDK is installed
only in this task's research folder. The app does not contact Honcho or upload
real messages/history/profile data. The comparison adapter requires an explicit
URL and explicitly synthetic fixture messages. Service results remain external
interpretations, not approved user facts or permissions for computer actions.

## Verification

- TypeScript validation passed.
- 538 unit tests passed, including ten new working-context/opinion checks.
- Eight distinct focused source-app integration checks passed across two runs:
  personal context, dated dialogue grounding and production-style profile
  persistence. The final six personal-context checks include harmless-pose-change
  coverage and cancellation for direct chat, sleep and focus.
- Six deterministic synthetic replay cases passed their state assertions against
  actual baseline recall and prototype helpers. This is not a general recall,
  semantic-search or personality benchmark. See `replay.json`.
- Eight real-SDK Honcho interface checks passed against a loopback test server.
  They cover synthetic-only input, authorship, timestamps, source IDs, observer
  perspective, readiness, evidence and cleanup. They do not measure Honcho's
  reasoning. See `honcho-contract.json`.
- The first real Codex generation was suppressed by the host validity gate and
  is retained as `live-first-result.json`. Targetless personal follow-ups had
  inherited screenshot-style pose stability. They now survive a routine pose
  change while retaining placement, user-interaction, exchange and privacy gates.
- One additional verification after that repair delivered a sourced bedtime /
  ArborCalc callback and marked the commitment mentioned. Its exact first output
  is retained in `live-after-repair.json`, including the unnecessary
  "I'm not calling it a broken promise" phrase. Context connection worked;
  everyday naturalness is not established. Prompt guidance now tells Capri to
  apply evidence boundaries silently instead of explaining them in casual speech.
  No further samples were selected to improve the example.

## Reproduce

```powershell
npm run typecheck
npm test -- --reporter=dot
npm run build
npx vitest run tests/e2e/personalContext.e2e.test.ts --no-file-parallelism --testTimeout=30000 --hookTimeout=30000
npm run context:replay
```

For the optional Honcho interface check, install `@honcho-ai/sdk@2.7.0` in a
separate research directory and set `CAPRI_HONCHO_SDK` to its package folder,
then run `npm run context:honcho:check`. For an actual synthetic backend
comparison set `HONCHO_URL` and, if required, `HONCHO_API_KEY`, then run
`node scripts/personal-context-replay.mjs --honcho`. It reports pending background
derivation honestly and cleans up its dedicated synthetic workspace.

The SDK interface check exposed two version-specific details worth retaining:
`environment: 'local'` overrides an explicit server URL with localhost:8000, so
the adapter leaves it unset; peer observation configurations use tuple entries
with the installed SDK's validated API rather than the older map-style example.

## Limits

An actual Honcho backend is not configured on this PC, so no service-quality
comparison was possible. The framework has not been adopted as Capri's memory.
New situations and general intentions still rely on the selected model's
extraction. Exact evidence, role boundaries and bounded state changes help, but
do not constitute a proof of semantic accuracy. Relative time parsing is bounded
and anchored to source timestamps, not a complete natural-language time system.
Live evaluation used synthetic data and one post-repair generation; it does not
establish multi-hour behavior, all paraphrases, or full personality consistency.
This source prototype has not replaced the installed 0.3.0 package.
