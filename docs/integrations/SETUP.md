# Consolidated setup

Start with [FINAL_SETUP.md](FINAL_SETUP.md), the complete Windows/iPhone guide for all three stages. Existing account setup is optional; ordinary chat and movement work with every integration disconnected.

# Capri integration setup

For Google Calendar, Last.fm, Spotify Scrobbling, Tailscale and OwnTracks use the numbered [Stage 2 setup checklist](STAGE2-SETUP.md). All new sources are disabled until explicitly configured and enabled.

## Existing Stage 1 setup

As of 0.4.1, typed Connections setup text is autosaved as a local draft, including incomplete website entries. Restarting or changing tabs restores it. Press **Save source controls** to validate and apply the websites and permissions; saving a draft alone does not grant access. Normal settings edits also flush when leaving the panel. The Chrome extension files are unchanged from 0.4.0, so a loaded extension does not need reinstalling for these app-side fixes.

Capri 0.4.0 ships the extension in `resources/extensions/chrome` beside the installed executable, and these docs in `resources/integrations`. In a source checkout the extension is `extensions/chrome`. All sources start disconnected. No account credentials are required for this stage.

## Chrome

1. Start Capri 0.4.0. Open its panel and choose **Connections**. Keep **Memory** enabled and **local desktop context** enabled in existing settings.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the complete `resources/extensions/chrome` folder. Keep the unpacked folder in a stable location. Chrome may display its normal unpacked-extension notice after restart.
3. Copy the extension's 32-letter ID from its Chrome extension card (also displayed in the extension popup).
4. In Capri **Connections**, paste that ID and click **Generate new pairing token**. Copy the generated token. In the Chrome extension popup paste it under **Pairing token from Capri Connections** and click **Save pairing**. Treat the token as private. Rotation invalidates the previous token. Windows OS encryption stores Capri's token; Chrome stores its copy in extension-local storage. If OS encryption is unavailable, pair again after Capri restarts.
5. In the Chrome source card in Capri, enable **Collect observations** and **Use in live dialogue**. Add exact site origins, one per line, for example `https://github.com` and `https://developer.chrome.com`. No URL paths, wildcard hosts, query strings or trailing slashes. Click **Save source controls**. This starts the authenticated local listener. Pairing alone does not enable collection.
6. Visit an allowed website, open the extension popup and click **Allow this site**. Accept Chrome's permission for that exact site. Both Chrome's permission and Capri's allowlist are required. You can then click **Share headings now**, or wait for a navigation/focus/content update.
7. For selected text or an article excerpt, separately enable **Allow bounded content access** in Capri and save. Select ordinary visible text outside forms, then use **Share selected text once**, or explicitly choose **Share article excerpt once**. Normal passive updates still share metadata/headings only. No full body is sent automatically. Source evidence used in dialogue is sent to whichever dialogue model you configured, with bounded context.
8. In Connections, click **Refresh diagnostics** to see accepted evidence, current projections, source health and candidates. A fresh page is current for at most 90 seconds without another focused sample. Leaving Chrome/focus invalidates it sooner when the bridge is available.

The extension reconnects automatically on future events and its 30-second freshness alarm after Capri restarts; failure backoff caps at five minutes. **Share headings now** retries immediately. It survives MV3 service-worker suspension through Chrome storage. No native messaging registry registration, open firewall port or login is necessary.

If disconnected: verify Capri is running, the source collection switch is on, the bridge says listening, the extension ID matches, both allowlists contain the exact origin, and the paired token is current. A port-in-use message means another process owns `127.0.0.1:43129`; close the other Capri/test instance, then pause/resume Chrome in Connections. Never open this listener beyond loopback. Sensitive URLs, login/payment fields, private browsing, unsupported schemes and inactive windows are intentionally excluded. A blocked page may simply expire without a new record.

**Stop sharing this site** in the extension removes its Chrome host grant and local extension allowlist entry. Also remove the origin in Capri and save to erase that source's contextual evidence immediately even if the extension cannot deliver its removal. **Pause** stops collection and invalidates current source records. **Disconnect and forget** disables permissions, erases contextual source records/aliases/candidates and deletes Capri's pairing secret; to reconnect generate a new token. Remove/uninstall the Chrome extension separately if desired. Source-informed saved Chat stays visible but is excluded from automatic recall and learning.

## Local projects

1. In **Connections**, click **Add project folder**, then select a specific project/repository folder in the native folder picker. Drive roots and user/system profile roots are rejected. Do not select your entire Documents or home tree.
2. Collection and live context start with metadata only, without retained source history or file-content permission. Verify the selected path and healthy watcher status. No opening events are fabricated for every pre-existing file.
3. In **Project identities and associations**, edit **Explicit aliases**, one per line. Add distinctive names, repository URLs and relevant documentation paths/origins to associate browser pages with that project. Click **Save explicit aliases**. IDs remain canonical when a display name changes. Avoid broad aliases like “docs”.
4. File edits and Git branch/HEAD changes now create bounded source events. Watch **Current understanding** and **Recent accepted events**. A filename or commit is evidence of activity, never successful completion.
5. Optionally enable **Retain source history locally** and set **Retention days** (1 to 30). Saved-history privacy must also be enabled. Otherwise observations and candidate consumption are session-only. Optional file content requires **Allow bounded content access**; only supported changed text/source files are read in small excerpts. Dependencies, builds, obvious credentials, large/generated files and symbolic links are ignored.
6. Use **Pause**, **Disconnect and forget**, or **Remove folder** for that project. To monitor a moved folder, remove its old source and select the new path. There is no whole-filesystem or editor-wide permission.

## Corrections, retention and clearing

Use **Your correction** under a current record, then **Apply correction**. It is a user statement, wins over passive updates until that record expires, and does not become an approved long-term memory. Use **Dismiss opportunity** to prevent an optional callback. No conversation is required to acknowledge a candidate.

Each source separately controls collection, live dialogue, retained event history and content access. Saving source-control changes clears its old evidence; new samples are governed by the new policy. Chrome/project source learning remains unavailable. Calendar, Last.fm and OwnTracks have separate opt-in summarized learning; see STAGE2-SETUP.md. While connected live sources are enabled, auto-learning from model exchanges is suspended to avoid storing untraceable derivatives. Disable sources to resume normal native auto-learning. Existing memories are preserved.

**Disconnect all and clear Life Context** disables sources and clears this subsystem's evidence and associations. Existing saved Chat, approved memories, movement preferences and other credentials remain. For whole-application history/memory deletion use Capri's existing privacy controls separately.

## Build, update and rollback

Use the established `npm run typecheck`, `npm test`, `npm run build`, focused Electron tests, then `npm run dist`. The installer is `release-staged/Capri-Setup-0.4.0.exe` and the portable staged build is `release-staged/win-unpacked`. Extension files and these docs must exist under the packaged `resources` directory. Run focused tests against `CAPRI_EXE` pointing to the staged executable before replacing an installed build.

The existing application profile-location policy is preserved: `Documents/Capri Buddy`, with explicit `CAPRI_USER_DATA` overrides for isolated tests and the existing legacy-profile adoption logic. Do not copy a fresh test profile over real user data. Back up the stopped real profile and current installed portable directory before an update. To roll back, stop Capri and restore the previous application directory. Keep the profile backup available; Stage 1 adds `life-context.json` and one encrypted credential key but does not migrate unrelated stores. Check STATUS for the actual delivery and verification results.
