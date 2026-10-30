# Capri 0.2.52: adaptive attention and behavior review

The review covered desktop observation, initiative admission, movement, direct interaction, speech delivery, continuity, settings/privacy changes, and the developer view. It retained the reconciled core, existing renderer and memory stores. No new behavior framework or runtime dependency was added.

## Behavioral changes

The ten-minute interval no longer controls observation. The saved legacy value is retained for profile compatibility and removed from the settings UI. Events and evidence determine whether another look is useful.

| Situation | Response |
|---|---|
| A new exposed application window opens | Local notice on the next presence cycle, subject to current activity and quiet controls |
| The new window settles in the foreground | Eligible for one selective visual decision after about six seconds |
| A document title changes | Wait for roughly ten stable seconds; loading-title churn does not trigger a sequence of requests |
| An unfamiliar foreground view persists | A glance can happen after four seconds; a selective visual decision becomes eligible after about eighteen |
| A familiar subject returns with a fresh unresolved curiosity | A possible revisit after settling, with per-subject and request limits |
| An unchanged accepted image returns | Reuse the reading; do not request the model again |
| The user is rapidly switching apps | Avoid chasing each switch; wait for a settled view |
| Capri is resting or staying put | She may still look and understand; movement remains restricted |
| Recent speech already fills the moment | Retain visual understanding and use a gesture rather than another aside |
| No new evidence or meaningful event | No model request just because time passed or a fidget played |

These are eligibility delays, not guaranteed response times. Provider latency, direct conversation, focus, privacy, sleep, visibility and request limits still apply.

## Concrete fixes and cleanup

- Removed the use of the 30-minute conversation-retention flag as an attention blackout. A remembered exchange is different from a conversation currently occupying Capri.
- Separated ledge rest and staying in place from visual attention. An investigation can be a glance while staying put.
- Added bounded native-window inventory tracking to the existing presence cycle. Startup seeds the inventory without pretending every existing window just opened. Titles remain metadata, not evidence of unseen contents.
- Removed timer-driven context and activity requests. Actual low-battery or changed adverse-weather cues can still provide meaningful context.
- Limited an unresolved curiosity to one follow-up opportunity until relevant external evidence or user input changes. The consumed opportunity is retained as a bounded hash in the existing state, so restart does not replay it. A model rewriting its own intention does not create new evidence.
- Added accepted-image fingerprint checks for redundant inspections. Rejected or failed readings do not establish an accepted fingerprint.
- Consolidated optional-request limits into one shared budget implementation. Observation can be more frequent without allowing unlimited calls.
- Applied a separate unsolicited-speech restraint: at least 45 seconds between delivered asides and at most three delivered lines within five minutes. Direct user conversation has priority. The model sees whether speech is currently appropriate, and host validation can convert a crowded speaking decision into a real nonverbal decision.
- Fixed authored scene lines being entered into dialogue replay history before delivery. They are now remembered at the same acceptance/completed-audio boundary as their actual delivery.
- Cancelled optional observations when foreground focus moves elsewhere, even if the old window remains exposed. Newer diagnostics are protected from an older cancelled request finishing later.
- Screen-reading permission changes and disabling spontaneous remarks cancel pending optional work. Selected-provider/model changes also cancel stale optional work and refresh provider status, including Codex and Claude configurations.
- Automatic visual capture now requires an explicit Allow policy. Ask first does not silently authorize background captures. Off-the-record exchanges stop optional capture before collection. Revoking permission invalidates pending work; granting permission clears stale attention eligibility.
- Provider deadlines now produce an explicit timeout diagnostic rather than disappearing as an expired decision.
- Standardized default clock callbacks in the affected behavior/continuity services for consistent deterministic replay.
- Updated the developer overview to show separate inspection and speech waiting periods and to count screenshot collection as pending work.

## Additional reliability fixes

Windows system speech now waits briefly for the selected voice to become available rather than dropping the first queued sentence. That wait is cancellable, has a deadline, never substitutes another voice, and emits one terminal error receipt. Native Windows speech and interruption passed in the focused packaged rerun.

With desktop context turned off, an unrelated settings save previously cancelled direct contextual reactions again and again. Context is now cleared/cancelled on an actual privacy transition, rather than on every volume or position write.

The regression harness now waits for real renderer readiness, avoids borrowing the user's idle state or pointer location for deterministic cases, waits for sleep settings to reach the renderer, and bounds shutdown of its own isolated child processes. Locked temporary Chromium cache files do not change the result of a successfully checked behavior.

## Request economy

At most six optional ambient attempts in ten minutes, with at least 30 seconds between them. Ambient and memory work share a ceiling of eight attempts in ten minutes. Memory learning retains its own three-attempt lane; deliberate placement and intentional contact keep their separate bounded lanes. These are maximum allowances, not periodic schedules. Automatic observation without an exposed preview does not request the model just to invent contents from a title.

Normal direct chat, existing action permissions, artwork, voice/provider selection and saved personal memory formats remain in place.

## Validation and deployment

0.2.52 passed TypeScript validation and all 493 unit tests in 51 files. Final focused packaged reruns covered 25 distinct checks with no remaining failure among those checks, including all ten adaptive-attention cases, native Windows speech/interruption, direct conversation and episodic restart continuity, sleep controls, developer state and controls, and flourish/mask previews.

Earlier broad 0.2.50 sweeps and repeated 0.2.52 runs contained failures and timeouts. They are retained in the delivered validation history. A full all-green regression suite was not established for 0.2.52. A controlled real-provider/native-window fixture on 0.2.50 completed one automatic visual decision and attributed episode in about 15 seconds, with attention metadata pinned to that fixture. This does not establish multi-hour reliability or everyday naturalness.

The delivered `Capri-Adaptive-Behavior-Review-0.2.52.md` and `Capri-Adaptive-Validation-0.2.52.json` record the changes, measured scope, deployment checks, and rollback location.
