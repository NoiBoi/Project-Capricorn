# Capri — Character Reference Dossier

Research date: 2026-10-24 (four days after *Cyberpunk: Edgerunners 2* premiered on 2026-10-20).
Source manifest: [`reference/SOURCES.md`](../reference/SOURCES.md).

Confidence legend: **V** = verified directly against an official frame, **S** = secondary source (wiki or review, not checked against the show), **I** = creative interpretation made for this app.

## 1. Identity (canon)

| Fact | Conf. | Source |
|---|---|---|
| Name "Project Capricorn", alias "Capri". | S | Cyberpunk Wiki |
| A *personality construct*: many digitised human psyches merged into one. | S | Wiki, quoting Ep. 4 |
| Self-description: "a collection of human psyches… rolled into one, beautiful me. Powerful, like an A.I., but born of humans." | S | Wiki quote, Ep. 4 |
| Made by Kyoko and Arasaka, originally as a cyber-weapon, later scrapped. Stored on an Arasaka biochip. | S | Wiki, reviews |
| Visible only to people who slot the chip (D, and later Talia Yang); she needs a compatible human host. | S | Wiki, reviewgeek Ep. 4 |
| Voice: Brittany Lauda (English), Aoi Koga (Japanese). | S | Wiki infobox (community-edited) |
| Infobox: hair "Pink", eyes "Blue". | S | Wiki |

## 2. Visual design (verified against three official frames)

Capri isn't drawn like a conventional anime girl. Studio Trigger renders her as a **flat, hard-edged, shard-built graphic figure**: a hallucination-style overlay drawn in a different style from the rest of the show.

### Silhouette (V)
- She is tall and thin, with long jagged legs.
- Her head is tiny next to the hair, which is the dominant shape: a huge angular cloud of slabs about 3× the width of her shoulders, rising well above her head.
- Long lightning-bolt strands of hair fall to her knees and below.
- The whole outline is made of straight segments and sharp points. There are no curves except the eyes.

### Hair (V)
- **Fill:** saturated crimson-pink, about `#F2154C` to `#FF1F55`.
- **Texture:** dense white/pale-pink sparkle speckle ("glitter static") over the red fill only.
- **Outline:** a violet/purple band (about `#7B3DF2` to `#9A4BFF`) offset down and to one side of each red slab, like a chromatic-aberration shadow.
- **Inner layer:** black spike shards sit between the red slabs, and spiky black bangs crown the head.

### Head and face (V)
- **Head:** near-black (`#0A0710`), angular, with a pointed chin and spikes radiating outward like a crown.
- **Mask:** a neon-green (`#22F27A` to `#2BFF88`) angular panel across the eye area, split vertically by a black notch between the eyes. Small green triangles sit below each eye.
- **Eyes:** round, wide and staring, built from concentric rings: black outer, green ring, thin white ring, bright blue iris (`#1D6CFF` to `#2A84FF`), dark navy centre and a white catch-light dot. They are slightly asymmetric when her head tilts.
- **Mouth:** a thin white zigzag line, a jagged grin. When open it's dark with white jagged teeth (seen in the ¾ frame).
- **Nose:** none. There are no other facial features.

### Body and "clothing" (V)
- A slim black body built from shards; no fabric detail is visible.
- The colour panels are **asymmetric**: neon-green panels down one side (shoulder, chest, hip, outer leg) and crimson lightning/geometric glyphs on the other side of the torso.
- Violet rim edges appear on the shard boundaries.

### Rendering style (V)
- Flat fills with no gradients or soft shading. The only texture is the hair sparkle.
- The violet offset outline works as her "lighting".
- Because she's composited over normally shaded backgrounds, she reads as an overlay or projection.

### Angles available
- **Front:** wiki infobox frame (close-up of head and torso).
- **¾ with head tilt, looking down:** gallery frame 03.
- **Full body seated:** gallery frame 01.
- **No profile or back view** was found. Those angles are reconstructed (I).

## 3. Personality and voice

| Trait | Conf. | Note |
|---|---|---|
| Self-assured and somewhat vain ("beautiful me"). | S | Direct quote |
| Mischievous, curious about "what fun her power can bring". | S | Review paraphrase |
| Motivations are deliberately unclear in the show. | S | Multiple reviews |
| Forms a close bond with her host (D), who embraces the possession despite the risks. | S | Reviews |
| Playful, teasing tone; short, punchy lines; Night City slang ("choom", "preem", "nova"). | I | Assumed from the franchise register. Not verified for Capri. |
| Treats the user as her "host" or "choom" and is fond of them. | I | Adapted for a companion app |

The persona prompt ([`src/main/ai/persona.ts`](../src/main/ai/persona.ts)) labels each line *canon* or *interpretation*. The app never claims her biography beyond the facts above.

**Voice:** No authorised Capri voice or voice model exists. The app uses a **clearly labelled substitute** (Windows system voices, or a user-configured TTS endpoint), and the UI says so.

## 4. Existing assets (checked 2026-10-24)

| Asset | Provenance | License | Usable? |
|---|---|---|---|
| Official 3D model, rig or textures | None published | — | No |
| Sketchfab "Capri (Project Capricorn)" by 0x00001337, 5.6k faces, posted 2026-10-24 | Fan | None stated, download disabled | No |
| GitHub `Seth666h/capri-cyberpunk-Desktop-pet` (PyQt, 4 static PNGs) | Fan | No license file | No (static sprites, unlicensed) |
| VRM / MMD / Live2D / Booth / VRoid Hub | None found | — | — |

**Conclusion:** no authentic or legally usable Capri model exists. The app ships an **original vector reconstruction** built procedurally from the verified references. It isn't the studio's artwork and doesn't claim to be identical to it.

## 5. Visual fidelity decisions

- **Rendering approach:** a 2D vector shard rig, not 3D (see ARCHITECTURE ADR-2). Her on-screen design is flat polygon art, so flat polygons reproduce it more faithfully than a shaded mesh would.
- **Matched to the frames:**
  - silhouette proportions (tiny head, hair mass about 3× shoulder width, knee-length lightning strands)
  - crimson glitter hair with a violet offset outline
  - black horn-like crown spikes
  - split neon-green mask with cheek triangles
  - concentric blue eyes with a white catch-light
  - thin white zigzag mouth that opens to a dark jagged grin
  - asymmetric green and crimson body panels
- **Reconstructed:** arms and hands (barely visible in the frames), the standing pose (frame #1 is seated), side and back views, every expression other than the stare and the ¾ grin, and all motion.
- **Consistency:** all geometry is static data and the glitter uses fixed seeds, so her face and hair never change between frames or sessions.
- **Animation provenance:** 35 clips. `tilt_grin` is posed after frame #3 and `front_stare` after frame #1; the other 33 are interpretation (ADR-8).

## 6. Uncertainties and how to resolve them

1. **Profile, back and full-standing views.** Resolve by checking more episode frames or official art books when published. The rig's `turn` parameter currently extrapolates from the ¾ frame.
2. **Exact palette values.** These were sampled from compressed web screencaps. A Blu-ray-quality frame would allow tighter values. All colours live in one table (`src/renderer/character/palette.ts`).
3. **Animation style.** In the show she appears to "pop" between poses with glitch jitter. The app uses smooth interpolation with optional glitch flicker, an interpretation.
4. **Personality depth.** Only a few lines were verified. Rewatching episodes 4–8 would let the persona be expanded with confidence labels.
5. **Voice.** An authorised voice would require a licence from the rights holders (CD PROJEKT / Studio Trigger / Netflix and the voice actors).

## 2026-10-26 dialogue performance revision

The original prompt treated general helpfulness and Night City slang as most of
her conversational identity. The revised brief gives her curiosity, personal
tastes, self-assurance, playful vanity, and emotional contrast. These are
explicitly app interpretation, with authored tone examples rather than copied
show dialogue. Ordinary conversation should usually contain no setting slang.
The examples are not a transcript or additional canon.

A secondary discussion describes both exuberant and quiet, reflective moments:
https://thecinemaholic.com/cyberpunk-edgerunners-capri-satellite/
Its satellite/escape explanations are speculative and were not promoted to
confirmed backstory. The official site https://www.cyberpunk.net/en/edgerunners2
provides show context but currently no detailed Capri performance guide.
First-party episode dialogue has not been independently transcribed here.

The app adds no fictional past with the user. Actual shared context continues
to come from conversation history and approved persistent memories.

## 2026-10-26 dialogue-source audit

The live performance brief now uses concise paraphrased scene analysis in `src/shared/capriVoice.ts`, with source URLs and evidence labels. The dataset stores no episode transcript and no borrowed dialogue collection. The English scene register is inferred from community transcripts, not represented as an official script or independently verified audio transcription.

- Episode 4, https://transcripts.foreverdreaming.org/viewtopic.php?t=266325: her introduction uses playful corrections, mock innocence, familiarity and exuberant self-regard; technical exposition follows the social exchange.
- Episode 7, https://transcripts.foreverdreaming.org/viewtopic.php?t=266328: exchanges with Talia show expectations of appreciation, teasing impatience and expansive confidence.
- Episode 9, https://transcripts.foreverdreaming.org/viewtopic.php?t=266330: fictional menace uses buoyant game-like language. The adaptation uses that audacity in banter rather than treating plot violence as desktop instructions.
- Episode 10, https://transcripts.foreverdreaming.org/viewtopic.php?t=266331: later conversation also contains short, ordinary replies and joking about practical help. Host-specific family grief is excluded from the general persona.

The official clip https://www.youtube.com/watch?v=5wGdjjwoDbY is titled 'The Moment D Meets Capri | Cyberpunk: Edgerunners 2 | Netflix'. Its publisher metadata was verified through YouTube oEmbed as Still Watching Netflix. A secondary caption reference is https://www.voicetube.com/videos/222871. The clip audio/captions were not independently transcribed during this audit. The transcript forum has a generic 2022 series air-date header despite its 2026 episode posts, and speaker labels can be incomplete, so isolated lines are not promoted to certain canon. Earlier blanket claims in this dossier about verified personality depth should be read with these limits.

Original acting examples in `persona.ts` are authored app dialogue kept for documentation, clearly distinguished from show quotations. Live requests receive two scene-level speech-act notes without example reply text, after a live check caught near-verbatim imitation of an authored example. The rewrite changes conversational performance, not the selected text/voice model or desktop action permissions.

### Grounded Night City outlook (0.2.25)
Runtime world context is defined in src/shared/worldContext.ts. D's Snake Nation/netrunner/revenge description, Talia's corporate upbringing and Maelstrom chrome culture, Weak's former King identity and loss of chrome, and Roman Carax's cinema/braindance interest are paraphrased from the official cast bios, verified 2026-10-26: https://www.cyberpunk.net/en/edgerunners2 . The corporate control/ownership/freedom lens is an interpretation for this private companion, not new canonical memories or invented relationships. Only topic-relevant cast facts are appended; ordinary tasks receive the compact world outlook without cast exposition. Existing Capri scene evidence and its limitations remain in force.
