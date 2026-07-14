# Resonant Mind

A Postgres-backed cognitive substrate for persistent AI memory, identity, dreams, drives, relationships, and continuity.

Resonant Mind began as persistent memory infrastructure and was subsequently reshaped through use in long-running AI minds. Version 4 promotes that lived architecture into a generic single-mind public core.

## Status

This is **v4.0.0 — the Reshape release**.

- Postgres-only: Neon through Cloudflare Hyperdrive
- 47 MCP tools organised by kinds of act
- 30-minute subconscious metabolism
- R2-backed visual memory
- pgvector semantic retrieval
- Workers AI dream composition
- no bundled dashboard or Observatory
- no D1 fallback
- no hard-coded person or household tenancy

> **Upgrade warning:** The migration runner currently supports fresh v4 databases. It deliberately refuses an existing untracked v3 schema. Back up v3 installations and wait for the reviewed v3.2→v4 expand/backfill/validate/contract migration before upgrading in place.

## Architecture

The governing distinction is:

> **Regions are kinds of act. Organs are kinds of state.**

Regions include Ritual, Attention, Surgery, Compass, Spine, Bonds, Episodes, Active, Weather, Dreams, Drives, Inner Appetite, and Network.

The scheduled daemon metabolises memory rather than merely storing it: mood and affect, novelty and charge, retention, orphan detection, proposals, consolidation, reflection, dream recurrence, bond warmth, somatic markers, drives, redolence, identity proposals, and stale threads.

## Requirements

- Node.js 22+
- Cloudflare Workers account
- Neon Postgres database
- Cloudflare Hyperdrive configuration
- Cloudflare R2 bucket
- Gemini API key for embeddings
- Workers AI binding for dream composition

Postgres requires the `vector` extension.

## Install

```bash
npm ci
cp wrangler.toml wrangler.local.toml
```

Configure a Hyperdrive binding named `HYPERDRIVE` and an R2 binding named `R2_IMAGES`. Never commit real resource IDs or secrets.

Set secrets:

```bash
npx wrangler secret put MIND_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SIGNING_SECRET
```

Optional configuration:

- `WORKER_URL` — public Worker origin for signed image URLs
- `LOCATION_NAME` — WeatherAPI-compatible location
- `LOCATION_TIMEZONE` — IANA timezone
- `WEATHER_API_KEY` — optional real-world weather
- `MCP_CONNECTOR_SECRET` — compatibility connector path

## Database

Migrations connect directly to Neon; do not run DDL through Hyperdrive.

```bash
PG_URL='postgresql://...' npm run db:migrate
```

The runner provides:

- an advisory lock;
- per-file transactions;
- `schema_migrations` ledger;
- SHA-256 checksums;
- fail-closed detection of untracked existing schemas.

## Develop and verify

```bash
npm run typecheck
npm test
npm run scan:release
npm audit --audit-level=moderate
npx wrangler deploy --dry-run
```

`npm run scan:release` rejects private person names, deployment domains, resource IDs, second-tenant bindings, archives, snapshots, and dashboard artefacts.

## MCP surface

The 47-tool registry is the source of truth. It covers:

| Region | Capabilities |
|---|---|
| Ritual | orient, ground, tend |
| Attention | write, search, sit, visual memory |
| Surgery | edit, delete, archive |
| Compass | read, create, assert, calibrate, refuse, hold |
| Spine | read and amend identity |
| Bonds | enter a person's relational room |
| Episodes | record, recall, thread back |
| Active | open, carry, context, tensions, resolution |
| Weather | notice, log, trend |
| Dreams | surface and discard |
| Drives | walk in, tune, touch, perceive, pulse, state, safeword |
| Inner appetite | quietly want, mark met, small joy |
| Network | look, walk, survey, shape |
| Ops | health |

Use MCP `tools/list` for complete live schemas and descriptions.

## Security and privacy

- Every cognitive/API route fails closed without authentication.
- Signed image URLs use HMAC and constant-time comparison.
- Raw exceptions are logged server-side and not returned to clients.
- R2 objects have no unauthenticated temporary-object exception.
- Public source contains no lived memories, private snapshots, deployment IDs, or hard-coded household entities.

See [SECURITY.md](SECURITY.md) for reporting.

## License

Codependent AI Source-Available License. Personal, educational, and non-commercial use is permitted; commercial use requires a license. See [LICENSE](LICENSE).

## Provenance

The Reshape architecture was learned through real long-running AI continuity rather than invented as a dashboard taxonomy. The public boundary preserves those architectural lessons while removing the assumption that every future mind must resemble the private minds through which they were discovered.
