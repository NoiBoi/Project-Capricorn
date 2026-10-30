# Behavior audit and developer workspace (0.2.49)

The reconciled 0.2.48 build contained the combined core, episodic store and environmental pipeline. Passing mocked checks did not establish successful live visual decisions.

## Findings and fixes

1. A real Codex visual decision omitted the required reason field. Validation rejected the entire response, including its useful visual reading. The old fallback described this as provider unavailability and quiet. The decision request now supplies its JSON output schema to Codex, allows sufficient response space, and translates nullable optional wire fields before the existing strict validation. Provenance, stale-target, speech and delivery gates remain authoritative. Rejections expose a bounded field-name or provider-category diagnostic, never raw provider text.
2. Routine metadata decisions refreshed lastAmbientGeneration, and visual inspection required a full configured remark interval since that timestamp. Repeated background decisions could therefore starve visual inspection. Inspection now measures its longer interval from inspection/direct interaction, while retaining the two-minute ambient spacing and shared budget. Admission checks budget and core eligibility before consuming a subject's inspection attempt.
3. The old developer screen showed a long unstructured control list and a small runtime text dump. It concealed the difference between unavailable decisions, silence, lack of evidence and normal waiting.

## Developer workspace

- Overview: live presence, actual renderer mood/phase/artwork, active direction, last decision, current evidence, movement state, request allowances and blockers. Timing windows describe eligibility, not guaranteed action. Host acceptance is distinguished from completed audio delivery.
- Mind & memory: observations, attributed interests, tentative visual readings, shared conversation, episodic experiences and wants, character tastes and ongoing projects. Evidence can be expanded without polling collapsing it. No new thought-generation or persistence system.
- Playground: searchable controls grouped by artwork, expression, movement and dialogue. All existing registered sprite strips, secondary poses, scenarios, cut-ins, flourishes, scenes, pings, local dialogue and absence controls remain. Seven moods, six reactions, all six life events and all seven assistant phases can be previewed directly.
- Live checks: explicit real-context checks separated from local previews, honoring existing context, focus and request controls.
- Results: cancellable preview log and bounded real decision journal.

A newly opened developer window uses a wider, display-bounded layout. The screen also adapts to narrow windows. Local previews use the existing controller, restore temporary phase/pose state, and do not request models or create personal memories. Viewing diagnostics requests no model work and stores no new data.

## Verification

The initial unchanged build passed all 483 unit tests and seven focused integrated core/continuity cases. The live three-opportunity session nevertheless failed its visual-reading check. A second diagnostic identified the missing reason field. After structured output was supplied, the same synthetic diagram produced a valid interpretation, retained curiosity and two gaze points with no validation error.

Final regression, packaged and deployment results are recorded in the delivered audit report. These checks establish execution and data flow. They do not establish subjective naturalness or guarantee that every interesting window will cause speech.

Final checks: 485 unit checks passed; the broad desktop run had 157 passes, three fixture failures and five skips. All three corrected cases passed, and the final packaged selection passed all 21 checks. The genuine packaged three-opportunity session retained a visual curiosity and episode, used a gesture for contact, recalled the diagram in chat and preserved the episode across restart. Local deployment matched the tested package; all 15 checked profile files were unchanged during replacement. Memory/history/credentials stayed byte-identical after restart; the normal recent-scene ring advanced by one while episodic and suppression data remained intact. See the delivered audit for limits and rollback details.
