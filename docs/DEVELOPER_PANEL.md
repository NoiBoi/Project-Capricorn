# Developer panel

Open **Developer panel** from Capri's character or tray context menu, the panel's
Developer navigation item, or **System > Open developer panel**.

The installed Electron app exposes the same controls as development builds.
No test environment switch, remote-debug port or arbitrary code execution is needed.

## Construct moments in 0.2.41

The new Construct moments group previews the satellite, possession of an exposed window, cursor lightning, mask-only sleep, each expressive movement, and each cut-in. Scene previews use their complete fixed timelines; Stop cancels immediately and restores Capri. Mask and movement previews respect the duration control. Runtime state reports the current scene. These remain local previews and do not create relationship-history entries. See [Construct moments](CONSTRUCT_MOMENTS.md).

## Controls

- All thirteen shipped animation strips, including held, sleep/wake, perch variants
  and mouth frames. These are exact temporary sprite overrides, not saved settings.
- Notice, lean, stretch, settle, return, pickup and putdown activity cues.
- Pat, poke, hover, return and window interaction cues.
- Animation, interaction, activity and loading-state walkthroughs, with a configurable
  duration of 0.5 to 8 seconds per step.
- Opening replay and one real exposed-window exploration outing.
- Up to three exploration outings, capped to available windows and selecting
  distinct window handles even when their titles are identical. Trials skip their
  own long rest periods without changing the normal director's saved history.
- Simulate idle, Simulate sleep, Return now and Clear absence controls. These do
  not change the saved behavior mode. Simulated sleep forces its pose immediately;
  it is distinct from the persistent manual Sleep mode.
- Local dialogue samples for several events and YouTube, Discord, ChatGPT, Spotify
  or ordinary browser contexts. Samples use an independent dialogue director.
- In-app local checks for dialogue variety, identity context, rest scheduling and
  renderer liveness. These do not replace the full automated test suites.
- Live visibility, mode, conversation phase, FPS, movement, visit state, outing goal,
  rest deadline, request state, memory count and preferred-name summary.
- A bounded results log and a fixed header Stop preview button.

Only one job runs at a time. Ordinary ambient work is suspended during previews.
Local preview controls make no model, speech-synthesis, browser, shell-task or
external-action requests. The separately labeled **Live contextual checks** may
make one bounded model request using the exposed portion of a visible external
window. Normal budgets, quiet modes and cancellation remain in force. They never
click or control that application. Read-only identity inspection does not modify
user memories.

An exploration trial uses the real movement/geometry path with independent outing
memory. It restores the original position and supported perch after completion or
cancellation. It respects the normal Sleep, quiet, game, focus and exposure gates;
unavailable visits fail visibly instead of being reported as passed. Preview cycles
temporarily override renderer animation/state without changing saved character settings.

Closing the panel, leaving its Developer tab, opening chat, starting a chat message,
using the normal stop shortcut or trying to pick Capri up stops the preview. A stopped
or failed job clears its temporary renderer state. Desktop movement and opening
replay are unavailable while conflicting activity is already running.

## Electron access

The registered panel renderer has a typed, allowlisted bridge:

```js
await window.capri.invoke('dev:get');
await window.capri.invoke('dev:run', { kind: 'animation', name: 'perch_glitch', seconds: 2 });
await window.capri.invoke('dev:run', { kind: 'cycle', name: 'animations', seconds: .5 });
await window.capri.invoke('dev:run', { kind: 'dialogue', name: 'roam', surface: 'youtube', seconds: 3 });
await window.capri.invoke('dev:run', { kind: 'checks' });
await window.capri.invoke('dev:stop');
```

Run responds with the initial job state rather than blocking until the cycle ends.
`dev:get` returns the job state, current step, result log and a lightweight runtime
snapshot. The UI reads it once a second only while the Developer tab is mounted.
All three endpoints require the actual panel webContents. Character, bubble and
unrelated renderer senders are rejected. Commands are strictly validated against
finite catalogs; there is no arbitrary script, URL, tool or shell-command argument.

## Absence tests

Choose Company or Explore, then simulate idle or sleep. A two-second grace period
avoids treating the setup click as your return. After that, real cursor movement or
a reset of the Windows keyboard/mouse idle clock triggers the common return path.
Return now triggers that path directly. Sleep plays its wake strip before travel;
idle uses a wave. Both teleport near the cursor and can give a short local return
line under the usual quiet/voice settings. The normal return path has the existing
cooldown; explicit test returns can be repeated. Tests do not generate model replies.
Return speech can use the user's configured voice engine, unlike silent animation
previews. Clear absence exits the simulation without teleporting. Simulations are
session-only and may remain armed after closing the panel so you can leave and
return naturally.

```js
await window.capri.invoke('dev:run', { kind: 'explore', count: 3 });
await window.capri.invoke('dev:absence', 'sleep');
await window.capri.invoke('dev:absence', 'return');
await window.capri.invoke('dev:absence', 'clear');
```

## Expanded behavior coverage in 0.2.36

- **Secondary artwork** previews closed-eye sitting and reclining with
  localized shader motion. Sitting supports mirrored/inverted orientations;
  reclining is always upright. They do not change the
  saved alternate-pose preference. The original strips stay the primary artwork.
- **Behavior scenarios** include the complete cursor visit and teleport return,
  quick window release, the held-window dangle/stand sequence, upright/perched/
  inverted closed-eye pats, app-aware drop fallback, and read-only shared history.
  Cursor and perch movement scenarios restore the original placement.
- **Contextual pings** preview late-night, rain, snow, storm, fog, hot/cold, battery
  and long-session lines. Fixtures do not alter the clock, actual weather, battery,
  normal ping history or configured quiet rules.
- **Live contextual checks** test a window-drop comment, a content-aware visual
  inspection, or a return comment. An inspection can produce up to two validated
  content locations in the same request as its comment. It does not initiate a
  computer-control agent. Unsupported vision providers use metadata honestly.
- The live diagnostic summary reports the latest dialogue outcome, validated
  visual point count and number of shared scenes. A skipped/limited drop uses a
  varied local fallback; a quiet inspection can legitimately yield no comment.
- Local dialogue event sampling now includes notice/resume/arrival, putdown,
  return and thanks, in addition to the existing interaction and outing events.

```js
await window.capri.invoke('dev:run', { kind: 'secondary', name: 'sit_closed', inverted: true, seconds: 3 });
await window.capri.invoke('dev:run', { kind: 'scenario', name: 'cursor_visit', seconds: 3 });
await window.capri.invoke('dev:run', { kind: 'scenario', name: 'pat_inverted', seconds: 3 });
await window.capri.invoke('dev:run', { kind: 'ping', name: 'late', seconds: 3 });
await window.capri.invoke('dev:run', { kind: 'live', name: 'inspect' });
```

## Purposeful pose scenarios in 0.2.40

Hover and downward-inspection fixtures now retain the original artwork. Front-facing sitting is exclusively the closed-eye cutout, triggered by four seconds of continuous head rubbing while perched upright on a window. The open-eye cutout is never loaded. Releasing the rub restores the original sitting art after the short movement grace period.

The supported rest fixture uses a lower ledge: lying starts immediately, then alternates 75 seconds of lying with 35 seconds of original side sitting. Natural lower-edge drops snap within 42 DIP and defer autonomous exploration, teleports, cursor visits, small activities and inspections for a random six to nine minutes. Manual movement still works. Lying requires clear space and disappears if support is lost. Local lounge dialogue uses the existing procedural dialogue engine and repetition history. Lying dialogue placement receives the transformed whole-body bounds as well as the face, scores above/beside/below locations after screen clamping, and avoids covering the body. Display selection follows the face rather than the transparent character window. The body anchor clears on returning to original artwork.

Hair shader displacement is stronger, with the face and support contact still pinned; reduced-motion and static fallback remain supported. The sleep strip is 90% of its previous size with its contact line preserved. Window-top placement now progresses from original sitting to lying beneath a low ceiling, then inverted sitting only when the shallow lying silhouette no longer fits. Both transitions have hysteresis. A narrow or covered ledge that cannot support lying falls back to inverted sitting. Lying uses a 900 ms minimum turn cooldown and a 280 ms stable-direction requirement.

The obsolete secondary float is removed. A requested inverted lying preview is
shown upright and logged as such. Natural lying requires a real supported edge
and clear room above, and cannot occur on an inverted perch.

Preview lines and completed preview movements are excluded from the companion's
shared relationship history, including the explicitly labeled live checks.

The Secondary artwork section includes an Animated/Still choice and Compare still and animated poses. Comparison shows sitting then lying, each still first and animated second. Live state reports actual shader availability and motion, reduced motion, or static fallback. All are local and make no model requests.
