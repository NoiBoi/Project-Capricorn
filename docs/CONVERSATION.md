# Regular chat and shared continuity

Version 0.2.35 gives regular conversation a stable character brief: Capri has a
reason to speak, a point of view and a changing rhythm, rather than a service
role with a mandatory joke. Her existing attributed character references remain
in use. Current exchanges determine warmth, audacity, curiosity or a plain answer;
the model is not asked to pick a fresh temperament every turn. Useful technical
answers remain direct. Prompts separate instructions from dated data, following
the [official OpenAI prompting guidance](https://developers.openai.com/api/docs/guides/prompt-engineering).

## One relationship across desktop and chat

`CompanionScenes` records delivered desktop lines and completed movement events.
It never imports the procedural director's unused candidates as if they had been
spoken. Regular chat receives up to four recent spoken lines, two recent actions
and two relevant older events within a 1,800-character text budget. Events retain
their original timestamps, relative age and kind. A quotation of Capri's opinion
is not promoted to a fact about the user. Current state overrides old actions.
Developer previews and exploration trials do not populate this record.

Generated asides receive the same event history and up to four recent chat
messages. This lets an aside continue a conversation or keep Capri's established
taste without treating a question she asked as something the user confirmed.
Opening chat in response to an aside preserves that aside rather than replacing
it with the last chat reply.

## Older conversation recall

The recent exchange retains its existing 12,000-character budget and configured
turn limit. A local search can retrieve up to three relevant older user/reply
pairs, capped at 3,000 characters, from the existing retained chat store. The
current message supplies the primary query. Short follow-ups can borrow the
recent topic; unrelated recent topics cannot crowd out a direct query's matches.
Distinctive names and questions about Capri's own opinions can retrieve a pair.
Quotes stay attributed to the user or Capri and are dated. Errors, duplicate
recent turns and interrupted recalled replies are excluded. A zero chat-history
turn limit disables this older-chat retrieval too.

Approved personal memories remain separately managed. Short follow-ups use their
ongoing topic when selecting the existing bounded memory working set; explicit
profile recall retains the full approved-profile route. Current corrections take
priority over older quotes. No embeddings, summary models or additional requests
are introduced. Context availability improves recall; it does not make the store
a complete semantic memory of everything ever discussed.

## Persistence and controls

The bounded scene journal is `companion-scenes.json` in the application profile:
at most 96 entries, at most 600 characters each, retained for the shorter of the
configured history retention or 30 days. With unlimited chat retention, the
scene journal still caps at 30 days. It stores broad surface categories rather
than raw window titles. It starts recording on this update and does not invent
a retrospective history of old asides.

Save conversations controls scene persistence too. Disabling it removes the saved
journal; subsequent events remain available only during that session. Clear
history cancels active generation before removing chat and scene histories. Full
reset also clears the journal. Approved personal facts are not changed by these
history controls. No facts are copied from synthetic test profiles into the
user's profile.

## Verification

Tests cover local old-topic and named-object recall, attribution of Capri's own
opinions, quote budgets, retention, malformed/future entries, persistence, and
disabled-history behavior. Electron checks inspect actual outgoing chat/aside
requests, aside preservation, full restart, and clearing history. A single live
request with the configured GPT-6 Luna connected a delivered fox-related aside
to a seeded older ceramic-fox exchange outside the active history window. This
was a focused smoke check, not a general guarantee of model behavior.
