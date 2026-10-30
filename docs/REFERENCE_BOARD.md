# Capri reference board & character specification (v2)

Updated 2026-10-24. This version adds the official Netflix clip **"The Moment D Meets Capri"** (YouTube, *Still Watching Netflix* channel, `5wGdjjwoDbY`, 3:16). It was inspected frame by frame at 4 s intervals across the whole clip and 0.1 s around her entrance. No frames are stored in the repository; the timestamps below let anyone re-check.

Sources: **N** = Netflix clip (timestamp), **W1/W2/W3** = wiki official frames #1–#3 in [reference/SOURCES.md](../reference/SOURCES.md).

## Board

| Ref | What it shows | Key observations |
|---|---|---|
| N 0:34 | Face close-up, ¾ | Two eyes on the green mask; **jagged white teeth** grin; crimson glitter hair slabs crossing the frame |
| N 0:50 | Extreme eye close-up | **Black pointed-almond eye shapes**, blue iris, white pupil dot, thin green ring. Several eyes of different sizes appear at once |
| N 1:51 (111 s) | **Full body, front, standing** | Arms **extremely long and spindly**, flung wide, with long thin claw fingers. Viewer-left arm black with violet rim, viewer-right arm crimson. Torso **crimson with a black X crossing**, green triangle at the viewer-left shoulder and hip. Tiny head, green rectangular mask, black spiky crown. Hair cloud wider than the arm span, with a brighter glitter sheen toward the top centre |
| N 1:49–1:54 | Same pose held | **Held pose for about 5 s.** Only the glitter shimmers and tiny shifts happen (Trigger limited-animation style) |
| N 1:55–2:06 | Eye close-up | Almond eyes with small **thorn spikes** on their edges. Iris inside a green ring that isn't always concentric. At 2:06 the eyes **narrow into slanted slits** (menace) |
| N 2:14 | "Many eyes" | The mask fills with **dozens of almond eyes** of varying size, the visual of "many psyches in one" |
| N 2:34–2:42 | Looming over D (low angle) | Huge scale presence. **Her colours take on scene lighting** (darker crimson and green in a dim room). The mask reads as an inverted triangle from below |
| N 2:54 | Glitch shards | Fragmented crimson, black and green shards with violet edges |
| N 1:48.7→1:48.8 | Entrance | Appears by a **hard cut**, with no in-world dissolve visible |
| W1 | Front close-up | Mask split by black bangs; concentric eyes read as round at small size |
| W2 | Seated full body | Crimson body with black and green accents; lightning-bolt hair strands to the knees |
| W3 | ¾, head tilted down | Open jagged grin; head tilt with a crown of spikes |

## Character specification (implemented in `src/renderer/character/rigData.ts`, `rig.ts`)

**Silhouette.**
- Tiny head (about 1/9 of figure height).
- Hair cloud about 3× shoulder width, rising high above the head, with knee-length lightning strands.
- Very long spindly arms; arm span close to the hair width when spread.
- Long jagged legs.

**Palette (sampled, ±5%).**
- Hair crimson `#f2154c`, sheen up to `#ff8fb0`.
- Glitter `#ffffff` / `#ffe6ee`.
- Violet edge `#8a3dff`.
- Ink `#0a0710`.
- Mask green `#22f27a`.
- Iris blue `#1d6cff`, pupil dot white.

**Face.**
- Green rectangular mask.
- Two black pointed-almond eyes, slanted, with 1–2 thorn spikes each. Blue iris, white pupil dot, thin green ring.
- Mouth: thin white zigzag; when open, a dark slot with white triangular teeth.
- No nose.

**Body.**
- Crimson torso with a black X and diamond lines, a green triangle (viewer-left shoulder and hip) and a black triangle (viewer-right shoulder).
- Viewer-left arm black with violet rim; viewer-right arm crimson. Claw fingers: 4 long thin spikes.
- Legs crimson with black lightning cuts and a green accent on the viewer-left leg.

**Rendering rules.**
- Flat fills only; the violet offset edge is the "shading".
- Glitter on hair only, with a brighter sheen zone top-centre.
- No gradients on the body.
- Geometry is static data, so nothing drifts between frames.

## Directly observed vs inferred

| Aspect | Status |
|---|---|
| Almond eyes, white pupil, green ring, thorns, narrowing | observed (N 0:50, 1:55–2:06) |
| Many-eyes effect | observed (N 2:14) |
| Crimson torso with X, long arms, claws, arm colours | observed (N 1:51) |
| Held poses with glitter shimmer | observed (N 1:49–1:54) |
| Scene-lit colour shifts | observed (N 2:34); not reproduced (the desktop has no scene light) |
| Profile and back views, walking, legs in motion | **not observed**; reconstructed |
| Teleport dissolve/reassembly | **inferred**: she enters by hard cuts; the desktop teleport FX extrapolate her glitch-shard and many-eyes visuals |
| Personality in motion (head tilts, grin) | observed (W3, N 0:34); other gestures are interpretation |

## v3 additions: body poses (2026-10-24)

Second source: **"Capri is a baddie in Cyberpunk Edgerunners 2"** (YouTube `Nli_SZ-DBco`, 5:35). It's a compilation of Netflix footage, credited "Video credit: Netflix MY" on screen. I sampled it every 5 s and inspected the Capri frames at full size. Timestamps are given as **B m:ss**.

| Ref | Observed | Implemented as |
|---|---|---|
| B 0:13 | Eyes go **blank white** (no iris) | `blankEyes` param, clip `blank_stare` |
| B 0:18 | **Standing on top of D's head**, tiny, perched | perch on the active window (teleport `perch`), posture `balance` / `sit_edge` |
| B 0:23 | **Curled up, sitting in mid-air** beside a building | posture `air_sit` |
| B 0:28, 4:48 | **Leaning over D's shoulder**, head tilted toward him | postures `peek_left` / `peek_right` at screen edges |
| B 0:48 | **Reclining in the air** beside D | posture `recline` |
| B 1:23, 4:53 | **Standing in a burst / on open ground, arms out** | posture `power_stance` |
| B 2:13–2:28 | **Peeking in between two characters** | edge peek (teleport `peek`) |
| B 2:33 | **^ ^ happy arc eyes** (smug) | `happyEyes` param, clip `smug` |
| B 2:48 | **Claw reaching toward the camera** | `clawScale`, clip `reach_claw` |
| B 3:03, 5:33 | **Wide jagged-tooth grin**, eyes wide, head tilted | clip `maniac_grin` |
| B 3:18–3:23 | Only her head and mask visible, peeking | (edge peek covers it; head-only mode not implemented) |
| B 3:33 | **Contrapposto**: weight on one leg, hip out, long arms hanging away | posture `contrapposto` |
| B 4:03, 5:03 | **Dashing: hair streaming horizontally** | glide movement + `hairStream` |
| B 4:13 | Glitch: **horizontal green/crimson streak bars** | glitch post-process streak bars |
| B 4:28–4:33 | Merging into Talia | not applicable to a desktop companion |
| W2, N 2:22 | **Seated on the edge of a bed**, one leg along the edge | posture `sit_edge` (on the taskbar or a window top) |
