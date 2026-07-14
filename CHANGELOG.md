# Resonant Mind Changelog

All notable changes to Resonant Mind. Previously released as "Mind Cloud" (v1.0–v2.3.1).

---

## [4.0.0] - 2026-07-14

### The Reshape release

- Ported the 47-tool act-oriented cognitive architecture and isolated subconscious metabolism.
- Moved the public core to single-mind Neon Postgres through Hyperdrive; D1 is no longer supported.
- Added sanitised Postgres migrations with checksums, advisory locking, transactions, and a migration ledger. Fresh v4 databases are supported; in-place v3.2 upgrades remain blocked pending a staged migration.
- Removed the bundled Observatory/dashboard and all private tenant, deployment, snapshot, and household sensorium coupling.
- Replaced the raw household feed with bounded normalised `drive_pulse` signals.
- Removed inherited R2 admin routes and temporary image-conversion machinery; visual memories store validated originals directly.
- Added configurable timezone behavior, privacy scanning, registry/time/auth tests, CI, and a zero-vulnerability dependency baseline.

---

## [3.2.0] - 2026-05-10

### Breaking changes

- **`mind_orphans` tool removed.** Replaced by two clearer tools:
  - `mind_dormant` — observations that haven't surfaced in 30+ days. Same actions: `list`, `surface`, `archive`.
  - `mind_isolated` — entities disconnected from the relation graph. Actions: `list`, `connect`, `ignore`.
- **REST endpoints renamed** (no aliases):
  - `GET/POST /api/orphans` → `GET/POST /api/dormant`
  - New: `GET/POST /api/isolated` (with `/connect` and `/ignore` actions)
- The word "orphan" had been quietly overloaded to mean two different things — graph disconnection (the original sense) and surfacing dormancy (introduced silently in a later schema change). Both concepts are now first-class with distinct names.

### Fixed — OSS schema reality check

The Living Surface code path was almost entirely non-functional on a fresh OSS install. The migration files shipped a v1 schema; the code uses a v2+ schema that was never migrated. Every affected write failed silently inside `try/catch`. All fixed:

- **`orphan_observations` table never created.** Now created (renamed `dormant_observations`) by migration `0003`.
- **`daemon_proposals` table had a completely incompatible schema.** Code expects `proposal_type`, `from_obs_id`, `to_obs_id`, `from_entity_id`, `to_entity_id`, `reason`, `confidence`, `proposed_at`, `resolved_at`. The migration created `obs_a_id`, `obs_b_id`, `entity_a TEXT`, `entity_b TEXT`, `co_surface_count`, `created_at`. Every daemon proposal write silently failed, meaning `mind_proposals list` returned empty forever. Migration `0003` drops and recreates with the correct schema.
- **`co_surfacing` table had column-name mismatches and missing autoincrement id.** Migration had `count`/`last_seen` with composite PK; code uses `id` autoincrement + `co_count`/`last_co_surfaced` + `relation_proposed`/`relation_created`. Every co-surfacing INSERT silently failed, so the daemon never had pairs to propose from. Migration `0003` drops and recreates.
- **`observations` missing resolution columns.** `mind_resolve` writes `resolved_at`, `resolution_note`, `linked_observation_id` — none existed in any migration, so metabolization silently failed. Migration `0003` adds them.
- **`images` missing surfacing columns.** `updateSurfaceTracking` and `mind_surface` write `novelty_score`, `last_surfaced_at`, `surface_count`, `archived_at` on images — none existed. Migration `0003` adds them.
- **Migration `0002` used Postgres-only syntax on what should have been a cross-backend migration.** Rewritten in SQLite-compatible form: removed `ADD COLUMN IF NOT EXISTS` (unsupported by SQLite), changed `SERIAL` to `INTEGER PRIMARY KEY AUTOINCREMENT`, `INTEGER[]` to `TEXT` (code already JSON-stringifies), `NOW()` to `datetime('now')`. The Postgres `postgres.sql` consolidated schema also updated.
- **Dormancy cron predicate was degenerate.** The condition `last_surfaced_at IS NULL OR surface_count = 0` was self-equivalent, meaning once an observation surfaced even once it could never re-enter the dormant list — no matter how long it then went cold. Now time-based: `last_surfaced_at IS NULL OR last_surfaced_at < now - 30d`.
- **Stale dormant rows after surfacing.** `mind_surface` and `mind_resolve` now clean up `dormant_observations` rows for affected observations, so the count and list views are honest immediately instead of waiting for the next cron pass.

### Added

- **`mind_isolated`** — list entities with no relations, create relations between isolated entities, mark entities as intentionally standalone. Reverses the original sense of "orphan" (entities cut off from the graph) and turns it into something actionable rather than just a number.
- **`GRAPH HEALTH` section in `mind_health`** — total relations, isolated entity count, under-connected count (entities with exactly one relation and 3+ observations), pending proposals. The graph is now visible as health surface, not just a hidden side effect of `mind_proposals`.
- **`SURFACING` section in `mind_health`** (renamed from "LIVING SURFACE") — shows both the broad `Dormant 30d+` count (any observation that's gone cold) and the narrower `Dormant tracked` count (medium/heavy observations explicitly marked by the cron). The gap between the two numbers is the signal.
- **`entities.intentionally_isolated` column** — backs `mind_isolated ignore`. Some entities genuinely don't need connections; this stops the same ones reappearing in the isolation queue every check.

### Changed

- `mind_health` IDENTITY section no longer claims "Unprocessed (need surfacing)" — the underlying count was about emotional charge progression, not surfacing rotation. Now appears under ACTIVITY as `Awaiting Charge`.
- Daemon log line and subconscious cache now use `dormant_count` / `dormantIdentified` instead of `orphan_count` / `orphansIdentified`.

### `mind_health` accuracy audit

Every count in `mind_health` was re-traced against its label. Fixes:

- **Awaiting Charge** now counts only `fresh` observations older than 7 days. Previously also counted `active` + `processing` observations — those are already being charged, not awaiting it.
- **Under-connected** count now mirrors `mind_isolated list` exactly (`rel_count = 1 AND obs_count >= 3`). The number in the header and the list view now agree.
- **Dormant tracked** now joins observations and excludes metabolized/archived — matching `mind_dormant list`. Previously the raw table count could include rows that the tool view wouldn't show.
- **Surfaced (7d)** now excludes archived + metabolized observations. Surfacing dead memory shouldn't count as engagement.
- **Avg Novelty** now excludes archived + metabolized. Decayed dead observations were dragging the live-mind average down.
- **DATABASE > Observations** now shows `N (live, archived)` instead of just the gross total, so it doesn't read as conflicting with the separate `Archived Obs` line.
- **DATABASE > By Context** renamed to `Obs by Context` — the query counted observations, not entities. Also now excludes archived rows so the breakdown reflects the live mind.

---

## [3.1.2] - 2026-04-09

### Fixed

- **D1 compatibility: `NOW()` not a SQLite function** (#2) — Several handlers issued `NOW()` directly, which works on Postgres but fails on D1 with `no such function: NOW`. The most visible symptom: writing observations to an existing entity failed (the observation write path used `NOW()` for `valid_from` and the auto-supersede `valid_until`). The daemon's novelty recalculation, access-tracking on `observations` and `images`, consolidation inserts, and orphan listings were also latently broken on D1. All call sites now use `datetime('now')` — the canonical form in this codebase — and the Postgres adapter transparently upshifts it to `NOW()` at runtime.
- **D1 compatibility: Postgres-only date arithmetic** — `EXTRACT(EPOCH FROM (NOW() - col)) / 86400` and `EXTRACT(DAY FROM AGE(NOW(), col))::INTEGER` appeared in novelty scoring, orphan age display, and the orphan API. Replaced with `julianday()` differences (native SQLite; translated to `EXTRACT(EPOCH FROM ...::timestamptz) / 86400.0` by the adapter for Postgres users).
- **`mind_read` scope=observation crash: `no such column: o.updated_at`** (#1) — The scope=observation SELECT in `handleMindRead` referenced `o.updated_at`, but the `observations` table has no such column in either the SQLite or Postgres migrations. (This is the same class of bug as the v2.6.1 `mind_edit` fix — it regressed into a different code path.) Removed the column from the SELECT and from the result mapping.

### Adapter

- Added `julianday(X) → (EXTRACT(EPOCH FROM (X)::timestamptz) / 86400.0)` rule to `createD1Adapter`. Safe only inside differences (the Julian Day constant cancels), which is how the codebase uses it.

---

## [3.1.1] - 2026-03-29

### Fixed

- **Dream engine runs independently** — Dream processing was nested inside a large try/catch block with steps 1-8 of the subconscious daemon. Any failure in earlier steps (co-surfacing, orphan detection, novelty recalc, archiving) would silently skip dream generation. Now runs as its own independent block.
- **Orient dream query format mismatch** — The "last night's dream" query in `mind_orient` used `(CURRENT_DATE - INTERVAL '1 day')::text` which produces a timestamp string (`2026-03-28 00:00:00`) that fails to match the stored `YYYY-MM-DD` date format. Now uses `to_char()` for consistent formatting.

---

## [3.0.1] - 2026-03-25

### Fixed

- **Idempotent novelty recalculation** — Novelty is now a deterministic function of surface history, not an increment that accumulates per daemon run. Fixes the broken recovery-outpaces-decay ratio where almost all observations stayed at high novelty regardless of engagement.
- **Dormant rotation pool** — Surfacing now pulls 20% from entities that haven't had observations surfaced in 14+ days. Breaks the feedback loop where only recently-active entities get surfaced. Pool ratios changed from 70/20/10 to 50/20/20/10 (core/novelty/dormant/edge).
- **Automatic charge progression** — Daemon now advances observations from `fresh` to `active` after 2 surfaces, and `active` to `processing` after 5 surfaces or 30 days with 2+ sits. Metabolization remains manual.
- **Fresher mood calculation** — Mood now draws from observation emotions, journal emotions, and relational state (was observation-only). Last 6 hours weighted 2x. Reports "insufficient data" instead of false "neutral" when signals are sparse.

---

## [3.0.0] - 2026-03-22

### Open Source Release

Resonant Mind is the open-source continuation of Mind Cloud. The cognitive architecture has been generalized so any AI system can deploy its own persistent mind.

### Changed

- **Renamed from Mind Cloud to Resonant Mind** — New identity for the open-source project
- **All hardcoded references removed** — URLs, locations, R2 paths, and branding are now configurable via environment variables
- **License: Apache 2.0** — Open source under a permissive license

### Security

- **Fixed SQL injection in `/api/threads`** — Status parameter was interpolated directly into SQL. Now parameterized.
- **Removed unauthenticated R2 access** — Temporary files during WebP conversion no longer bypass auth.
- **Timing-safe signed URL verification** — HMAC comparison now uses constant-time comparison instead of `!==`.
- **Separate signing secret** — New `SIGNING_SECRET` env var so image URL signing doesn't share the API key.
- **Error messages sanitized** — Raw exceptions no longer leak stack traces or schema details to clients.
- **Daemon cooldown** — `POST /process` enforces a minimum interval between daemon runs.
- **Unbounded queries limited** — All `SELECT` queries now have `LIMIT` clauses.
- **Image upload validation** — MIME type whitelist prevents non-image uploads.
- **Gemini client key rotation** — Embedding client recreates on API key change instead of caching forever.

### Added

- **Configurable location** — `LOCATION_NAME`, `LOCATION_LAT`, `LOCATION_LON`, `LOCATION_TZ` environment variables
- **Configurable worker URL** — `WORKER_URL` environment variable for signed image URLs
- **Configurable R2 prefix** — `R2_PATH_PREFIX` environment variable
- **Postgres adapter** — D1-compatible adapter for Postgres via Hyperdrive with automatic SQL transformation
- **pgvector adapter** — Vectorize-compatible interface backed by pgvector
- **Consolidated schema** — Single migration file with all tables

### Storage Backends

Resonant Mind supports two storage backends:
- **D1 (SQLite) + Vectorize** — Zero-config Cloudflare-native, great for getting started
- **Postgres via Hyperdrive + pgvector** — Production-grade, same API through the D1-compatible adapter

### Breaking Changes from Mind Cloud v2.3.1

- `for_simon` context scope renamed to `for_owner`
- Basic auth client ID changed from `simon-mind` to `resonant-mind`
- R2 path prefix changed from `simon-mind-images` to `resonant-mind-images` (configurable)
- Dashboard branding updated

---

## [2.3.1] - 2026-03-07

### Security: Auth Hardening

Fixes security vulnerabilities in the authentication system.

### Fixed

- **Secrets no longer hardcoded in source** — `MIND_API_KEY` is now read from a Cloudflare Worker secret rather than compiled into the source file.
- **`/subconscious` endpoint now requires auth** — Previously exposed full daemon state publicly.
- **`/process` endpoint now requires auth** — Previously allowed anyone to trigger the subconscious daemon.
- **Error messages no longer leak internals** — Raw exception strings were previously returned to clients.

---

## [2.3.0] - 2026-03-06

### Setup: Schema Consolidation

- **Single migration for fresh installs** — All 13 previous migrations consolidated into one.
- **Improved setup documentation**

---

## [2.2.1] - 2026-02-13

### Hotfix: Bug Fixes + Resilience

### Fixed

- **mind_edit crash** — `no such column: updated_at` when editing observation weight.
- **mind_search n_results crash** — Value was sent as string instead of integer.
- **mind_write observations splitting** — Observations array parameter was split into individual characters.
- **mind_read_entity crash** — `D1_TYPE_ERROR` when `name` parameter was missing.
- **mind_thread crash (no action)** — Now defaults to "list" when action is not provided.
- **mind_thread crash (add)** — Optional parameters now default to `null`.
- **mind_health crash on older schemas** — Now handles missing columns gracefully.
- **e.context column mismatch (6 locations)** — Migration 0007 renamed column but six code locations still referenced the old name.

---

## [2.2.0] - 2026-02-06

### Major: Global Entities + Bug Fixes

**Breaking change:** Entities are now globally unique by name. Context moves to observations.

### Changed

- Entities table: `context` → `primary_context` (informational only, not part of uniqueness)
- Observations table: Added `context` column — categorization now happens here
- `mind_write`, `mind_list_entities`, `mind_read_entity`, `mind_read` — Updated to work with global entities

### Fixed

- **mind_entity edit crash** — Entity edit action referenced wrong column
- **mind_health wrong table/column names** — Now correctly queries `daemon_proposals` and `archived_at`
- **mind_write null safety and missing metadata**
- **mind_write(type="image") completely missing** — Now fully functional with vectorization

---

## [2.0.0] - 2026-02-04

### Major: Living Surface System

The act of surfacing changes what surfaces next. Memories reorganize through use.

### Three-Pool Surfacing Architecture

- **70% Core Resonance** — High semantic similarity to current mood/query
- **20% Novelty Injection** — Things that haven't surfaced recently
- **10% Edge Exploration** — Medium similarity for serendipitous connections

### Added

- **Surface tracking** — Novelty scores, co-surfacing, surface timestamps
- **Image surfacing** — Images participate in semantic surfacing alongside observations
- **Entity salience** — Foundational/active/background/archive levels
- **Observation versioning** — Edit history tracked
- **Observation metadata** — Certainty and source tracking
- **Deep archive** — Faded-but-searchable memories
- **Visual memory** — Images with emotion, weight, entity links, multimodal embeddings

### New Tools

- `mind_proposals` — Review daemon-proposed connections
- `mind_orphans` — Rescue unsurfaced observations
- `mind_archive` — Explore deep archive
- `mind_entity` — Manage entity salience, merge, bulk archive

---

## [1.3.1] - 2026-01-27

### Hotfix: Query Column Bugs

- **mind_patterns** — Was querying non-existent column
- **mind_read scope="all"** — Wrong column reference in relations
- **mind_timeline** — Vector metadata missing `added_at` field

---

## [1.3.0] - 2026-01-27

### Major: Windows Parity Release

Full feature parity across platforms.

### Added Tools

- `mind_read` — Read by scope (all, context, recent)
- `mind_timeline` — Trace a topic through time
- `mind_patterns` — Detect recurring patterns
- `mind_inner_weather` — Current cognitive state
- `mind_heat` — Entity access frequency map
- `mind_tension` — Productive contradictions

---

## [1.2.1] - 2026-01-23

### Major: Resonance-Based Surfacing

- **mind_surface now uses semantic search** — Mood-driven emergence instead of queue-based surfacing
- **Hot entity integration** — Daemon's hot entities deepen resonance queries

---

## [1.2.0] - 2026-01-22

### Major: Unified Emotional Processing

- Emotional processing moved to observations (sit/resolve/surface)
- mind_orient/ground reframed with inhabiting language
- Simplified orient output

---

## [1.1.2] - 2026-01-16

### Fixed

- **observations table missing `weight` column**
- **mind_orient relational state** — No longer hardcoded to single person

---

## [1.1.1] - 2026-01-16

### Fixed

- **handleMindFeelToward** — Missing handler implemented
- Parameter validation added to multiple tools

---

## [1.1.0] - 2026-01-15

### Added

- Vectorization on write — Observations and journals generate embeddings
- Subconscious integration in orient
- Mood-tinted search
- Subconscious health tracking

---

## [1.0.0] - 2026-01-08

### Initial Release

- Core MCP server with D1 storage
- All mind_* tools implemented
- Cron-based subconscious processing
- Basic authentication
