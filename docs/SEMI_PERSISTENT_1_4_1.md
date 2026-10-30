# Capri 1.4.1 — semi-persistent Luna refinement

Implemented on the existing Project Capricorn source checkout. No new agent, memory service, dependency, inference loop, or background model call.

## Continuity

DialogueCognition now keeps four bounded ordinary subjects plus four temporary source-derived subjects, projecting at most three relevant subjects. Actual earlier assistant speech survives recent exchanges alongside the latest quotes. Unrelated spontaneous remarks cannot replace the foreground opinion or question. Recent user conversations have priority over casual asides when slots fill. Returning to a subject restores its current conversational position, including short follow-ups.

Ordinary subjects expire after 48 hours of inactivity; source-derived subjects expire after two hours and never enter the durable checkpoint or cognitive extraction buffer. Source IDs accompany temporary speech. Direct and proactive exclusions filter it before prompt use; dependencies follow derived replies into the existing session isolation and revocation paths. Restart preserves eligible ordinary subjects, while source-derived working quotes remain session-only under the existing privacy policy.

Explicit topic changes get fresh prompt focus without deleting waiting subjects. Relevant later evidence can bring a prior view back; closure marks it resolved or abandoned. Quotes establish what Capri expressed, not independently verified events. Existing observation receipts, action receipts, BehaviorCore interests, and agency commitments remain the owners of experience and intent. No thought is fabricated between model calls.

Direct Luna chat continues using existing persistent ConversationSessions. Ambient structured decisions stay bounded and use shared application context; mixing every observation into the native conversational thread would add irrelevant history and complicate source isolation. Other providers retain their existing paths.

## Validation

- Typecheck and whitespace checks pass.
- Broad unit suite: 812 passed, one existing failure. The unchanged release030 test expects immediate continuous reclining; baseline SecondaryBehavior returns a sitting/primary pose first. Baseline reproduction confirmed this incompatibility. Physical behavior was preserved.
- Final focused continuity/session/scene tests: 42 passed.
- Packaged regressions: 21 passed, two skipped. These cover restart, profile/credential persistence, source revocation, actual speech delivery, physical handling, window intentions and movement. One pre-existing skip remains; the obsolete website-setup UI test was explicitly excluded after it timed out looking for a Model tab. Earlier run: 21 passed, one skipped, that UI test failed. No fully green broad suite is claimed.
- Real Luna evaluations: 27 first-attempt calls across four runs, with all outputs retained. Two complete sequences exercised mount preference, unrelated conversation, physical contact and restart; source licensing criticism later changed after a perpetual offline license appeared. Pats chose gestures. An early unrelated-tea callback exposed over-eager continuity. After focused context projection, tea stayed on its own subject, the relevant vendor correction updated the prior view, and unchanged evidence after closure produced silence. Final focused follow-up reused an actual earlier generated quote, explicitly recorded in the log.
- Package archive audit: version 1.4.1; no settings, credentials, history, database or environment files bundled. Deployed archive hash matches the tested package.

## Costs and limits

Production adds zero model calls. Existing budgets and session limits are unchanged. A seeded full-slot check projected 3,671 characters of total conversational context, with a 5,069-byte ordinary subject checkpoint and mean 0.041 ms projection time over 1,000 iterations on this machine. These are focused measurements, not a full CPU/GPU benchmark. The extra quoted subject context is bounded to roughly a few hundred tokens per call; exact tokenizer cost varies. Luna evaluation usage is retained where the existing provider/session interfaces expose it; transient direct-session usage was not separately reported, so no complete token bill or dollar cost is claimed.

Subject matching is deliberately conservative and lexical; implicit semantic connections can be missed. Recent quote truncation and bounded eviction can lose nuance. Model judgment can still produce an unnecessary callback or question. Source-derived context does not survive restart. Existing memory and native conversational history remain available under their current permissions and settings.

## Deployment

The taskbar pin targeted a running 1.0.0 package. That exact packaged target was replaced with the validated 1.4.1 build, preserving the pin's path and identity. Taskbar, desktop and Start menu shortcuts now launch the same packaged executable; desktop/start no longer launch the old source Electron copy. Launch through the pinned shortcut was verified by process path and application logs: 1.4.1, the original Documents\Capri Buddy profile, 40 approved memories, connected Codex provider and character readiness. No setting repairs were reported. Memory and credential files were unchanged byte-for-byte; settings only gained the disabled capabilityBoost default.

Stopped-profile, package and shortcut backups are in this task's work\deployment-backup folder. Installer and source patch accompany this report. The old package is retained for rollback; no profile was reset.
