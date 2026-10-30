# Dialogue and continuity, 0.2.43

The requested emphasis is more mischievous, unpredictable and audacious, with
the existing head-pat warmth preserved. `CAPRI_MISCHIEF_DIRECTION` is an app
adaptation shared by chat and generated desktop remarks. It asks for a concrete
want or opinion, situational disagreement and varied response shapes. This is
not additional canon. Most local touch/movement lines still require no model call.
New complete lines broaden those pools without inflating arbitrary phrase combinations.
The replay ledger now retains 128 delivered lines for 30 days. Required local
reactions can relax older exclusions when their finite pool is exhausted.

## Research and limits

Revisited 2026-10-27:

- https://www.cyberpunk.net/en/edgerunners2 (official show context).
- https://transcripts.foreverdreaming.org/viewtopic.php?t=266325 (community captions;
  familiar intrusion, evasive corrections and casual explanations).
- https://transcripts.foreverdreaming.org/viewtopic.php?t=266328 (community captions;
  self-interest, impatience and breezy deflection).
- https://transcripts.foreverdreaming.org/viewtopic.php?t=266331 (community captions;
  varying registers and mixed host context).
- https://www.reddit.com/r/Edgerunners/comments/1xgztnh/i_dont_think_capri_was_happy_with_her_deal_with_d/
  (audience interpretation of agency, transactions and occasional empathy).

Community interpretation informs acting choices, not canonical facts. Episode audio
was not independently transcribed; the Netflix YouTube clip fetch was throttled.
No subtitle corpus or collection of show quotations was added. The model still
has stylistic variation and can produce a generic line; prompt checks are not a
guarantee of performance quality.

## Three forms of continuity

1. Approved durable memory stores explicit facts/preferences, plans, named projects,
   progress and corrections with source evidence. Capacity is now 1,000 entries.
   Learning remains controlled by the existing automatic-learning toggle. Extraction
   gets original message timestamps so delayed work does not reinterpret an old
   relative plan as if said today. The extractor is told to return the latest explicit
   state of a subject and distinguish plans from outcomes.
2. The dated conversation archive now keeps up to 50,000 messages under the existing
   retention setting, instead of 2,000. Local relevance search retrieves up to three
   short exchanges; the normal live turn window is unchanged. A short re-entry can
   surface a prior substantial topic from 4 hours to 90 days ago, with no claim that
   it remains unfinished. Existing messages previously pruned cannot be recovered.
3. The observed profile stores daily aggregate app-category seconds and counts of
   pats, pokes and chat messages. It is not a personality diagnosis. Full totals and
   the last seven calendar days are distinct. Partial observations do not establish
   productivity, document contents, emotional state or goals.

## Observed profile controls

Memory > Our patterns shows totals and a toggle. Enabled by default for this
requested build, it also requires memory and saved history. App activity further
requires Notice local context. Only consecutive foreground samples at most five
seconds apart count; absence, hidden/fullscreen suppression, quiet periods,
developer simulations, restarts and overnight gaps do not accrue time. Category
classification is approximate and uses the existing app classifier. No raw titles,
paths, messages, screenshots or keystrokes enter `interaction-profile.json`.

Turning off the profile, memory or saved history clears its persisted aggregates.
Clear observed patterns, Forget all, Clear history and Reset all clear it too.
The profile follows history retention, with a ten-year aggregate ceiling when
retention is unlimited. Pausing local context stops app sampling while preserving
earlier aggregates and allowing direct interaction counts.

The aggregates are stored locally. Their compact summary is included in requests
to the selected dialogue provider so Capri can use it. It is not confined to local
model processing when a remote provider is selected. No historical computer usage
is backfilled; the profile starts with this version.

## Recoverable background learning

`memory-learning-queue.json` holds up to 200 unprocessed user messages only when
memory, automatic learning and saved history are enabled. It is bounded by history
retention (30 days for an unlimited-history queue), atomically written and loaded
on restart. Normal shutdown pauses rather than discards pending work. Completed
jobs leave the queue. Rate limits, offline mode, malformed output and network
failures retain pending work for a later bounded-budget attempt. Direct replies
still take priority. Memory batches can run a minute apart, up to three per ten
minutes, within the unchanged shared five-attempt background ceiling. Manual memory edits/deletions/reset and Clear history discard
pending extraction so old queued text cannot undo those actions. Off-the-record
messages do not enter the queue. Disabling saved history removes queue persistence;
session-only learning can continue if explicitly enabled.

## Suggested next steps

- Add a small inspectable set of shared ongoing threads with last mention, outcome,
  next eligible follow-up and dismiss controls. This would support selective
  follow-ups without turning a recalled plan into a nagging task list.
- Add consistent Capri tastes and optional running bits with their originating
  exchange, keeping them separate from user preferences and canon. Current recall
  can recover her words but is still lexical, not a semantic memory model.
- Add an optional project association the user names for an app/window. Explicit
  associations would let broad activity become meaningful project continuity
  without inferring a project from a title or reading unrelated private content.
- Add a simple line feedback control to retire a disliked local line and save an
  explicit style preference for generated dialogue. This is stronger feedback than
  inferring preference from a pat or how often an app is opened.
