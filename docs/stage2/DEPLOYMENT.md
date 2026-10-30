# Capri 0.2.46 deployment

Deployed locally on 2026-10-27, including the completed Stage 1 behavioral core and Stage 2 persistent identity and memory work (through e27990b).

The running portable app at the existing Capri `release/win-unpacked` location was updated and restarted. Its original 0.2.45 program files and complete user profile were saved in the task workspace at `work/rollback-0.2.45`. Keep both together for rollback because Stage 2 writes a version 2 scene envelope.

Validation:

- Typecheck and production packaging passed.
- Full unit run: 464 passed, one storage size-cap test exceeded its default timeout. All 29 storage tests passed in an isolated rerun.
- Eight packaged behavioral, conversation, and continuity checks passed; three opt-in live-provider cases were skipped.
- Added packaged-executable support to the behavioral and continuity checks.
- Explicitly ship the Windows x64 Koffi binary as a resource. The initial package omitted its optional native dependency; the corrected package enumerated five desktop windows in isolation without a native binding warning.
- Final regular-profile startup reported version 0.2.46, Codex connected, and character ready in 978 ms with no native binding warning.
- Saved memory, credentials, and chat history matched the stopped 0.2.45 backup. Settings differed only in character screen position. All 96 recent scenes survived migration to the version 2 envelope.

The installer and blockmap were also copied into the original release folder. No remote release was published.
