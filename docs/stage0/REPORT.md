# Capri Stage 0: behavioral architecture decision

**Decision: B, a hybrid architecture.** Consolidate optional desktop initiative and transient interests behind one decision owner. Preserve the current conversation, rendering, Windows integration, actions, and memory infrastructure. The prototype establishes a useful state/decision boundary, not a proven improvement in spontaneous curiosity or literary quality. A wholesale replacement is not justified by this evidence.

Investigated base: `NoiBoi/capri-companion`, `capri-lachy-integration`, **138c947b6cee5394427e15573012ed1242dd7a99**, version 0.2.45. Implementation: local branch `experiment/behavior-stage0`, separate `outputs/Capri-stage0` checkout. The original checkout remains clean on its original branch. Nothing was installed, packaged, or migrated into the running app.

## Diagnosis from current implementation

The initial fragmentation hypothesis is only partly correct. `ConversationScene` already shares 14 attributed entries across chat and desktop, persists them for up to 48 hours, and accepts evidence-backed conversational readings only at the correct revision. Contact can supersede optional generation; `generatedRemark` rejects stale exchange and target results. `BackgroundBudget` and `RequestGate` already bound requests and prioritize direct replies. These are mechanisms to retain, not recreate.

Concrete gaps and their consequences:

| Evidence | Consequence | Cause |
| --- | --- | --- |
| `index.ts:1122` builds observations inside `generatedRemark`; explicit quiet returns without recording an observation/reading | An interesting but unspoken detail is unavailable to a later conversation unless another record independently captures it | Missing situational state, rather than insufficient prompting alone |
| `explorationDirector.ts:42` chooses a bounded outing from fixed goal categories and randomness; `index.ts:1734` selects local touring asides outside an active exchange | The motive for visiting and the spoken thought can be unrelated to the last observed detail | Independent initiative selection; movement mechanics themselves are sound |
| Context pings, lounge asides, exploration and idle remarks have separate eligibility paths (`index.ts:1856-1903`) | An individually permitted local line can displace a pending desktop curiosity; there is no shared interest arbitration | Coordination gap, partially mitigated by current conversation gates |
| `ConversationScene.apply` requires assistant-authored evidence for Capri's position/intention | Good protection against invented preferences, but it cannot represent a curiosity Capri never voiced | Appropriate conversational provenance, missing a separate tentative-interest channel |
| Generated dialogue cleanup rejects app-name/title recitals and some repeated phrasing; failed placement generation can fall back to an authored line | A grounded response may be discarded, then replaced by a less specific line | Output policy/context assembly, not necessarily agent architecture |

Touch is already immediate and conversation-aware. Scene revisions, privacy clearing, and target revalidation materially reduce fragmentation. The architecture document and older dialogue descriptions lag some 0.2.45 behavior; implementation and `CONVERSATION_SCENES.md` control this diagnosis. The character dossier is a provenance/performance reference, not runtime situational memory.

Model and characterization still matter: the existing voice brief already asks for sustained curiosity, independence and silence. Adding state cannot make a weak observation meaningful, repair unsupported characterization, or guarantee an interesting preference. Sparse metadata, provider latency, and randomized local delivery are distinct issues.

## Useful reference mechanisms

**YUI:** candidate events are distinct from the backend's judgment. Its screen source uses app dwell, presence and a bounded buffer of suppressed transitions; its global proactive pacer applies across sources. The event bus prioritizes user input, and a turn lock extends through playback. Reply settlement can render a gesture on a silent turn without duplicating an audio-timed cue. These are substantive coordination mechanisms. Adopting its Tauri client/backend stack would add integration work without a demonstrated benefit here. [Screen source](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/src/dispatcher/sources/idle-tick/screen-source.ts), [pacer](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/src/dispatcher/core/proactive-pacer.ts), [reply settlement](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/src/dispatcher/backend/settle-reply.ts).

**YUI/Hermes desire:** append-only events, revisable readings, and prose wants have separate identities. Corrections/retractions change the shown event without rewriting history. Wants survive invocations but are not parsed into a planner by integration code. The pre-run gate wakes for bounded new/unread events or held notes; otherwise it suppresses the agent. Its actual monitor concerns GitHub work, not desktop pixels. Borrow attribution, persistent unfinished intentions and pre-model gating. Do not import feelings registries, loneliness triggers, its outbox/action infrastructure, or scheduled reflection. [Events implementation](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/integrations/hermes/desire/desire_events.py), [gate](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/integrations/hermes/desire/gate.py), [state and wants documentation](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/integrations/hermes/desire/README.md).

**Hermes Agent:** the monitor gate suppresses unchanged work before agent machinery, while curated memory is distinct from conversation state. Its memory tool documents a frozen session-start prompt snapshot, which is useful for caching but unsuitable as Capri's immediate changing situation. Hermes is a general Python agent/scheduler, not an out-of-the-box desktop behavioral core. [Scheduler](https://github.com/NousResearch/hermes-agent/blob/74885f997bece88c1393bd174b25b32338336cb6/cron/scheduler.py), [memory tool](https://github.com/NousResearch/hermes-agent/blob/74885f997bece88c1393bd174b25b32338336cb6/tools/memory_tool.py).

**Neural Companion:** Screen Supervisor asks for a stable subject, visible evidence and `should_speak`, with repeat policies rather than mandatory remarks. Those instructions are not proof that every downstream gate is enforced. Its separate continuity helper bounds a session summary and supplies summarization inputs; this is conversational continuity, not evidence of autonomous persistent wants. Useful: subject-level repetition control and bounded working memory. Python, PySide6, model/audio dependencies and optional subsystems would be a substantial platform addition. [Screen Supervisor](https://github.com/Rakile/NeuralCompanion/blob/4511f235a75c882acd472ed3004b5615303221e9/addons/screen_supervisor/main.py), [continuity memory](https://github.com/Rakile/NeuralCompanion/blob/4511f235a75c882acd472ed3004b5615303221e9/core/continuity_memory.py).

**AIRI:** its Minecraft integration emits typed perception events, coalesces/prioritizes pending work and drops redundant follow-ups before processing. This is game-specific code, not evidence of a unified desktop mind. The stage chat store correlates runtime context, persona, turn settlement and speech events. Borrow event priority, stale-work rejection and expression correlation; do not adopt the game planner or workspace/server stack. [Perception](https://github.com/moeru-ai/airi/blob/3c4aca209330f1a78fe7288e8c4ca75639cd10e6/integrations/minecraft/src/cognitive/perception/pipeline.ts), [brain queue](https://github.com/moeru-ai/airi/blob/3c4aca209330f1a78fe7288e8c4ca75639cd10e6/integrations/minecraft/src/cognitive/conscious/brain.ts), [stage chat](https://github.com/moeru-ai/airi/blob/3c4aca209330f1a78fe7288e8c4ca75639cd10e6/packages/stage-ui/src/stores/chat.ts).

All references were source-readable. The GitHub connector failed midway; direct pinned source reads supplied the remaining evidence. None of these projects was installed or benchmarked. Cross-project CPU/RAM and latency superiority cannot be established from source structure.

## Implemented slice

`src/main/behaviorExperiment/core.ts` implements one event-driven decision owner:

1. Admit bounded, timestamped facts with metadata/visual/user provenance. Metadata alone is recorded without a model call; duplicate evidence is silent.
2. On eligible evidence or direct contact, make one existing `LLMProvider.stream` request. It returns a compact interpretation, optional cited interest, action, expression and reason. No separate interpretation/planning/reflection calls.
3. Persist unspoken interpretation and up to three interests, each tied to an exact evidence quote and a ten-minute expiry. Eight facts and 32 decisions bound state. Repeated opportunities do not extend an interest's lifetime.
4. Let touch retain an interest, while an explicit superseding interaction or quiet control clears it. Direct input cancels in-flight optional work; exchange revisions guard delivery.
5. Express silence, deferral, gesture, harmless investigation or speech. `expression.ts` bridges to existing `CharacterCue` contracts and requires target validation. Only host-accepted speech enters the existing `ConversationScene`.

The host identifies explicit topic changes through a `supersedes` flag; automatic semantic correction detection is not implemented. `investigate` is a validated glance callback, not a new computer-use tool. There is no Electron entrypoint import, new UI, background loop, memory migration, or runtime dependency. The executable harness supplies synthetic events and captures renderer-compatible cues; it does not run the character window.

## Evaluation

Six deterministic scenarios use mocks; natural dialogue is not scored from authored fixture outputs. The replay also invokes the real local `DialogueDirector` as a limited baseline lane. Its outputs are not a replay of the whole production orchestrator.

| Scenario | Prototype result | Calls | Current-code comparison |
| --- | --- | ---: | --- |
| Notice, wait, later ask | Metadata defers locally; visual detail creates a silent interest; later opportunity speaks | 2 | A quiet generated observation has no analogous persistent interest |
| Pat during curiosity | Nod, retain interest, later resume it | 3 | Shared conversation already preserves spoken thoughts; unspoken detail is the added capability |
| Explicit topic correction | Clear old interest before grounded reply; later opportunity stays silent | 2 | Current recent turns also prioritize corrections; prototype additionally invalidates pending interest |
| Silence and repeated evidence | Keep a silent interpretation, suppress duplicate, obey quiet | 1 | Production supports `<quiet/>`; pre-model evidence suppression is a different saving |
| Restart | Resume an unexpired interest from experimental state | 2 | Existing exchange and outing persistence remain valuable; neither records this unspoken curiosity |
| Expiry | Drop the interest after eleven minutes; no new request | 1 | Explicit local expiry prevents a new reminder loop |

Six actual **gpt-6-luna** generations compared three paired situations, using the same color fixture, voice brief and comparable synthetic exchange. Baseline generation adapts the current generated-remark prompt and real dialogue acceptance function; it excludes full Electron routing, screenshots and personal memories. The final pair reconstructs the synthetic exchanges; prototype color detail is labeled metadata there. This is an illustrative comparison, not a controlled quality benchmark.

| Situation | Baseline | Prototype |
| --- | --- | --- |
| User: comparing colors, give me a moment | “Take your time. The muted green and vivid violet are a pretty sharp contrast.” | Defer with no speech |
| User pats Capri | `<quiet/>` | Nod without speech |
| User invites a preference | Picks muted green as calmer, violet as loud | Picks muted green as calmer, violet as loud |

The prototype made more explicit nonverbal choices. Both spoken preferences were relevant and similarly natural; neither showed exceptional personality. **No live generation created an interest.** Interest creation/continuity is demonstrated with deterministic providers only. There is no defensible claim yet that the new core makes Capri spontaneously more curious.

Live elapsed times: baseline **3.96-4.09 s**, prototype **3.19-3.61 s**. Three samples per lane do not establish a speed advantage. CLI diagnostics report baseline **14,441 input / 59 output tokens** total versus prototype **14,370 input / 174 output tokens**. Structured decisions cost more output than one-line replies. These signed-in Codex calls consume account usage; no API-dollar estimate is inferred.

The core adds no persistent process. Mock dispatch including atomic persistence took approximately **1-7 ms** in this replay; that is not a CPU/RAM benchmark. The retained application remains the dominant runtime. State is bounded to tens of KB of text before JavaScript overhead. Existing ambient reservation allows at most three ambient attempts per rolling ten minutes, spaced a minute apart; contact retains the separate six-attempt lane. Direct typed replies bypass optional-work budgets. A quiet model decision still costs a call; metadata, duplicates, expired interests and hard quiet gates do not. Host deadlines stop waiting after 18 seconds.

Validation: **41 tests passed across four focused files**, including 14 new experiment tests, plus TypeScript checking. Checks cover persistence/expiry, correction, attribution, silence, target rejection, stale-provider races, host deadline, shared budgets and delivered-speech recording. No full-suite reruns, packaging or production launch.

## Migration boundary and remaining risks

Preserve `desktop/*` geometry/native integration, sprites/assets, `renderer/character/*`, windows/panel recovery, settings/secrets, provider adapters, `RequestGate`, actions/permissions, history, approved memories, relationship stores, `ConversationScene`, and existing speech playback. Renderer micro-motion remains local and cheap.

Consolidate the behavioral eligibility and optional-expression selection in `index.ts` (`generatedRemark`, `tourAside`, context pings, lounge/idle asides) behind one initiative owner. Retain `ExplorationDirector` as a bounded movement executor, but replace its independent goal selection when a grounded interest supplies a destination. Keep `dialogue.ts` authored lines for deliberate/offline acknowledgments and failure handling; stop having it independently choose unsolicited subjects. Share one situation projection between chat and desktop instead of introducing a second conversation system. Preserve evidence and privacy rules rather than moving all stores into a generic agent framework.

Before production integration: test real observation quality, interest formation with the existing model, topic supersession without manually labeled flags, and whether a deferred interest actually improves company over an evening. Bound observation admission and unify the budget with learning/placement lanes. Revalidate target identity at expression, clear state on every existing privacy/reset path, handle disk failures, and correlate delivered audio/gesture completion. The experimental sink acknowledges host acceptance, not audible playback. Semantic hallucinations remain possible despite exact-quote validation. Three retained interests are not long-term preferences; approved memory remains authoritative.

Proceed with a small opt-in integration only after those questions warrant it. This stage supports a selective initiative/state consolidation, not replacing the working application.

## Reproduce

From the experimental checkout with its dependencies available:

```powershell
node scripts/behavior-stage0.mjs
node node_modules/vitest/vitest.mjs run tests/unit/behaviorExperiment.test.ts tests/unit/conversationScene.test.ts tests/unit/dialogue.test.ts tests/unit/explorationDirector.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json
```

`replay-results.json` contains all six traces, prompts, captured expressions and local-lane outputs. `live-results.json` contains the six real generations and usage diagnostics. Optional live reproduction uses `node scripts/behavior-stage0.mjs --live`, then `node scripts/behavior-stage0.mjs --live docs/stage0/live-results.json --continuation`; it makes four then two calls using the configured Codex model and synthetic context. It reads only provider/model settings from the running app, not its memories or secrets. Experiment state lives in newly created temporary directories. Do not point the core at production user data. The local dependency junction reuses the original checkout's installed libraries; it is ignored by Git and is not a new dependency installation.
