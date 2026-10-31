# Direct window inspection repair (1.5.5)

The production ActionContext did not supply readScreen, although read_screen
was advertised and configurable. The 1.5.4 diagnostic snapshot records both
Screen reading unavailable and Capability precondition failed. The action also
accepted no target; source-context taint could escalate persistent allow to
confirm, and the model could decline to invoke the action at all.

## Repair

- Supply the production readScreen hook. Resolve a named app/title with the
  existing unique-window resolver; foreground, current perch and last desktop
  context serve requests with no named target. Never replace a missing target.
- Route unambiguous user inspection commands into the existing action executor
  before generating a reply. Other actions retain the normal model action path.
- Preserve allow/confirm/deny. Only a current explicit user read request can
  bypass taint escalation for this read-only action. Source material remains
  untrusted; source-derived writes and consequential action protections remain.
- Reuse the existing exposed-window capture and Codex/Gemini/OpenAI image
  adapters. Return the visual interpretation as untrusted action evidence to
  the same Conversation turn. No new perception framework or movement policy.
- Prefer authorized Chrome semantic snapshots matched to the window title and
  content hash. Require live collection, content permission and an approved
  origin. Do not bypass missing/revoked Chrome permissions with screenshots.
- Recheck target identity, exclusions and screen permission across capture and
  interpretation. Private exchanges keep their existing nonretention behavior;
  no screenshot or extra window-title log is added by the repair.

## Validation

Type checking and 123 targeted unit tests passed. The final packaged run passed
all four tests across direct native inspection and existing Chrome semantic
extraction. The opt-in packaged acceptance
check uses real visible native windows and the signed-in Codex provider, without
mocking readScreen, native enumeration, capture, or provider output. A random
verification code exists only in the test window. It checks another focused
window, the actual selected target/action evidence/model reply, a visible Capri
perch, repeat allow without confirmation, confirm decline/accept, deny, excluded
and closed targets, and an embedded instruction that must not create a note.

Run against a packaged executable with CAPRI_EXE and CAPRI_LIVE_INSPECTION=1:

    npx vitest run tests/e2e/directInspection.e2e.test.ts --no-file-parallelism

Initial live checks exposed model-only refusal under allow and confirm. Routing
explicit commands through the existing executor fixed that failure; the full
packaged acceptance check then passed.

## Limits

Only sufficiently exposed window regions are captured; minimized, fully covered,
ambiguous, closed, excluded, game-quiet or OS-blocked targets fail with an
explanation. Small/unclear text remains limited by capture and the chosen model.
Chrome requires current paired-extension content from an approved origin.
Other configured providers without the existing image adapter report that a
supported vision provider is needed. Live visual acceptance used Codex; Gemini
and OpenAI image paths were reused but not live-account tested in this repair.
