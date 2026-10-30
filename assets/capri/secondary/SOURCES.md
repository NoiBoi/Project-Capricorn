# Secondary character poses

## Runtime assets in 0.2.37

Only `sit-soft.png`, `sit-soft-closed.png` and `recline-palette.png` are shipped.
The superseded secondary float and sitting edits described in the historical
notes below are archived outside the runtime assets. Original primary strips
remain unchanged. The sitting upper silhouette repair is retained.

Sitting scales to the primary perch mane width (160 source pixels versus 874 in this cutout), rather than filling the window. Built-in imagegen removed the
purple offset outline, preserved fine sparkle, and softened red/green saturation
at the user's request. Its closed-eye variant uses angular black eyelid lines
inside the green mask panels, guided by the original `perch_blink.png` expression.
The reclining artwork has not been recolored by this update.

`poseShader.ts` uses one local WebGL cutout rig for localized mane lag, a subtle
seated leg swing, and reclining ankle motion/breathing. Face and contact regions
remain stable. Motion concepts were informed by mochiiwuff/capri-desktop's
MIT-licensed `sprite.js` and `acting.js`, at the commit credited below; its license
remains in third-party/capri-desktop-LICENSE.txt. This implementation adds no purple
rim, grading or sparkles. GPU resources are reused. Missing graphics support falls
back to a still cutout; reduced-motion settings suppress local deformation.

## Historical provenance and earlier cleanup

These remain unofficial character artwork and derivatives, not MIT-licensed art.
Capri / Cyberpunk / Edgerunners belong to CD PROJEKT RED, Studio Trigger and Netflix.
Used in this private, noncommercial fan companion with no official affiliation.

- `sit-complete.png`: derived from `reference/cutouts/sit_wiki01.png` in
  https://github.com/TheAgencyMGE/capri-companion at commit
  c094ec1e74941c075cf0a2ce5ab340a58a3c6344. Original reference is the official seated
  bed still, wiki Capri_01. Built-in imagegen extracted the figure, removed most
  white hair speckles and repaired the source's cropped upper hair silhouette.
- `recline.png`: derived from `reference/cutouts/lie_5wG_0030.png` in that same
  repository/commit. Original reference is the Netflix clip 5wGdjjwoDbY at roughly
  0:30. Built-in imagegen removed the room/bed and most white hair speckles.
- `float.png`: derived from `assets/capri/capri-full.png` in
  https://github.com/mochiiwuff/capri-desktop at commit
  f8395800976b4c787ec088d6fead140a934875fb. Built-in imagegen cleaned the texture,
  flattened the red palette, preserved the floating pose and completed clipped tips.

Generated changes are adaptations, not recovered animation frames or additional
show canon. The renderer adds subtle band-based mane lag locally. It retains the
original lachydotmcg strips as its primary art and for eyes-closed pats, speaking,
sleep, drag, teleport and window-motion reactions.

## Palette and sparkle correction

The shipped versions are `sit-palette.png`, `recline-palette.png` and
`float-palette.png`. A second built-in imagegen edit used both original
`lachy/idle.png` and `lachy/perch.png` as palette/texture references. It preserved
the extracted poses and canvas dimensions, brightened green panels, matched the
hot-pink/crimson red and violet outlines, and retained fine scattered hair sparkle.
The superseded cleanup images above are retained as provenance references; only
the palette-corrected versions are loaded at runtime. No original primary strip
was changed. The sitting upper silhouette repair remains in the corrected asset.

Upstream review found procedural WebGL acting over one source cutout in mochiiwuff,
not ready-made alternate-pose animation strips. Existing portraits, cut-ins, opening
frames and icons were already imported separately; this adds its usable floating
body. High-drama code-hook and possession sequences are not appropriate as routine
desktop idles and are not presented as extra source animation frames.

