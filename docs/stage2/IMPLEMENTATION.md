# Stage 2: persistent character identity and memory

Implemented on `experiment/behavior-stage2`, based on Stage 1 commit `9b88880`. The existing installed app, original checkout and production data remain unchanged. This extends the existing stores and behavioral core; no external database, agent framework, embedding service or runtime dependency was added.

## What Capri remembers

`CompanionScenes` now retains selected shared experiences alongside its existing recent delivered scenes. An episode contains exact, dated source evidence, its speaker/origin and reliability, a tentative interpretation, an optional unresolved question/want, and an actually delivered response when available. Routine movements and touches remain recent events rather than automatically becoming episodes.

The behavioral model can propose an experience in its existing decision response. A cited interest is also a candidate. Promotion requires an actual supplied source ID and exact supporting substring; missing, stale, private or sensitive evidence is rejected. A screenshot capture can ground a *tentative visual interpretation*, not prove the truth of an inferred detail. Model descriptions, retrieval tags and user statements never become verified external facts.

Conversation learning can select meaningful developments in the **existing** background extraction call. It does not add a new reflection call or enqueue every gesture. User facts remain in `MemoryStore`; Capri's preferences remain in `RelationshipStore`; project progress remains in existing threads. Delivered dialogue stays in `ConversationScene`. The episodic store adds the connection between evidence, interpretation and an unfinished interest, rather than copying whole conversations.

`companion-scenes.json` uses a version-2 envelope containing the old recent list, episodes and forgotten-source markers. Legacy arrays are read and preserved under `recent` on the next save; the migration is tested. Existing taste and history formats remain readable, with optional evidence/private metadata added. Old binaries do not understand the new scene envelope, so deploying or rolling back a packaged release needs to account for that format change. No production migration was performed here.

## Bounded intentions and recognizable preferences

An episodic want survives invocations and restarts for **48 hours from its source event**, not from a delayed reflection. Repeated sightings do not renew it. New evidence can explicitly replace an open intention without extending its deadline. Correction, resolution, dismissal and expiry remain distinguishable; the original supporting source is retained when the bounded evidence list is trimmed.

These wants supply context when a relevant event occurs. They do not create timers, reminders or independent model wake-ups. The short-lived behavioral interest is an active projection; once promoted, it is not duplicated in the persisted behavioral state. Existing ten-minute behavior remains available when automatic learning is disabled.

Delivered questions are marked as asked. Optional decisions cannot repeat a related dismissed, expired, resolved or already-asked question. Current user corrections outrank earlier interpretations. A topic change supersedes the previous episode; a factual correction remains visible as newer attributed evidence. An explicit user invitation can reopen an interest.

Preferences retain up to six distinct supporting delivered utterances. Replaying one source does not manufacture more evidence. A manually edited preference cannot be overwritten by a model's contradictory preference. No relationship score, emotional simulation, fictional offline thought or autonomous task planner was introduced.

## Retrieval and subsequent behavior

Both chat and autonomous decisions retrieve up to **three** relevant episodes, bounded to **4,200 serialized characters**. Ranking combines existing lexical evidence, simple word normalization, a small local concept vocabulary, optional topic tags and application process identity. A window's temporary handle is not stored in an episode. Thus an application can be recognized after restart with a different handle, while its old contents remain historical rather than claims about the current screen.

Older chat recall keeps exact dated excerpts and adds concept matching when lexical matching fails. The normal lexical path remains available without an index. This is **concept-assisted local retrieval, not general embedding-based semantic search**.

`scripts/continuity-recall.mjs` compares the actual Stage 1 recall function against the new function on six fixed cases: graph, color and music paraphrases, an exact project reference, an unrelated question, and an unfamiliar paraphrase. Expected results improved from **2/6 to 5/6**. “Sculpting sandbox” referring to a Blender mesh still failed. These are illustrative fixtures, not a general recall benchmark; embeddings might help that remaining vocabulary gap.

The architecture follows the verified Stage 0 [YUI/Hermes separation of events, readings and wants](https://github.com/yw0nam/YUI/blob/66a9869441e3916e073d4a8937befda30e41c9a9/integrations/hermes/desire/README.md). [SQLite-vec](https://github.com/asg017/sqlite-vec) supplies vector storage/search, which would still require supplying embeddings. [Mem0's implementation](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py) uses embedding and model-extraction paths; adding those alongside Capri's existing extraction was not justified by these cases. [Letta's documented persistent-agent harness](https://github.com/letta-ai/letta-code/blob/main/README.md) is broader than the required store extension. No comparative runtime benchmark of these projects was attempted.

## Controls, privacy and correction

The existing Memory page now shows shared experiences, evidence, reliability, dates and want status. It provides **Correct**, **Resolve**, **Drop interest**, **Forget experience**, and **Clear shared experiences**. The narrow-window layout was rendered and checked.

Forgetting cancels pending work, removes linked current-exchange entries and excludes remembered source IDs from subsequent history retrieval and reflection. Deletion markers are bounded to 512 opaque source IDs. Clear/reset and memory/history privacy controls include the new records. No new destination receives private history.

Off-the-record user messages and their replies now stay session-only in history as well as being excluded from scenes, episodes and learning. Legacy off-the-record pairs are filtered from recall without rewriting their original text. This closes a pre-existing gap where the short-term scene excluded a private exchange but the chat archive could still surface it later.

## Verification

| Requested continuity scenario | Evidence |
| --- | --- |
| Earlier curiosity revisited | A silent graph interest is restored and included in a later application visit |
| Opinion remains recognizable | Repeated delivered preferences retain distinct sources; live violet preference survives restart |
| New evidence changes interpretation | New user correction is dated and preserved ahead of the earlier visual interpretation |
| Question becomes irrelevant | Dismissal and source-based expiry survive restart; repeated sightings cannot revive them |
| Contact and conversation share context | The real touch handler receives the persisted episode after restart |
| Indirect older reference | Local graph/color/music paraphrase cases return the original attributed excerpts |
| Restart continuity | A new native window handle still retrieves the same application episode |
| Correction, clearing or privacy | Memory controls, stale-extraction guards, deletion markers and private-history exclusion are tested |

**110 targeted unit tests and eight mocked Electron tests pass**, along with TypeScript checking and the development build. No full-suite run or installer packaging was performed.

Four real `gpt-6-luna` generation opportunities were used. The first three maintained vivid violet through restart and a differently worded question, then selected a nonverbal pat response. One additional check supplied no earlier chat/history: the model recovered vivid violet from the captured episode alone. The test promoted an actual delivered opinion using its exact quote; it does **not** establish spontaneous episode selection or spontaneous preference development. Automatic selection/reflection and repeat-prevention are covered with deterministic providers. Captured results are in `live-results.json`.

## Cost and remaining gaps

Storage is bounded to 64 episodes, four source excerpts and three interpretations per episode, the existing 96 recent scenes, and the deletion markers. Episodes honor shorter history retention and otherwise expire after at most 90 days; wants expire much sooner. Retrieval is local over bounded episodic data. There is no model download, vector index, permanent worker or continuous inference loop. More contextual text and optional structured output can increase tokens in existing requests; no additional per-event reflection request is introduced.

Remaining uncertainties are everyday selection quality, false or missed concept matches, semantic correctness of model interpretations, and long-archive retrieval latency. The live sample establishes a working recall path, not an evening-long quality result. Existing provider, Windows, rendering, speech, permission and user-data systems remain intact.

Reproduce the six-case recall comparison with `node scripts/continuity-recall.mjs`. The new focused tests are `tests/unit/episodicContinuity.test.ts` and `tests/e2e/continuity.e2e.test.ts`; live cases are skipped by default and require explicit environment flags. All integration checks use temporary profiles.
