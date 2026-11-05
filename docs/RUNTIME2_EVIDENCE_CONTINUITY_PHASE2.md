# Runtime 2 Phase 2: evidence and conversation continuity

Base: `636939ad9ab3cb57926ff39e893cf776b44980bc`.
Branch: `fix/runtime2-evidence-conversation-continuity`.

This repair follows both November 5 architectural audit passes and
`RUNTIME2_BEHAVIORAL_BOUNDARY_PHASE1.md`. The extra-high audit's reproduced
escalation, focus-change and assistant-only dialogue omissions are the acceptance
targets. Its proposals for additional opportunity generation, event routing,
failure recovery and model experiments remain outside this phase.

## Verified causes

1. `CognitiveLoop.drain()` excluded observation records from journal recovery and
   injected immediate semantic excerpts only on round zero. `images.splice()`
   consumed image attachments. An investigation record preserved its question
   and evidence IDs, but the next actual model input lost the preceding text and
   pixels. Reacquisition was possible but consumed another tool continuation.
2. Browser focus changes remove the previous page from `Perception`'s live
   projection. Archive scene projections intentionally omit text and sections.
   The old selector ranked these projections without expanding originals, so an
   archived, recently visited page could supply only metadata.
3. `selectAmbientDialogue()` started from user anchors rather than retaining
   recent assistant records. `dialogueExchange()` rejected a hit with no earlier
   user turn, and rejected oversized surrounding exchanges. Journal persistence
   consequently did not establish selection of Capri's expressed view.
4. Completed-task and stale-checkpoint filtering ran only on the lean route.
   Ambient deep continuation rebuilt a broader history without the same status
   semantics.

## Implementation

- `evidenceSelection.ts` is a bounded selection helper over existing archive
  originals. It adds no store, queue or scheduler. It ranks explicit active-state
  evidence, currently visible content, unhandled changes and related revisions
  before recency. Only current, relevant or unhandled semantic candidates are
  expanded. There are at most four candidate resolutions and two excerpts per
  round; duplicate semantic bodies are rejected.
- `workingObservations.ts` shares a 3,000 UTF-8-byte semantic body allowance
  between text and sections, rather than repeating both. Changed sections remain
  preferred. Identifiers remain unchanged; bounded metadata and a truncation
  marker point to deliberate recovery. Selection rejects any resulting record
  over 8,000 serialized UTF-8 bytes. Two records therefore contribute at most
  about 16 KB before wire encoding and array overhead.
- The loop retains only the actually supplied initiating semantic and image IDs,
  at most two of each, for that cycle. Every continuation resolves semantic
  originals again, reapplies retention and disclosure checks, and supplies their
  bounded content. Source revocation or pruning prevents a cached payload from
  returning. A non-retained live observation remains eligible only for its
  immediate request; it is not copied into another store.
- Observation records explicitly encode `current` or `historical`. A recently
  visited page is not promoted to current merely because its window handle is
  foreground. Images retain their original observation ID and capture time and
  retain the existing historical-pixels warning.
- The first deep continuation can automatically reuse one initiating image,
  prioritizing an investigation's referenced image. Later rounds receive
  authorized observation references and can deliberately call `retrieve_evidence`
  for additional pixels. The existing two-image per-request allowance, image
  headroom reservation and six-request/five-executable-round ceiling remain.
- Full tool results and initiating excerpts are not inserted twice for the same
  evidence. If the context assembler evicts the larger tool exchange, the small
  initiating excerpt is reconsidered under the same budget. No context allowance
  is raised. Tool-result references are checked for continuing archive
  availability as well as current permission before reuse.
- Recent assistant records enter dialogue selection directly. Existing subject
  search can recover older opinions. Anchorless and oversized-exchange recovery
  returns the selected journal record with its original sequence and speaker.
  Selection preserves a user and following reply together, treats later asides
  independently, clips long selected text with an original-ID recovery marker,
  and enforces 12 records / 4,500 serialized bytes.
- Ambient ordinary and deep requests use the same dialogue and completed,
  abandoned and retired investigation filtering. Explicit retirement cannot be
  overridden by search relevance. Stale task checkpoints stay out of active
  state on both routes. Conversation permission also gates selected dialogue and
  canonical records supported by dialogue. The context policy explains that
  prior views supply context, need not be repeated, and create no required
  callback on an unrelated subject. Silence requires no additional memory write.
- The revocation fixture exposed an acknowledgement race: source deletion purges
  the observation journal while an inference can still acknowledge that prior
  window. `forgetSource` now advances the existing scene cursor over the purged
  window before deletion. No new cursor or persistence mechanism is introduced.

## Diagnostic receipts

The existing recorder now emits concise `evidence.selection` events containing
the round, candidate IDs, actual metadata IDs, actual semantic representations
and current/historical labels, tool-evidence IDs, selected dialogue IDs, attached
image IDs, initiating IDs, semantic byte count, selection-resolution count and
context-budget omissions. Selection reasons distinguish relevance, unhandled
changes, duplicate content, permissions, known retention expiry, unavailable
archive records and selection/byte limits. An unavailable archive record may
have been revoked or pruned; the receipt does not invent a more precise cause.

These receipts contain identifiers and counts, not another copy of the content.
Existing observation-retention events, scene coverage, `context.selection` and
the assembled/wire inspectors establish retention versus actual model delivery.
Diagnostic privacy controls and image-file deduplication are unchanged.

## Verification and measured overhead

- Focused unit/worker integration tests: **75 passed** across
  `evidenceContinuity.test.ts`, `twoSpeed.test.ts`, `cognitiveLoop.test.ts` and
  `runtime2Integrated.test.ts`. Sixteen tests are new continuity regressions.
- Targeted Electron integration: **2 passed**, `runtime2Cognitive.e2e.test.ts`
  and Phase 1's `runtime2Delivery.e2e.test.ts`.
- `npm run typecheck`, `npm run build` and `git diff --check`: passed.
- No exhaustive suite, live SIWC inference, provider change or inference-cadence
  change was used. All providers were deterministic fixtures. Normal and
  daily-test profile data were untouched; temporary synthetic fixtures were
  cleaned up. The unrelated untracked `docs/DEVELOPMENT_SETUP.md` was preserved.

Measurements use actual encoded fixture inputs and UTF-8 bytes / 4, not a model
tokenizer or reported provider usage. They measure marginal evidence content,
not a claim of net savings against a live baseline.

| Fixture | Observation |
| --- | --- |
| A then B through the real browser focus path | A's historical excerpt adds approximately **320 text tokens**; two semantic records reach the first request. A is not fetched again on an unrelated acknowledged cycle. |
| Large multilingual semantic body | One bounded record adds approximately **937 text tokens**: 4,566 with it versus 3,629 with that record removed from the same encoded request. Text and sections are not duplicated. |
| Text X and image Y, then escalation | X and Y both reach the first deep input. **Zero reacquisition tool calls** are needed in the fixture. Each request contains one semantic record for X. |
| Six-request stress cycle, two initial images | Image submission counts are **2, 1, 0, 0, 0, 0**. Total automatic image submissions are three, one above the initial two. The referenced second image wins reuse priority. |
| Same stress cycle: estimated complete request text | Approximately **4,566; 5,828; 5,852; 5,975; 6,098; 3,726** tokens. These include identity, tools, state and history; deep tool schemas account for part of the route difference. |
| Retrieved full observation plus initiating excerpt | **Zero duplicate excerpts** for evidence already supplied in a retained tool result. After permission withdrawal, both the excerpt and tool payload are withheld. |
| Near context limits | Oversized tool exchanges are evicted; the initiating excerpt survives when it fits. At a budget below excerpt admission, it is omitted. Limits and the final tools-empty request remain enforced. |

Image token usage and monetary cost are **unmeasured** because fixtures do not
contact a model. The new automatic image overhead is bounded to one attachment
per escalating cycle. Existing context admission reserves 8,192 capacity units
per attached image; that reservation is not an estimate of actual image billing.

One existing test expectation changed: a textless browser observation now counts
as metadata, rather than misleadingly counting as full semantic delivery.

## Remaining limits and real-model acceptance

- Only two semantic observations and one automatically reused initiating image
  can cross this boundary. Other originals require deliberate recovery. The
  selection window is the existing bounded scene sample; not every archived page
  is automatically expanded. A tiny context allowance can still omit evidence,
  and unusually large metadata can cause an excerpt to be skipped.
- Retention expiry is distinct from live freshness expiry. Content that remains
  retained and authorized can be historical evidence after it stops being a
  current observation. Removed originals never gain authority from an old ID.
- Relevance uses existing source/state references, scene changes and dialogue
  lexical search. Deterministic success establishes that evidence reaches the
  request, not that a model notices its important detail or chooses good work.
- The journal still records generated assistant text without a presentation
  receipt on each record, as documented in Phase 1. This phase does not claim
  that every recovered line was actually seen or heard by the user.
- In an attended real-model trial, confirm that Capri uses X/Y without redundant
  retrieval, describes page A as historical after switching to B, and recovers a
  prior opinion when its subject returns. Confirm that an unrelated activity
  proceeds without a forced callback, silence does not cause repeated remarks,
  and completed work stays completed after escalation. Measure actual image
  usage, total token cost and investigation quality before claiming efficiency
  or behavioral improvement.
- Runtime 2 remains development-only. No version bump, installer, installed
  application replacement, shortcut change or live behavioral validation is
  part of this source delivery.
