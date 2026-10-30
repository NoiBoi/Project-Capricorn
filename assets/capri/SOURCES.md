# Capri character model

`model.json` is Capri's vector model, traced from reference frames of *Cyberpunk: Edgerunners 2* (© CD PROJEKT RED, Studio Trigger and Netflix). The character and these frames belong to their owners and are not covered by the project's MIT license; this is a non-commercial fan project.

Build it with `python -P tools/build_model.py` (needs opencv-python-headless and numpy). The source cut-outs are in `reference/cutouts/`.

| Pose | Source | Used when |
|---|---|---|
| `sit` | Official still, wiki `Capri_01` (1920×1080): seated on the edge of a bed, one leg along it, one dangling | sitting on a window's top edge; sitting in mid-air (B 0:23) |
| `lie` | Netflix clip `5wGdjjwoDbY` 0:29–0:31: lying on her side on the bed | lounging or asleep on the taskbar or a window edge; reclining in mid-air (B 0:48) |
| `crouch` | Netflix footage via `Nli_SZ-DBco` 0:23–0:25: knees drawn up, floating | floating; hovering just above the taskbar; being dragged |

The face references are the official close-ups `Capri_Infobox` and `Capri_03`.

## How the model is made

1. **Trace:** `tools/vectorize.py` snaps each pixel of a cut-out to her palette, then traces every colour region into polygons, keeping holes. The palette is crimson, a dark crimson shade, ink black, mask green and the violet offset outline.
2. **Hair:** the hair's glitter speckle is detected and replaced by a `hair` region, because the renderer draws a crisp glitter texture there.
3. **Cleanup:** scene shadows on the hair, and anti-aliasing slivers along outlines, are cleaned out.
4. **Reconstruct crops:** `tools/build_model.py` continues each spike tip the shot cut off, with its violet offset, and extends a leg that leaves the frame to a point along its own direction.
5. **Live face:** the traced eyes, irises and teeth are dropped. The renderer draws her face live (`src/renderer/character/face.ts`) so she can blink, look, squint, grin, go blank, bloom many eyes, and talk while audio plays.
6. **Normalize:** every pose is scaled to one unit, where 26 units is the distance between her eyes. That keeps her the same size in every pose. Coordinates are relative to the pose's anchor: the seat, contact point, or centre.

`src/shared/framing.ts` sizes her window from these bounds: every pose, mirrored too, plus room for sway, bob and effects. `tests/unit/model.test.ts` checks that nothing can be cropped.

## Additional transmission artwork

Expression portraits and cut-ins in `mochiiwuff/` come from mochiiwuff/capri-desktop. See `mochiiwuff/SOURCES.md` for the source commit and separate artwork rights. These assets are excluded from the source-code MIT licenses.
