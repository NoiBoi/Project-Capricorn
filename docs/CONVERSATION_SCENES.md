# Capri 0.2.45: conversation-led interactions

The main change is what supplies the reason for a line. Chat and desktop contact now share an immediately updated current-exchange record, rather than independently selecting an acting style.

## Current exchange

The record holds up to 14 attributed user/Capri entries, each bounded to 1,200 characters. The last eight enter a shared prompt for chat and contextual desktop turns. It includes real delivered speech and physical-contact events. It expires after 48 hours and is persisted only with memory and saved history enabled. New input wins over earlier interpretations. No inferred feelings or relationship score is stored.

The existing background extraction can enrich the record with subject, Capri’s supported position/intention, an unanswered question and conversational tone. It must cite exact source evidence. A revision check rejects an interpretation if new turns arrived during extraction. This uses the existing learning request, not a second planning request. If the model returns no useful reading, the immediate attributed turns still supply continuity. Automatic learning must be enabled for this optional enrichment.

Memory > Current exchange shows the record and lets you clear it. Disabling memory or saved history, clearing chat, Forget all or Reset all removes it. Off-the-record input and its direct reply do not enter this record. Approved user memories, Capri tastes and project threads remain separate.

## Interactions

Pats and pokes can now request a response to the current conversation. Pickups and movement can continue an active exchange. Touch animation remains immediate. A deliberate-contact allowance permits at most six generation attempts per ten minutes, spaced at least ten seconds apart. It does not compete with the existing inspection/memory allowance. Contact can supersede an in-flight optional remark, and direct chat retains priority. This can increase model use compared with 0.2.44.

Contact generation has a seven-second overall deadline. If unavailable, it uses a tiny acknowledgement or silence rather than a full unrelated canned joke. Explicit quiet output stays quiet. Repeated rapid touches remain primarily gestural. Lines from a superseded conversation or moved-away target are dropped.

Ambient movement uses the existing background budget. During an active exchange, budget exhaustion means silence rather than a template about moving to a new seat. Weather/clock reminders are suppressed during an active exchange. Outside an active exchange, local movement/startup and other fallback pools still exist. This is not a replacement of every local line with continuous generation.

## Voice and variety

Normal live chat and generated desktop turns now use one concise performance brief. The old stacked style paragraphs and keyword-routed acting references are no longer added to live chat. Generated desktop remarks no longer receive a randomly selected innocence/audacity/curiosity direction. A move, pat, disagreement or quiet moment gets its meaning from the exchange.

Desktop generation allows one or two natural sentences, up to 50 words, rather than requiring a 28-word one-liner. The character can still be brief. The current record measures repeated interjection openings, question endings, teasing reversals and performance commentary across the last six delivered lines. Those measurements guide variation without forcing a different mood every turn. Generated replay checks focus on recent lines; retired-line exclusions remain persistent.

App placements prioritize continuing the actual exchange unless a visible detail warrants a change. Music reactions no longer require praise or a jeer. No model, voice engine or Codex sampling configuration was changed. The Codex temperature slider limitation remains.

## Validation and limits

Tests cover multi-turn disagreement, touch, correction, quiet company, restart persistence, stale-state rejection, speaker attribution, privacy/expiration, request budgets and an explicitly quiet generated response. Live synthetic Codex sequences were also reviewed: a pat could continue the color discussion, the model retained its preference on the following chat turn, accepted a change to quiet company, and answered arithmetic plainly. The latest live run persisted 11 entries across restart; its optional background scene reading was null. An earlier run produced and persisted a reading. Neither is represented as a guarantee of natural dialogue.

This is still a prompted model and can sound generic. Long-term older-chat retrieval is still lexical; it has not become a semantic relationship model. Tests establish routing and persistence, while live sequence review checks the quality of the resulting interaction.
