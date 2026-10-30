# Incidental dialogue, 0.2.29

The dialogue director in `src/shared/dialogue.ts` owns pickups, touch, greetings,
returns, local window scenes, touring, perches, arrivals, placement fallbacks,
mute/unmute, exits and offline social replies. Agent actions and ordinary user
conversations keep their existing providers, permissions and history.

## Performance choices

Use Capri's quick changes of rhythm, appetite for experience, cheeky familiarity,
mock innocence, sudden delight and occasional bluntness. Confidence should sound
casual, not like a royal approval ceremony. Sometimes the right reaction is plain
or silent. Vanity, setting slang and digital captivity are not recurring punchlines.

These are original companion lines, not episode dialogue or new canonical facts.
The following references were rechecked on 2026-10-26:

- [Official show context](https://www.cyberpunk.net/en/edgerunners2).
- [Episode 4 community transcript](https://transcripts.foreverdreaming.org/viewtopic.php?t=266325):
  social intrusion, self-correction and conversational familiarity before exposition.
- [Episode 7 community transcript](https://transcripts.foreverdreaming.org/viewtopic.php?t=266328):
  breezy self-interest, impatience, playful deflection and expansive confidence.
- [Episode 9 community transcript](https://transcripts.foreverdreaming.org/viewtopic.php?t=266330):
  gleeful game-like reversals; fictional violence is not a desktop behavior instruction.
- [Episode 10 community transcript](https://transcripts.foreverdreaming.org/viewtopic.php?t=266331):
  ordinary short replies, an offhand joke and curiosity without an obligatory philosophy lesson.
- [Community discussion](https://www.reddit.com/r/Edgerunners/comments/1xbgrfl/season_2_was_peak/)
  and [character review](https://www.reddit.com/r/Edgerunners/comments/1xbtr2v/my_own_season_2_character_review_yap_session/)
  were consulted for audience interpretations, not promoted to canon. Comparisons
  to Rebecca do not mean copying Rebecca's voice. Host-specific family history and
  mixed speaker attribution are not general Capri memories.

The transcripts have incomplete speaker attribution and have not been independently
checked against episode audio. The forum's generic series header is not episode
release-date evidence. Fan companion output, including the recent post authored
by a Capri app, is excluded as a character reference to avoid circular imitation.

## How selection works

1. Resolve the real event and eligible scene conditions, including returning,
   inverted attachment, repeated handling and current mood.
2. Optional moments may stay silent. A shared 18-second minimum speech gap stops
   local scenes, arrivals and tours from talking over each other.
3. Occasionally choose an eligible local context topic instead. Context topics
   have a 12-minute global gap and 45-minute individual cooldown.
4. Choose an authored speech act, then compatible setup/payoff phrases within it.
   A row with many combinations gets no extra selection weight. Recent intent
   and row use reduce their weight; old punchlines and similar openings are excluded.
5. Keep at most 128 delivered lines for 30 days in `dialogue-history.json`.
   This file is separate from approved user memories. Corrupt entries are ignored.
   Exhausted optional dialogue stays silent instead of immediately repeating.

Local phrase slots contain only a preferred name from an explicit approved name
fact. Raw window titles and filenames never enter a local line. App metadata is
classified into broad categories; a music player being open is not proof of playback.
Foreground duration excludes idle/hidden/quiet gaps and does not imply progress.
Window-title continuity stays in session memory only.

## Local context and weather

Clock/day cues use the PC's local clock. Battery uses one cached Windows power
status call per minute, ignoring unknown status and machines without a battery.
Existing window enumeration provides a bounded list of broad open-app categories
once a minute. Active-app continuity is bounded to 32 session entries.

Character settings include **Notice local context** and an optional **Weather city**.
Weather is off when the city is blank; there is no automatic location lookup.
If configured, [Open-Meteo](https://open-meteo.com/en/docs) supplies a small current
forecast. Its [geocoder](https://open-meteo.com/en/docs/geocoding-api) runs once per
configured city, and forecasts refresh at most every 30 minutes. Requests time out
after three seconds each; failures wait for the next scheduled refresh. Ambiguous
cities, unknown codes and stale data do not become dialogue. No weather page or
Windows widget is scraped. The settings credit Open-Meteo. Weather text identifies
its forecast origin rather than pretending Capri sees outside.

## Model and latency cost

Ordinary return greetings, pickups, touch, arrivals and local roaming/perch lines
make no language-model requests. Deliberate drops onto a visible application or
its edge debounce for 1.1 seconds
and may use one contextual request, including a visible-window preview when
supported and enabled local cues. Ordinary and familiar windows qualify. Drops
elsewhere use preset putdown lines or silence. Rapid rearrangements cancel stale
commentary. Deliberate drops have a reserved persisted allowance of four attempts
per ten minutes, separated by at least fifteen seconds, rather than competing with
idle chatter. Failure, provider throttling, quiet output or an exhausted allowance
uses a varied app-aware fallback. The fallback speaks only about the broad app
category, without pretending to have read its pixels. Empty desktop drops remain
local or silent.
Greetings and exits may use one contextual request when
the existing shared budget permits, with local fallbacks. Greetings fall back after
3.5 seconds; exits retain their bounded shutdown deadline. User bedtime is never
inferred from quitting or the clock. Waiting text is display-only, stable for a request/stage,
and never sent to speech or stored as an answer. Ordinary short commands retain
their existing offline action parser.

Occasional evidence-led window observations also use generation. They retain
the existing shared background reservation, spacing, provider and direct-reply
priority. No inspect/question request is sent without a real target. Their compact
performance brief replaces the full biography/memory prompt for this route; the
ordinary chat prompt is unchanged by this inspection route. Context collection
never triggers generation. Regular chat and asides share continuity as described
in CONVERSATION.md.

Generated text must be short and plain. Action markup, stage directions, boilerplate,
near duplicates, title recitals and common app-name announcements are discarded.
Discarding a line never triggers a corrective model request. An observation that
fails validation or cannot be generated stays silent rather than making up a
local observation. Existing stale-target/revision cancellation and quiet gates remain.

## Platform flavor, music and longer outings

YouTube, Discord, ChatGPT, Spotify and ordinary browsers have compatible local
speech acts about their affordances and Capri's preferences. Platform identity
comes from a known process or a website's title suffix, not a word mentioned in
an unrelated article. Local lines never claim playback, private-message contents,
or the user's reasons for changing focus. A background perch never supplies user
activity: only an actual foreground window does. Very brief switches are not
established return history.

Optional song banter reads Windows' Spotify media-session metadata only during an
existing visit or observation opportunity. No continuous polling or Spotify login
is involved. The read runs in a hidden, bounded helper process. It requires a
playing Spotify session with both track and artist, probes no more than once per
five minutes, permits an opinion attempt no more than once per fifteen minutes,
and avoids the same track for two hours. It uses the same optional generation
budget and skips screenshots when track metadata is sufficient. Playback is
checked again before presenting the result; changed or paused tracks are silent.
The line may compliment or lightly jeer, but never claims to hear live audio,
invents lyrics, or assumes a recommendation was deliberately chosen by the user.

Exploration is now a bounded outing rather than a perpetual round-robin. It chooses
a feasible goal from the available places, remembers completed destinations, varies
one to three physical looks, and resumes interrupted intentions without counting
failure as success. A destination has a ten-minute revisit gap. An outing takes
one to three visits, with 40-90 second interim rests. Completed outings rest for
2-6 minutes; settling outings and occasional longer pauses last 8-12 minutes.
Unavailable remaining places end an outing rather than causing a retry loop.
The local director never opens apps or invents what it learned.

`exploration-history.json` preserves up to 32 destination fingerprints, the current
goal and rest deadline, separately from user memories. Raw app/window titles are
not stored there. Visit history expires after a day and unfinished goals after two
hours. Restarting or briefly focusing a different window does not reset the rest.

## Validation

Unit coverage exercises mixed-event variety, restart history, optional silence,
conditional beats, context eligibility/cooldowns, stale and missing signals,
activity accounting, loading stability, title rejection, weather concurrency,
caching and failure backoff. Electron coverage exercises local interaction without
generation, generated-title rejection, persistence, waiting text, real window
placement, exploration, sleep gates and bubble interaction.

Curiosity lines promising a closer look can trigger a cursor visit: glide beside
the cursor, linger 3.5 seconds, then teleport back. The movement itself is local,
has a 90-second cooldown and cancels on user interruption. On return, an occasional
comment can use the actually focused external window's exposed content, with the
ordinary ambient request allowance and a local fallback. It does not misattribute
the companion's perch as the user's focus. Head pats hold the closed-eye cell from
the matching blink strip.

## Inspection and exploration

At the start of an outing, one budgeted visual request can produce both a short
line and up to two interesting regions. Coordinates are validated and mapped from
the exposed screenshot crop. Capri can hover beside a region without covering it,
hold attention there, and linger longer. Points expire after a minute and are
discarded when the target title or geometry changes. No clicking, reading private
messages or autonomous task execution is involved. Codex, Gemini and compatible
vision-enabled OpenAI endpoints receive the image; other providers use metadata.

Local routes vary within visible areas, with gently curved flights, varied pace,
short holds and longer 4.5–15-second inspections. Existing multi-minute outing
rests and saved visit history remain in force. A blocked curve aborts/replans
rather than crossing a covered window. Developer outings use shortened local
holds and no automatic model requests.

## Optional contextual pings

Character settings add **Occasional contextual pings**, alongside **Notice local
context**. Pings use authored procedural lines, never model requests. There are
20 late-night sleep nudges and over 60 total lines across weather, battery and
long-session cues. A global 45-minute minimum and per-category daily caps apply;
late-night nudges occur from 2 AM until 6 AM, at most twice per local calendar day.
They require recent user activity and respect sleep, quiet, focus, game and chat
gates. They do not infer a sleep schedule or nag during a developer preview.

Weather requires an explicitly configured city and fresh cached Open-Meteo data;
the lines identify it as a forecast. A low-battery ping requires real unplugged
battery data. No battery means no battery ping. The optional long-session cue uses
actual foreground continuity, not Capri's own window visits. Ping history respects
Save conversations, clears with chat history and full reset, and retains session
cooldowns when saving is disabled.

## Alternate artwork

**Occasional alternate poses** selects smaller sitting poses for sustained hover,
downward inspection and settling; longer supported rests use upright reclining.
The secondary float is removed. Sitting has ink-black edges, softer red/green and
an angular closed-eye variant. Fine hair sparkle remains. Both poses use a single
localized WebGL rig rather than sliding horizontal bands; the lying art is unchanged.
Reclining needs a clear upright window top, the taskbar, or a supported window
bottom edge. It never appears inverted or as an unsupported mid-air rest.
Speaking, sleep, dragging and travel use the original strips. Pats use the seated closed-eye art when already sitting, otherwise the original blink strip. Preview each
pose and orientation from Developer. See assets/capri/secondary/SOURCES.md for
artwork provenance and adaptations.


