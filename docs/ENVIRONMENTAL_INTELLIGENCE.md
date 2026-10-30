# Stage 3: environmental interest and character continuity

Implemented in version 0.2.46, 2026-10-27.

Capri can keep an unresolved visual interest, quietly look at a sustained view,
prefer that subject on a later safe outing, and use the same dated reading in
ambient remarks, touch responses and direct conversation. Time passing alone no
longer requests an idle question. A new app category never establishes a task,
an intention, progress, or detailed knowledge of the content.

## How it works

`EnvironmentalCuriosity` in `src/shared/curiosity.ts` adds a small local decision
layer to the existing foreground sampling and exploration director. It does not
add an observation service, screenshot loop, model polling or computer control.

- A foreground subject must remain stable for 12 seconds before familiarity or
  a glance is established. Four switches in a minute suppress curiosity decisions.
- A selective inspection needs 30 seconds of stability, the configured remark
  interval since startup/interaction/foreground attempt or recent generation,
  enabled idle remarks and interaction lines, and the existing interruption gates.
  A new view may merit one inspection to find out whether it contains anything
  interesting; novelty is not proof that its contents are interesting.
- The same uninterrupted subject is not repeatedly inspected. A return can
  revisit a still-fresh unresolved visual question, with a ten-minute per-subject
  attempt gap. Failed attempts also consume the local gap. Glances require no model.
- An inspection returns a spoken line or `<quiet/>`, up to three visual facts,
  a separate tentative interpretation, one optional unresolved curiosity, and at
  most two visual interest points. These are model descriptions of the exposed
  crop, not independently verified facts. There is no requirement to ask a question.
- Existing tours can float beside validated points and favor a subject with an
  open curiosity. Existing safety, occlusion, placement revisions, user touch,
  cursor separation, abort and rest handling continue to control movement.
- A quiet inspection can still supply points and a reading. It creates no spoken
  scene or synthetic shared conversation. Actual delivered remarks still enter
  the existing shared history. Direct responses receive relevant current/watched
  readings and the same character identity.

Before accepting an inspection, the target must still exist with the same title,
the window geometry must match its capture geometry, the crop must still be
exposed, and the placement and conversation revisions must match. Interrupted or
superseded results do not become interests or movement targets.

The session table holds at most 32 opaque subject hashes, expiring after two
hours without observation. Visual evidence, interpretations and open curiosities
stop entering prompts or influencing destinations after 15 minutes. Screenshots
and raw titles are not stored in this table. There is no new persistent user
memory. History clearing, reset and disabling local context clear the table.
Developer previews do not add environmental readings.

## Character evidence and adaptation

The existing dossier and `capriVoice.ts` source manifest remain the evidence map.
This pass re-read the linked English community transcripts for episodes
[4](https://transcripts.foreverdreaming.org/viewtopic.php?t=266325),
[7](https://transcripts.foreverdreaming.org/viewtopic.php?t=266328), and
[10](https://transcripts.foreverdreaming.org/viewtopic.php?t=266331), and checked the
[official series page](https://www.cyberpunk.net/en/edgerunners2).
Community captions are secondary evidence with incomplete speaker context; the
official clip was unavailable through the fetch tool, so no fresh audio
verification is claimed. No new biography or show quotation was added.

The shared compact character core turns existing scene analysis into motives:
unfamiliar mechanisms, strange visual choices, self-directed experience,
confidence, occasional impatience and plain sincerity. Opinions and curiosity
must attach to a specific detail. Ordinary answers and silence remain valid.
The new core is shared through `CAPRI_SCENE_VOICE`; it does not add example
dialogue, alternate personalities, conversation modes or a new chat interface.

## Bounded cost

The local decision layer uses no provider calls. New foreground inspection
opportunities have a five-minute local minimum in addition to the user's longer
remark interval, a ten-minute same-subject revisit gap, and all existing shared
limits. These are ceilings, not a speech schedule or engagement target.

The existing persisted `BackgroundBudget` is unchanged: at most three ambient
attempts per ten minutes inside a shared five-attempt background ceiling, with
separate existing placement and touch lanes. The existing ambient generation
cooldown remains two minutes. Budget denial causes no screenshot or model call.
Only supported configured providers receive an exposed crop from the existing
960 by 640 thumbnail pathway. One response supplies speech, reading and points;
there is no second analysis call. Gemini/OpenAI inspection output is capped at
380 tokens and the existing request timeout/cancellation remains in effect.
The existing Codex request lane, timeout and provider cooldown remain unchanged.

## Validation and observed examples

The focused unit scenarios cover rapid switching, returning to a subject,
continuing an unresolved curiosity, touch interruption, silence despite an
available inspection, expiration and a simulated hour of quiet work.
Electron integration checks cover quiet readings reaching direct conversation,
one-image/one-request inspection, and rejecting a target changed during generation.

`scripts/verify-environment-live.mjs` makes exactly three application requests
using the configured Codex chat model, an isolated profile and a synthetic diagram.
It uses neither user screenshots nor saved user history, and disables automatic
memory learning and TTS in that profile. The actual run produced:

1. Visual observation: "Oh, that branch slips right out of the enclosure. I like
   how the bright loop makes the breach look almost deliberate."
2. Separate open curiosity: "I wonder what changes if the branch exits through a
   corner instead." This was kept as an interest, not spoken as a question.
3. A head pat chose `<quiet/>`, preserving the interest without starting a new topic.
4. The single subsequent direct reply considered a deliberate exit route versus
   a mistake, and correctly answered 17 times 24 as 408.

These examples demonstrate grounding, opinion, continuity and restraint. Three
calls are a limited character sample, not proof of consistent show-level acting.
Returns are recognized by process/title identity, so retitled tabs can be new
subjects and unseen changes inside an unchanged title are not automatically
detected. Long-term tastes still come from existing approved memory and shared
conversation; this new environmental table lasts only for the running session.

Final validation: type checking, 428 unit tests, and three focused Electron tests
against both source and the packaged build passed. A broader selected desktop
run passed 34 checks and failed four existing assertions: foreground look reply
includes a window title, inspection waits until settling, a late-night ping
always speaks, and quiet generated drops always receive local fallback speech.
All four failures reproduced against the pre-change main application bundled
with the same dependencies and test harness. They were not hidden or rewritten
to make this change appear green. This was not a complete all-desktop-suite pass.
