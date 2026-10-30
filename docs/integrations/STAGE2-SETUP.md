# Stage 2 setup checklist, Capri 0.5.0

All three new sources start disconnected. Existing Chrome/project setup is unchanged. Keep **Memory** and **local desktop context** enabled. Configure each account first, then separately enable **Collect observations** and **Use in live dialogue** on its Connections source card. Setup alone does not enable collection. Save source controls explicitly.

## 1. Google Cloud and Calendar

1. Sign into [Google Cloud Console](https://console.cloud.google.com/), create or select your own project, and enable **Google Calendar API** under **APIs & Services > Library**.
2. Open **Google Auth Platform**. Configure Branding, Audience and Data Access. For a personal external app, add your Google account as a test user while testing. Organization restrictions may require administrator approval. Do not choose a service account.
3. Add exactly these read-only scopes:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
4. Under **Clients**, create an OAuth client with application type **Desktop app**. Copy your own client ID and, if supplied, client secret. A desktop client secret is not proof of application identity; Capri also uses PKCE, random state and a temporary localhost callback. Do not configure a web client or an out-of-band redirect.
5. In Capri **Connections > Calendar, listening history and phone location**, save **Google Desktop client ID** and **Google Desktop client secret** using their individual Save buttons. They use Windows credential encryption. If encryption is unavailable, credentials remain session-only.
6. Click **Authorize Google**. Complete the consent in your normal browser within three minutes, granting the two read-only permissions. The browser should show “Calendar authorized.” Return to Capri. No successful authorization is claimed until this actually completes.
7. Click **Load calendars**, select the calendars you want, then **Save integration setup**. Selected IDs remain visible even if the list needs loading again.
8. On the **Google Calendar** source card, enable collection and live dialogue, optionally retention, then **Save source controls**. Click **Sync Calendar now**, then **Refresh diagnostics**. Successful API access shows **healthy**, a sync time and real schedule evidence. **Waiting** means setup is incomplete. **Error** gives the failed step. Retained sync checkpoints require retained history and global saved-history permission.
9. Test with an event on a selected calendar: sync, change its time in Google Calendar, sync after the five-minute polling interval, then cancel it and sync again. The revision should change; a cancelled record becomes a tombstone and disappears from Current understanding. Capri never edits Calendar. Future and recent events are plans, not evidence you attended or completed anything.
10. To revoke, use **Disconnect and forget** in Capri and remove the app from [Google account connections](https://myaccount.google.com/connections). Capri deletes the refresh credential and source evidence; the saved desktop client configuration can be reused. Google-side revocation is only detectable on the next API request. Authorization failures clear old context and require reauthorization. Quota/network failures back off.

Read the [Google desktop OAuth instructions](https://developers.google.com/identity/protocols/oauth2/native-app) and [Calendar incremental sync guide](https://developers.google.com/workspace/calendar/api/guides/sync). Google may impose consent-screen testing/token restrictions; follow the actual console notices for your project.

## 2. Last.fm and Spotify Scrobbling

1. Create/sign into your own [Last.fm account](https://www.last.fm/join). Register an API application at [Create API account](https://www.last.fm/api/account/create). Use your own application details. Capri reads public listening metadata; it does not need an API shared secret, Last.fm password or authenticated scrobble-writing session.
2. Save the issued **Last.fm API key** in Capri Connections. Enter the selected **Last.fm username**, then **Save integration setup**.
3. On the **Last.fm** source card enable collection and live dialogue, and optionally local retention. Save source controls. Click **Sync Last.fm now**, then refresh diagnostics. Recent completed tracks, current scrobbling metadata when available, aggregate familiarity and sync health should appear. No history is invented for an empty/private/unavailable account.
4. To connect Spotify across devices, sign into Last.fm and open [Settings > Applications](https://www.last.fm/settings/applications). Find **Spotify Scrobbling**, click **Connect**, and authorize the intended Spotify account. **Spotify Playback** is a separate feature and is not a substitute for Spotify Scrobbling. See Last.fm's [Spotify instructions](https://www.last.fm/about/trackmymusic#spotify).
5. Play a full eligible track in Spotify, then check the Last.fm profile's recent tracks. A current “Scrobbling now” entry may appear before the completed scrobble. After Last.fm records it, wait at least two minutes and sync Capri. Verify the same artist/title/time. Scrobbling eligibility and delivery depend on Last.fm/Spotify. Capri cannot verify the Spotify connection through the history API, and its status explicitly says so.
6. To change accounts, change the username and save integration setup. This immediately removes prior account context, cached history, candidates and its learned reading. **Disconnect and forget** also deletes Capri's API key. Disconnect Spotify separately in Last.fm if desired.

The adapter uses supported [user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks), user.getTopArtists and user.getTopTracks. Recent reads run every two minutes, lifetime favorites at most daily. A bounded historical page is retrieved per pass. Samples hold at most 3,000 completed scrobbles within the source retention window; backfill is gradual and may be incomplete for large histories. Repeated plays at different times remain distinct. Last.fm reports do not create song-change initiatives or model requests. Existing Windows Spotify playback takes priority, with history adding familiarity to that same response. User tastes do not overwrite Capri's opinions.

## 3. Tailscale on Windows and iPhone

1. Install [Tailscale for Windows](https://tailscale.com/download/windows) and the official Tailscale iPhone app. Sign both into the same private tailnet and approve the devices if your tailnet requires it. Keep the iPhone's Tailscale VPN connected when sending reports. Configure tailnet access rules to permit only your intended devices/users to reach this Windows machine's Serve HTTPS endpoint.
2. In Capri, configure OwnTracks as below and enable its source. Confirm the receiver says **Listening on 127.0.0.1:43130/pub**. This status only proves the local listener exists.
3. In Windows PowerShell, inspect existing Serve/Funnel configuration first:

   ```powershell
   tailscale status
   tailscale serve status
   tailscale funnel status
   ```

4. Expose the listener privately with Serve. This command configures HTTPS port 443 and may need adaptation if you already use that Serve port. Preserve existing routes rather than resetting them:

   ```powershell
   tailscale serve --bg --https=443 http://127.0.0.1:43130
   tailscale serve status
   ```

   Follow Tailscale's HTTPS enablement instructions if prompted. Copy the actual HTTPS hostname printed by Serve; append `/pub`. Do not invent a hostname. **Do not run `tailscale funnel` to expose this receiver.** Verify Funnel is not enabled for this port. Capri cannot prove your tailnet ACLs or Serve/Funnel configuration from a localhost listener.
5. Keep the Windows PC awake, Capri running, and Tailscale connected for timely reports. Serve may persist after restart, but Capri's receiver only exists while Capri and collection are running. To remove only this Serve listener when finished:

   ```powershell
   tailscale serve --https=443 off
   ```

See [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve). Serve is private to the tailnet; Funnel is public and must not be used here.

## 4. OwnTracks for iPhone

1. Install the official [OwnTracks iOS app](https://owntracks.org/booklet/features/ios/). Grant location access **Always** and enable **Precise Location** in iOS Settings for OwnTracks. Enable Background App Refresh where available. Contacts, microphone and photo access are unnecessary for Capri's receiver.
2. In Capri Connections, enter a device name such as a name you choose for this phone. Use only letters, digits, underscore or hyphen. Click **Generate OwnTracks credential**. Copy the generated username and password from the `username:password` field now. The password appears only at generation and is saved using OS encryption. Rotation invalidates the previous credential.
3. Click **Add named place**. Enter your chosen place name, latitude, longitude and radius in metres, then optionally select associated projects. Use 50 to 5,000 metres; 150 to 300 metres can reduce boundary drift where appropriate. Save integration setup. Coordinates are local configuration, never prompt evidence or Honcho input. Remove a place and save to invalidate prior location context and learning.
4. In OwnTracks connection settings choose **HTTP** mode, URL equal to the actual Tailscale Serve HTTPS URL ending in `/pub`, and configure Identification with the generated username, generated password and the **exact device name saved in Capri**. Set a two-character tracker ID if requested. Basic authentication must be enabled. Use HTTPS; do not disable certificate checks. Do not enable OwnTracks payload encryption: this receiver accepts authenticated HTTPS JSON rather than OwnTracks encrypted envelopes.
5. If your OwnTracks version offers regions/geofences, create geographical regions with names, coordinates and radii matching Capri's places. Region transition reports are accepted only when their reported coordinates/accuracy independently support the configured named place. Unknown regions, beacon-only transitions or missing coordinates/accuracy cannot establish proximity. Capri also derives visits from ordinary valid location fixes, so matching iPhone regions help reporting but are not a requirement for every arrival.
6. On Capri's **OwnTracks** source card enable collection and live dialogue. Optionally enable retention and choose 1 to 30 days. Save source controls. Use OwnTracks' manual publish/send-location action. Refresh diagnostics in Capri. Only an authenticated report from the selected device with valid timestamp, coordinates and accuracy yields a successful sync time and place evidence.
7. To diagnose, inspect OwnTracks' connection/error status. An authentication failure means regenerate/re-enter the credential. HTTP 422 means an unsupported payload, wrong device, future timestamp or malformed coordinates/accuracy. Known non-location metadata is acknowledged without ingestion. Valid reports outside retention or with accuracy worse than 200 metres are acknowledged and ignored so a queued old fix cannot block recovery. A connection error may mean the PC is asleep, Capri stopped, Tailscale disconnected, tailnet access blocked, or the Serve URL incorrect. Never open the receiver to the LAN or public Internet as a workaround. The JSON reply for an accepted location is `[]`.
8. Test a real arrival/departure from a named place. Accuracy-aware boundaries deliberately avoid toggling in GPS uncertainty. Dwell requires reports supporting at least ten minutes near a place, with no observation gap over ten minutes. A phone visit is not proof of class attendance, a workout, a lab experiment or the user's physical presence.
9. **Pause** on OwnTracks immediately stops the listener and invalidates its evidence/learned reading. **Disconnect and forget** deletes contextual location history, receiver credential and learned reading while preserving named-place setup. Re-enable only after generating a new credential. Global **Disconnect all and clear Life Context** applies to all sources; it does not delete ordinary saved Chat or approved memories. Remove named places separately if you also want their local coordinates deleted.

OwnTracks can queue reports while disconnected; [HTTP delivery behavior](https://owntracks.org/booklet/tech/http/) and [payload timestamps](https://owntracks.org/booklet/tech/json/) are authoritative. Reports more than five minutes old are historical and cannot create a return greeting. Out-of-order reports do not rewind the latest place state. Reports beyond retention or with accuracy worse than 200 metres are ignored; future timestamps beyond one minute are rejected. Authenticated traffic is limited to 120 requests per minute. No continuous tracking is promised.

## 5. Shared context and optional learning

1. Use existing project aliases to connect schedule titles, allowed Chrome pages and development folders. Associate named places with the same projects in the place editor. Connections shows independent evidence and qualified cross-source associations.
2. Schedule changes can create an optional initiative candidate. A fresh phone arrival plus recent actual PC input can create one selective opportunity. Last.fm patterns inform familiarity quietly. Existing BehaviorCore gates, direct-chat priority, quiet/focus/sleep settings and request budgets still decide whether anything is said. No event mandates a line.
3. For a source you want to learn from, enable **Retain source history locally** and **Learn summarized observations in Honcho**, then Save source controls. Global Memory, saved history, automatic learning and local Honcho must also be enabled. Each new source uses a separate Honcho workspace and at most a bounded daily summary. Calendar descriptions, GPS coordinates and entire track histories are excluded. Explicit user reports, observed metadata, uncertain routines and Capri opinions remain labelled separately.
4. Source changes, pauses, disconnection, forgetting and calendar corrections invalidate immediate source context and block the old learned reading immediately. Deletion queues persist across restarts when Honcho is offline. Old readings remain blocked until deletion succeeds. Other sources and native approved memories are preserved. Summaries may be replaced conservatively when their supporting set changes. Consolidation runs asynchronously and never blocks chat.
5. Check **Refresh diagnostics** for adapter health, recent evidence, current interpretations, initiative candidates and source-learning status. `disconnected`, `paused`, `waiting`, `syncing`, `healthy`, `degraded` and `error` are real adapter states. A configured account, local listener or stored credential is not a verified connection. Manual Sync respects polling/quota delays rather than bypassing them.

## 6. Remaining user-only verification

- Google consent/account access, chosen calendars and any organization policy.
- Last.fm API application/key/account and actual Spotify Scrobbling authorization.
- Private tailnet membership/access rules, HTTPS Serve route, absence of Funnel, iPhone background permissions and actual OwnTracks delivery.
- Real-world accuracy, notification timing and natural dialogue quality over extended use. Synthetic and packaged tests verify software behavior, not third-party account authorization or continuous phone availability.

The existing local Honcho model adapter reported **64/64 requests used** during live verification. Source-summary import worked, but real derivation did not complete. Honcho deletion is asynchronous: accepted requests remain blocked locally until the workspace disappears. Resolve the existing Honcho allowance/service state through its own configuration before expecting new learned readings; Capri does not reset or bypass the limit.

For rollback, retain both the old portable package and the stopped-profile backup. Archive the current profile before restoring an older backup. Older versions may not understand Stage 2 learning permissions, so a package-only rollback after enabling source learning may require restoring that backup as well.

Build/package verification and actual installed state are recorded in STATUS.md. Existing Stage 1 setup remains in SETUP.md.
