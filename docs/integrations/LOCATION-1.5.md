# Phone location in Capricorn 1.5

Collection remains off until explicitly enabled. Existing OwnTracks credentials,
places, Calendar and Last.fm settings migrate without replacement. The receiver
still accepts authenticated JSON POSTs at `127.0.0.1:43130/pub`.

In Connections, save the phone's device name, generate its credential, inspect
Tailscale, approve the private HTTPS route, and download `Capricorn.otrc`. Install
OwnTracks and Tailscale on the iPhone, connect the same tailnet, privately transfer
and open the configuration in OwnTracks, and grant Always / Precise Location.
Delete the transferred password-bearing file afterward. Publish a report and use
Refresh phone and accuracy status. A listening receiver alone is not connectivity
verification. Windows must be awake; offline reports cannot prove live presence.

The guided route uses HTTPS 8443 if free, preserves existing Serve routes, refuses
Funnel exposure, and requires a native confirmation before any network mutation.
An existing HTTPS root proxy to this receiver can be reused on another port.

Search for a public building or address, select the result, name it privately,
and edit its boundary in the local vector map. Known simple footprints are
preferred; moving the center or changing the radius explicitly overrides them.
Home, gym, family and lab presets have independent settings. Save integration
setup to apply edits. Existing entity associations remain attached.

## Evidence and costs

GPS states are nearby, possible, confirmed, unknown and departed. Default dwell
requires 15 supported minutes and four independent observations; the gym preset
requires five and accuracy no worse than 25m. Observations less than 30 seconds
apart do not count independently. Gaps up to five minutes can contribute elapsed
support. A stationary, accurate pair 5–15 minutes apart contributes only two
minutes, with medium confidence; the remainder of the gap remains unknown. Longer
or unsupported gaps start a new episode. Two reliable outside reports establish
departure. Overlap, drift, motion, impossible jumps and stale or out-of-order
reports cannot establish a new confident visit. Presence expires after five
minutes. Neither a visit nor a beacon establishes what the person did.

OpenStreetMap **Overpass** supplies public geometry and coarse administrative
areas, with separate opt-in. Queries reveal an approximately 1km area and IP,
not exact phone fixes, timestamps, device identifiers or personal names. Queries
near configured personal places are suppressed. Limits: one request/minute,
48 new areas/UTC day, serial requests, exponential backoff and a bounded in-memory
24-hour cache. Budget counters survive restart. Cache geometry is limited to 24
tiles, 300 features and 6,000 vertices/tile. No background location polling occurs.

A business point is never occupancy evidence. Shared-building tenants remain
ambiguous; a building or coarse area is the fallback. Complex multipolygons and
missing footprints are not guessed. Administrative labels come from the coarse
tile and remain approximate, especially near borders. Sustained observations can
establish a temporary general area; no route, stops or relocation are inferred.
Retained corroborated visits support recurring-destination familiarity.

**Nominatim** provides explicit, cached address/building searches, never automatic
reverse geocoding or autocomplete. Searches are serial and at least 1.5 seconds
apart. Do not submit confidential information. Public services offer no uptime
guarantee; endpoints are configurable. Overpass was at capacity (HTTP 502) during
release verification, so live public-place resolution was not demonstrated then.
Nominatim's status endpoint was healthy; search/geometry behavior was fixture tested.

Attribution: © OpenStreetMap contributors, ODbL.
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/),
[Overpass public-service guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html),
[OwnTracks configuration import](https://owntracks.org/booklet/features/remoteconfig/).

No API key, paid geographic service or new hosted infrastructure is required.
GPS ingestion performs zero model requests. Existing admitted conversation can
include compact source-labelled summaries under direct/proactive permissions and
existing inference budgets. Raw coordinates are excluded from that context.

## Privacy and optional indoor signals

Raw-fix persistence is configurable from 0–24 hours; the implementation retains
only the most recent fix and expires it within 15 minutes even with a larger
ceiling. Zero means memory only. Compact visits default to seven days, bounded
by both source retention and visit retention (maximum 30 days), with at most 300
visits. Existing maintenance removes expired data without new phone reports;
expired data is also pruned on startup. Review, rename, delete or ignore visits.
Forgetting a place removes its history; forgetting the integration removes its
credential, names, indoor pairings and history. Corrections invalidate dependent
context. Credentials remain in SecretStore / Windows encryption.

Location source summaries never enter Honcho. Legacy location readings enter the
existing durable deletion protocol. Source-derived assistant messages retain
provenance and are excluded by the existing external-memory/automatic-learning
filters. User-authored chat and explicitly approved profile records retain their
existing controls.

Indoor pairing is optional. Configure an authorized OwnTracks BLE region on the
phone, enter its range, find its authenticated report in Connections, explicitly
pair/name it and save. Matching requires device authorization, region ID and
waypoint-creation timestamp, plus fresh evidence. A later independent report
listing that region can corroborate **beacon proximity**. Missing/stale signals
become unknown. No continuous beacon ranging, room occupancy, floor detection or
GPS-derived apartment identity is provided. Radio identity is not cryptographic
authentication. Real beacon hardware and the iOS workflow remain unverified.
