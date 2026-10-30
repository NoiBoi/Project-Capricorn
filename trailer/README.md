# CAPRI — product trailer (Remotion)

A 35-second, 1920×1080, 30 fps demo of the real app on a real Windows desktop. Everything on screen happened in one recorded take:

- she appears on the desktop and follows the cursor
- a live Gemini conversation in the panel
- a teleport on request (the real window crosses the screen)
- Calculator launched after the permission prompt
- back to idle, then the wordmark

The only additions are:

- the camera move
- four short captions
- a few frames of glitch on each cut
- the closing wordmark
- the score and sound effects

## Record the footage

From the app folder (the parent of this one):

```bash
node scripts/build.mjs
```
```bash
node scripts/record-demo.mjs
```

The recorder needs the local Gemini key in `../.env.local`. The app loads the key itself and the recorder never reads it.

For about 50 seconds the recorder takes over the mouse and minimises every window, then restores them. It drives the app as a user would:

- real cursor moves, real double-clicks and real clicks
- typing into the real panel

It writes two files to `public/demo/`:

- `desktop.mp4`: 30 fps, from Chromium's desktop capture, because GDI grabbing manages only about 12 fps at 1080p.
- `marks.json`: the time of each beat on the video clock, plus where her window and the panel were.

The edit reads `marks.json`, so a new take re-times and re-frames itself. `public/demo/` is git-ignored because it shows your desktop.

## Preview and render

```bash
npm run dev
```
```bash
npx remotion render src/index.ts CapriTrailer out/capri-trailer.mp4 --codec=h264 --crf=16 --gl=angle
```

`node scripts/stills.mjs 3.5 12 21.5 28.5` renders review stills to `out/stills/`.

On Windows, a project in a very deep folder can push Remotion's bundled browser path past `MAX_PATH`. If so, copy `node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64` to a short path and pass `--browser-executable=<that>\chrome-headless-shell.exe`. `stills.mjs` picks up `%TEMP%\rchrome` automatically.

## Structure

`src/Trailer.tsx` holds the whole edit:

- **Beats.** Six beats, each made of clips from the take.
- **Camera.** It fits the recorded rectangles: her window, the panel, and Calculator's spot.
- **Captions.** Each one sits on the side away from her.
- **Cut glitches.** They borrow her own torn-slice glitch.
- **Wordmark.**
- **Score and sound-effect cues.**

Credits and licences for the music and sound effects are in [ASSETS.md](ASSETS.md).
