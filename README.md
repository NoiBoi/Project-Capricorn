# Project Capricorn

A Windows desktop companion built around Capri, with natural conversation, native window movement, durable intentions and shared character continuity.

This is an independent repository with a fresh Git history. It continues development from [Capri Companion](https://github.com/TheAgencyMGE/capri-companion) and retains its MIT license, contributor credits and third-party notices. It is not connected to GitHub's fork network.

## Current version

1.6.0 adds an opt-in Runtime 2 companion entry point, bounded evidence reads without an investigation prerequisite, automatic historical dialogue recall, and playback-aware ambient pacing. The ordinary companion path is now the Runtime 2 default. See the [source review, implementation and verification](docs/OPEN_SOURCE_COMPANION_REVIEW.md). Natural companion quality still needs ordinary-use observation.

- Ctrl+Shift+Space opens focused quick chat.
- Ctrl+C+Space opens long-term chat on the active monitor. Escape dismisses it.
- Direct chat and desktop reactions share bounded, attributed working context.
- Manual handling preserves active window intentions and accepted resting positions.

## Development

Windows with Node.js and npm:

```sh
npm ci
npm run typecheck
npm test
npm start
```

`npm run dist` builds the Windows installer. Native-window and keyboard checks require an interactive Windows session. Close other Capri instances before native shortcut tests so they do not own the global hotkeys.

For the new companion architecture, run `npm run start:daily`, or launch the installed executable with `--runtime2`. This opens the existing Chat panel with session controls, initially paused. It reuses the isolated Runtime 2 `daily-test` profile, leaving the normal profile separate. Model selection, sign-in and desktop-context controls are in the panel. The normal application launch continues to select the legacy runtime. Developers can select the earlier comparison paths with `CAPRI_V2_COGNITION=two-speed`, `lean`, or `layered`.

## Privacy and attribution

User profiles, chats, memories, API credentials and local build/validation output are not included. Source code is MIT licensed; character artwork and third-party assets have separate notices in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Unofficial fan project, not affiliated with CD PROJEKT, Studio Trigger or Netflix.

See [the cumulative dialogue guide](docs/DIALOGUE_GUIDE.md), [1.4 release notes](docs/RELEASE_1.4.md), and [original project documentation](docs/ORIGINAL_README.md).
