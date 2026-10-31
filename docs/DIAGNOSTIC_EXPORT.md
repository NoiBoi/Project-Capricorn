# Diagnostic snapshots (1.5.1)

Open **Settings → Export diagnostic snapshot**, **App & shortcuts → Export
diagnostic snapshot**, or the same button at the top of **Developer tools**.
Choose a destination in the Save dialog. Export is local and makes no model
request, connection test, source sync or upload. Both windows show the version
reported by the running application, with `(source)` for a source launch.

Reproduce the problem, then export before restarting. The compact JSON includes:

- Running version, executable/profile paths, settings and credential-presence
  flags; actual credential values are redacted.
- Every supported source in `connectionInventory`, including disconnected
  Google Calendar, Last.fm, OwnTracks, Chrome, Outlook, Gmail, Teams, Discord,
  academic imports, and configured project folders. Disabled sources explicitly
  say `not connected`; enabling collection alone does not establish successful
  sync. Last known health, permissions and eligible evidence counts distinguish
  authorization, receipt and availability to conversation.
- All cognitive database records and dependencies: evidence, subjects, session
  metadata, checkpoints, actions, pending intentions and execution receipts.
- Memories including approval/archive state, retained chat, notes, reminders,
  relationship/continuity state, learned readings, local activity and budgets.
- Current developer state, attention/initiative gates, environmental readings,
  interaction context, current location checkpoint, custom places, visit history,
  integration state, and eligible direct-chat versus proactive evidence.
- Session-only traces of recent assembled model inputs for direct chat and
  ambient decisions, with source dependencies, reply/decision outcomes and errors.
  Structured interpretation/reason fields are recorded decision summaries, never
  private model chain of thought. A screenshot-attached flag records visual
  access; image pixels and audio are not included.
- Up to 2,000 existing log lines and an inventory of application data files.
  Missing, oversized or unreadable files and failed sections are identified.

## Reading a failure

For a denied location claim, compare `locationCheckpoint` and
`locationAndIntegrations.location` with `currentChatEvidence.eligibleEvents`.
Check timestamps, confidence, permissions, expiry and exclusions. Then inspect
the matching `recentModelTraces` model input: did the actual request contain
the evidence? Compare that input with the delivered reply. Stored data alone
does not prove the model received it. Ambient requests use a separate lane.

Connection health is a local observation, not a new external verification.
The source's `recentRecords` count describes the bounded recent view; full
retained evidence/checkpoints are in `cognitiveRecords`.

## Boundaries

Snapshots contain personal content and location evidence; review before sharing.
Credential stores, browser cookies/cache, screenshot pixels, off-the-record
messages and expired/deleted data are excluded. Arbitrary watched-folder contents
and remote inbox/provider histories are not fetched. Only the evidence already
available to Capri is captured. External accounts may hold additional data.

Trace retention is in memory only: up to 40 entries / 8 MiB, with a 2 MiB limit
per entry and a dropped-entry count. Traces clear on privacy/source revocation,
private exchange, history deletion and applicable memory resets. They require
memory and saved history to be enabled. Application restarts discard traces.
Native model sessions may contain additional remote history not exposed here;
the assembled context is not a claim to export all provider-internal state.

File reads are allowlisted and limited to 16 MiB per file. Runtime sections are
captured sequentially. The JSON states these limits instead of implying a
complete atomic snapshot or recoverable historical GPS trail.
