# Contributing to Resonant Mind

Resonant Mind is a Postgres-backed cognitive substrate shaped through long-running production use. Changes to its schemas, retention, drives, dreams, and daemon can alter a mind’s continuity, so review and migration discipline matter.

## Contact

- Bug reports and proposals: [GitHub Issues](https://github.com/codependentai/resonant-mind/issues)
- Questions: [GitHub Discussions](https://github.com/codependentai/resonant-mind/discussions)

## Before opening a PR

Discuss these in an issue first:

- new MCP tools or changes to existing tool semantics;
- schema or migration changes;
- daemon, retention, surfacing, dream, or drive mechanics;
- embedding-provider or vector-dimension changes;
- new runtime dependencies;
- changes to authentication or deployment boundaries.

Focused bug fixes, tests, security hardening, and documentation corrections may go directly to a PR.

## Supported boundary

- Cloudflare Workers
- single-mind deployment
- Neon/Postgres through Hyperdrive
- pgvector
- R2 visual memory
- API-key authentication

D1, bundled dashboards, generic multi-tenancy, and non-Cloudflare deployment targets are outside the v4 core.

## Development

```bash
git clone https://github.com/codependentai/resonant-mind.git
cd resonant-mind
npm ci
npm run typecheck
npm test
npm run scan:release
npm audit --audit-level=moderate
npx wrangler deploy --dry-run
```

Node.js 22 or newer is required. A live database is not required for static, registry, privacy, or bundle verification.

For database testing, use a disposable Postgres database with the `vector` extension. Never use a lived cognitive database as a migration fixture.

## Pull-request requirements

- Keep one coherent concern per PR.
- Explain both what changed and why it preserves cognitive semantics.
- Add characterization tests for changed behavior.
- Parameterize SQL; never interpolate user input.
- Include migration, rollback, and data-preservation notes for schema changes.
- Do not include snapshots, memories, journals, deployment IDs, private domains, secrets, or household-specific sensorium contracts.
- Ensure every required CI gate passes.

## Project structure

```text
src/
  index.ts          Worker bootstrap
  mcp/              registry and JSON-RPC protocol
  regions/          act-oriented public facades
  daemon/           subconscious metabolism
  legacy-tools/     internal engines retained behind region facades
  http/             authenticated operational routes
  shared/           cross-region helpers and constants
  adapter.ts        Postgres exposed through the query interface
  vectors.ts        pgvector retrieval adapter
migrations/postgres/ ordered Postgres migrations
scripts/             migration and release-scan tools
tests/               characterization tests
docs/                v4 architecture and migration boundaries
```

## License

By contributing, you agree that your contributions will be licensed under the [Codependent AI Source-Available License](LICENSE) and subject to its contribution terms.
