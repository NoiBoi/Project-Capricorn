# Troubleshooting

Start with **tray → Diagnostics**. It checks the model, speech recognizer, credential store, fullscreen detection, GPU, shortcuts and the last unclean exit, and shows performance numbers and live logs (with a Copy button).

| Symptom | Fix |
|---|---|
| Windows "protected your PC" on install | The installer is unsigned. Click *More info → Run anyway*. |
| She disappeared | Press `Ctrl+Alt+H` (or `Ctrl+Alt+J`), or use *tray → Show*. If she's off-screen, use *tray → Reset position*. A fullscreen app in front also hides her automatically. |
| Clicks go through her | Click-through is on. Press `Ctrl+Alt+C` for 15 s of interaction, or untick *Click-through* in the tray. |
| "Couldn't reach the model server" | Ollama: make sure it's running (`ollama serve`) and the model is pulled (`ollama pull llama3.2`). Then use *Model → Test connection*. |
| "rejected the API key" | Re-paste the key in *Model*. Keys from another Windows account can't be decrypted and must be re-entered. |
| Slow or no replies | Raise *Model → Timeout*, pick a smaller model, or switch to *Offline commands*. |
| Push-to-talk does nothing | Enable *Voice → Allow microphone*. Check Windows *Settings → Privacy → Microphone → Let desktop apps access your microphone*. |
| Poor transcription | Windows offline recognition is basic. Set *Speech-to-text* to an OpenAI-compatible Whisper endpoint (cloud, or a local server such as faster-whisper-server). |
| "No Windows speech recognizer installed" | *Settings → Time & language → Speech*: add an English speech pack. |
| No voice | Enable *Voice → Speak replies* and press *Test*. Install more voices in *Settings → Time & language → Speech → Manage voices*. |
| Wake word triggers randomly | Turn it off (*Voice → Wake word*) and use `Ctrl+Alt+T`. |
| A shortcut doesn't work | Another app owns it. *Diagnostics → Shortcuts* lists the active fallback. |
| High CPU/GPU | Lower *Look → Max frame rate* or *Animation intensity*. She already throttles to ≤30 fps idle and 15 fps asleep, and stops rendering when hidden. |
| Settings look reset | A corrupt or invalid `settings.json` was repaired. The bad file is kept as `settings.json.corrupt-*`, and *Diagnostics* lists the repaired fields. |
| Something is badly broken | *Privacy → Delete all data & reset*, or quit Capri and delete `%APPDATA%\Capri`. |

**Logs:** `%APPDATA%\Capri\logs\capri.log`, also reachable from *Privacy → Open data folder*. Set *Privacy → Log level → Debug* for more detail. Secrets and message text are always redacted.
