# Capri 1.4 — Reliable Intentions & Continuous Character

Implemented on the existing 1.3.1 source baseline. No new dependencies or parallel planner/memory system.

- Natural window requests route into the existing durable `stay_at_window` skill, including posture choice, optional duration, and clock deadlines. Exact aliases resolve only when unambiguous. Native arrival is verified before confirmation.
- Carrying suspends enforcement. A safe position on the assigned window becomes the saved resting anchor; moving elsewhere allows handling to finish before return. Absolute deadlines and anchors survive restart.
- Native geometry and eligibility are checked through the existing heartbeat. Recovery uses at most three safe checks with a short bounded delay, then reports failure. Recreated windows require a unique exact application/title match. Placement never restores or activates other applications.
- Delivered desktop remarks now enter the same existing dialogue cognition as direct chat. Working context is a bounded projection of attributed opinions, recent developments and unfinished words. Inactive user subjects expire independently of unrelated desktop remarks. Source restrictions, private exchanges and clearing context keep their existing authority.
- Rapid pats, pokes and placements coalesce into developing interactions. Counts stay internal; the cumulative dialogue guide discourages statistical recaps and routine implementation commentary while preserving personality and initiative.
- Ctrl+Shift+Space opens and focuses quick chat. Ctrl+C+Space opens long-term chat on the active application's monitor (cursor monitor when no external application owns focus). Escape dismisses the panel, stops an active reply, and restores prior focus.

Validation: 129 focused unit tests passed. Seven focused packaged end-to-end scenarios and four existing spatial regression scenarios passed, including actual external native windows, accelerated twenty-minute deadlines, native drag handling, resized/recreated/unavailable targets, saved resting positions, restart continuity, mixed contact bursts, privacy clearing, focus and Escape. Both shortcuts were also exercised with native key input. The full legacy suite and an installer upgrade were not run.

A bounded live Luna check chose crimson for a synthetic dashboard, retained its reason through five pats and a full restart, and resumed the same Codex session. The burst produced one response: “All right, all right, I’m still picking crimson. The pat doesn’t get a vote on the palette.” Shared working context measured approximately 1 KB. First outputs, including any quiet/error result, were retained during the check.

Deployment uses the existing Electron source launch and original Documents/Capri Buddy profile. It does not install a packaged application. A packaged candidate was validated independently in synthetic profiles.

Rollback resources are in this chat's work directory: `rollback-1.3.1.zip` (source), `rollback-source-dist` (previous running bundles), `rollback-package-1.3.1` (runnable packaged application), and `profile-before-1.4` (stopped-profile backup). To roll back, stop Capri first, restore the earlier source/bundles or launch the rollback package, and use the profile backup only if necessary. Keep the current profile unless intentionally reverting subsequent conversations.
