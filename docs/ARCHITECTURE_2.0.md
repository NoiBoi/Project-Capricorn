# Project Capricorn 2.0 — Architecture Guide

Version 0.5 · November 4, 2026 · Living reference

This document condenses the supplied version 0.2 guide and records material implementation findings. The actual checkout and current official provider documentation take precedence. Update this guide when architecture changes, without rewriting other documentation.

## Direction

Capri is intended to become a persistent, autonomous, multimodal desktop companion. A general-purpose conversational model interprets experience, synthesizes context, develops interests and opinions, investigates, and decides whether to speak. Local software owns observation, persistence, scheduling, permissions, execution, and verified outcomes. The model is invoked as needed; it is not a continuously resident process with infinite context.

Preserve original evidence and provider-independent logical continuity. Reduce redundant collection and transport without application-side rules deciding what is interesting. Prefer small working vertical slices and reuse useful infrastructure. Never treat window titles, retrieved content, or model interpretations as host instructions or verified facts.

## Implemented foundation

| Capability | Actual status |
| --- | --- |
| Development-only Runtime 2, synthetic profile, legacy isolation | Phase 1, commit 154d28ffc7fc721ee09142f22ae3dcc0bc66d4af |
| Change-only Win32 foreground metadata and typed execution boundary | Phase 1 |
| Worker-owned SQLite observation archive, retrieval, retention, restart restoration | Phase 2, commit df89dda4a4658c53b0a2b88aab77b8acc5679489; pushed separately |
| Database path inspection rejects dangling links and non-files before SQLite | Phase 2; real file-link regression skipped on this Windows host due to permissions; mocked link and actual directory/junction tests passed |
| Durable logical conversation, rolling context, archive tools, coalesced inference, chat integration | Phase 3; automated tests and the first live SIWC loop verified |
| Supported browser OAuth, account catalog, Responses streaming | Official SIWC DevKit integration; authorized live gpt-6.1-sol inference and all four read-only tools verified, including continuation after restart |
| Rich perception, canonical memories/intentions, attention, native positioning | Integrated cycle 1; controlled worker/Electron integration and a separate live SIWC image request verified |

Legacy remains the default. Runtime 2 requires CAPRI_RUNTIME=2 and an isolated CAPRI_V2_PROFILE_ID. It ignores CAPRI_USER_DATA, rejects packaged use and profile links, and does not migrate legacy histories or memories. Do not change these boundaries silently.

## November 4 efficiency verification

The 183-second diagnostic captured 13 requests, 368,816 input tokens, and ten silent completions. Offline replay of the same 13 request points reduced average full observations from 59 to 4.5 and repeated observations from 52 to 2.7. Using captured provider attribution, estimated average input fell from 28,371 to 4,489 tokens. A separate scheduling replay admitted six wakeups under restored daily-test defaults with silent-response backoff disabled. These are offline comparisons. Live behavior and billing after the correction remain unmeasured.

## Layered cognitive workspace

Layer 0 carries factual scene entries and their observation IDs, recent dialogue, active state, due reviews, body, attention and execution receipts. SQLite schema 5 stores the latest retained observation per source slot and the acknowledged sequence. Migration seeds historical slots and uses the existing journal high-water mark. On restart, retained entries remain last-known or stale until a live observation establishes current status. Screenshots retain their original capture time and historical provenance. A successful response acknowledges only the version assembled for that request. Recent changes are coalesced and bounded, with the original observations still available independently. Newly captured pixels can travel once on the visual fast path. A direct question can receive a fresh browser excerpt in its first request.

The model can write or retire the 1,800-character `working-checkpoint` through revision-checked `write_memory`. Checkpoint text is explicitly an interpretation. Capri can pin up to six foundational records and cite observation or dialogue IDs. Routine assembly starts with 24 recent dialogue turns and the essential retrieval, memory, attention and movement tools. Direct, scheduled and investigative requests have wider histories and the full tool set. Large older tool payloads within a cycle can be replaced by recovery IDs after delivery.

Layer 1 uses `search_observations` for compact discovery with source, modality, date and related-ID filters, including a saved-dialogue modality. The existing worker builds SQLite FTS5 indexes transactionally where supported, uses BM25 for lexical relevance and provides a bounded literal fallback. Archive deletes, expiry pruning and source revocation remove index entries. Equivalent same-source hits are deduplicated within each result page. Layer 2 supplies paged browser sections and dialogue excerpts. Layer 3 retrieves directly by ID or batches up to six evidence requests, with response and image bounds. Layer 4 uses the existing authorized inspection, browser, capture and attention capabilities through the receipt-producing executor.

Attention combines a short settling period with a maximum wait for continuous changes. Direct input can interrupt ambient work. `set_attention` can watch an exact source identity within the existing monitoring window. Investigation deadlines survive restart and are limited to four scheduled reviews per record, with the existing six-request ceiling per cycle. An exploratory review advances review state. Reliable user-facing reminders with timezone, delivery acknowledgment, retries and local fallback remain future work.

The opt-in recorder keeps exact inputs and adds mode, scene versions, evidence selection and omission IDs, checkpoint revisions and investigation steps. The report filter accepts investigation IDs. The redacted export continues to include only event identity and timing. Detailed local recordings are sensitive historical copies and should be handled independently of the live archive.

## Current topology and feedback loop

1. WindowFocusSource emits changed foreground process/window metadata with timestamps, provenance, loss markers and stable IDs.
2. WindowFocusArchive sends all SQLite operations to one worker. Original observation JSON and an observation reference in the logical journal are committed together before inference is notified.
3. CognitiveLoop batches pending observation changes independently of collection. Equivalent changes do not wake the model, and silent ambient completions increase spacing. Direct messages bypass ambient pacing. One inference cycle owns a conversation at a time; arrivals during inference remain pending.
4. The context manager assembles pinned identity from the canonical runtime section of DIALOGUE_GUIDE.md, recent dialogue, active canonical state, a factual current scene, a short change list with recovery IDs, and paired calls/results. The latest tab state replaces superseded snapshots in routine context. The archive retains originals independently.
5. SiwcProvider translates provider-independent records into Responses input. The model can speak, remain silent, or request historical evidence.
6. The existing TypedCapabilityExecutor validates and executes archive and agent calls. Actual receipts/results are journaled under the model's call ID and returned to the model on the next request. Up to five rounds execute tools; an additional model response can finish the cycle. Further calls earn denied receipts. At most eight calls are accepted per response.
7. Existing chat IPC, preload, panel and bubble receive streamed text and completed messages. Completed assistant dialogue and user messages survive restarts. Legacy Conversation remains blocked in Runtime 2.

Provider failures pause automatic inference and preserve durable state; a new direct message can retry. Shutdown cancels inference and closes the archive after accepted work settles. Interrupted calls are reconstructed with unknown outcomes, never successful invented results. Partial interrupted dialogue is displayed as interrupted but is not canonical completed dialogue.

## Storage and context

The synthetic profile contains runtime2/experience.sqlite. Schema 1 stores original window-focus observations; schema 2 adds a stable conversation UUID and an append-only journal with monotonic sequence numbers. Migration preserves Phase 2 evidence and seeds its references. User/assistant messages, model calls, execution receipts/results, and observation references remain separate record kinds. Tool-call IDs have a durable uniqueness constraint.

Original observations retain the Phase 2 policy: 30 days / 50,000 records, by ingestion time. A retained conversation reference can outlive its original observation; missing evidence is explicit. Conversation records currently persist until the user clears chat; they are not semantic memories. The old 256-item snapshot remains an observation/debug working view, not the durable journal. Chat history queries select dialogue independently of observation volume.

Default input budget: approximately 100,000 tokens, capped by the selected model's catalog-reported context_window minus 8,192 output headroom. The estimator uses UTF-8 byte counts plus overhead and is deliberately approximate. Identity and tool schemas stay pinned. Eviction removes oldest whole recoverable groups, preserving call/result pairing and durable records. Capri can maintain a bounded model-authored checkpoint through the same canonical state tool. Routine requests still carry recent dialogue and the pinned identity.

If the account catalog omits a usable context capacity, inference stops rather than inventing one. The first live account catalog supplied gpt-6.1-sol with 500,000 context tokens. Other accounts/models must still supply their own verified catalog metadata; no entitlement is assumed.

## Provider and authentication

Official references checked November 2, 2026:

- [DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

The local Node SDK runs browser OAuth with loopback callback, PKCE, state/nonce, ID-token verification, a persisted host ID, issued client registration and rotating refresh tokens. Its credential store uses locking, atomic replacement and an Electron safeStorage adapter. Unavailable OS encryption fails closed. Tokens never enter renderer IPC, the conversation archive, or diagnostics.

The SDK is a private workspace rather than a published package. A source snapshot is retained under src/vendor/siwc-local with upstream commit, original license and notices. Only its types, catalog mapping and Responses wrapper are adapted for documented native function tools, structured history, usage and context capacity; authentication/storage code is unchanged. The subtree retains the DevKit Noncommercial License independently of the application license.

This is a meaningful deviation from treating the stock DevKit as a complete inference wrapper: it currently exposes only text streaming. The adapter extends it over the documented public API; it does not introduce a different authentication mechanism.

Discovery uses GET https://api.openai.com/v1/models for the signed-in account. CAPRI_V2_MODEL must explicitly match that catalog and cannot select a Codex/Luna model. Inference uses POST https://api.openai.com/v1/responses, store:false and stream:true. Every HTTP request sends local history; provider-side conversation storage and previous_response_id are not used. Instructions replace explicit system message items. Read-only function definitions are grouped in a capri_archive namespace.

The SIWC preview rejects max_output_tokens and several ordinary API parameters. Output headroom is an input-budget reservation, not a request-side output-token cap. Success requires response.completed. Interrupted/incomplete streams, authentication failures, rate limits and plan-sharing failures surface separately with sanitized diagnostics. No Codex credentials, undocumented endpoints, Luna fallback, API-key fallback or multi-provider orchestration are used.

## Read-only tools

- get_recent_observations: original recent events, optional bounded time range.
- search_observations: literal title/process search, optional time range.
- get_observation_by_id: exact evidence or an explicit missing result.
- get_archive_statistics: count and oldest/newest evidence.

Arguments and counts are validated; retrieval is bounded to 100 observations and response size is bounded. Read calls use the worker archive, existing executor, request deadlines, cancellation and actual receipts. The cycle 1 section below adds narrowly scoped evidence and positioning tools; no shell, arbitrary code, navigation or unrestricted computer control is exposed.

## Integrated cycle 1

The implemented cycle now connects perception, canonical state, attention and positioning to the same CognitiveLoop. It preserves the SIWC provider, native collectors, executor and worker-owned SQLite database. Legacy remains the default, Runtime 2 remains development-only and synthetic-profile-only, and no additional provider, dependency or production-profile migration was introduced.

### Model-visible interfaces

The four archive functions remain in `capri_archive`. Routine requests expose ranked discovery and the direct/batched evidence tool alongside the core agent tools. Rich results are bounded excerpts; originals remain recoverable. Eight additional functions use the same validated execution/receipt/continuation path:

- `inspect_window({handle?})`: current or known visible window metadata.
- `get_browser_page({offset?,limit?})`: current authorized text and structure, paginated by section (maximum eight sections).
- `capture_window({handle?})`: existing exposed target-window JPEG capture, provenance and retained original.
- `retrieve_evidence({observationId,offset?,limit?})`: original extension payload sections, dialogue excerpts or image attachments, with direct and batched access.
- `find_memories({search?,kind?,status?,offset?,limit?})`: bounded literal canonical-state retrieval, checking disclosure permission on cited observations.
- `write_memory({id,kind,text,provenance,evidence,status,dueAt,expectedRevision})`: create, correct, retire, complete or abandon semantic/episodic memories, user facts, interests, investigations or intentions. Revision checks prevent stale writes. Host/user provenance requires corresponding original records. Wording remains model-authored, never host certification. Limits: 1,000 records, 4,000 characters and 16 evidence IDs each.
- `set_attention({afterMs,durationMs,inferenceIntervalMs,observationIntervalMs,source})`: next inference and temporary source pacing. Monitoring expires within 15 minutes; minimum host sampling is 500 milliseconds. The extension retains its own stricter extraction budget. Review deadlines persist in the archive. Pass `{action:"pause"}` or `{action:"cancel"}` to control optional ambient attention.
- `move({target,handle?})`: native teleport/perch/near-cursor/left/right/corner positioning; idle returns to a neutral corner. Existing geometry, exclusions, permissions and cancellation remain authoritative. Actual native bounds and receipts control success. No animation engine rewrite or arbitrary computer control was added.

### Perception, persistence and context

ChromeBridge retains token/Origin/Host/site/incognito/revision validation. Its raw sink bypasses legacy semantic admission, and LifeService starts only the bridge in this mode. Accepted bounded/redacted extension payloads are recoverable originals, not full DOM snapshots. Unchanged content is deduplicated; context supplies changed-section excerpts and supports further section retrieval. Window metadata and screenshots share window/PID source identity. Application-text/accessibility contracts exist, but new UIA/OCR collectors are not implemented.

Schema 3 adds canonical state and evidence metadata transactionally to the existing SQLite worker. Binary originals live in `runtime2/evidence/<sha256>`, using flushed temporary files, rename, integrity checks, crash-orphan recovery and explicit missing results. Defaults: 128 MiB total, seven days, 2 MiB per blob; source deadlines may shorten retention. Startup/access/shutdown and one-minute maintenance clean expired evidence. Rich observation text also obeys source retention deadlines. Large original payloads are not duplicated into tool-history records: actual results reach the current continuation, while durable tool results retain recovery references.

Rolling context now includes bounded active state (18 KB), up to ten due-review summaries, current host body state and attention. Up to two requested images reserve additional context headroom and are supplied only to the next continuation, not repeatedly replayed from history. Original chronological groups still evict together, with recovery references and no semantic summarization pipeline. User message IDs/timestamps are encoded so memories can cite actual statements.

Outstanding absolute deadlines are loaded independently of the recent-memory window. Reviews are acknowledged only after a successful inference cycle that actually received them. They are exploratory review opportunities, not delivered user reminders. Event-driven scheduling uses a 10-second ambient floor and up to 120 cycles per hour outside daily-test mode, each with at most six model requests. Ordinary pending observations default to 30-second pacing; structural changes and due intentions can wake earlier. Direct input bypasses ambient pacing and interrupts ambient inference. Observation continues independently. Screen lock/suspension cancel inference and movement, with scheduler eligibility restored on unblocking.

### Privacy and verification limits

Cloud disclosure is checked separately from local collection, including direct versus proactive Chrome permissions. This durable alpha conservatively requires Chrome retention before disclosing page evidence and screen retention before supplying pixels; nonretained live-only pages stay local. Disabling history rejects new durable chat instead of silently retaining it. Disabling memory denies canonical operations. Revocation quiesces inference and conservatively purges derived journal records, canonical state and binary evidence; explicit user messages survive unless history itself is disabled. This broad purge is an early-alpha limitation, not fine-grained dependency deletion.

Catalog `input_modalities` controls images. Unknown/non-image models get explicit pixels-not-supplied results, with permitted browser semantic text as the available content alternative. SIWC encoding and the vendored validator now accept bounded `input_image` data URLs. The format follows the official [image-input guide](https://developers.openai.com/api/docs/guides/images-vision), retaining the [SIWC inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference). Authentication and credential storage are unchanged.

Controlled tests cover browser evidence, sequential inspection, canonical state, attention, restart, due review and original recovery. Electron testing adds fixture-rendered pixels and actual native character-window movement; automated model inference is mocked. Separately, one authorized live SIWC request on November 4 used catalog-confirmed image-capable `gpt-6.1-sol` and correctly read `9374` and `TEAL TRIANGLE` from a generated image (415 input / 18 output tokens). No personal desktop was sampled. This proves SDK image input, not sustained autonomous behavior or a fully live multi-tool sequence.

Remaining: ordinary-use behavioral evaluation; a bounded live model-directed multi-tool trial; native OS screenshot validation using a controlled external fixture; more selective working-state retrieval at larger scale; transient nonretained conversation support. User-facing reliable reminders, new UIA/OCR, expressive animation tools and broader legacy integrations are not implemented. The conversation journal still has no total lifetime byte cap, although evidence storage, active state and context are bounded. No packaged Runtime 2 or production-profile support was enabled.

The first authorized live account interaction is verified with gpt-6.1-sol: real foreground metadata, all four read-only tools with completed receipts, streamed dialogue, and conversation/tool continuity after restart. A live test exposed a retained text-only input validator; it now accepts native function-call/output history, with a regression test exercising the actual SDK request path. The connection badge now follows SIWC session state independently of the legacy provider. Sustained-use evaluation remains future work; this narrow live check does not establish long-running reliability.

## November 4 daily-test integration

`npm run start:daily` explicitly selects Runtime 2 and the persistent isolated `daily-test` profile. It opens the existing Chat panel, starts paused, and never copies credentials. The panel provides account-catalog model selection, desktop-permission setup, diagnostic start/stop, pause/resume, source readiness, capture check, usage, report/folder opening, a private portable folder and a separate content-free redacted export. The tray also exposes pause and stop. Legacy launch and production profiles are unchanged.

These current limits supersede earlier alpha defaults in this document for daily-test mode: three-minute routine ambient pacing with a ten-second host floor, optional slower pacing after ten minutes without source activity, 30 attempted inference HTTP requests per rolling hour, 100 per diagnostic session, and a two-million reported-token admission threshold. Every continuation/attempt passes the host guard at the actual Responses boundary; SDK retries remain disabled. The hourly attempt ledger survives restart. A response may cross the token threshold before usage becomes known; subsequent requests are denied. Catalog/authentication traffic is not counted as inference. A new diagnostic session is required after restart; memories, archive and dialogue persist.

`dailySession.ts` owns configuration/admission and `diagnostics.ts` owns incremental local recording. Sessions contain flushed JSONL, complete assembled and effective provider request JSON plus offline HTML inspectors, outputs, exposed stream events, tool receipts/results, state changes, scheduler/observation events and separate image files. Image references preserve hashes; capture provenance includes dimensions. Recording never captures headers/credential stores or audio, and never grants collection/disclosure permission. Privacy revocation immediately disables recording and pauses autonomy. Previously authorized diagnostic files remain local for review; they are not automatically uploaded or erased. Stop produces an offline report. Recording has a configurable four-GiB aggregate diagnostic-folder budget with report headroom and bounded write backlog. The durable conversation journal now fails closed at 200,000 records or 256 MiB of payload instead of growing indefinitely; clearing chat releases it without replacing canonical memory or original evidence storage.

The existing five executable tool rounds and sixth tools-free finishing response remain. Repeat capture failures for the same target are suppressed within a cycle. Chrome now identifies tabs separately, restores current semantics when returning to unchanged content, and reports actual recent extension delivery separately from pairing. The existing Windows Spotify metadata watcher is connected without audio; no call-presence integration was added. Native capture, movement, memory continuity, recording reconstruction and the MV3-to-Runtime-2 pathway are verified with controlled fixtures. These tests do not establish autonomous cloud behavior on personal homework pages. The actual daily profile still needs its own supported sign-in and Chrome/site authorization.
