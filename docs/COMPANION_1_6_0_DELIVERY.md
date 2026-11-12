# Capri 1.6.0 companion delivery

Historical first delivery. The current 2.0 beta and subsequent live/UX evidence
are described in [Companion development](COMPANION_DEVELOPMENT.md).

Implemented November 12, 2026 on `feature/companion-evidence-loop`, based on
`a062abe` (the November 5 interaction/context correction branch).

## Delivered

- Default Runtime 2 companion mode with two ordinary evidence tool calls and one
  outcome-aware continuation. A durable investigation is optional for longer work.
- Automatic, bounded original-dialogue recall for direct turns, using the
  existing local journal and respecting conversation disclosure controls.
- Queued/playing speech gates optional ambient work, with renderer receipts,
  stale-event handling, queue bounds and timeout recovery.
- Installed `--runtime2` entry point that opens Chat paused in the existing
  isolated `daily-test` profile. Normal launch retains the legacy runtime.
- Matching taskbar commands retain the companion launch flag. Isolated Runtime
  2 cannot change the normal app's Windows login registration.

See the [architecture analysis and pinned sources](OPEN_SOURCE_COMPANION_REVIEW.md).

## Verification

| Check | Result |
| --- | --- |
| TypeScript check | Passed |
| Full unit suite | 93 files passed; 1,060 tests passed, one existing skip |
| Relevant source Electron suite | Eight files, 11 tests passed |
| Installed executable companion test | Passed with an isolated fixture profile; two evidence-turn inferences were fixtures |
| Production bundle and NSIS installer | Built successfully |
| Installed executable metadata | File version 1.6.0; product version 1.6.0.0 |
| Installed packaged manifest | `capri-buddy`, version 1.6.0 |
| Installed resources | `app.asar` SHA-256 matched the validated staged package |
| Normal installed companion launch | Runtime 2, existing `daily-test` profile, archive ready, recording off, paused, zero requests |
| Existing ChatGPT session in the installed app | Connected; plan sharing already enabled; no sign-in or inference performed |
| Startup log | Version 1.6.0, runtime 2, normal non-test launch |
| Desktop and Start Menu companion shortcuts | Installed executable, `--runtime2`, correct working directory/icon and `dev.capri.buddy` identity |

The native checks cover original evidence and images, movement and supported
poses, window closure/recovery, user preemption, typing/voice routing, speech
receipts, daily-session controls and restart continuity. The new bounded loop,
rejected escalation, recall limits/revocation/failure and overlapping queued
speech also have focused tests.

Two old comparison tests initially assumed that `two-speed` was the default;
their fixture now selects that mode explicitly. A pre-existing teleport admission
test intermittently selected a random destination with no safe traversal. That
test now uses a deterministic destination draw; production traversal is unchanged.
The final suites above passed after these corrections.

## Installation and preservation

Installed executable: `%LOCALAPPDATA%\Programs\Capri Buddy\Capri Buddy.exe`.
Use **Capri Companion** from Desktop or Start Menu to open the new architecture.
It starts paused. **Capri Buddy** retains the normal legacy launch.

Both existing profiles were backed up while Capri was stopped. The previous
1.5.5 installer was retained for rollback. No normal-profile migration, credential
copying, persona replacement or memory reset was performed. The pre-existing
untracked `docs/DEVELOPMENT_SETUP.md` remains outside this change.

## Limits

These checks establish implementation and integration, not improved natural
initiative or conversation quality. No new live-model inference, A/B test or
ordinary-use behavioral trial was run. Recognizing the existing account in the
installed app does not establish that the separate November 5 runner's guard is
fixed. The frozen comparison was not resumed.

Lexical recall can miss differently worded memories and later corrections;
historical mentions are explicitly qualified, with current canonical state and
corrections taking precedence. Adding semantic retrieval or local voice models
would require a separate measured decision. No new service/model dependency was
introduced in this release.
