# Capri 0.2.55: restore speech, improve the reactions

This corrects the 0.2.54 overcorrection. The user wanted better, more characterful reactions, including reactions to screenshots, rather than less speech.

- Removed the blanket rule that prevented automatic screenshot inspections from speaking. A relevant screenshot can now prompt speech, a gesture, a closer look, or silence using the normal shared restraint.
- Preserved direct spoken reactions to pats, pokes, pickups, putdowns and window placements. Direct physical interactions keep priority over the unsolicited-aside waiting period.
- Added Capri's fuller existing dialogue-register guidance to the desktop decision prompt. That path previously used only the compact character brief.
- Replaced the silent-inspection direction with affirmative guidance for spontaneous reactions to physical contact, movement, and visible details. Small interactions do not need an analytical justification to deserve a line. Her enjoyment, cheek, preferences, curiosity, impatience or interrupted thought should shape the response.
- Screenshots remain grounded evidence. The desired speech is a personal reaction to a detail, not a caption, generic aesthetic praise, advice, or the same manufactured question every time.

The initiative recovery, varied movement, retained interests, deferred follow-through, privacy controls and bounded request use from 0.2.54 remain in place. No remark-frequency limit was changed for this correction.

Validation: TypeScript validation and 56 focused tests passed before packaging, including explicit spoken-reaction checks for screenshots and five kinds of physical interaction. Packaged validation and genuine provider outputs are recorded in the accompanying reports. Generated tone remains model-dependent; these changes enable and guide relevant speech rather than forcing a line after every event.

Final validation: all 20 selected packaged checks passed on 0.2.55. Two genuine Codex opportunities also delivered speech: a reaction to the synthetic screenshot and a pat response that retained the visual curiosity. Both outputs are retained in Capri-0.2.55-live-reactions.json without resampling. This confirms spoken delivery and continuity; it does not establish perfect characterization.
