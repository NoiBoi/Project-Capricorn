# Current preferences in 0.2.42

Mask-only sleep, satellite scenes and window possession are disabled by default and in the active user profile. Spins are removed from automatic choices and developer movement controls; the renderer rejects spin cues. The remaining features continue to work.

After a fall, Capri stands for 6-10 seconds, then uses the original sitting animation for 25-45 seconds. Subsequent supported rest cycles have a 45% chance of including a lying interval. Movement or loss of support cancels this recovery. Deliberate drops onto a lower ledge retain their existing lying behavior.

Lying dialogue uses the fixed pose envelope and contact display for its placement. Animated hair, head movement, mirroring and the pointer tail no longer drive text-box repositioning. It still adapts to actual character movement, screen bounds and text-box resizing.

The following describes the retained implementation and earlier optional features.

# Construct moments

Version 0.2.41 adds locally animated moments inspired by Capri Desktop, while retaining the existing lachydotmcg sprite strips, their timing, and their palette. The existing sitting, lying, head-rub, text-box placement, and window-clearance behavior remain the foundation.

## Everyday life

- Small movements use anticipation, held drawings at 12 fps, and a complete return to neutral: curious tilts, looks, hops, squashed turns, green/red split afterimages, landing squash, flinches, and edge peeking. Grounded hops keep their contact line. Large actions and supported lying suppress incompatible movement.
- Standing reaches rotate the actual arm pixels from the existing sprite around the shoulder. No replacement body or recolored source image is introduced. The original art remains at the same scale. When headroom permits, the satellite scene stands her up on her contact line to reach; she sits back down afterward.
- When her supporting window closes, she falls toward a safe lower ledge or the taskbar, then settles. Picking her up or starting another movement cancels the fall. Ordinary manual drops still preserve the requested placement behavior.
- After 40 seconds actually asleep, the body fades into a drifting construct mask with closed eyes and a rare peek. Natural sleep wakes with activity; explicit Sleep stays asleep until woken. Waking reforms the original body. Only the mask receives clicks while fully dissolved.

## Larger moments

Right-click Capri or her tray icon and open **A little spectacle**:

- **Look at the satellite**: a quiet constellation, a reach, charging, the red spark, the satellite's response, then settling. The full sequence lasts about 12 seconds. Autonomous satellite scenes occur at most once per local day, with the day remembered across restarts.
- **Possess this window**: a short dive, eyes and a grin over the visible window, red/violet edge lightning, then re-forming. After an autonomous possession, she may emerge at another safe window. Only exposed areas are drawn over. Closing, moving, minimizing, or covering the target cancels or clips the effect.
- **Play with the cursor**: anticipation, one short visual spark, and a reaction. No mouse movement, click, keyboard input, or change to the real pointer occurs. A manually requested spark on another monitor can bring Capri near that pointer first.
- **Stop the scene** restores Capri immediately. The existing Stop shortcut also stops it. Chat, head rubbing, dragging, quiet mode, fullscreen/game changes, and shutdown interrupt incompatible scenes.

Automatic large moments honor conversations, focus/stay requests, quiet hours, sleep, and the six-to-nine-minute settling hold. User-requested tray scenes can interrupt the lounge hold without shortening its remaining duration. Possession and cursor play have separate minimum spacing, and small movements vary without consecutive repeats. No new model calls are needed. Relevant original dialogue uses the existing procedural dialogue director and shared repetition history; previews do not enter relationship history.

Brief grin, laugh, eye, and sideways-look cut-ins use the already imported artwork. Normal cut-ins have a 35-second minimum gap. A multi-action task completion can produce a small victory movement, with its own 90-second spacing. Preview buttons can show each cut-in without waiting for that gap.

## Controls and accessibility

**Character > Little spectacles** contains separate switches for expressive movement, deep sleep, reaction close-ups, satellite moments, window possession, and cursor lightning. **Everyday activities and cursor play** governs autonomous choices. The tray can still request an enabled scene directly.

Reduced motion suppresses added body deformation, afterimages, cursor bolts, scanning slices, and star travel. It retains a calm constellation or mask treatment. Animation intensity and the existing effects setting also apply. There are no full-screen impact flashes in these new scenes.

The scene window is temporary, transparent, unfocusable, and click-through. It has readiness, crash, target-validity, and hard lifetime checks. It never captures a desktop image or reads target-window contents. All geometry is in display-independent coordinates; character anchors come from the actual rendered hand, face, and body.

## Inspection

The production **Developer panel > Construct moments** previews each scene, mask sleep, each movement, and each cut-in. Scene previews play the whole fixed sequence; Stop cancels immediately. Other previews use the duration control. Runtime state reports the current scene. Preview activity remains separate from normal dialogue history.

The new tests cover the sleep/re-form clock, mask hit testing, choreography endpoints, grounded contact, autonomous spacing and daily limits, every rendered scene, no focus or pointer changes, exposed-area clipping, disappearing and moving targets, interrupted possession recovery, quiet/settled gates, developer cancellation, falling and landing, and reduced motion. Existing regression checks cover lying text-box placement, window-top posture progression, original-art head rubbing, and settings recovery.

## Source and artwork

Feature and choreography reference: [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop), inspected at commit `6e3158f6b7cfcc61fdc18a8c2df82604598d8dce`. These features are implemented locally around this application's existing sprites and window model. No new upstream body sprite or current upstream source module is bundled. Existing imported portraits/cut-ins retain their separate artwork credits in `assets/capri/mochiiwuff/SOURCES.md`; earlier code adaptations retain their existing license notices.

## Validation record

TypeScript checking and all 393 unit tests passed. Eighteen targeted checks passed against the packaged application, covering the new scenes plus the recently revised perching, lying composer placement, head rubbing and sleep framing. The broader source run passed 124 checks, skipped two, and failed eight existing dialogue/background-learning/timing checks. The same eight checks also failed against the preceding 0.2.40 packaged app; this update does not claim a completely passing broader suite.
