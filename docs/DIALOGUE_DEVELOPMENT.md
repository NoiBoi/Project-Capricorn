# Capri 0.2.56: grounded dialogue and continuity

Capri's remarks now have a shared physical context and better access to the actual conversation. Persistent curiosity can survive an interruption without turning every later interaction into another declaration about that curiosity.

## Changes

- Interests merge by subject and document identity, preserving their initial ten-minute deadline across changed captures and restarts. An expired subject cannot renew itself for two hours merely by being captured again. Legacy duplicate interests are merged on load. Interest bookkeeping stays bounded.
- Repeated declarations of unresolved curiosity are filtered separately from ordinary wording similarity. New discoveries and conclusions can still be spoken.
- Direct chat and desktop decisions receive the same host-observed body state, including carrying, falling, movement, inverted perching, user placement, support, gaze target, and the renderer's reported secondary pose and animation. Physical state changes invalidate pending desktop remarks. A surface allowing a pose is not treated as proof of that pose.
- Contact events occupy at most four slots in the fourteen-entry conversation scene. Recent substantive dialogue remains available through repeated alternating pats and pickups.
- Ambient dialogue can retrieve bounded, dated earlier exchanges. A new specific subject takes precedence in the retrieval query. An unrelated episode no longer qualifies merely because it occurred in the same application.
- Project threads retain up to eight sourced developments and six user-supplied alternate names. Current status overrides older plans. Prompt context shows a short recent timeline, and a relevant project can inform an opinion without demanding a progress report.
- Tastes retain speaker attribution and now support natural replies to explicit questions about Capri's own preferences. The host supplies the actual question with the delivered answer. A question about what the user should choose does not qualify as Capri's taste.
- Pending automatic learning can no longer be postponed indefinitely by repeated scheduling from desktop observations.
- Live chat receives the existing show-informed dialogue register and lasting-rapport guidance as well as the compact character core. No copied example replies or new canonical claims were added.

## User-adjustable allowance

Character > Conversation cues > Conversation activity controls optional generation and delivered-aside pacing. The default is Lively, following the user's request to raise the ceilings. Selecting a lower level immediately changes the applicable limits without deleting recent usage.

| Level | Ambient requests per 10 minutes | Memory requests | Placement requests | Contact requests | Combined ambient/memory | Minimum unsolicited speech gap | Maximum unsolicited remarks per 5 minutes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Relaxed | 6 | 3 | 4 | 6 | 8 | 45 s | 3 |
| Balanced | 12 | 6 | 8 | 12 | 16 | 25 s | 6 |
| Lively | 24 | 12 | 16 | 24 | 32 | 15 s | 10 |
| Very lively | 48 | 24 | 32 | 48 | 64 | 8 s | 16 |

These are ceilings, not speech quotas. Requests may produce speech, gestures or silence. Direct user chat remains independent of optional request allowances. Existing provider-error cooldowns, focus, sleep, game, privacy, visibility and user-absence controls still apply. The increase creates room for more relevant interaction without timer-driven filler.

## Verification

The first genuine model check exposed a real taste-learning failure: a natural music preference was rejected by a rigid first-person phrase gate. That result is retained separately. The repaired run learned Capri's music preference and the synthetic project's alternate name, completion and timeline. After restarting with synthetic transient conversation removed, Capri recalled industrial music and the completed project. It also produced a spoken pat response connected to her own earlier opinion.

Both runs retain their original generated replies, including ordinary acknowledgements and imperfect phrasing. They establish the exercised learning and recall paths, not universal characterization quality. This release adds no invented tastes to the user's real profile and does not replay historical conversations into fresh memory automatically.

Final unit, packaged and deployment evidence is recorded in the accompanying validation report. Ongoing everyday feedback remains necessary for evaluating naturalness and fidelity to the character.
