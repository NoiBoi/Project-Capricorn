# Capri 0.2.48: reconciled overhaul

The Stage 0–2 and Stage 3–4 work had different source lineages. Both started at
`138c947` (0.2.45). The Stage 0–2 branch advanced through `68fad5d`, while the
0.2.47 production checkout contained the separate Stage 3–4 changes without that
branch. The previous Stage 4 report's claim to integrate all stages was incorrect.

This reconciliation uses a three-way comparison against that common source.
The pre-reconciliation working files were backed up before editing. The Stage 0
prototype remains a harness importing the production core, with no second live
behavior engine.

## Combined behavior

Foreground sampling and selective exposed-window captures feed Stage 1's
`BehaviorCore`. Environmental familiarity supplies local look/inspection
opportunities; the core owns optional model decisions, short-lived interests,
interruption, shared request limits, and expression. There is one structured
response containing the decision, visual descriptions, tentative interpretation,
optional curiosity, evidence-backed episode proposal, and harmless interest
points. There is no separate perception/planning/reflection request.

Stage 2's attributed episodes and bounded wants inform the same core and normal
chat. Environmental descriptions remain uncertain model readings. Only selected,
source-backed experiences enter episodic storage, subject to existing learning
and privacy settings. Physical contact remains immediate and can continue the
same thought; chat preempts optional work. Corrections, private input, memory
controls, and privacy changes also clear the session's environmental projection
so an older curiosity cannot bypass those controls.

Stage 3's stability, rapid-switching, freshness and per-subject inspection gates
remain. Budget reservation now precedes screenshot collection and is consumed
once by the unified request. Invalid title, process, crop geometry, exposure,
placement or exchange revisions reject readings, points and episodes together.

Stage 4's local movement approval allows a safe outing to start while its single
optional inspection runs. The existing movement executor owns the trip and rest;
the core can request an investigation through that executor. The single-outing
guard remains. There is no second post-tour commentary cycle or mandatory
timer-driven question. Ordinary fidgets yield during outings.

Delivery uses the later Stage 4 receipt path. Visible text records once on
acceptance. Audio-only remarks record after matching start and successful end;
cancelled or failed speech does not count. Dialogue replay history commits at
that same delivery boundary. A decision journal's `delivered` field still means
host acceptance, not proof that audio completed. Old utterance receipts cannot
finish a newer reply.

The later deduplicated chat context, history-write avoidance, visibility-cache
reuse, renderer error recovery and background-learning priority are retained.
The Stage 2 Windows native-binding packaging resource is retained explicitly.

## Data compatibility

The combined app reads both legacy scene arrays from 0.2.47 and Stage 2's version
2 envelope. It retains the recent events, episodes and forgotten-source markers
when saving the version 2 envelope. Approved personal memories, preferences,
history and credentials retain their existing formats.

Rolling back to 0.2.47 or another binary without Stage 2 also requires the matching
stopped-profile backup: those binaries cannot read version 2 episodes. Do not
replace a current profile with an older backup without preserving new exchanges.
This reconciliation does not fabricate episodes that an older binary might
already have discarded. The inspected live scene file was a legacy array before
deployment.

## Verification

Validation results and deployment details are recorded below after the final
packaged checks. Existing Stage 0–4 reports describe their individual historical
builds; their prior quality and performance measurements do not establish the
combined build's behavior.

Final validation: TypeScript checking and all 483 unit tests passed. The broader desktop sweep passed 142 cases, failed 12 and skipped five conditional/live cases. The 12 failures were traced to retired behavior expectations, changed request envelopes, fixture fullscreen configuration and blocker-message precedence. All 18 corrected desktop cases passed in a focused rerun. Nine packaged continuity/conversation cases passed; three opt-in live cases were skipped. No new live-provider quality or performance claim is made.

Nine additional packaged cross-stage checks passed, covering movement overlap, the single-outing guard, quiet visual continuity, title/geometry/occlusion rejection, screenshot denial before an exhausted budget, and audio completion. In total, 18 focused packaged checks passed. A second complete all-green desktop sweep was not performed.

Deployment: the 0.2.48 portable application was updated and restarted. Its application package matches the tested staging copy. All 23 checked profile files stayed unchanged during replacement. Saved memory, credentials and history fingerprints remained unchanged after restart, and all 91 prior recent scenes were retained. The previous complete app and stopped profile are retained at the reconciliation task's work/rollback-0.2.47 directory. The installer is built; no remote release was published.

