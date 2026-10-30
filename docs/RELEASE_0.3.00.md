# Capri 0.3.00

The Windows package uses the standard version `0.3.0`. This release includes
the full earlier 0.2.57 dialogue/companion work and the additions below.

## Dialogue panels

- Up to four recent outputs remain visible together instead of immediately
  replacing one another. Their group is positioned around Capri's actual body
  and available monitor space, including lying and inverted poses.
- Panels grow in width and height to fit text. If a reply cannot fit on the
  monitor, More/Previous controls provide the remaining text without a message
  scrollbar. Long older remarks have Read full controls.
- Each remark retains its original display-time deadline when a newer remark
  arrives. Expiring panels fade, then the remaining panels resize and reposition.
- Fade updates preserve existing panel elements instead of replaying their
  entrance animations. An expired newest remark does not reformat an older
  remark as a new response.
- Hovering the dialogue area pauses expiry. New remarks arriving during hover
  also retain a full reading interval after the pointer leaves.
- Cartoon speech pointers have been removed from all dialogue panels.
- The composer returns to simple dialogue after four seconds away, then fades
  normally. Hover, an unsent draft, and an active response protect it from
  collapsing while in use.
- Hold Ctrl+Space+C to open/focus Capri's reply box. The chord is sampled without
  recording typed text. The existing Ctrl+Alt+Space shortcut also remains.
  The explicit summon also activates the native Windows reply window and its
  input field, so keyboard input works without clicking the box first.
  Esc dismisses the reply box and restores the previously focused window when
  that window still exists.

## Movement, rest and music

Repeated pats and pokes have generated third/fifth-touch reactions with the
actual count and current exchange. A short settling delay coalesces rapid
touches, preserving model request limits rather than generating on every poke.

- A flight releases its previous attachment and support before movement begins.
  An attached departure gets a brief upright floating transition, preventing an
  inverted perch sprite from travelling across the window.
- Chosen lower-window and taskbar rests can last 5 to 15 minutes. Supported long
  rests stay lying instead of alternating to sitting every 75 seconds. Sleep,
  movement, user handling and loss of support still take priority.
- A real Codex cooldown, or a rate-limit error from a behavior provider, can
  prompt a local taskbar rest with no model request. It respects quiet, focus,
  active interaction and movement gates, and does not invent a battery reading.
- Hidden/covered Spotify metadata is omitted from unrelated conversation.
  Explicit music questions can still use the identified track. Unsolicited
  background-track candidates are spaced at least 15 minutes apart; visible
  Spotify keeps the more frequent existing song-change behavior.
- The installed sleep threshold is preserved rather than reset. Idle/sleep
  continue to use user activity and the configured timer, with text return
  greetings independent of model availability.

## Identity and continuity

`docs/DIALOGUE_GUIDE.md` remains the cumulative source used by both chat and
spontaneous remarks. It preserves sass, personal tastes, self-awareness,
creator/title-first YouTube reactions, accurate physical context, and previous
preferences. The submind framing is an additional adaptation directive for
relevant capability/identity questions, not a replacement personality or a
claim of hidden access to the larger fictional AI.

All delivered companion dialogue, authored as well as generated, is appended to
Chat and broadcast to an already-open panel. Normal chat replies keep their
existing entry; cancelled/quiet decisions create none. History retention and
off-the-record controls still apply. Casual title/creator reactions also omit
verdict-withholding and categorical/qualitative/missing-information preambles;
unsupported details remain unsaid rather than invented.

Timed movement commands remain a separate limitation: "stay here" is enforced
until release, and quiet-company duration is supported. "Sit here for 25 mins"
and "avoid this window for 30 minutes" are not yet enforced timed movement
contracts. This release does not claim otherwise.

The earlier cursor visits, new-window interest, tour/perch/lounge choices,
clock/battery cues, immediate interaction bank, generated pat continuations,
same-window relocation reactions, settings/developer reactions, long-term
continuity and higher activity allowances remain included.

## Verification

Focused checks cover original expiry deadlines, fade/removal, hover with new
messages, composer collapse and draft protection, fifteen minutes of sustained
recline, configured sleep entry/return, real stacked-panel layout, upright
departure, model-free resting, hidden Spotify context, and guide inclusion.
Packaged checks and profile-preserving deployment are recorded alongside this
release's output reports. The checked portable package is used for deployment;
a separate NSIS installer attempt failed to open its generated output file.
