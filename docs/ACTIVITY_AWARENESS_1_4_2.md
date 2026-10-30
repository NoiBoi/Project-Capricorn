# Capri 1.4.2 — long-term activity awareness

Extends InteractionProfile, the existing Windows idle/presence tick, local JSON persistence and the current chat/BehaviorCore context paths. No new agent, scheduler, memory architecture or dependency.

## Behavior

- Optional local timing aggregates retain up to 60 noon-to-noon days; the UI offers 30 or 60 days. A shorter global history-retention setting wins. Collection records first/last observed input, estimated active and observed idle time, hourly totals, bounded sessions and completed breaks. Gaps over five seconds, restarts, developer simulations, private exchanges, Capri-controlled input, locking and suspend do not count as continuous active use.
- Seven- and thirty-day summaries cover observed computer hours, late-night activity, session lengths and recurring breaks. Patterns require at least three completed days with two hours of coverage and ten minutes of estimated activity. Endpoint estimates require observed inactivity or a system lock/suspend; incomplete sessions do not establish typical session lengths. A previous day's substantially changed endpoint needs five baseline days and a deviation of at least 90 minutes or three median absolute deviations.
- At most one optional daily summary is offered to an already occurring model request. A directly relevant question can request it again. No routine event, speech timer, coaching or extra inference is scheduled. Observed endpoints never establish bedtime, departure, motives or activity on another device.

## Privacy and controls

Access & privacy → Activity awareness includes an explicit switch, retention choice and Clear activity history. Default is off for other/new profiles. It requires memory, saved history and local context. Disabling collection deletes its local record; clearing, disabling or reducing retention withdraws old source-derived context and invalidates affected native sessions. The existing clear-patterns, forget-all and history-clear actions also clear timing data. Ordinary companion-category aggregates remain separate when only activity timing is cleared.

No app names, titles, browsing contents, screenshots or keystrokes are added to this record. Only a compact summary is supplied to the selected model, tagged activity-patterns so derived speech follows existing source privacy and exclusion rules. It is excluded from automatic durable speech learning.

## Validation and costs

- Typecheck and whitespace checks pass. Twenty-eight focused unit tests passed, including three new timing/retention tests. One new packaged UI test exercises provenance, clear, disable and restart.
- Packaged regression checks: 14 passed, one existing skip, across five files covering activity controls, profile/credentials, physical handling, cancelled/covered/closed targets and window intentions.
- Broad unit run: 814 passed; the existing immediate-recline expectation failed, and the unrelated MemoryStore size-cap case timed out under the concurrent run. Its isolated suite then passed all 35 tests. No fully green broad suite is claimed.
- Three genuine Luna first attempts used clearly labelled synthetic activity history. Luna recognized the earlier observed endpoint and rejected an inference of sleep; the optional opportunity did not force a routine announcement. All first outputs and usage are retained. These are prompt probes, not evidence of thirty real observed days.
- A 10,000-sample replay with 30 seeded days and 3,334 settings checks averaged 0.012 ms per sample, including 35 persistence writes over 2.78 simulated hours. The resulting timing file was 22,230 bytes; relevant prompt context was 1,043 characters, roughly a few hundred tokens. These are focused measurements, not a full desktop CPU benchmark. Production adds zero model calls. Writes normally occur at most every five minutes, plus lifecycle/privacy flushes.
- Fixed a latent restart bug exposed by clearing: BehaviorCore now recognizes a privacy-clear tombstone instead of treating it as valid reasoning state. Startup failures are logged; synthetic tests no longer hang behind a native error dialog.

## Limits and rollout

Activity estimates concern this PC while Capri is running. Passive reading or video without input can look idle; shutdown/restart gaps and sparse coverage remain incomplete. Habit recognition needs several adequately observed days; no history was invented or imported from old categories. Dialogue remains model-dependent and may occasionally miss a useful connection.

The tested 1.4.2 package replaces the executable already targeted by the taskbar, desktop and Start menu shortcuts. Activity awareness is enabled on the current profile at the user's request, with a 60-day cap. A stopped-profile and 1.4.1 package backup is retained in this task's work/deployment-backup-1.4.2 folder. Installer, source patch, evaluations and resource results accompany this report.
