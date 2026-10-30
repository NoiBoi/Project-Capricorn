# Security & privacy

## Data locations (`%APPDATA%\Capri`)

| File | Contents | Notes |
|---|---|---|
| `settings.json` | preferences | validated on load; invalid fields reset and reported in Diagnostics |
| `secrets.bin` | API keys (Gemini, OpenAI, Anthropic, voice) | DPAPI-encrypted via Electron `safeStorage`; if encryption is unavailable, keys stay in memory only |
| *(dev only)* `.env.local` in the source folder | `GEMINI_API_KEY` for development | git-ignored, never packaged (verified by `npm run verify:package`), read only by unpackaged builds |
| `history.jsonl` | conversation | optional (*Privacy*); retention window (default 90 days); capped at 2000 messages |
| `memory.json` | long-term memory | model suggestions stay *pending* until you approve them; max 200 items |
| `notes.json`, `reminders.json` | notes, timers | bounded |
| `logs/capri.log` | JSON-lines log | secrets and message text redacted; 2 MB × 3 rotated files |
| `session.lock` | crash marker | removed on clean exit |

There is no telemetry. Gemini requests are sent with `store: false`, so Google doesn't keep them for later retrieval; normal Gemini API data terms still apply. Network traffic goes only to the model and voice endpoints you configure, plus pages you approve opening.

## Permissions model

- **Microphone:** off by default. Electron's permission handler grants audio only to the character window, and only while *Allow microphone* is on. The stream opens only while recording (push-to-talk or after the wake word) and is released immediately. A green ring and mic badge show on Capri while it's live. The temporary WAV is deleted right after transcription.
- **Wake word:** opt-in. It's a single on-device recognizer child process; audio never leaves the PC. It exits when Capri exits, even after a crash, because it watches the parent PID.
- **Screen:** requested computer-control tasks capture the primary display and send reduced-size screenshots to the selected computer-use backend (Codex account or Gemini). The permission policy asks before a task starts. Ordinary idle animation does not capture screenshots. The fullscreen check reads the foreground window's rectangle and class name.

## Private Codex integration

The Codex provider launches the installed CLI using its own existing sign-in;
Capri does not read or copy Codex credentials. Its empty temporary working folder
contains only the current request's screenshot, if any, and is removed after the
process exits. User configuration is ignored, the shell tool is disabled, and
Codex sessions are ephemeral. The desktop app receives text/action data and
applies its normal action validation and permission policies. Conversation
history still follows Capri's history settings. Chat and screenshot requests
use the user's Codex account allowance and require network access.

## Tool safety

- The model can only *request* actions with `<action>{json}</action>`. Every request is:
  1. parsed (malformed → rejected)
  2. matched to one of 10 known tools (unknown → rejected)
  3. validated against a zod schema
  4. checked against your policy (*allow*, *ask first* or *never*)
  5. confirmed in the panel when required, with a 2-minute timeout counting as a no
  6. executed by trusted code.
- There is no shell and no arbitrary executable. `launch_app` only opens apps you added with a file picker. `open_url` only allows http(s) and rejects embedded credentials. `search_files` matches names only, inside authorised folders, with traversal checks, depth, count and time limits.
- **Prompt injection:** results containing untrusted data (file names, notes) are wrapped as `<untrusted>` data. The system prompt forbids following instructions found there. Any action requested after untrusted data entered the turn is forced to *ask first*. Turns are limited to 3 action rounds and 4 actions per round.
- **IPC:** the preload exposes an allow-list of channels. The main process checks which window sent each request (character vs panel) and validates every payload with zod.
- **Renderers:** sandboxed, `contextIsolation`, no Node integration, strict CSP (`connect-src 'none'`). Navigation and `window.open` are blocked. API keys never reach a renderer; cloud TTS is fetched by the main process.
