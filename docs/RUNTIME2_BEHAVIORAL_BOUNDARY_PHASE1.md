# Runtime 2 behavioral boundary repair, Phase 1

Baseline: `c69be90bee0d902873afa351970afbc80d7a166f`.
Branch: `fix/runtime2-behavioral-boundaries`.

## Verified causes

- `BuddyBubble.dismiss()` set a global presentation latch. Runtime 2 ambient
  output arrived through `delta()` and `done()`, which did not release that
  latch for a distinct utterance. `done()` also always selected reply styling.
  `remark()` released the latch without a stream identity, so simply routing
  every streamed update through it would reopen dismissed text and duplicate it.
- Ambient `chat:phase` used the same reveal path as direct thinking. It could
  reveal previous text before the new utterance was available.
- Both agent-tool permission admission and the native reaction host treated
  reactions as movement. The presence cue and local physical heartbeat also
  used the movement blocker. A position pin or denied teleport permission
  therefore suppressed effects that never change native placement.
- Generation and speech dispatch had diagnostics, but bubble acceptance did
  not. Disabled TTS could obscure the distinction between successful visual
  presentation and denied audio delivery.

## Changes and execution trace

`CognitiveLoop` attaches optional `aside`/`reply` delivery information to its
existing delta, completion (including interrupted completion), and phase events.
Legacy producers default to reply delivery. The existing `toPanel` bridge
forwards panel history normally and sends each stream ID to `BuddyBubble` once;
it does not turn speech dispatch into a second visual remark.

`BuddyBubble` rejects dismissed IDs before mutating text or the visible stack.
A distinct ID resets the presentation latch. Completion replaces streamed text
for that same ID instead of archiving another copy. `remark()` delegates to the
same aside completion path with a local identity. Asides preserve their styling,
generated-spontaneous origin, existing expiry, and composer protection. Direct
replies preserve reply semantics. Ambient phase notifications do not reveal a
previous bubble. Hidden/fullscreen restrictions apply even with a composer;
ambient presentation also honors sleep, quiet hours, do-not-disturb and existing
quiet commitments. TTS permission is independent of visual acceptance.

The existing recorder receives `presentation.dispatch` with response ID,
delivery, delta/done stage, bubble target, acceptance, and suppression reason.
The efficiency summary includes these outcomes alongside generation and speech
outcomes. Text-only talking animation is dispatched only for accepted visual
completion when TTS is disabled.

Physical admission now distinguishes `move` from `expression`. Only relocation
checks the position pin and teleport policy. The agent tool and native reaction
host both check expression permission. Existing shared checks for unavailable
desktop/character, dragging, recovery, hidden/fullscreen/gaming, sleep/quiet,
stay/focus commitments and direct activity remain in effect. Collection,
disclosure, retention and privacy-revocation paths are unchanged.

The existing physical heartbeat uses expression admission for in-place activity
and posture, but still uses movement admission for target tracking, obstruction
relocation, cursor following and accompanying another window. Native travel
continues to check movement admission before execution and while travelling.
The presence cue uses expression restrictions. No model action can clear a pin;
the existing authorized native user command remains the supersession path.
Supported-posture selection and renderer receipts are unchanged.

No new cognitive layer, prompt, memory system, timer or schedule was introduced.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Targeted unit coverage: 71 passing tests across `bubbleDelivery.test.ts`,
  `physicalBehavior.test.ts`, `twoSpeed.test.ts`, and
  `runtime2Integrated.test.ts` (run in focused batches).
- Three targeted Electron tests passed: `runtime2Delivery.e2e.test.ts`,
  `runtime2Physical.e2e.test.ts`, and `runtime2Cognitive.e2e.test.ts`.
- `git diff --check`: passed.

Coverage includes dismissed A receiving later deltas/completion, B appearing
once, direct replies, composer protection, disabled bubbles, TTS-disabled visual
delivery, accepted/suppressed recorder events, and unchanged legacy history.
The Electron delivery fixture traces synthetic provider output through the real
bridge and bubble renderer. It replays generated completion at the presentation
boundary under quiet/sleep/hidden/quiet-commitment restrictions, because those
restrictions normally prevent a new ambient inference from starting.

Physical coverage exercises actual pinned user placement, denied relocation,
eligible local activity without changed native bounds, renderer-confirmed
reaction completion, quiet/sleep/hidden/stay constraints, native user-command
supersession, supported poses, lost-window recovery and dragging cancellation.
The unit tool test separately verifies denied movement and dispatched reaction
receipts from the same synthetic model output. Generic heartbeat tests preserve
fullscreen, gaming, recovery, focus and unavailable-desktop restrictions.

All provider responses were deterministic fixtures. No live cloud inference or
user model quota was used. Isolated synthetic profiles were removed. Normal and
daily-test profiles were not changed. The exhaustive suite was not run.

## Remaining limitations and attended checks

- Acceptance means the host accepted text for the bubble window. It does not
  prove that a person saw it, that the window was unobscured, or that every frame
  was painted. Electron coverage verifies actual bubble renderer content, but
  uses offscreen windows. Attend a visible Windows run to assess focus, expiry,
  hover/stack behavior, fullscreen transitions and animation comfort.
- The conversation journal still stores generated assistant text even if its
  bubble delivery is suppressed. New diagnostics expose this difference, but
  the journal does not yet annotate presentation status. Later model context
  may therefore include an unshown line. Changing that evidence contract is a
  broader architectural follow-up, outside this phase.
- A dispatched physical reaction is not a completed animation. Existing
  renderer completion/interruption receipts retain that distinction.
- Speech delivery remains independent of visual dismissal. This phase does not
  redefine the audio interruption policy or force speech/movement frequency.
- Runtime 2 remains development-only (packaged Runtime 2 selection is rejected
  by the existing runtime selector). No release version, installer, installed
  application or shortcuts were changed. Live SIWC behavioral quality remains
  unverified.

## Changed files

- `src/main/bubble.ts`
- `src/main/desktop/physicalBehavior.ts`
- `src/main/index.ts`
- `src/main/runtime2/agentTools.ts`
- `src/main/runtime2/cognitiveLoop.ts`
- `src/main/runtime2/diagnostics.ts`
- `src/main/runtime2/perception.ts`
- `src/shared/ipc.ts`
- `tests/unit/bubbleDelivery.test.ts`
- `tests/unit/physicalBehavior.test.ts`
- `tests/unit/twoSpeed.test.ts`
- `tests/e2e/runtime2Delivery.e2e.test.ts`
- `tests/e2e/runtime2Physical.e2e.test.ts`
- `docs/RUNTIME2_BEHAVIORAL_BOUNDARY_PHASE1.md`

The pre-existing untracked `docs/DEVELOPMENT_SETUP.md` is preserved and excluded.
