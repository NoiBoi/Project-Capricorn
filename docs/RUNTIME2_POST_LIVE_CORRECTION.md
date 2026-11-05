# Runtime 2 post-live correction and bounded comparison

Baseline: `1226ef45da92bacd08be38edca593c1366c21fee`.
Branch: `fix/runtime2-interaction-character-feedback`.

The November 5 real SIWC recording `2026-11-05T21-36-49-215Z-00a52489`
contained 11 ambient decisions: one remark, two expressions and eight empty
completions. No model requested investigation, memory/interest formation or
relocation. Provider totals were 63,314 input and 993 output tokens. This is
evidence of sparse behavior, not improved companionship. No new live inference
was initiated to prepare these corrections.

## Confirmed dialogue defect and correction

The completed investigation's evidence list cited the user's later cancellation
but not the older exclusive-watch instruction. The loop put every ended-task
evidence ID in `retiredDialogue`. Selection removed the cancellation, retained
its assistant acknowledgement, and could recover the old instruction through
recent history/exchange expansion. A generic completed-task marker remained,
but the actual superseding user statement was missing in all 11 recorded inputs.

Selection now distinguishes user evidence occurring after task creation from
the task's original evidence. For the existing six-task diagnostic/context
window it recovers that later user evidence through the existing journal,
preserves it despite the retirement set, and ranks its exchange as relevant.
The latest selected user exchange is ranked ahead of older lexical matches.
This is provenance/chronology handling, not a language classifier that guesses
whether a message says “cancel.” Later evidence does not reactivate ended tasks.
Earlier explicitly retired dialogue and stale checkpoints remain excluded.

The old instruction can remain as meaningful historical dialogue, accompanied
by the actual later cancellation and completed-task status. The existing
conversation policy already says historical dialogue does not reissue
instructions and completed tasks are inactive. The core prompt is unchanged.
No stored conversation or memory was deleted, and no age cutoff was added.
The 12-record / 4,500-byte dialogue limit and 14 exchange-anchor limit remain.
At most 96 existing local dialogue lookups identify resolution candidates;
at most four resolution anchors are added within the existing anchor limit.
Oversized or numerous exchanges still face these bounded context limits.

Offline reassembly used the actual 11 recorded requests, a read-only source
database snapshot and the production selector, assembler and provider encoder.
Archive recovery was restricted to each original decision time, avoiding future
dialogue leakage. The cancellation changed from **0/11 to 11/11** encoded inputs.
The session's expressed opinion survived in all **9/9** appropriate later inputs.
The original instruction remained historical in 11/11; this is explicit
supersession, not erasure. Maximum selected dialogue size was 3,807 bytes.
Identity, tool schemas and active-state content matched the recorded requests.
This replay checks content delivery, not what a live model will decide.

## Confirmed physical reporting defect and correction

`go(..., 'ai', 'either')` could attempt a local glide. If `glide()` returned
false, `go()` called `automaticBlock()` even though the attempt was not
automatic. That unrelated helper consulted the legacy AI monitor and replaced
the physical failure with “AI is not connected.” SIWC could simultaneously work.

The private glide result now preserves failure details: interruption before
departure, missing native character, no safe path, interruption during travel,
or encountering a protected area. Only automatic requests consult automatic
admission for their failure explanation. A newer cancellation is reported as
such. Existing `flyTo()` callers still receive a boolean. No native arrival,
completion callback or successful-movement count is emitted for failed travel.
Partial native movement is explicitly possible for an interrupted glide.

Regression checks reproduce protected-path failure with the legacy monitor
disconnected, and successful AI-requested travel with that monitor disconnected.
Thus no independent AI-movement admission defect was demonstrated. Automatic
admission, safe placement, quiet, fullscreen, pins and cancellation guards were
not relaxed. The original failed glide's exact physical cause cannot be
reconstructed from its overwritten receipt. It was a local physical attempt;
there were no model relocation calls in the live recording. A supplied movement
tool, a local opportunity, an attempted glide and a completed relocation are
distinct observations.

## Verification

- Typecheck, development build and `git diff --check`: passed.
- Focused continuity, cognition, resource-control, spatial, company and physical
  unit checks: **104 passed**.
- Existing `npm run preflight:runtime2-interactions`: **20 passed**.
- Existing Electron physical, bubble delivery and cognitive checks: **3 passed**.
- No exhaustive suite or live provider choices were used as behavioral proof.
- The pre-existing untracked `docs/DEVELOPMENT_SETUP.md` remains excluded.

Runtime 2 is development-only. The development application was rebuilt and
relaunched with the existing profile, recording off and cloud admission paused.
Version 1.5.5 is unchanged; there is no installer or normal-profile replacement.

## Prepared live comparison — requires explicit authorization

Use the existing `npm run start:daily` entrypoint and `daily-test` profile.
If the prepared application is running, no console is needed: use Chat's
existing session controls. Do not start another copy or reset history.

Prepared page: NASA Science's **Kuiper Belt: Facts**, at
`https://science.nasa.gov/solar-system/kuiper-belt/facts/#h-introduction`.
Browser inspection verified substantive readable paragraphs, rather than a
video title/transcript assumption. Existing Chrome content, live, proactive and
retention permissions already authorize all sites; no permission was changed.
The current app reports SIWC connected, the archive ready, screenshot permission
available and zero new requests. A fullscreen restriction was observed during
startup; physical presentation must be checked after the article is foreground.

Prepared settings: model `gpt-5.6-sol`, **four HTTP attempts total**, 60/hour,
three-minute routine interval, inactivity pacing enabled, 100,000 reported-token
threshold, 4,096 MB diagnostic budget. Only this isolated profile's request and
reported-token thresholds were reduced, with its prior configuration backed up.
Four attempts is a hard session admission limit including authenticated retries,
image-bearing requests, direct requests and all deep continuations. An
investigation consumes the same budget and may leave fewer independent cycles.
The token threshold stops later admissions after reported usage reaches it;
it is not a guaranteed maximum token total or an output-length cap.

Keep the core prompt, tools, context allowance and cognition mode unchanged.
**Do not enable `CAPRI_V2_NORMAL_ATTENTION` for this comparison.** Its existing
implementation clears the inherited attention request/review and pending
observations and excludes pre-session task state and dialogue from ambient
context. That would change context and potentially wake timing together; it
would confound attribution to the two repairs. Restart itself resets transient
timers and silence counters, so timing is still not a controlled matched replay.
The readable page is another deliberate input change. Any improvement cannot
be attributed solely to one correction.

After authorization: start recording once, focus/read the prepared article,
allow ordinary use and a short focus interruption/return, and stop at four
attempts or about ten minutes, whichever occurs first. Do not ask the model to
notice, investigate, speak or move. Inspect the first assembled and matching
wire request for actual paragraph content and cancellation context. If only
headings or pixels arrived, stop and report the perception limitation instead
of treating the result as a text-grounded judgment test. Do not increase the
budget or restart recording to obtain a preferred response.

Select **Stop session**, then **Open report**. Record measured provider usage,
image submissions, missing usage if any, independent decisions and the first
evidence-supported breakdown. The hard request cap denies additional HTTP
attempts; the Stop control also quiesces inference and observation. The recorder
automatically produces its existing local report.

Prepared status is **LIMITED pending authorized observation/request verification**,
not READY: page readability and site permission are checked, but actual text
delivery cannot be claimed from a paused app that is not collecting. If the
model repeatedly returns empty results with substantive, correctly qualified
history and no action denial, report low initiative under those inputs. Do not
respond by adding tools, prompts, memory or scheduling layers. The remaining
causal question is how much earlier passivity came from thin/qualified input
versus the model's decisions under the unchanged policy; the bounded real
requests, outputs and receipts are the next evidence needed.
