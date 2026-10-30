# Testing & performance

Results from 2026-10-25 (the overhaul) on an AMD Ryzen 7 7730U (16 threads, Radeon iGPU), 14 GB RAM, Windows 11 Home (build 26300), one monitor at 125% scaling.

All automated runs use **off-screen mode** (ADR-13): no windows, tray icon, hotkeys or notifications appear on the desktop.

## Results

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p .` | clean |
| Unit (9 files) | `npm test` | **176 / 176 passed** |
| End-to-end, dev bundle | `npm run test:e2e` | **38 / 38 passed** (microphone and live-Gemini tests opt-in) |
| **Live Gemini e2e** | `CAPRI_LIVE_GEMINI=1 npm run test:e2e` | **passed** against the real API |
| Packaged build | `npm run verify:package` | **12 / 12 checks**: install, layout, key scan, 38/38 e2e against the installed exe, perf (startup 308 ms, idle 1.6% CPU, 47.7 fps), uninstall |
| Live Gemini probe | `node scripts/gemini-probe.mjs` | auth OK, 60 models visible, stream (first token 0.73 s) + multi-turn OK |
| Real-desktop take | `node scripts/record-demo.mjs` | full scripted session on the real desktop, no test hooks (see the trailer) |

## Bugs found by the overhaul's real-desktop takes (all fixed, all with tests)

| Symptom | Cause | Test |
|---|---|---|
| She crept 1 px down-right every 0.3 s after any move, and `settings.json` was rewritten 3×/s | at 125% DPI the window size reads back ±1 px; the settings handler "fixed" it, moving her, which saved the position again | e2e "after a teleport she stays exactly where she landed" (fails without the fix) |
| She sat in "thinking" for a minute or more | an occasional Gemini request never streams, and the SDK's body reader ignores aborts | unit: quiet stream after headers; request that never starts |
| Long silent waits on free-tier keys | 429 retry delays (~40 s) were waited out twice | unit: long quota wait goes to the fallback or fails fast |
| `gemini-3.8-flash` failed every message | it rejects `thinking_level: minimal` | unit: retried with the model's default, remembered |
| Raw `<emote>{…}</emote>` text in her replies | the model improvised a tool-name tag | unit: improvised tags run as actions; unknown tags stay text |
| Action status "done" wrapped to two lines | flex shrink | visual |

## Live Gemini verification (real API, local key)

- **Authentication:** `models.list` succeeded; `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` are both listed for this key.
- **Status:** the app showed **Connecting → Connected** after a real check (0.8 s).
- **Conversation:** the first streamed chunk arrived after 0.64 s; the reply came in 4 progressive deltas.
- **Multi-turn:** the second turn correctly recalled the first (the code-word test).
- **Bad configuration:**
  - An invalid key returns `API_KEY_INVALID`, shown as an *Error* state with a readable message.
  - A missing key gives a clear "No Gemini API key" error.
  - A dead network gives "Network error reaching Gemini" and the status moves to *offline*.
- **Key hygiene:** the key appears in none of the logs, history, settings, the installed app files, the asar listing or the installer (byte search).

## What's covered

- **Gemini (mocked HTTP + live):**
  - Interactions SSE parsing, with thought-signature deltas ignored.
  - Request shape: stateless history steps, `system_instruction`, `store:false`, `max_output_tokens`, `thinking_level`.
  - Key only in the header.
  - Fallback model on 404, with a "fallback" notice.
  - 429 retried using `retryDelay`; invalid key not retried; missing key gives a config error (never a mock reply).
  - Network failure is fast and classified; `test()` checks model availability; TTS/image models are filtered from the list.
  - Errors are scrubbed of keys, and the logger redacts both Google key formats.
- **Connection monitor:** connecting→connected only after a real check; network→disconnected, auth→error, transient→unchanged; offline mode is never "connected"; stale checks can't overwrite newer ones; the panel chip shows "no AI" / "online" / "error" / "offline".
- **Teleportation:**
  - Destinations always fully on-screen, a real distance away, never under the cursor; the active window is avoided; beside-cursor, other-monitor, corner, left and right all work; a single monitor degrades gracefully; impossible layouts are rejected (never off-screen).
  - The real window moves; departure and arrival effects both run and are acknowledged; she arrives with an observed pose clip; the new spot persists.
  - A stalled renderer times out safely; overlapping teleports are rejected; the auto interval stays in bounds.
  - **Autonomous teleport is blocked without AI and runs once genuinely connected** (a mock Ollama provides a real "connected" state); it's also blocked during a conversation, when you're away, or when turned off. Manual teleport works without AI.
- **AI → character:** emote/teleport validated against fixed enums; the model made her play `menace` and teleport to a corner; no extra model round; no chat clutter; taint doesn't block cosmetic actions; offline mode understands "teleport", "come here" and "other monitor".
- **Character & animation:**
  - Rig integrity; the figure fits the frame; almond-eye/many-eyes/teeth rendering; transparency and hit testing.
  - The spring integrator is stable from 5 to 144 fps; transitions are continuous; blink cadence; the full state machine.
  - 39 clips: well-formed, honest provenance (6 tied to official footage or frames), snap easing, mirroring, fade in/out.
  - 10 simulated idle minutes give ≥10 distinct clips with no repeats; quiet hours use subtle clips only; conversation cancels ambient clips; an error never leaves her "thinking".
- **Interface:**
  - All 10 views at 340×420, 420×620 and 900×900 have no horizontal overflow and the close button stays visible. That test caught a real overflow bug, now fixed.
  - Onboarding offers Gemini and finishes into chat.
- **Everything from v1:** streaming providers, interruption, permissions, prompt-injection defence, IPC sender validation, mic denial, memory/settings persistence, crash detection, renderer-crash recovery, DPI position creep, idle performance.
- **Cleanup:** after Quit, no Capri process remains (checked by command line and PID).

Not automated:
- drag-by-mouse and right-click menus (OS input on a non-focusable window)
- real fullscreen-app hiding (the detection binding is verified as active)
- physical second monitor (multi-monitor logic is tested with simulated displays; only one monitor was available)

## Performance (`node scripts/perf.mjs <exe>`)

| Metric | Installed build (v2) |
|---|---|
| Launch → character visible | 322 ms |
| Idle CPU (all processes, % of one core) | 1.8% |
| Memory, all Electron processes | ~450 MB |
| Render rate | 30 fps idle, ≤60 fps active, 15 fps asleep, 0 when hidden |
| Teleport (out + move + in) | ≈1.5 s |
| Installer / installed size | 118.8 MB / 383 MB |

## Bugs found and fixed in the v2 work

1. Gemini SDK internal retries stacked on top of ours, so a dead network took over 20 s to fail. The SDK's retries are now disabled, leaving one bounded policy.
2. `gemini-3.8-flash` rejects `thinking_level: minimal`, and at `low` it took 90 s per reply. It's documented as unsuitable, and the configurable thinking level now has a hint.
3. The live test prompt "remember this code word" correctly triggered the `remember` permission prompt and waited. This was a test-design issue; the permission flow behaved as designed.
4. A long connection chip pushed the whole panel wider than the window, hiding the send and close buttons. Fixed with grid `minmax(0,1fr)` and chip truncation; now guarded by a test.
5. The black hair shards were drawn under the new glitter sheen and looked grey. The draw order is fixed.
6. Electron's `offscreen` flag still shows a transparent native window on Windows, so off-screen mode now never shows native windows at all.
7. On a cold first launch right after install, the window was shown a beat late. The test now waits (the app itself was fine).

## v3 (postures) additions

- **Unit:**
  - Every posture cites a source and fits its surfaces.
  - Over 20 simulated minutes postures change several times but never twitchily, and only to ones that fit the surface. There's no "sitting on nothing" in mid-air, and she peeks at edges.
  - She dozes on a ledge or curled up in the air; dragging makes her stand; talking never makes her jump up; thinking's hand-to-chin wins over the posture.
  - Dashing streams the hair.
  - Perch seats her exactly on the window's top edge (and is refused on maximised or narrow windows); peeks are partly off-screen but visible; glides move the window through intermediate positions with the dash cue on and off.
- **End-to-end:**
  - She detects the taskbar and sits on it, really lowering her body.
  - She perches on a (fake) active window with her seat aligned to its top edge, then startles and jumps away when the window moves.
  - She peeks from an edge with the leaning posture, and the AI can make her sit.
- **Bug found:** the sitting pose shifted her sideways and clipped the hair cloud at the window edge. Fixed by widening the character window from 300 to 340 px.
