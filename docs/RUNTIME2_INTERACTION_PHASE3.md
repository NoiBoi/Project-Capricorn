# Runtime 2 Phase 3: user interaction and character feedback

Base: `0ea1b7d6d9bfe0bd281de76fb8d84864bde95bb0`.
Branch: `fix/runtime2-interaction-character-feedback`.

Both architectural audit passes and the Phase 1/2 delivery documents were
reviewed. This phase reconnects their confirmed interaction and feedback gaps.
It does not measure a real model's natural responsiveness or perceived
intelligence.

## Confirmed causes

- `onAudio()` always called the legacy `convo.send()`, although that conversation
  is disabled in Runtime 2. Starting recording also interrupted only legacy
  cognition. Runtime 2 admission did not retain voice-input origin.
- A late transcription had no recording identity, and cancellation did not
  invalidate an already pending transcription. A microphone stream could arrive
  after cancellation while its permission request was still pending.
- Runtime 2's `interaction()` branch emitted its immediate life cue and returned
  without supplying contact context. Pickup/placement still entered legacy
  contextual paths; opening Capri's own interface returned immediately.
- The Runtime 2 `chat:phase` bridge updated presentation but did not dispatch the
  existing character phase cue. Runtime 2 speech receipts were logged without
  updating character phase. Old inference completion could compete with a new
  listening/transcribing phase.
- The loop's failure handler set its pause flag after ordinary ambient failures.
  Later observations did not release it. Blindly clearing that flag would also
  release explicit stops and could repeatedly retry due work.

## Changes

### Voice and direct-message admission

`sendUserMessage()` is the shared host route for typed text and successful
transcripts. It selects Runtime 2 or the legacy conversation once. Runtime 2's
existing `send()` accepts optional `viaVoice` metadata; the same journal record,
history projection and provider encoding preserve it. No second history or
voice persona was added. Legacy selection still dispatches to `convo.send()`.

Starting recording interrupts the active runtime. The character mic cue and
returned audio carry a recording identifier. Audio is accepted only once for
the current recording with current microphone permission. Recording cancel,
chat stop, a new typed message, privacy withdrawal and shutdown invalidate
pending voice input. A late transcription or old microphone error cannot
override the newer recording. Existing listening, transcribing, empty-input and
error feedback remains. Stop/cancel shortcuts also target the active runtime.

`MicRecorder` invalidates pending device acquisition on stop, releases a late
stream, detaches its audio callback, and clears the old capture resources before
awaiting AudioContext closure. This avoids an old stop clearing a new capture.
Transcription providers, WAV encoding, endpointing and synthesis remain intact.

### Host interaction context

The existing observation contract gains the `user-interaction` modality with
bounded structured contact, placement and interface facts. The small
`interactionObservation()` helper creates host-attributed observations, not user
messages. `Runtime2.observeInteraction()` admits them through existing collection,
retention, revocation tracking and `Perception.observe()` paths.

- Contact keeps its immediate local life cue and physical cancellation. The
  existing touch timer combines rapid pats/pokes after a 900 ms lull, with a
  three-second burst boundary and at most 100 contacts in one record. Sustained
  handling flushes bounded bursts. No contact handler calls inference or writes
  a canonical interest. Exact counts and timestamps establish contact only,
  without assuming affection, annoyance or intent.
- Completed manual placement supplies destination handle/title when authorized,
  prior support, surface, whether she moved aside, and whether physical activity
  was interrupted. The interruption fact is captured before cancellation. Only
  completed handling is recorded; drag coordinates are not streamed to cognition.
  User placement and model movement remain distinct, and the pin is unchanged.
- Own-interface navigation is limited to settings, attention, voice, character
  and developer pages, at most once per page per two minutes. Navigation explicitly
  establishes no settings change. Explicit settings saves coalesce speech
  enablement, behavior mode and character scale changes for 900 ms, retaining the
  latest value per field. Position persistence and unrelated controls create no
  model message. Legacy contextual remark generation is not reactivated.

The new observations use the existing local-context, screen-access, history and
avoided-window permissions. Their nominal retention is one day and their live
freshness is ten minutes; existing archive pruning and disclosure checks still
apply. Immediate physical reactions continue when cloud context is unavailable.
Privacy changes discard pending interaction coalescing and revoke retained
source data through the existing path.

Phase 2's bounded selector can supply unhandled interactions to direct, ordinary
ambient and deep continuation requests, including contact received during an
ongoing request. Events are labeled historical facts, never currently visible
page content. They share the existing two-record semantic allowance and context
budget. They do not retire an unrelated interest or force another model call.
The existing attention controller still governs admission, silence backoff,
watch-only constraints and explicit attention pauses.

### Character feedback and recovery

Direct Runtime 2 phases now dispatch existing `phase` cues, deduplicated at the
host. Listening/transcribing takes precedence over late inference completion.
Existing speech-start/end/error/cancel receipts control speaking feedback for
the current utterance; stale speech receipts are ignored. Stop emits idle
feedback promptly. Text-only talking retains Phase 1's existing path.

Ambient thinking does not send a direct character phase or reveal an old bubble.
Phase 1's dismissed-stream and aside presentation behavior remains intact. No
new animation director or animation assets were added.

Recoverable ambient failures no longer set the permanent pause flag. They apply
the existing silence backoff and wait for a new eligible observation. There is
no retry timer and no retry merely because a deadline remains due. Later events
still pass ordinary scheduler and host admission. Explicit stops, aborted
requests, privacy/authentication denials, daily/plan quotas, storage ceilings and
tool-round exhaustion retain the paused/control-gated behavior. Direct failure
handling is not broadened into an automatic recovery loop.

## Deterministic preflight and verification

Run `npm run preflight:runtime2-interactions`. It builds the development bundle
and runs just the interaction unit/worker and Electron fixtures. Microphone
devices, transcription, synthesis and model output are replaced with controlled
fixtures; no live account inference is used.

- Preflight: **20 passed**: 16 unit/worker tests and 4 Electron tests.
- Existing focused regression coverage: **109 passed** across
  `evidenceContinuity`, `twoSpeed`, `cognitiveLoop`, `runtime2Integrated`,
  `bubbleDelivery`, `physicalBehavior` and `speech` unit files.
- Existing Electron cognition, delivery and physical tests: **3 passed**.
- `npm run typecheck`, development build and `git diff --check`: passed.

The Electron preflight exercises actual typed-message, audio, contact, settings,
panel-navigation and speech-state IPC. It checks once-only routing, voice origin,
interruption, cancellation during transcription, stale audio, microphone
permission withdrawal, error recovery, character renderer phase, five immediate
touch cues becoming one 3-pat/2-poke observation with zero inference calls before
explicit test admission, and actual event content in subsequent requests. It
also verifies the legacy-only voice route and quiet/privacy restrictions.

The physical regression now explicitly waits for a real drag to cross its
movement threshold and verifies a user-placement observation with interrupted
activity. Its synthetic pointer samples use fresh coordinate objects, matching
the native sampler; the older fixture mutated its starting point in place and
could finish as a click. Pinned movement denial, permitted expression, supported
poses, lost-window recovery and physical preemption remain covered.

Worker tests verify event attribution, privacy withholding, contact received
during direct work, unchanged active interests, real scheduler resumption after
a transient provider error or corrected context budget, no automatic retry,
explicit stops, attention pause/watch-only restrictions, plan/request ceilings
and canceled pending microphone acquisition.

No exhaustive suite was run. Normal and daily-test profiles were untouched.
All temporary synthetic and legacy test profiles were cleaned up. The unrelated
untracked `docs/DEVELOPMENT_SETUP.md` is preserved and excluded from delivery.

## Diagnostic receipts

Existing recorder events now distinguish:

- `voice.input`: recording start, audio receipt/admission, cancellation and late
  transcript rejection, using identifiers/counts rather than another transcript
  or audio payload.
- `user-message.admitted`: the journal ID and typed/voice origin.
- `interaction.received`, `interaction.coalesced`, `interaction.admission`: local
  contact arrival, burst facts, archive admission and observation identifier.
- Phase 2's `evidence.selection` and assembled request inspector: whether an
  interaction actually reached the model and whether budget/permission omitted it.
- Existing provider/tool/presentation/speech receipts: model choice and delivery
  or physical outcomes.
- `character.phase`: phase, cause and character cue dispatch availability.
- `cycle.recovery`: recoverability, pause status and the next required admission.

No diagnostic subsystem or privacy exception was introduced. A dispatched cue
is distinct from human-visible animation; the Electron tests separately inspect
renderer state.

## Remaining limitations and real-model validation

- Integration is verified; natural responsiveness, good judgment, timing and
  perceived intelligence are unmeasured. An attended trial should compare single
  incidental contact with sustained handling, preserve a stated opinion through
  repositioning, and allow silence or nonverbal response without repeated
  acknowledgements. Confirm that interface changes do not prompt repetitive
  remarks and that unrelated activities proceed without forced callbacks.
- Actual microphone hardware, recognition quality and audible synthesis were
  not exercised. Canceling transcription discards its eventual result; existing
  transcription APIs can still finish their underlying operation.
- Coalescing delays contact context until the burst flush. Two semantic records
  share the existing allowance, so simultaneous events or competing relevant
  evidence can remain metadata or require archive recovery. No model is forced
  to respond to a retained event.
- Host interaction context currently requires the existing local screen/context
  and history permissions even for contact. Denied collection still leaves the
  immediate local reaction available.
- Recovery deliberately waits for a later eligible observation. Authentication,
  permissions, budgets, explicit cancellation and hard failures can still need
  user control changes or explicit resume. No failure alone schedules another
  request.
- Runtime 2 remains development-only. No version bump, installer, installed app
  replacement, shortcut change or live model validation is part of this source
  delivery. Phase 1's generated-versus-presented journal limitation remains.
