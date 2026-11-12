# Project Capricorn

A Windows desktop companion built around Capri, with natural conversation, native window movement, durable intentions and shared character continuity.

This is an independent repository with a fresh Git history. It continues development from [Capri Companion](https://github.com/TheAgencyMGE/capri-companion) and retains its MIT license, contributor credits and third-party notices. It is not connected to GitHub's fork network.

## Current version

2.0.0-beta.1 packages the existing Runtime 2 companion architecture with bounded evidence reads, automatic dialogue recall and playback-aware pacing. Chat now has a compact Start/Pause flow, and Developer tools shows Runtime 2's actual loop and pipeline outcomes. See the [development workflow and current evidence](docs/COMPANION_DEVELOPMENT.md) and [open-source architecture review](docs/OPEN_SOURCE_COMPANION_REVIEW.md). Sustained everyday companion quality remains an open behavioral question.

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

`npm start` and the installed beta open Runtime 2, initially paused, using its existing isolated `daily-test` profile. Start Capri in Chat; model selection and limits are under Usage and diagnostics. The older profile is retained separately: use `npm run start:legacy` or launch with `--legacy` to access it. `--runtime2` remains an explicit companion launch flag. Developers can select the earlier comparison paths with `CAPRI_V2_COGNITION=two-speed`, `lean`, or `layered`.

## Privacy and attribution

User profiles, chats, memories, API credentials and local build/validation output are not included. Source code is MIT licensed; character artwork and third-party assets have separate notices in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Unofficial fan project, not affiliated with CD PROJEKT, Studio Trigger or Netflix.

See [the cumulative dialogue guide](docs/DIALOGUE_GUIDE.md), [1.4 release notes](docs/RELEASE_1.4.md), and [original project documentation](docs/ORIGINAL_README.md).
