# Capri Buddy: private artwork integration

## 0.2.42 calmer behavior and stable lying dialogue

Disables mask-only sleep, satellite scenes and window possession by default, and removes spin choices from ordinary movement and developer controls. After a fall, the original standing art stays for 6-10 seconds, followed by 25-45 seconds of original sitting; supported rest can then sometimes include lying. Direct lower-edge drops keep the existing lying behavior. A fixed lying silhouette envelope and contact display now anchor dialogue placement, so animated head/hair motion and facing reversals no longer make the text window jump. TypeScript, 396 unit tests and nine focused renderer checks pass.


## 0.2.41 construct life and desktop spectacles

Keeps the existing original sprite strips and adds original-art reaching, expressive cel-timed movements, split afterimages, window-loss falling/landing, deep sleep into a mask and re-forming, a staged satellite/red-light sequence, exposed-window possession, harmless cursor lightning, and additional reaction cut-ins. Relevant original dialogue uses the existing local procedural engine and repetition history. The satellite day and separate scene cooldowns survive restarts.

Large moments respect quiet company, chat, games, sleep, and lounge holds; manual tray scenes can override the lounge hold. Each feature has its own switch. Temporary scene windows are unfocusable and click-through, with target revalidation, exposure clipping, cancellation, renderer-failure recovery, and a hard lifetime. Reduced motion suppresses added body deformation, star travel, scanning and bolts. No desktop content capture, actual cursor input, or extra model calls are added.

See [Construct moments](docs/CONSTRUCT_MOMENTS.md) for timing, controls, design boundaries, source credits and validation scope. The new motion uses existing artwork pixels at the existing scale; the current upstream body renderer is not substituted.


## 0.2.38 intermediate sitting size

The sitting and closed-eye sitting display scale increases by 50% from 0.2.37,
while remaining capped inside the available window. This is an intermediate size
between the original oversized fit and the overly small primary-width match.
Seat contact, softer colors, artwork and lying size are unchanged. Mane sway, breathing and leg/ankle motion are now more visible at desktop size. The developer panel adds a still/animated comparison and actual renderer status, including reduced-motion and static fallback. Renderer status is sent only when it changes.

## 0.2.37 purposeful sitting and supported lying

Sitting v2 now matches the measured visible mane width of the primary perch art,
rather than filling the window, with ink-black edges,
softer red/green saturation, fine retained hair sparkle and an angular closed-eye
variant. The redundant secondary float has been removed from runtime assets and
developer controls. The lying image and its colors remain unchanged.

The sliding-band idle implementation is replaced by a single-pass WebGL cutout
rig with localized mane lag, a seated leg swing, reclining ankle motion and subtle
breathing. Face/contact regions are kept stable, textures and uniforms are reused,
and missing graphics support falls back to still art. Reduced motion suppresses
deformation. No model requests or extra desktop sampling service are introduced.

Pose selection now follows deterministic scenes: sustained hover selects sitting
after 1.8 seconds, a longer hover closes the eyes after 3.2 seconds, and a sustained
downward inspection selects sitting after 0.7 seconds. A short hover latch keeps
the interaction alive when the smaller pose moves away from a stationary cursor.
Sitting can also be an intentional floating gesture; lying always requires a real
supported surface. After 18 seconds of uninterrupted supported rest, lying can
hold for 75 seconds before a shorter primary-art break.

Main-process support checks allow lying on a clear upright window top with room
above, the taskbar, or a window bottom edge. Inverted perches and unsupported air
cannot select it. Even an explicitly inverted developer lying preview is shown
upright. Developer adds open/closed sitting and hover, inspection and supported
lying scenarios, with an explicitly compressed rest clock for the latter fixture.

Validation: TypeScript, 387 unit checks and focused source Electron checks passed,
including the shader path, pose timing, real stationary hover, actual support and
inverted restrictions. Eleven final packaged Electron checks passed.

## 0.2.36 responsive drops, curious outings and alternate poses

Deliberate drops onto visible application content or a window edge now produce a
contextual remark or a varied app-aware local fallback. Drops debounce for 1.1
seconds and reserve a bounded four-per-ten-minute generation allowance, spaced
by at least fifteen seconds. They can interrupt optional background generation;
quiet, offline, limited and failed responses no longer leave a normal drop silent.
Empty desktop drops remain procedural or silent. Quiet/sleep/game/chat gates stay
in force. No tab title is read aloud as a template slot.

Curiosity cursor visits now follow through with an occasional comment about the
actually focused external window after returning. Outings use variable holds,
gentle curves and varied pace, with longer pauses at some stops. One optional
visual request can supply both a short Capri reaction and up to two validated
regions of interest in the exposed crop; safe nearby approaches give those details
a closer glance. Stale/moved-window observations are discarded. No application
control or separate model call per movement step is introduced.

Optional procedural pings add twenty late-night sleep nudges and over sixty total
lines for reliable weather, low battery and long foreground sessions. Global
spacing is at least 45 minutes; late-night nudges are limited to twice per day,
from 2 AM until 6 AM, while the user is active. Weather still requires an explicitly
configured city and fresh cached data. Ping persistence follows history controls.

Occasional sitting, reclining and floating secondary artwork adds gentle local
mane animation. A palette-reference imagegen pass matches the existing strips'
hot-pink/crimson, green and violet outlines while retaining fine hair sparkle.
The original strips remain unchanged and primary for speech, pats, sleep and
movement. Character settings expose alternate poses and contextual pings.

The dev panel adds upright/inverted secondary previews, closed-eye pat variants,
cursor visit/return, quick and held window-motion scenarios, fallback dialogue,
contextual ping fixtures and shared-history inspection. Clearly labeled live
contextual checks can make one normal-budget request. All other preview controls
stay local; preview activity does not enter shared relationship history.

Validation: TypeScript, all 380 unit checks and twelve focused source Electron
checks passed. A prior live GPT-6 Luna chart smoke check produced a grounded line
and the correct two visual interest points. Fourteen final packaged Electron checks passed, including corrected artwork,
drop fallbacks, visual inspection, cursor follow-through and history controls. Artwork provenance: assets/capri/secondary/SOURCES.md.

## 0.2.10 reply priority and background learning

The foreground reply no longer awaits memory extraction. A bounded in-memory
queue starts after the reply completes and a short quiet delay. A new user
message cancels pending extraction and defers the unfinished job until chat is
idle again; one learning request runs at a time. Old/new user facts are processed
in order, so corrections still replace their prior entries. Current corrections
are understood from conversation immediately, before long-term storage catches
up. Manual edits/deletion/Undo, disabled memory and shutdown discard pending
jobs so they cannot resurrect intentionally removed entries. Completed memories
remain persistent; unfinished jobs are session-local. Failed learning remains
independent of reply success. The UI and prompt no longer claim extraction has
already finished. Successful chat replies now restore connection status.

## 0.2.9 automatic conversational learning

Opt-in automatic learning runs a bounded structured extraction before the main
reply, using the configured model and only the current user's message as new
evidence. Explicit durable facts/preferences are saved; corrections update the
matching entry rather than append contradictory versions. Uncertain or quoted
claims and temporary moods are excluded by the extraction contract. Each change
requires an exact supporting quote, validated schema and an unchanged store
snapshot. Manual edits, deletion, disabled memory and cancellation take priority.
Failures leave memory unchanged and do not prevent the main reply.

Automatic changes retain up to eight reversible revisions per entry with source
message ID and evidence, visible in Memory. Forget requests exclude entries
from future memory context while retaining a reversible local record until the
user permanently deletes it. Undo never rewrites a later manual correction.
An extra model request can add latency and usage. No background polling or
retroactive mining of saved conversations is added. Existing model-suggested
remember actions remain governed by their original policy when learning is off.
The Memory panel ignores superseded asynchronous refreshes after mutations.

## 0.2.8 attributed persistent profile

User-supplied profile entries can be imported atomically with source label,
supply date and fact/preference/interpretation classification. Reimporting the
same entries does not duplicate them or discard existing memories. The Memory
panel shows provenance and supports inline correction while retaining the source
and recording the correction time. Approved context is omitted when memory is
off; pending entries never enter the prompt. The prompt distinguishes tentative
interpretations and dated reports from enduring facts, prioritizes current
corrections, and leaves unknown personal facts unknown. Private import data is
kept outside the source checkout and persists in the user's local memory store.

## 0.2.7 character performance

The dialogue brief now gives Capri conversational motives, tastes, vanity,
curiosity, disagreements and quiet sincerity. Original tone examples teach
contrast instead of relying on franchise slang. Contextual and offline banter
uses the same brief, and ambient lines avoid immediate repetition. Expressions
return after a short clip while deliberate pose choices retain their duration.
Biography beyond existing source notes remains excluded; added characterization
is explicitly interpretation. The separate user profile import is deferred.

## 0.2.6 connected personality

One local personality clock connects cursor attention, touch reactions and idle
sequences. Cursor approach has a short dwell before notice/watch/play/settle;
repeated pokes build mild annoyance, pats build contentment, and emotions fade
naturally. Explicit animation selections, hanging, dragging, sleeping and
teleport sequences retain priority. The Character panel has an Expressive
behavior switch. Original PNGs are unchanged.

The renderer shares mood with conversation context and captures it per spoken
utterance. Remote TTS appends mood delivery to the editable voice prompt while
preserving Nova and speed. Fetch/playback is serialized, and stopped requests
cannot begin playing after their response arrives. Contextual bubbles greet a
return from at least three minutes away or react to window movement. They obey
Idle remarks and quiet settings, have cooldowns, and do not replace an open
composer or active conversation. Touch responses remain silent. Recent session
interactions provide small callbacks; approved memory and saved position remain
the existing persistent sources. No new screen monitoring or model polling is
introduced.

## 0.2.5 Nova voice delivery

Remote speech sends editable delivery instructions and the Rate slider to the
speech endpoint. The preset uses gpt-4o-mini-tts with nova and playful, lightly
raspy, conversational delivery. Pitch is shown only for Windows voices because
the remote endpoint has no pitch parameter. Older tts-1 models omit instructions
for compatibility. Existing provider, microphone, volume and credentials remain
as configured; the live voice preset uses rate 1.05.

## 0.2.4 window movement and hanging

An attached window changing position or size puts Capri in idle/blink at her
old position. She waits until the left mouse button is released and geometry
has settled for 240 ms, then plays the original perch_glitch strip through both
teleport phases. The destination is resolved after departure to catch Windows
snap/maximize adjustments, preserving her relative place along the window.
High windows use the original dangle strip below the top edge. Available
headroom is calculated for the window's monitor and character scale, with a
small hysteresis band to avoid pose flicker. Moving the window down restores
perching. Closing or minimizing the target releases the attachment.

## 0.2.3 stable bubble sizing

Bubble movement now writes a fixed requested width and a cached content height.
It never reuses Windows' rounded native size for the next position update.
Duplicate layout measurements and two-pixel rounding jitter are ignored, and the
card has a fixed CSS width so viewport rounding cannot repeatedly rewrap it.
The chat shortcut also explicitly focuses the input on every opening.
A regression check exercises 2,000 repeated placements at 125% display scaling
and verifies that the bubble dimensions remain unchanged while idle.

## 0.2.2 bubbles and character presence

- Double-click, the chat shortcut, the tray, and the launcher open a compact
  attached speech bubble with an input, rather than the full settings/chat panel.
  Normal model replies appear there even when voice and the large panel are off.
- The bubble follows Capri, wraps and scrolls long replies, shows thinking/stop
  controls, and can be dismissed with Escape. It can send chat but cannot access
  API keys, edit settings, or approve computer actions; those remain in the panel.
- Seated artwork looks right in the original strip, while standing artwork looks
  left. Facing now uses the active clip's source direction, including blink/glitch
  variants. Facing > Original artwork keeps every strip unmirrored.
- Blinks play the complete four-frame sequence instead of being cut off by the
  faster procedural eyelid timer. Standing and sitting selections retain blinks.
- Added small idle fidgets, a seated lean around the contact line, visual talking
  for muted text replies, and rate-limited local poke/head-pat bubble responses.
- Conversation instructions favor concise, playful responses over generic helper
  introductions. This is interpretation, not a claim of exact character fidelity.
- `node scripts/verify-bubble-live.mjs` checks a real Codex reply through the bubble
  in an isolated profile, without opening the large panel.

## 0.2.1 interaction fixes

- Window seats track a native window handle, not whichever app currently has focus.
  A chosen seat stays pinned against automatic teleporting and follows the window
  during movement/resizing. Closing or minimizing it releases the seat in place.
- Drop snapping searches visible windows below the character, including background
  windows, and uses the same contact line as the sprite renderer.
- Corrected the source artwork's facing direction. Cursor tracking works beyond
  the transparent window and expires when the cursor stops moving.
- Hit testing uses the opaque base sprite rather than particles, glow or teleport
  pixels, and updates as the animation changes underneath a stationary cursor.
- The animation intensity control changes sprite playback and movement; zero
  freezes playback. A persistent Animation selector exposes the actual supplied
  strips instead of unsupported vector-only poses.
- Teleport effects resume a covered/paused renderer; departure/arrival completion
  listeners are registered before sending the effect cue.
- Validation: 196 unit checks, 40 desktop checks (two optional checks skipped),
  plus an explicit native-window snap/focus-change/move/resize check. Rendering
  and contact alignment were checked again after aligning the snap line.

This local branch combines TheAgencyMGE's companion with the original
lachydotmcg PNG strips. No remote fork or public upload was created.

Sources:

- Companion: https://github.com/TheAgencyMGE/capri-companion
  at c094ec1e74941c075cf0a2ce5ab340a58a3c6344.
- Artwork: https://github.com/lachydotmcg/capri-desktop
  at b3d7144f9954ba294b623d7e780d1b510b92a2eb.
- Artwork attribution: `assets/capri/lachy/SOURCES.md`.

## What changed

- The character draws the original 13 PNG strips directly instead of the vector
  body. Idle, blink, grin, glitch, drag, sleep, wake and perch states follow the
  companion's behavior. The supplied mouth overlay follows speech amplitude.
- The original desktop shell, pixel hit testing, drag/drop, taskbar/window
  placement, teleport effects, settings, conversation, voice and action tools
  remain connected. Gaze currently changes her facing and adds a small lean;
  the original baked-in eyes are not independently redrawn.
- Added a Codex account provider using the installed CLI's own sign-in. It does
  not read, export, or copy account credentials. Replies and screenshot decisions
  consume the user's Codex usage. Other existing providers are still selectable.
- Codex subprocesses use empty temporary working folders, ignore user config,
  disable the shell tool and do not persist Codex sessions. The companion passes
  its conversation context each turn. Desktop actions stay inside Capri's
  validated action/approval system. Replies appear after each completed model
  response, rather than token-by-token.
- Computer control can use Codex screenshot decisions as well as Gemini. Both
  the chat Stop button and Esc cancel an active task.
- Startup waits for the character renderer's loaded artwork/first frame, fixing
  an offscreen first-launch timing race.
- Packaged separately as Capri Buddy to avoid sharing another installation's
  settings. On first launch it selects Codex when the CLI is installed. Speech
  starts muted; select a Windows substitute voice in Voice to enable it.
  Initial scale is 65%, and fullscreen hiding starts off so she remains visible
  beside the current workspace. Both can be changed in Character settings.

## Run and build

`npm ci`, then `npm start` for development. `npm run build` compiles the app;
`npx electron-builder --win --dir` creates `release/win-unpacked/Capri Buddy.exe`.
Keep that executable with its surrounding files.

`npm test` runs unit checks. `npm run test:e2e` tests isolated offscreen windows
with mock model endpoints. `node scripts/verify-live.mjs` explicitly makes two
real requests through the signed-in Codex CLI: conversation and an image-based
action response, without physically operating other apps.

Computer control uses the primary display and the real Windows cursor. Its
action restrictions are partly prompt-based, as in upstream; this is a working
prototype rather than an audited autonomous desktop agent. Autonomous browsing
stays off and still requires Gemini in the inherited explore mode. No voice
cloning or original Capri voice is included.


## 0.2.11 contextual desktop companion

Opening chat generates a brief time/activity greeting. Touch and mute changes generate short responses. All generated lines use the configured TTS gate; muted reactions remain visual/text. Remote TTS failures never switch to a system voice. A late TTS result is discarded after mute/cancel. Windows speech never chooses an unspecified male/default voice.

Background exploration cycles visible, non-minimized external windows every 20–55 seconds without activating them, preferring least-recently visited windows. Activating the explored window detaches and teleports her away, with an occasional generated reaction. Exploration pauses while chatting, dragging, controlling the computer, sleeping or during quiet hours. It replaces the old autonomous website-opening routine. Window titles and process names provide context; occasional window thumbnails go to the selected Codex or Gemini provider for visual observations, without activating the window. If unavailable, observations use metadata only. Captures are not kept in history. Screen text is untrusted data and cannot grant actions. Other model providers currently receive metadata only.

osu, Valorant and Deadlock are detected from foreground process identity (and title fallback) in windowed or fullscreen mode. Speech and ambient behavior stop while they are active. Game detection is heuristic rather than a universal game detector. Sleep follows cursor inactivity, with 1-second presence updates. Global pointer samples update gaze/hit testing at 16 ms; pats reject tiny jitter. New user chat aborts pending companion generation.


## 0.2.12 memory visibility and conversation recovery

Reconcile speech state after generation finishes so an early speech error cannot strand the character in thinking. Starting a new chat clears obsolete speech; provider construction errors are caught inside the turn. Panel initialization reads the actual conversation state. Async chat navigation cannot overwrite another panel; memory loading isolates optional notes/reminders failures and shows a retryable error instead of a blank view. The Memory panel shows active and attributed entry counts. Memory reads refresh from externally changed profile files; partial writes preserve the last valid in-memory snapshot. Approved identity facts take precedence over old assistant claims of ignorance.

Codex CLI diagnostics now recognize HTTP 429 and its reported backoff, stop the stalled request, and expose a rate-limit error and shared cooldown. Login status alone is not proof that replies work. Logs record memory count/enabled state at conversation construction without logging personal text. A --memory launch opens the Memory panel directly.


## 0.2.13 request pacing and rate-limit recovery

All Codex chat, desktop vision, ambient, and memory calls share one request gate. Explicit user work preempts active background work and waits for its process to exit. Background arrivals are dropped when another request is pending. Cooldown is checked again when a queued reply starts. Both JSON stdout errors and complete stderr diagnostics recognize 429 and retry delays; the cooldown is saved in user data and respected across restart. Login checks cannot overwrite a newer failed request.

Touch/mute reactions use local contextual lines; generated ambient comments are limited to one attempt every two minutes, without abort/restart churn. Codex memory extraction waits for sixty seconds of quiet after a reply, batches up to four queued messages with individual evidence attribution, excludes off-the-record messages, and preserves queued work after rate limits or scheduler preemption. Other providers retain their existing memory delay.

Validation: 235 unit tests and five targeted desktop tests passed; a live Codex connectivity reply succeeded. The separate Nova speech-credit issue is unchanged.


## 0.2.14 conversation routing and Codex context

Reauthenticated the local CLI through the official browser login restricted to the current desktop workspace. Capri uses the CLI's own credential store; credentials were not copied into the app. The user's normal Codex configuration is unchanged.

Ordinary conversation and background learning use GPT-6 Luna. Desktop actions use the installed Codex default model unless a task-model override is configured. Both are configurable in Model settings. The intent router supplies the action catalog only when needed; a request_actions handshake upgrades missed intents without requiring another user message. Every action still passes existing validation and approval policies.

Personality instructions and dialogue examples are preserved verbatim. All approved memory texts remain in context, grouped under shared attribution headers while retaining kinds, source dates and corrections. Ordinary chat omits the background-window list. Dynamic time follows stable context for prefix reuse. Codex invocations replace generic coding-agent instructions with a short engine contract and Capri's actual instructions, disable unrelated native capabilities and skill/plugin discovery, and separate system context from conversation.

Logs record purpose, selected model, input character count, measured input/cached/output counts, duration and provider cooldown without recording chat or memory text.

Validation: 260 unit tests and seven packaged desktop tests passed. Eight consecutive live user messages (nine model calls) succeeded against a copy of the full saved history and all 38 memories, including timer execution, conversation recall, personal recall, personality and a thirty-second pause. Chat calls used approximately 7,700-7,900 input tokens; task calls used approximately 8,600. A separate live Luna memory-extraction test saved a fact with exact supporting evidence. The original memory file was unchanged byte-for-byte.

The lean-context path with the default model alone still reproduced a provider 429 during longer testing; switching ordinary conversation to Luna passed the longer test. The provider's internal throttling threshold and precise cause are not exposed, so no claim is made that external rate limits are removed.


## 0.2.15 settings recovery, inverted perching and contextual reactions

Settings windows retain a native Windows close control even if their page fails. A small independent startup bundle offers Reload/Close if the main UI or bridge fails; required boot requests have a timeout and optional status requests cannot block navigation. Main-process readiness/watchdog handling reloads a stalled initial page once, replaces failed/crashed/unresponsive panels when opened again, and preserves the last requested tab. Window callbacks are scoped to the window that created them. Rapid navigation and late async panel results cannot overwrite a newer view. Package updates are staged separately and swapped only after the old application exits.

Insufficient space above a title bar now selects a vertically flipped seated pose, anchored at the mirrored seat fraction, instead of the hanging clip. The sprite hit mask follows the flipped art. Bubbles align lower beside the inverted face. Drag snapping can use this mirrored contact point on high title bars. Moving/resizing a pinned window restores the appropriate upright/inverted seat with hysteresis. Manual hanging animation remains available.

Exploration visits are spaced 75-150 seconds apart, including initial startup; glides are slower. Visits can float within a selected window's area as well as perch, can revisit a lone background window, and can move around the desktop when no background window is available. Manual placement grants a 150-second dwell before autonomous exploration.

Drop reactions are two-stage: an immediate varied local response, followed after 1.6 seconds by one target-specific observation. A placement revision cancels stale work when moved again. Custom placement generation is limited to once per 30 seconds, with varied title-aware local lines during cooldown. Ambient generation keeps the existing two-minute cap. Event metadata and screenshot share the same explicit window handle; active-window metadata is separately labeled. Closed or renamed targets and obsolete replies are discarded. Conversation distinguishes the physical/observed window from the active window.

Runtime prompts preserve personality guidance and approved memories but omit canned example replies that were encouraging repetition. Touch and placement lines avoid recent repeats; generated comments vary intent and are instructed to avoid repeating earlier lines. The canonical dialogue examples remain available for documentation and prompt tests.

Validation: 264 unit checks, 60 desktop tests (two optional live/microphone tests skipped), and nine focused desktop checks passed. Fault injection covers failed boot, renderer crash, rapid settings navigation, target binding, stale observations and floating visits. The inverted sprite and settings layout were visually inspected. A live Codex placement test produced a quick reaction followed by an Acrobat/ME270-specific line despite an unrelated active-window fixture. All 38 approved memories were available during the live check.

## 0.2.16 transmission visuals

Adapted the angular speech panel, purple offset shadow, expression portraits and typography from mochiiwuff/capri-desktop at commit 16985d14c3d2b4948b6e621420784dd7acaf8d9c. The panel is CSS rather than a bubble image. Loading uses the real reply phase and elapsed time, with an indeterminate activity stripe. Errors retain the actual failure text. Long replies scroll, and opening the composer reserves room for the input and controls.

Teleport adds silhouette collapse, a red/violet/white beam, departure slit, arrival streak/vortex and short green/ink impact frames. The separate display-sized visual layer cannot take focus or mouse input, never participates in teleport acknowledgements, stops drawing after 650 ms and hides after 800 ms. Existing teleport effects settings and reduced-motion preferences suppress its animation. Loading/error character overlays do not alter the sprite hit mask.

The upstream MIT code notice and the separate artwork rights are retained in THIRD_PARTY_LICENSES.md and assets/capri/mochiiwuff/SOURCES.md. Chakra Petch and JetBrains Mono font licenses ship with the app. This imports visual assets and effects only; existing providers, memories and personality remain in place.

## 0.2.17 embodied presence and quieter interaction

A shared attention rig coordinates sprite facing and pose gaze. Manual placement and exploration look toward the actual tracked window after a brief settling beat, with smooth gaze changes; user conversation takes priority. Closed targets and the non-inspectable Explorer desktop shell are excluded. The latter fixes greetings being discarded when the bare desktop is foreground.

A bounded, in-memory session encounter ledger recognizes returns to the same process/title and quick interruptions. Placement feedback and conversation context use these actual encounters without claiming remembered document contents or progress. It never edits approved memories. Reopening a recent conversation resumes its last reply; replying to an aside preserves that remark instead of generating another greeting.

Nearby exploration on the same display uses gentle 2.8-5.5 second glides, with longer moves retaining teleport effects. A pickup, new placement, conversation, closed target or quiet zone cancels the flight without completing its old landing. Floating artwork has slow lateral/vertical drift. Mood gradually changes movement tempo and warmth, and settled contentment survives a new window visit. Speaking no longer forces a happy reaction or playful mood each time.

Repeated touch can receive gestures alone. Unsolicited observations may explicitly choose silence; unavailable ambient generation does not manufacture filler. Short asides use a smaller transmission panel and expire sooner. Longer replies, loading, errors and the composer retain the full panel. Early character-side loading uses subtle dots, with elapsed status after fifteen seconds.

Validation: TypeScript and 270 unit checks passed. The packaged regression run passed 65 desktop checks; its one onboarding failure was a test-listener race, fixed to accept an already-open startup panel and verified separately. All 66 applicable desktop checks are covered; two optional live/microphone checks were skipped. Visual inspection covered the compact aside, expanded composer and window-directed gaze. A live isolated packaged-profile test successfully replied through Codex, recalled the saved name and loaded all 39 approved memories.

## 0.2.18 purposeful visits, conversational controls and local teleport effects

Window exploration now has one cancellable intention: approach, study for 4.5-8 seconds, settle for 1.8 seconds, then rest for at least 30 seconds. Only after settling does it consider an occasional target-specific observation, still subject to the existing ambient request cap and quiet rules. A new conversation, pickup, closed target, focus request or stay request cancels obsolete work and prevents old landings/comments.

Complete direct utterances such as 'I need to focus', 'I need to focus for 20 minutes', 'Stay here', 'Look at this', 'You can move again', 'I am done focusing' and 'Back to normal' use a local conversation branch for typed and transcribed input. They preserve chat history and normal reply speech, construct no model provider, and do not enqueue temporary commands for memory extraction. Quoted text and mixed requests remain ordinary conversation. Focus defaults to 25 minutes, accepts 1-180 minutes, quiets ambient remarks and wandering, and still permits explicit replies/reminders. Stay holds the current location until released. Both are temporary session preferences, leave saved settings unchanged, and can be toggled from the tray/character menu. Their active state appears in the full bubble footer. Looking selects the external foreground/recently used window and changes attention without confusing it with physical location or claiming document contents.

All automatic movement paths respect these requests, including glides, teleports in progress, summon-on-chat and moving away when the explored window gains focus. Cancelled teleports restore the departure appearance without completing an obsolete native move. Panel opening captures the external foreground context before taking focus.

The display-sized teleport overlay introduced in 0.2.16 has been retired. A softened 2-7 DIP filament is rendered inside the character canvas, centered from the current silhouette bounds and extending only eight DIP beyond her body. It handles pose changes, inversion and display scale without a separate overlay window. The character's topmost state is reasserted after final perch bounds are applied and again after arrival, with short delayed rechecks that respect the user's always-on-top preference.

Validation: TypeScript and 290 unit checks passed, including local command routing, quote/mixed-request rejection, focus expiry, no-provider/no-learning handling, visit transitions, cancelled glides/teleports and silhouette-centered beam geometry at four display scales. All 33 selected packaged desktop checks passed across company controls, interaction continuity, window targeting, teleportation, bubble chat, settings and onboarding. Four separate native Windows checks (left, random, right and perch) confirmed topmost style and z-order above an ordinary covering window after deliberately demoting Capri before each move. Visual QA covered active company labels, the short beam and inverted poses.

## 0.2.19 dialogue performance and arrival frequency

The character brief now prioritizes an inhabited, openly fictional performance over assistant-style acknowledgments, biographical introductions and unsolicited app disclaimers. Actual software/authenticity questions still receive candid answers. Conversational intent is informed by compact paraphrased scene observations from community episode transcripts (4, 7, 9 and 10), with attribution and evidence limits in src/shared/capriVoice.ts and docs/CHARACTER_DOSSIER.md. Late host-specific grief is not imported as a general memory. Native desktop permission checks, model choice and the approved-memory store are unchanged.

Two relevant speech-act notes are selected locally for each turn. They contain no finished example replies: a live test showed that even an instruction not to copy an acting example could produce near-verbatim repetition. Authored example dialogue remains documentation only. Ordinary character identity, imaginative banter, honest implementation answers, explicit current name corrections and arithmetic were exercised through the installed Codex model. The final check answered naturally in first person, then used the requested test name and returned 391 for 17 times 23 without an app disclaimer.

Every completed teleport/glide can now trigger a short varied local arrival line, paced at least 2.6 seconds apart. Arrival speech uses the existing voice/interaction-lines toggles, respects focus, quiet hours, games, fullscreen, hidden state and active conversation, and requires no model request. Failed/cancelled travel does not fire arrival callbacks. Window visits consider a more specific observation after settling 65 percent of the time, while retaining the shared two-minute generation cap. This increases presence without increasing the maximum model request rate.

Validation: TypeScript, all 292 unit checks and 34 selected packaged desktop checks passed. Coverage includes source attribution and speech-act selection, exclusion of finished example replies from live prompts, arrival speech without model calls, focus/mute gates, teleport recovery, company controls, bubble chat and settings/onboarding. Live Codex samples covered character identity, imagined freedom, harmless mischievous banter, a direct authenticity question, a current name correction and arithmetic. The final two-turn check produced a fresh introduction without an app disclaimer and returned the correct calculation with the requested test name. These are performance checks, not proof of exact canon fidelity or an independent audio transcription.

## 0.2.20 opening animation and Windows taskbar controls

The opening adapts the hand reach, close-up greeting, wave and head dive from mochiiwuff/capri-desktop using nine credited WebP frames. It runs for about 4.25 seconds on launch, then unfolds the regular desktop sprite. Windows reduced-motion preference uses a short stationary greeting. The overlay is transparent, click-through and unable to take focus. It respects hidden/fullscreen/game states, pauses the ordinary sprite renderer, and restores it on completion, cancellation, renderer failure or timeout. Character settings can disable automatic openings; taskbar controls can replay them without a model request.

A normal native Capri window supplies a persistent taskbar button with the reference Capri icon. Clicking it opens controls for chat, minimize, replay, settings and quit. Its native minimize button hides Capri and her chat; restoring it brings Capri back. The Open action parks the controls while keeping Capri visible. Closing the control window exits the app. Packaged Windows jump-list actions support Open, Minimize and Close. The ICO is shipped outside the archive so Windows can read it for taskbar/relaunch metadata. Existing companion memories and provider settings are retained.

Character startup now waits for asset readiness before restarting a paused animation loop, preventing an opening/boot race from creating duplicate loops. Desktop test setup identifies the character page by URL because the smaller taskbar page can finish loading first.

Validation: TypeScript and all 298 unit checks passed. The packaged run covered 32 selected desktop checks across opening/taskbar, transmission visuals, desktop presence, teleportation, interface, bubble chat and company controls. The close test initially read Playwright's process object after disposal; capturing it before closure fixed the test, verified separately. Native Windows checks confirmed a taskbar-eligible control window with a real icon, a click-through/non-focusable opening, restored character after landing, native minimize/restore behavior, Open preserving the pet while parking controls, and native Close exiting cleanly. Visual inspection covered controls, the wave and the head dive.

## 0.2.21 complete intro framing and exclusive visibility

Intro cels span the current monitor's work area horizontally so her hands reach both edges. Vertical framing is bounded separately to avoid cropping her face on different aspect ratios; the dive returns to uniform scaling at the regular sprite. Target coordinates use the actual native content bounds after Windows constrains the window. The canvas backing size and drawing transform refresh during playback if the viewport or DPI changes.

Native replay checks reproduced the regular sprite becoming visible even though the app's logical visibility flag remained false. Windows topmost updates were showing the hidden character again. Topmost refreshes, settings changes, restoration requests and startup now honor opening visibility; perch-follow updates wait until it finishes. Completion reapplies the current visibility/topmost preference before showing the character. The regression test uses an actual onscreen window and repeatedly changes foreground, settings and restore state, verifies both native and logical visibility, then resizes the intro and verifies canvas resolution and final recovery. Manual native sampling covers all three connected displays at 100% and 150% scaling.

## 0.2.22 independent controls, interaction recovery and adaptive speech panels

The taskbar panel now minimizes and restores independently of Capri. Its native close button parks the panel; only the explicit Quit action exits the companion. Settings opens without revealing a hidden pet. The redesigned panel groups Talk, entrance replay, settings, hide and quit with clear descriptive text. Executable resource editing is enabled while signing remains disabled, embedding the actual Capri ICO and version metadata instead of Electron defaults. The character and settings windows also receive the Capri icon. The standalone --quit command exits immediately when no existing instance is running.

Dragging preserves current mouse hit state across settings changes. The renderer reasserts that state after applying settings, checks the current opaque sprite on mouse-down, and receives authoritative drag-end feedback from the main process when native button polling detects release outside its window. Placement cancels stale visit intentions. This prevents a missed mouseup from leaving the renderer in held mode.

The character renderer reports its transformed face anchor at most ten times per second, only after meaningful changes. This uses the same canvas transform as the drawn sprite, including mirroring and upside-down attachment. Bubble placement follows that anchor. A vector pointer selects the appropriate edge of the panel and clips along the actual direction toward her face, including when the target lies outside the bubble window. Compact and composing layouts use their measured plate bounds. Hidden bubbles skip positioning work, and stationary cursor polling no longer recomputes bubble geometry.

Speech text has improved spacing, selection, focus, scrolling and a larger input with a dark scrollbar. Streaming follows the bottom only when the reader was already there; failed submission restores the draft. Settings inputs have clearer focus and more comfortable sizes. Opening text is drawn dynamically, varies locally by time and across loads, and can use an explicitly approved preferred-name fact. It excludes the previous greeting through a small independent preference file, never modifying companion memories and requiring no model call.

Validation includes TypeScript, 304 unit checks, 38 selected packaged desktop checks plus the separately verified panel-exit test, and seven focused source checks including new outside-release and inverted/mirrored anchor regressions. Native Windows input moved Capri twice by 120 by 80 DIP and verified release after each grab; the artwork was held stationary during native mouse verification to avoid selecting a moving transparent edge. Packaged executable icon extraction returned Capri artwork and version 0.2.22. Rendered UI inspection covered the redesigned controls, composer, inverted bubble and a bubble clamped to a screen edge. Final packaged checks are recorded below.

Final 0.2.22 packaged validation: all 26 selected desktop checks passed, including seven opening/control/drag/anchor checks, transmission visuals, bubble chat, sprite interaction regressions, responsive interface and contextual interactions. The final package also passed two native drag-and-release checks and standalone --quit exited cleanly in 295 ms. Deployment preserved the memory file byte-for-byte.

## 0.2.23 native pickup recovery

The earlier native drag test injected renderer pointer updates and froze the artwork. It did not exercise the normal production cursor polling path and missed false mouseleave events from toggling transparent-window mouse handling. Mouseleave no longer clears the authoritative cursor sample. Stationary cursor samples refresh at a bounded 100 ms interval, and native left-button transitions over the last opaque hit can start the same guarded drag path as renderer mousedown. Both routes share cancellation and release behavior, and explicit click-through, hidden state, opening playback and computer-control mode remain respected. A dedicated native-pointer test switch enables production cursor polling in isolated tests. Native verification now uses moving artwork, actual Windows cursor/button input and no injected pointer messages.
Validation: TypeScript and all 304 unit checks passed. The packaged native-pointer run picked up and moved the animated pet twice by 120 by 80 DIP and cleared the held state after both releases, without injected pointer cues or freezing the artwork. The false-mouseleave regression explicitly keeps an opaque pickup point interactive.

The packaged run passed 13 of 14 selected checks initially; the covered/paused teleport animation check timed out on its arrival log and passed when repeated alone. All eight opening/control/drag/anchor checks passed. Native production-pointer testing passed both animated drag/release checks. Version 0.2.23 was deployed with unchanged memory bytes and a connected Codex provider.

## 0.2.24 farewell and teleport-out on quit

Quit from the taskbar panel, tray, character menu, settings or a running-instance --quit request now shares a bounded farewell sequence. It cancels background movement, replies, learning and computer-control work; requests one short original Capri farewell from the configured provider using a compact persona and up to two recent conversation snippets; displays it briefly; then plays the existing teleport-out animation without moving or returning. The sequence waits for the renderer's departure acknowledgement, with an independent timeout. Hidden/fullscreen/game-hidden pets exit without being brought back just for a farewell. Standalone --quit with no running instance still exits immediately, and restarts keep their immediate lifecycle path.

Generation has a 4.5-second budget, the line stays readable for 1.5-2.3 seconds, and the entire sequence has an 8.5-second hard deadline. Failed, rate-limited or slow generation uses a varied local farewell. Repeated quit actions share the same active sequence. The previous farewell is saved in a separate small file to avoid repeats, and neither generated nor local farewell text enters chat history or memory extraction. The normal teleport-effects setting is respected. Tests cover duplicate quit actions, never-resolving generation, hidden state, missing departure acknowledgement, output filtering and an end-to-end generated farewell through a local provider mock.

Validation: all 309 unit checks passed. A live isolated Codex check generated an original 14-word farewell in 3.7 seconds, displayed it, received teleport-out acknowledgement and exited with code zero. The generated-farewell end-to-end mock test passed and confirmed no memory file was created.

All nine selected packaged opening/taskbar checks passed. Version 0.2.24 was deployed, preserving the memory file byte-for-byte; Codex connected after restart.

## 0.2.25 intentional modes, Night City context and background economy

Company, Explore and Sleep are persistent behavior modes, separate from the appearance animation selector. They are available on the taskbar control panel, Character settings, tray menu and character menu; direct utterances such as start exploring, go to sleep and wake up use the local control route without an AI request or memory extraction. Sleep holds position, blocks autonomous travel and unsolicited remarks/observations, pauses background memory processing, and keeps the sleeping artwork/state despite cursor movement and touch. Explicit chat or push-to-talk wakes her. Explore enables genuine window visits even when automatic visits in Company mode are disabled. Existing focus, games, quiet hours, fullscreen and conversation controls still take priority.

Exploration retains one approach/study/settle/rest intention. It now chooses a nearby perch fraction from her actual position and alternates sitting/floating rather than rolling arbitrary destinations. Arrival speech uses the real destination and return state, with a deterministic fresh line among intent-appropriate choices, without a model request. Unprompted personality fidgets no longer trigger random glitch bursts; event-driven curiosity, repeated-touch annoyance, warmth, blink and settling behavior remain.

Dialogue adds a compact Night City outlook and up to two relevant world facts, selected locally from the user's topic. Official Edgerunners 2 character bios at https://www.cyberpunk.net/en/edgerunners2 support the D, Talia, Weak and Roman context; the existing Capri brief retains its separate scene/transcript evidence. The perspective about ownership, corpo power, risk and freedom is explicitly an acting interpretation. It should shape reactions rather than force jargon or a lore lecture into unrelated requests. The live persona keeps concise performance/continuity guidance alongside canon and runtime permissions. Full authored examples remain documentation only.

Prompts retrieve up to eight relevant approved memories within 2800 text characters and keep the newest complete conversation turns within a 12000-character target. The latest turn is never truncated, and explicit broad personal-recall questions load the whole approved profile. Storage and all saved memories remain intact. A shared persisted budget permits at most five optional generation jobs per rolling ten minutes, with at most three ambient/farewell attempts and two memory batches, minimum spacing of one and two minutes respectively. Direct user replies remain outside this optional-work budget and retain priority in the existing Codex request gate. Memory processing can batch up to eight messages, remains pending when budget is unavailable, and stops while asleep. Cold-start model-signature initialization avoids a redundant connection check after the first position save. Stationary pointer heartbeats retain native pickup recovery while no longer continually refreshing the gaze-idle clock.

Validation: TypeScript and 315 unit checks passed. New coverage includes shared budget persistence/expiry, complete profile retention and relevant retrieval, world-fact selection, history bounds, local mode commands and destination-specific arrivals. Initial desktop checks passed Sleep persistence/no-ambient-call behavior and the actual Explore visit; its sole failure was an unsupported test matcher, corrected to read the button's aria-pressed attribute directly. The redesigned mode controls were visually inspected with all controls visible.

Live isolated Codex validation: the Arasaka/property question produced a concise first-person response grounded in her weapon/ownership history, and an engineering-study request received quiet company without a lore dump or pep talk. Both were ordinary chat routes. Input context was 7888 and 8021 characters, with all 39 approved memories still available in the store; Codex reported 3072 cached input tokens in both samples. These are performance samples, not proof of exact canonical delivery. The first broad packaged run passed 27 of 28 checks; its float test exposed the first-vantage choice and was fixed to prefer floating when the top edge is tight or after a perch.

Final validation: all 12 selected packaged opening/control/mode/drag/anchor/float checks passed after the movement correction. The earlier broad run covered another 16 applicable checks across company, arrival, profile/context, responsive settings and contextual reactions. Version 0.2.25 was deployed with the memory file unchanged byte-for-byte and Codex connected.

## 0.2.26 local activity scenes and embodied interaction

A local ActivityDirector fills the gaps between window visits. A stable, real window title becomes the subject of a notice/lean/settle/rest sequence, rather than choosing an unrelated action each tick. Interrupted scenes can resume, actual returns to prior subjects receive local continuity, and a vanished subject is cleared. Brief comments follow stable window changes or returning user input, respect the idle-remarks preference and quiet/focus/game/sleep gates, and are paced at least 75 seconds apart. The longer model-generated idle-remark interval and shared optional-generation budget are unchanged. The current scene is included as session metadata in ordinary replies, without claiming document contents.

Whole-body acting uses bounded, smoothly returning transforms around the sprite's real anchor. Leaning, noticing, stretching, settling and returning are rendered through the same transform as the face anchor and opaque hit mask, retaining speech-pointer and pickup alignment. Warmth and irritation also influence body displacement. Lingering over her for 600 ms can trigger a local lean toward the cursor, paced at least 12 seconds apart; that interaction takes priority over a background activity cue. Existing head pats and held artwork remain. Actual pickup movement, rather than a mouse-down alone, can receive one short local reaction; release gets a settling motion and the existing location-specific response.

Automatic sleep and activity detection now use Windows system input idle time, including the keyboard, instead of cursor motion alone. Explicit Sleep mode still remains asleep. Explore mode schedules visits 35-65 seconds apart, subject to the existing study/settle/rest phases, without speeding up physical glides; Company retains its 75-150 second travel cadence. A first visit can begin after the opening settles. Session-only preferred spots accumulate from deliberate placements and are considered periodically among valid background windows. No saved user memories are edited for these preferences. Everyday activities and cursor play can be disabled independently in Character settings.

Validation: TypeScript and all 320 unit checks passed. New tests cover stable subjects, scene phases and rest, interruption/resumption, actual returns, input-based return detection, bounded transforms and mode-specific visit cadence. Eight selected desktop checks passed, including a test that leaves the cursor idle for ten minutes while reporting recent system input, verifies she stays awake, runs a subject-bound local scene, observes a visible face-anchor shift under leaning, and makes zero model calls. Visual inspection covers the actual perched sprite under lean and stretch transforms. Broader packaged validation follows below.

Final validation: all 25 selected packaged checks passed across local scenes/system-idle, modes, opening, controls, drag/anchor behavior, arrivals, immersive presence and contextual interaction. Native Windows input moved the animated companion twice by 120 by 80 DIP and confirmed both releases. The old 0.2.25 process had completed cleanup but lingered after graceful quit; it was stopped before replacing files. Version 0.2.26 was deployed with unchanged memory bytes and Codex connected. The new activities add no generation jobs.

## 0.2.27 selective placement, cursor return and transition stability

Placements retain gaze/settling and session metadata but no longer receive a canned acknowledgment on each drop. A local interest filter considers a first meaningful window, an unusual upside-down perch, or a return after three minutes; repeated ordinary placements receive only a five-percent candidate chance. Interesting candidates are paced at least 45 seconds apart, ordinary candidates at least two minutes. Window-specific generation waits 3.5 seconds for settling, shares the existing background budget, and may choose silence. Empty or quiet model output never becomes a manufactured placement fallback. Title metadata is only an interest hint, never evidence of document contents.

After at least 90 seconds of real keyboard-and-mouse inactivity, moving the cursor can trigger one teleport beside it and an optional short local line. This is paced at least five minutes apart and suppressed during focus/stay, sleep, hidden/fullscreen/game states, conversation, dragging, recent deliberate placement and other movement. Keyboard-only resumption expires the trigger after five seconds, so typing at a stationary mouse does not cause a delayed surprise jump. The ordinary teleport-arrival line is suppressed during this sequence to avoid double reactions. No model request is needed for the return greeting.

The unsolicited generated-remark default is now ten minutes, and this user's prior 25-minute preference is updated to ten on deployment as requested. Existing quiet and request-budget gates still apply. Sprite base loops retain their phase through blinks and expression changes. Cursor-driven facing requires 140 ms of stable direction, while explicit facing and opposite-source-orientation pose changes remain immediate. Body anchors ease between sitting/standing clips, and interrupted local acting blends from its current transform instead of snapping to zero. Face anchors and hit masks continue to use the displayed transform.

Validation: TypeScript and 323 unit checks passed. Five focused desktop checks passed for cursor return with no model request, facing-noise resistance and loop-phase preservation, retained target gaze/session continuity, selective delayed placement and stale-observation cancellation. Tests that previously required a reaction on every placement now verify the updated quiet-first behavior while retaining the independent gaze and composer checks.

Routine pickup speech is also removed so a quiet placement is not preceded by another stock line; pickup retains a gesture/mood reaction. A packaging/test overlap invalidated one desktop run and was discarded. A clean rebuild is being validated sequentially, and the packaging script now refuses to clear a staged application that is still running.

Final validation: all 17 selected source desktop checks and four targeted clean-package checks passed. Version 0.2.27 was deployed with unchanged memory bytes and the requested ten-minute remark interval.

## 0.2.28 exposed-window tours and immediate attention

Native enumeration now distinguishes real application targets from dialog occluders and rejects hidden, minimized, cloaked, transparent, no-activate and tool surfaces as targets. QA OSD, GeForce/NVIDIA and other known overlay helpers are excluded. Front-to-back visible regions constrain inspection previews, floating destinations, perch contact points and every step of a flight. Covered visits cancel and replan. Focusing the visited application continues its visit instead of forcing an unrelated departure.

Exploration follows an actual sequence: teleport to an exposed region, gently fly to two nearby exposed spots with a local aside and optional window-specific observation, then perch on its exposed top edge and rest for about thirty seconds. Limited clearance uses an inverted perch. Explore attempts are paced at 30-45 seconds and normal optional visits at 50-85 seconds, with the visit/rest gate preventing overlap. Small windows may use safe flights beside an exposed top edge. Current geometry and z-order are checked again during movement. Existing quiet/focus/sleep/drag gates remain.

Cursor-facing uses the current pointer sample with no 140 ms hold and a small central dead zone. Cursor attention no longer translates or tilts the full sprite sideways. Blink/base phase continuity and explicit local body acting remain. Directional teleport rays are restored as thin 450 ms traveling streaks in temporary transparent, unfocusable, click-through windows. They follow actual departure and arrival centers across displays; disposal is timed from renderer readiness with a bounded load failsafe.

Explore and drop generation use varied delivery angles and observed exposed content rather than app-name receipts, repeated questions, productivity praise or stock placement acknowledgments. Local movement/perch asides avoid recent repeats. Interesting-placement selection is retained. Movement and local lines make no model requests; generated observations retain the existing shared background budget and cooldown.

Validation before packaging: TypeScript and 330 unit checks passed. Seven targeted real Electron checks passed for native helper/transparent/hidden filtering and dialog occlusion, covered destinations and interrupted perches, directional ray pixels/focus/cleanup, first-frame facing and phase continuity, roam-to-perch sequencing, focused-window continuity and pickup cancellation. The mode-control exploration check also passed separately. Packaged verification and deployment are recorded below.

Final validation and deployment: the final wider-body build passed all eight selected source desktop checks. Nine selected packaged checks passed, including native window filtering, occlusion cancellation, rendered directional ray and cleanup, first-frame facing, mode ownership, roam/perch/rest, focus continuity, pickup interruption and manual placement. An initial packaged run had two debugger startup timeouts and a ray-window sampling timeout under concurrent release-copy/native-check load; the affected three checks passed in an isolated repeat. The live Windows mouse check was repeated separately with the older companion hidden and confirmed grabbing and both releases. The installed version is 0.2.28, startup to character-ready was 538 ms, Codex reports connected, and memory.json remained byte-for-byte unchanged. The former app completed clean shutdown before its lingering process was stopped and the release replaced with a recoverable archive.

Release copying now selects only the current installer, blockmap and manifests rather than recopying all historical installers. Packaging itself finished successfully; the redundant historical-copy process was stopped and the current artifacts copied explicitly. No application files were rewritten during packaged checks. Manual sit-on-window also uses an exposed safe perch, and Explore mode reserves autonomous movement even when the optional normal-mode exploration switch is off.
# 0.2.29 procedural dialogue and remembered outings

Incidental speech now uses one shared local dialogue director: event/scene eligibility,
weighted speech acts, compatible setup/payoff combinations, optional silence, and
bounded replay history across events and restarts. The voice emphasizes quick
curiosity, cheek, mock innocence, impulsive delight and plain reactions, informed
by the existing performance dossier and refreshed community scene references.
Routine title recitals, repeated magnificence jokes and placement receipts are
removed. Generated lines reject near duplicates, title recitals and the unwanted
"keeps pulling you back" assumption. The explicit look control no longer reads
the title aloud. Waiting text is stable and display-only.

Local cues include time/day, cached native battery status, actual foreground
activity and broad open-app categories. Background attention/perch targets no
longer stand in for user focus. Returns require actual observed focus history;
idle/quiet gaps do not count as working time. Optional city-based Open-Meteo
weather uses short requests and a thirty-minute cache, without scraping or
automatic location lookup. Character settings expose these cues and sparse song
banter. YouTube, Discord, ChatGPT, Spotify and generic browsers have procedural
platform-specific beats without pretending to know private contents or playback.

Contextual greetings and exits may make one budgeted generation request, with
bounded local fallbacks. Routine handling/movement adds no model work. Sparse
Spotify opinions reuse an existing observation opportunity and its shared budget,
read actual Windows playing-track metadata, skip screenshots when metadata is
sufficient, and recheck the track before delivery. Probes are spaced five minutes,
opinion attempts fifteen minutes, and a repeated track two hours. The helper is
hidden and bounded; there is no continuous media polling. All optional generation
retains the existing three-ambient/five-total rolling-ten-minute ceiling and reply
priority. The ambient prompt is substantially shorter than the full chat persona
and profile; rejected output never causes a repair request.

Explore now chooses feasible local outings with a goal, one to three visits, varied
physical looks, remembered destination fingerprints and interruption continuity.
Interim rests are 40-90 seconds; completed outings rest 2-6 minutes, with occasional
8-12 minute rests. Destinations have a ten-minute revisit gap. Closing remaining
places ends a circuit instead of causing a retry loop. A bounded independent file
preserves visits, unfinished goal and rest deadline across restarts without storing
raw window titles or modifying user memories.

Validation: TypeScript and all 350 unit checks passed. Eight focused source Electron
checks passed, followed by eleven packaged checks covering focus/perch separation,
changed-song suppression, procedural dialogue persistence/title rejection, stable
loading, one-request contextual greeting with local touch, settled placement,
system-idle scenes, Sleep, actual roam/perch/rest state, delayed-result cancellation
and game quiet gates. Loading and conversation-cue settings were visually inspected.
The Windows media-session helper ran without error; no live playing Spotify track
was available in that sample, so track-specific presentation was verified with
controlled metadata and a changed-track regression rather than fabricated input.

Version 0.2.29 was packaged and deployed. The running executable reports 0.2.29.0;
the existing memory file remained byte-for-byte unchanged. The previous unpacked
application is retained in the dated release backup for recovery.

See docs/DIALOGUE.md for behavior, source evidence and limitations.

# 0.2.30 identity continuity after restart

The 0.2.29 incidental-generation optimization omitted saved personal context from
fresh greetings and farewells. The user's saved profile and conversation history
were intact, but these independent requests could treat the user as unfamiliar.
The current preferred name was also stored as an attributed correction on a
background fact rather than a dedicated name sentence, which the local opening's
narrow text matcher did not recognize.

A small shared identity summary now reaches greetings, asides, exits and regular
conversation. It resolves the latest explicit preferred-name correction, retains
a small background/style core, and gives the correction precedence over older
profile labels. Routine retrieval pins that core before filling its existing
eight-item working set. Incidental context remains bounded and adds no requests.
Local openings recognize the same approved name evidence; disabled memory still
omits it. No stored user memories were rewritten.

TypeScript and 354 unit tests passed, including nickname correction, competing
topic retrieval, archived/pending/irrelevant exclusions and disabled-memory tests.
A real packaged test used a persisted profile, fully quit, relaunched with the same
profile, and verified preferred-name/background context in the new greeting and
subsequent conversation. It confirmed three expected model requests against a
local mock and an unchanged memory file. The test supplies a neutral desktop
override so a real foreground game does not correctly suppress the test greeting.

# 0.2.31 production developer panel

The installed Electron panel now includes Developer navigation, a System entry and
character/tray menu entry points. It previews all thirteen actual sprite strips,
local interaction/activity cues and event/platform dialogue, and runs bounded
animation, interaction, activity and loading walkthroughs. It also replays the
opening, runs one real exposed-window outing, and performs local smoke checks for
dialogue variety, identity context, exploration rests and renderer liveness.

A serialized developer controller exposes progress and a sixty-entry result log
through strictly validated, panel-origin-only dev:get/dev:run/dev:stop IPC. It is
available in the production package without a test flag, arbitrary script evaluator
or network-debug port. The panel shows lightweight runtime state and polls only
while its Developer tab is open. Stop stays in the fixed header. Leaving/closing
the panel, opening chat or sending a chat message cancels temporary preview state.

Visual preview state is renderer-local and exact sprite-strip selection does not
change saved animation preferences. Preview controls make no model, synthesis or
external-action requests. Autonomous movement/remarks pause during previews. An
explicit exploration trial shares the production geometry path but uses its own
outing director, suppresses generated observations and speech, and restores the
previous native position/perch and normal visit schedule afterwards. Infeasible
trials report failure rather than success; actual movement completion, not the
unrelated manual-teleport counter, determines their result.

Validation: TypeScript and 358 unit tests passed. Three packaged Electron checks
passed for preview UI and all-strip cycles, prompt cancellation, close cleanup,
invalid-command/foreign-renderer rejection, independent exploration and native
position restoration, zero preview generation requests, and the prior full-restart
identity regression. The developer panel's rendered controls and fixed stop button
were visually inspected. docs/DEVELOPER_PANEL.md documents controls and the typed
Electron bridge for future automated use. Full automated test suites remain outside
the interactive app; the panel's checks are explicitly labeled local smoke checks.

# 0.2.32 transformed interaction geometry and return testing

Perch-following now retains attachment orientation while a moved window triggers
one nonlooping 24-frame/10-fps dangle strip, then standing. Teleport waits until
that cycle and a short standing beat finish, the native button is released, and
the target geometry has settled. Repeated movement does not restart the strip.
The landing resolves the latest window geometry and carries its explicit perch
mode through the move/attachment callback. Manual scaling preserves the correct
upright or inverted contact ratio. Render pose interpolation resets across size
or inversion changes instead of reusing offsets from a different frame.

Mouse-down no longer detaches a perch or changes the renderer to held art. Actual
movement past the four-DIP threshold owns those transitions, so clicking or opening
chat cannot flip an inverted perch upright. Covered targets retain their attachment
identity; destination movement still waits for exposure rather than jumping through
a covering window. Location context can distinguish attachment from visibility.

Facing uses a logical direction gate, independent of source-art mirroring, with
140 ms stable intent and a 380 ms minimum turn interval. Rubbing the transformed
head region holds facing. Head hit tests invert the actual draw matrix and use the
same opacity mask as the sprite. Pat particles derive from the transformed hair
anchor, including mirrored and upside-down perches. Cursor coordinates reference
the drawn face rather than a fixed upright head position.

The bubble reply control now uses a dedicated, validated bubble-origin route that
opens the composer without replaying generic chat/opening behavior. Visible speech
panels accept native activation for their buttons; showInactive still prevents
unsolicited focus changes.

Developer tools add idle/sleep simulations, Return now, Clear absence, and up to
three exploration outings. Simulations are session-only and preserve saved mode.
They arm after a two-second setup grace and detect real mouse or keyboard input.
Sleep wakes first; idle uses a shorter wave. Both share the cursor teleport and
local return-line path. Ordinary keyboard/system input can trigger returns without
a mouse move, brief conflicts defer a return, and stale blocked returns expire.
Explicit tests use normal voice settings but add no model requests. Three-outing
trials cap to available windows, identify distinct concurrent windows separately
even with matching titles, bypass only their isolated rest timers, and restore
normal outing history and starting placement afterwards.

Validation: TypeScript and 360 unit checks passed. Fourteen focused source Electron
checks passed across perch movement, transformed interactions, reply composition,
developer cycles and the absence tools. Eight packaged checks passed for inverted
click/reply/scale/cover stability, the dangle/stand/follow sequence, mirrored/inverted
head regions and particles, idle/sleep test returns, ordinary keyboard-only return,
facing delay, two-of-three available-window trials and full-restart identity.
The perched pat effects were also captured from the packaged renderer for visual
inspection. No user-memory format or contents were rewritten by these changes.


## 0.2.33 forgiving pats and upright perch departures

Expanded the transformed head ellipse from 55x66 to 85x94 source-pixel radii,
including hair padding in the interactive region rather than requiring opaque
pixels. The rest of the body still uses its sprite mask. Compact speech portraits
now use the same 48x52 size as the chat composer. Window-motion dangle and floating
standing frames render upright, including when departing an inverted seat; the
native attachment target and inverted landing remain intact.

Validation: TypeScript and all 360 unit checks passed. Packaged Electron checks
cover expanded mirrored/inverted pat targets, upright departure frames, perch
continuity, and identical portrait dimensions before and after opening chat.

## 0.2.34 deliberate perch commentary and prompt window following

Actual window-perch drops now debounce for 1.1 seconds and request a brief
contextual reaction even for ordinary or familiar windows. The request includes
the target view when supported, broad window subject and enabled local cues.
Placement no longer substitutes a Spotify music aside or requires a title novelty
lottery. The shared persisted generation budget and cooldown still bound requests;
new drops cancel pending/stale commentary. Unattached drops over a window body do
not count as window perches, and use local putdown lines or silence only.

Window motion retains the single upright dangle cycle and stand phase while held,
but a released, geometrically stable window can teleport after 240 ms without
waiting 2.7 seconds for the animation. Covered/unsafe targets still wait.

Validation: all 360 unit checks and six focused Electron checks passed, including
quick release, long hold, ordinary-drop debounce and cooldown, no request for an
unattached drop, actual-target context and cancellation of stale observations.

The same update holds cell 1 (fully closed eyes) from blink/perch_blink during
head-pat reactions. Curiosity lines promising a closer look now accompany a bounded
cursor visit: float beside the cursor, linger 3.5 seconds, then teleport back to
the latest original perch or prior desktop spot. Tours await this detour before
continuing. Movement does not generate dialogue or model requests. A 90-second
cooldown and existing quiet/chat/drag/sleep gates prevent repeated interruptions;
a new placement or conversation cancels the trip instead of snapping back.

Additional validation: 361 unit checks and nine source Electron checks passed,
including closed-eye pats in all orientations, full cursor visit/return, and
cancellation by a new placement.

## 0.2.35 regular conversation and shared continuity

Replaced the live chat acting brief with coherent character motives, opinions,
specific conversational reactions and grounded continuity. Regular chat receives
delivered desktop remarks and completed movement scenes; generated asides receive
recent conversation and those same scenes. Recent asides stay visible when chat
opens instead of being replaced by an older chat reply.

Local recall searches the existing chat history for relevant dated user/reply
pairs beyond the live window, including distinctive names and Capri opinions.
Short follow-ups inherit their recent topic for approved-memory selection.
Shared scene history persists under Save conversations, expires and caps locally,
and clears with chat history. Existing approved memories stay unchanged.

No additional model requests, embeddings or summarizers are introduced. A single
live configured GPT-6 Luna smoke check successfully joined a new desktop aside
with a seeded older conversation. See docs/CONVERSATION.md for bounds and caveats.

Final validation: TypeScript, 369 unit checks and eight packaged Electron checks passed. Approved personal memory contents are preserved during deployment.




