# Stage 4 update: semantic reading in product 0.9.0

The Chrome extension now supports metadata, explicitly enabled passive reading per
approved site, and deeper reading once on request. Existing pairing and optional
host grants remain. Reload the existing extension directory; do not rotate pairing
merely to upgrade. The app still independently requires exact origins and content
permission. Structured rendered sections are bounded to 18,000 characters passively
or 48,000 on request, with up to 24 local snapshots under source retention controls.
Only relevant sections enter model context. New developments carry a bounded section
selection, never a whole page. Private forms and hidden content are excluded.
YouTube media samples establish playback state, not user watching duration.

The same Life checkpoint owns the deferred attention queue and source revocation.
Important developments can wait through games/focus; related facts are combined.
World projections preserve evidence status, and unchanged semantic subjects saturate
before optional model calls. No second cognitive loop was introduced. Full current
architecture and continuation are docs/architecture/STAGE4.md and STAGE5_HANDOFF.md
in the source checkout. Earlier integration details below remain supporting records;
older one-time-only excerpt descriptions are superseded by this section.

# Unified Life Context: Stages 1-3

Release 0.6.0. The existing Electron main process owns this subsystem. There is no second agent, scheduler, memory migration, graph database, or model call during ingestion.

## Existing components and boundaries

- `BehaviorCore` remains the sole optional model decision lane. Host interruption, focus, sleep, hidden/fullscreen, speech, budget and delivery gates remain in force. Candidate events enter the existing presence opportunity; they do not speak directly.
- `PersonalContext` retains explicit situations, intentions and follow-ups. `RelationshipStore` retains user/project threads and Capri's established tastes. They are not replaced by the event ledger.
- `CompanionScenes` retains established shared experience and completed action receipts. Existing desktop exploration, movement, Spotify/YouTube metadata and screenshot systems remain.
- `HonchoMemory` retains its local conversation/profile implementation, erasure queue and native stores. Chrome/project source learning remains unavailable. Stage 2 adds separately scoped summary learning as described below. External observations and source-informed assistant dialogue never become Honcho input, auto-learned profile facts, tastes or episodes. Ordinary native conversation/profile learning works when connected live sources are absent.
- `docs/DIALOGUE_GUIDE.md` remains the cumulative personality foundation in both prompt paths.
- Typed preload channels retain main-process sender checks and Zod validation. Pairing uses the existing OS-encrypted `SecretStore`; no plaintext application token file is introduced. When OS encryption is unavailable, pairing is session-only.

## Event model and bounded persistence

`src/shared/lifeContext.ts` defines adapters, source policies, events, entities and candidates. Events include source identity, source record ID, monotonic revision, occurrence/reception/expiry timestamps, operation, type, canonical entity IDs, evidence quality, bounded detail and permissions. Observed data, user statements, model interpretations and uncertain associations have distinct labels.

`LifeContext` appends accepted events to a bounded in-memory ledger. A debounced atomic JSON snapshot avoids a new Windows native SQLite dependency. Existing unrelated stores are untouched. Limits: 40 source slots with a separate 20-project limit, including Chrome, Calendar, Last.fm, OwnTracks and communication/academic/Discord sources, 100 entities, 2,000 event records, 512 candidates, 4,000 revision watermarks, 1 to 30 days of source retention. Source configs survive restart; evidence/candidates/watermarks persist only for sources with retention permission and saved-history enabled. Nothing is retained indefinitely.

Equal/older revisions are rejected. Tombstones preserve deletion ordering across restart. Latest revision per record supplies current projections, excluding expired, deleted, paused, revoked or live-disabled evidence. Delayed historical events remain historical. Current explicit user corrections block passive overwrites until expiry, while deletions still take effect immediately. Changing source controls invalidates that source's previous evidence. For an unrecognized store version/schema, startup fails without replacing the original file; invalid JSON uses the established corruption backup behavior.

Canonical project IDs and user-confirmed aliases associate folder names, repository URLs and documentation. Source-backed aliases disappear on forget/revocation. Uncertain associations are displayed with their certainty and never automatically treated as an identity. There is no fuzzy model-generated merge or completion inference. Users should choose distinctive aliases; ambiguous aliases can match multiple projects and remain qualified.

`ContextAssembler` selects up to six fresh records, bounded to 3,600 characters, ranked by explicit correction, project relevance and freshness. It combines immediate context, selected native material, historical excerpts and Honcho understanding within a character budget. Chat and ambient prompts use it incrementally while preserving the native recall paths. Character budgets are conservative length limits, not tokenizer estimates. Records are serialized as untrusted evidence, never action authorization. Chat actions become tainted when live sources can have informed the exchange, retaining existing confirmation escalation for noncosmetic tools.

## Attention lifecycle

Events with sufficient importance/freshness create semantic candidates. Ordinary page navigation/headings and individual file edits stay below the unsolicited-speech threshold; approved selected content, a development-session batch or a Git change may qualify. Equivalent content updates refresh evidence, not novelty. Candidates progress through pending, deferred, delivered, dismissed, expired or superseded. A brief settling delay and at most two attempts limit retries. Delivered semantic callbacks remain consumed through retained restart history; when retention is off, consumption is session-local by design.

Existing presence arbitration selects at most one candidate. Direct chat cancels in-flight optional work through the existing BehaviorCore cancellation path. Accepted gestures or quiet decisions do not manufacture spoken history. A host-confirmed delivered callback consumes the candidate. No clock event alone manufactures a reason to talk.

## Chrome transport and semantics

The shipped MV3 extension uses optional exact site grants and its own clear allowlist. The app independently enforces exact site origins. The extension observes only the active tab in Chrome's focused window, top frame, and no incognito. Periodic freshness checks are lightweight source observation, not reasoning. Navigation, focus changes and debounced DOM mutation hints trigger recapture. The service worker stores pairing/allowlist in `chrome.storage.local`, uses a 30-second alarm to recover after suspension or Capri restart, and exponentially backs off to five minutes after connection failure.

Requests go to `127.0.0.1:43129/v1/page`. The bridge requires the exact Host, exact paired `chrome-extension://ID` Origin, bearer token and JSON content type, with bounded request size, connections and timeouts. No wildcard CORS, remote bind, unauthenticated pairing endpoint or action channel exists. Extension IDs are selected by the user in Capri, not trusted from an unsolicited network message. Authentication cannot protect against an already-compromised local process that possesses the token.

Default payloads contain sanitized URL (no query/fragment/userinfo), title, up to eight headings and a description. Selected text or a bounded article excerpt needs both app content permission and a deliberate extension action. No automatic full body, screenshot, iframe, input, form, editable field or hidden content is captured. Sensitive URL categories and pages containing password/payment fields are blocked. Secret-pattern redaction is best effort, not a guarantee that arbitrary prose lacks private information. Only allow sites whose headings/metadata may be shared with the configured dialogue model. Page text is not proof the user read or understood it. Lost focus or revoked site permission emits a tombstone; if delivery fails, evidence expires after 90 seconds.

## Project adapter

Only explicitly picked folders are authorized. A maximum of 20 project watchers use a 900ms debounce and asynchronous bounded scans (3,000 files, 500 directories, depth 12, file metadata up to 2MB). Dependencies, builds, release outputs, Git internals, common credential names and generated binaries are excluded. Symbolic links are not traversed. Rename detection uses file identity when available; otherwise a rename is a create/delete pair. Large folders must be narrowed to avoid scan-limit ambiguity.

Git branch/HEAD are queried without a shell, optional locks or prompting, with a short timeout. Worktree Git metadata pointers are supported. Git internals are never ingested. Changes create metadata evidence and batched session observations, never proof of task completion or successful builds. Unavailable watchers show a failure and retry with capped exponential backoff. No editor plugin or entire-filesystem monitor is installed. Browser/project associations use explicit IDs; editor title guesses are not promoted to verified project activity.

Content indexing is optional, bounded and incremental: only changed approved text/source files up to 16KB, a 2KB read and at most 1,000 characters of sanitized excerpt per event. Read paths are resolved and checked for containment; obvious secrets and ignored paths are excluded. No embedding service, full repository index, automatic document upload or PDF reader exists in Stage 1.

## Revocation and learning boundary

Collection, live dialogue, retained ledger history and content access are independently controlled. Chrome/project Honcho learning remains disabled. Stage 2 sources use separately opt-in summaries and independently erasable workspaces.

While any connected live source is enabled, automatic model learning from the exchange is suspended. Source-informed assistant messages carry `contextSources`, stay visible in saved Chat, and are excluded from automatic history recall and Honcho export. They do not enter the durable shared-scene archive. Revocation cancels pending decisions and chat generation, clears immediate exchange/BehaviorCore caches, removes the source ledger/candidates and source-backed aliases, and stops the adapter. Existing approved memories, credentials for other services, Chat transcript and unrelated episodes are preserved. Users can still deliberately view saved Chat; forgetting context is not deletion of the saved transcript. This conservative Stage 1 boundary prevents derived Honcho conclusions from resurfacing without deleting pre-existing unrelated Honcho understanding.

## Future adapter contract

Calendar, music history, OwnTracks, mail/Teams, Gradescope and Discord use the same typed adapter and event contract, independent credentials and explicit per-source policies. Define stable source record IDs and revisions; map cancellations/deletions to tombstones, changes to source-backed corrections, delayed webhooks to historical events, and disconnect to immediate invalidation. Narrow OAuth scopes, supported APIs, provider-specific consent and removal semantics are prerequisites. Calendar reminders and location inference must be independently authorized. Integrations never authorize computer actions. Do not scrape authenticated private sources or add a second agent loop. Stage 2 extends `learn` to a boolean for its three sources only; the service rejects learning on other kinds.


## Stage 2 implementation

`stage2.ts` owns adapter lifecycle, validated setup, checkpoint persistence, cancellation epochs, budgets/backoff and independent source learning. `calendar.ts`, `lastfm.ts` and `owntracks.ts` publish into the existing LifeContext ledger. They never call a dialogue model. Typed sender-checked IPC and Connections controls are extended; Stage 1 stores and existing physical behavior remain.

Calendar uses a system-browser desktop PKCE/state flow and a temporary 127.0.0.1 callback, OS-encrypted refresh credentials, two read-only scopes and selected calendar IDs. Expanded recurring instances retain provider IDs/ETags, original-start metadata, offsets and all-day calendar zones. Initial synchronization spans seven days back and thirty days ahead; daily full window refresh plus incremental checkpoints handles rolling coverage and HTTP 410 recovery. Checkpoints advance only after ledger flush. Pages and response bytes are bounded. Cancellations/full-window removals create tombstones; changes are corrections. The observation timestamp records when schedule metadata was read; actual planned start/end are explicit fields in the detail. Neither proves attendance.

Last.fm polls supported recent-track APIs at two-minute intervals, at most one bounded historical page per pass, and lifetime artist/track favorites daily. Stable identities combine account, timestamp, artist and title. A maximum of 3,000 completed scrobbles supports bounded frequency and revisit analysis. Metadata is not audio. Windows Spotify owns existing song-change initiatives; Last.fm candidates have zero/low importance and only enrich the existing context. No independent tastes are written to RelationshipStore. Now-scrobbling context expires in three minutes.

OwnTracks binds only 127.0.0.1:43130, disabled by default, with generated 256-bit Basic credentials. Requests require bounded JSON POST /pub, matching X-Limit-D, valid event timestamp, coordinates and accuracy. Origin-bearing browser requests are rejected. Eight connections, 16KB bodies and ten-second timeouts bound transport. The user separately exposes private Tailscale Serve HTTPS; Capri cannot attest tailnet/Funnel configuration. Reports use event time, a bounded deduplication set and a persisted latest timestamp. Delayed/out-of-order reports never rewind current state or trigger present-tense arrival candidates. Accuracy-aware place boundaries add 50m departure hysteresis; ten-minute supported observations can establish phone dwell, never an activity. Raw fixes are not persisted: local place coordinates are setup, and the ledger retains named proximity observations. Place state, scrobble samples and checkpoints persist only with source retention plus saved-history permission.

ContextAssembler joins fresh records through explicit canonical entities and observation proximity, with qualified independent-source links. A fresh arrival corroborated by recent actual PC input may create one candidate through existing initiative arbitration. Model requests, speech and physical actions remain under BehaviorCore and existing host gates. A cancelled source record leaves current prompts immediately.

Each opt-in Stage 2 source has a separate HonchoMemory instance under life-learning/<source>, using the existing local transport, erasure queue and nonblocking background consolidation. Only bounded provenance-labelled summaries are imported. GPS coordinates, full descriptions and track histories are excluded. Source corrections/changes/revocation synchronously clear cached reading and persist a workspace-deletion queue, preserving other sources and native Honcho. Failed/offline erasure blocks old recall through restart. Honcho HTTP 202 is only acceptance: the transport confirms absence through workspace listing before clearing a durable tombstone. Delayed deletion remains pending and cannot restore old context. Automatic export of source-informed Chat remains blocked. Current observations outrank derived routines and user tastes never become Capri opinions.

Limitations and actual checks are in STATUS.md; credential/device setup is in STAGE2-SETUP.md. Source learning is a conservative replace-and-rebuild summary view, not an unlimited lifetime archive. Raw source retention remains bounded to 1-30 days.


## Stage 3 extensions and final audit

`stage3.ts` owns lifecycle/configuration for two Gmail, two Outlook and two Teams slots, Discord local/bot and manual academic records. It extends the same ledger, shared ContextAssembler, aliases and BehaviorCore; no source speaks directly or runs a model at ingestion. New sources start with collection/live/proactive/content/retention/learning off. Outlook/Teams are the user's priority; Gmail remains optional and disconnected.

`oauth.ts` shares public installed-client authorization-code PKCE/state validation for communication accounts. Google uses an ephemeral 127.0.0.1 callback and metadata-only Gmail scope by default; Microsoft uses registered http://localhost:43131/oauth2callback, Mail.ReadBasic or selected-body Mail.Read, Chat.Read and optional ChannelMessage.Read.All. Every account has an independent OS-encrypted refresh credential in the existing SecretStore; Microsoft needs no client secret. Google Desktop configuration can be reused without sharing Calendar refresh tokens. Token rotation, epoch cancellation, bounded requests, off-provider continuation rejection and auth failure invalidation are covered. Discovery is bounded and cannot write stale results after revocation. No sending, archiving or modifying endpoints exist.

`communications.ts` reads selected Gmail labels and mailbox history IDs, Outlook selected-folder delta links with immutable IDs and source-retention filtering, and selected Teams chat/channel messages with bounded reply collection. Account filters, selected body IDs and excluded record IDs are validated. Initial backlog stays below initiative threshold. Significant new request/deadline/recruiting/schedule claims can earn one optional candidate; they remain third-party claims, never proof of a user action. Provider timestamps, conversation identities and fingerprints preserve revisions/deduplication. Checkpoints are committed only after a successful active pass and ledger flush; expired history/delta clears obsolete context before a bounded rescan. Partial/lost writes do not publish checkpoints early. Collection errors back off independently and never block chat or another adapter.

`socialAcademic.ts` uses the existing foreground observation plus a once-per-minute bounded tasklist query for Discord process presence. Explicit game executable matches are application metadata, not gameplay or Discord presence. A legitimate bot reads only configured guild text channels/threads and optionally one configured user's voice connection in one authorized guild. Bot identity is checked; DMs/self-bots/client injection are unsupported. Recent windows plus after-checkpoints detect new/edited messages; five older retained IDs are audited per pass for disappearance. Speech/audio and general DM calls are not detected. No Discord observations enter Honcho. Third-party content is bounded and requires source content permission.

A supported public student Gradescope API was not established in the reviewed official documentation. No undocumented endpoint is used. Selected notification emails are classified as academic notices using the actual sender domain plus observed text, not display-name trust. Existing approved Calendar and Chrome semantics remain source-attributed alternatives. Explicit manual records/normalized JSON imports distinguish assigned/due/submitted/graded/feedback/cancelled without deriving completion. File imports use a native picker, a 256KB limit and 200 validated records. No gradebook/password scraping.

LifePermissions adds optional `proactive`. Existing records without it preserve their previous live-context policy; new Stage 3 sources explicitly default it off. Ingestion, candidate selection, chat/ambient assemblers, Honcho summary context and source-tagged shared turns honor the chosen mode. Mixed BehaviorCore facts/interests/interpretations are conservatively withheld when a source is excluded from that mode. Changing controls clears source context and cancels pending work. Native approved memories, explicit commitments, physical body state and independent tastes remain. Source-informed Chat stays visible but is excluded from automatic archive/Honcho/native learning.

Fresh current projections use fair per-source selection, so an inbox cannot starve location/project/calendar evidence. Relevant canonical-entity queries can retrieve up to two retained, expired records labelled historical; tombstones and disconnected sources are excluded. Explicit person/course/commitment identities use the same association model as projects. Removing an association invalidates dependent learned readings. No model-generated identity merges or automatic promise/completion claims are introduced.

Existing Stage 2 HonchoMemory instances now also host opt-in communication/manual-academic aggregate providers. Summaries include only type counts and explicitly associated project names; no subject/body/address/grade/feedback is exported. Workspace/tombstone semantics remain unchanged, including confirmation of actual absence after asynchronous 202 deletion. Source changes and exclusions block recall immediately; no global Honcho reading is overwritten to remove a single communication source. Browser/project and Discord source learning remain unavailable. Every source still works locally without Honcho.

Lifecycle audit: changing an unrelated communication setting no longer restarts every project watcher or the Chrome listener. Project signatures and Chrome credential/config signatures retain working adapters. Provider synchronization is bounded, sequential per source, abortable, backoff-limited and model-free. Source checkpoint stores cap fingerprint records at 500 per slot and obey retention; main evidence/candidate/watermark caps remain shared. No extra service/framework was added. Phone collection, clipboard, audio and account authorization are never silently enabled.

Known bounded limits: selected Teams windows/replies are not a full tenant archive; edits outside scanned windows may be delayed. Large mail containers need narrowing. Gradescope direct API and general Discord voice/speech/presence are unsupported; official alternatives are documented. Actual OAuth/tenant/server/iPhone access remains user setup. See FINAL_SETUP.md and the current verification matrix in STATUS.md.
