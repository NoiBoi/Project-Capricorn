# Stage 1: integrated behavioral core

Implemented on `experiment/behavior-stage1`, building on Stage 0's hybrid decision. This is integrated application code, not a second standalone prototype. The original `capri-lachy-integration` checkout remains unchanged and recoverable. No installer or production profile was modified.

## What changed

`src/main/behavior/core.ts` is the single owner of optional behavioral decisions. The Stage 0 harness imports that same implementation through a compatibility export; it has no separate live engine.

Desktop events, placements, touch, touring stages, arrivals, activity, local-context opportunities and idle opportunities now feed this owner. It combines recent observations, tentative interpretations, short-lived interests, approved memories and the existing shared exchange. Outcomes are silence, deferral, gesture, speech or investigation. Most foreground collection and local physical activity use no model call. Eligible contextual decisions use one bounded generation, not separate observation, planning and expression calls.

`index.ts` now collects native context and executes decisions. Its former `generatedRemark` body has become an observation/dispatch adapter. It no longer independently picks an acting angle, generates a line, selects a fallback and infers movement from the line's wording. Touring, lounge, activity and context-ping routes no longer volunteer unrelated authored subjects. One candidate is selected per presence tick, with pending interests taking precedence.

Movement remains with the existing exploration/teleport executors. Interests bias the chosen window. A proposed outing proceeds only after an investigate decision, or a cheap local approval when visual context/dialogue is disabled. Model-selected investigation can watch a target and request movement, but respects exploration settings, explicit placement, rest/cadence, geometry, occlusion and interruption checks. It cannot click, type or bypass desktop permissions. Automatic teleport and theatrical initiative yield to current decisions/interests. Scripted theatre retains authored lines outside an active exchange.

## One situation, existing conversation

The core adds only observations, tentative interests and a compact decision journal in `behavior-state.json`. User statements and delivered dialogue stay in `ConversationScene`; completed desktop actions stay in `CompanionScenes`. Approved user memories, tastes and project threads retain their existing stores. Chat reads the same situational projection and pending interests through its existing companion-context hook.

Bounds: eight observations, three interests, and 32 journal entries. Observations and interpretations expire after 15 minutes; an interest lasts at most ten minutes without new evidence. A changed document in the same native window invalidates its old interest. Missing targets are dropped before later decisions. Source IDs and exact supporting substrings prevent interests being detached from their evidence. For screenshots, the source quote identifies the captured artifact; the model's description remains an uncertain visual interpretation, not verified OCR. Image bytes are not persisted in this store.

Physical contact keeps its immediate renderer cue. It cancels older optional work before any model request. A contextual pat can retain an unfinished interest while continuing Capri's last position. Typed/voice conversation also cancels optional work, receives the pending context, and takes over the thought when its answer is delivered. Explicit correction/topic-change wording invalidates older tentative interests immediately. Arbitrary semantic topic detection remains model/context driven, rather than pretending a keyword rule understands every correction.

## Reliability, privacy and fallback

Direct interactions preempt optional work. Revision, exchange, target identity and visibility checks reject obsolete results. Collection is coalesced as well as generation, so a presence pulse cannot start overlapping screenshot requests. Spotify metadata is rechecked before expression. There is a shared quiet gap and the existing persisted `BackgroundBudget`; direct chat keeps its existing provider and action pathways. No background inference loop or new runtime dependency was added.

Sleep, DND, quiet hours, focus, fullscreen/hidden state, user absence and interaction settings gate decisions and expression. Existing provider support and request prioritization remain. The existing Gemini image adapter is retained alongside ordinary provider streaming. Model or validation failure gives touch a local gesture and optional observation silence. Offline mode retains authored acknowledgements and local movement without fabricated perception. Dialogue validation can now run without prematurely committing a line to replay history.

The existing scene recorder is the only production delivered-dialogue writer. Suppressed output is not stored as an experience. Bubble-visible speech is recorded on display acceptance. Voice-only speech is recorded on its renderer start acknowledgement; cancellation clears pending acknowledgements. This preserves voice with speech bubbles disabled. A decision journal's delivery flag means host acceptance, not a guarantee of complete audio playback.

The new file persists only with memory and saved history enabled. Existing chat clear, current-exchange clear, memory clear, reset, privacy changes and off-the-record input clear/cancel the relevant situational state. Off-the-record content does not enter the new store or a contact-generated continuation. Persistence failures leave the in-memory companion usable. Existing approved memory/history formats are unchanged.

## Demonstrated lifecycle

The Electron integration test admits a real application observation through the placement adapter, with a deterministic provider:

1. A color-study window is observed. The core interprets a possible curiosity, creates a cited interest and deliberately defers. No delivered line is recorded.
2. The application restarts. The same unexpired interest is loaded.
3. The real touch handler emits its physical cue immediately while the delayed provider is still pending. Its later line continues the color curiosity and enters the shared exchange exactly once.
4. A direct correction changes the subject to shape. It cancels optional work and clears the prior interest before the ordinary conversation reply.

Other checks cover late target/DND suppression, provider failure/offline behavior, stale observations, expiry, evidence validation, deadlines, shared budgets, privacy clearing, and cancellation during final media validation. A local fallback acknowledgement is also tested with both output channels disabled to ensure suppression creates no delivered experience or replay-history entry.

Validation on the final implementation: TypeScript checking, a development bundle, **57 targeted unit tests**, and **six mocked Electron tests**. A separate live Electron check used three generation opportunities with the configured **gpt-6-luna**, synthetic user-described context, isolated data and TTS disabled. No full-suite run or installer packaging.

The live sequence selected vivid violet, maintained that position through the pat, then answered the quiet-company correction plainly. Its pat line added an unsupported reference to a room. This demonstrates topical continuity, not perfect grounding or proven spontaneous curiosity. The prompt now explicitly excludes inferring a room or project purpose from a vague title; that wording change has not received another live quality sample. The captured sequence is in `live-results.json`.

## Module boundaries

| Replaced or consolidated | Reused |
| --- | --- |
| Optional generation, cancellation ownership and short-lived interests: `behavior/core.ts` | `Conversation`, `ConversationScene`, approved memory and relationship stores |
| `index.ts` generated remarks, local touring/lounge/activity speech and context-ping selection | Windows observations, exposure checks, perching, exploration and teleport execution |
| Speech-wording-triggered curiosity movement | Character cues, sprite assets, animation, speech bubbles and voice engines |
| Premature dialogue-history commits during filtering | Authored fallbacks, dialogue validation, `BackgroundBudget`, `RequestGate` |
| Competing optional initiative while another intention is active | Settings, provider adapters, secrets, desktop actions, permissions and injection boundaries |

## Stage 2 gaps

The important remaining uncertainty is behavioral quality over ordinary desktop use. Three live generation opportunities do not prove better curiosity, natural timing or less repetitive dialogue over an evening. Test spontaneous interest formation and whether follow-ups are welcome, with actual exposed-window imagery rather than only fixtures. Semantic correction handling and visual interpretation still rely on model judgment; source attribution validates provenance, not the truth of every description. Low-level movement, geometry and renderer micro-motion intentionally remain deterministic.

Audio playback and all model providers were not exhaustively exercised live; the focused integration checks used OpenAI-compatible mocks and signed-in Codex. Interest/decision expiry, data clearing and movement safety were exercised in isolation, not through a new packaged release. This branch is ready for review and controlled use before a Stage 2 release decision.

## Reproduce the checks

From this checkout:

```powershell
npm run typecheck
node node_modules/vitest/vitest.mjs run tests/unit/behaviorCore.test.ts tests/unit/behaviorExperiment.test.ts tests/unit/conversationScene.test.ts tests/unit/dialogue.test.ts tests/unit/explorationDirector.test.ts
npm run build
node node_modules/vitest/vitest.mjs run tests/e2e/behaviorCore.e2e.test.ts tests/e2e/conversationScene.e2e.test.ts --no-file-parallelism --testTimeout=60000 --hookTimeout=60000
```

The optional real-provider test is skipped by default. Setting `CAPRI_STAGE1_LIVE=1` and selecting only its `reviews three real` test runs three generation opportunities in a temporary Electron profile. It reads only the configured provider/model from the existing settings; it does not copy personal memories, history or secrets into that profile.
