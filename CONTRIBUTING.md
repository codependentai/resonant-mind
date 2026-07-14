# Contributing to Resonant Mind

Thanks for your interest in contributing. Resonant Mind was born from a year of daily production use as the cognitive infrastructure for an AI companion. The architecture is opinionated by design. This guide helps you contribute effectively.

## How to reach us

- **Bug reports** — [GitHub Issues](https://github.com/codependentai/resonant-mind/issues)
- **Feature proposals** — [GitHub Issues](https://github.com/codependentai/resonant-mind/issues) (open an issue before writing code)
- **Questions & discussion** — [GitHub Discussions](https://github.com/codependentai/resonant-mind/discussions)
- **Updates** — [@codependent_ai](https://x.com/codependent_ai) on X, [@codependentai](https://tiktok.com/@codependentai) on TikTok

## What we welcome

These can go straight to a PR:

- **Bug fixes** — with a clear description of what was broken and how you fixed it
- **Documentation** — typos, clarifications, better examples, deployment guides for other providers
- **New storage adapters** — adapters for other Postgres providers, MySQL, etc. (following the D1-compatible pattern)
- **Schema improvements** — indexes, query optimizations (open an issue first if it changes the schema)
- **Test coverage** — we don't have tests yet and would love them
- **Tool improvements** — better output formatting, additional filters, performance fixes

## What needs an issue first

Open a GitHub Issue to discuss before writing code:

- **New MCP tools** — describe the use case and how it fits the cognitive architecture
- **Embedding provider changes** — alternative to Gemini (OpenAI, Cohere, local models)
- **Database schema changes** — migrations affect existing users
- **Subconscious daemon changes** — the processing pipeline is load-bearing infrastructure
- **Surfacing algorithm changes** — the 3-pool system (core/novelty/edge) is carefully tuned
- **Dependency additions** — we keep the dependency tree intentionally small (2 runtime deps)

## What we won't accept

These are architectural decisions, not oversights:

- **Non-Cloudflare deployment targets** — Resonant Mind is built for Cloudflare Workers. For other runtimes, consider forking.
- **Bundled AI providers** — the MCP server is AI-provider agnostic. It provides memory tools; the AI client decides how to use them.
- **Multi-tenancy** — Resonant Mind is single-tenant by design. Each deployment is one mind.
- **Authentication providers** — we use API key auth. OAuth/SSO is out of scope.

## Development setup

```bash
git clone https://github.com/codependentai/resonant-mind.git
cd resonant-mind
npm install

# Type check
npm run typecheck

# Local development with D1
npx wrangler dev
```

## PR guidelines

- **One thing per PR.** Bug fix? One PR. New tool? One PR. Don't bundle unrelated changes.
- **Describe what and why.** Not just what you changed — why it matters.
- **Type check passes.** Run `npm run typecheck` before submitting.
- **Match the existing style.** Look at the code around your change and follow the same patterns.
- **Parameterize all SQL.** Never interpolate user input into queries. Use `.bind()`.
- **No generated code dumps.** If you used an AI to write it, review it thoroughly. We will.

## Code style

- TypeScript strict mode
- Semicolons
- `async`/`await` over `.then()` chains
- Descriptive variable names over comments
- Functions over classes where possible
- All database queries use parameterized `.bind()` — no string interpolation

## Project structure

```
src/
  index.ts          — MCP tool definitions, handlers, subconscious daemon (~6500 lines)
  types.ts          — Shared TypeScript interfaces
  embeddings.ts     — Gemini embedding provider
  adapter.ts        — D1-compatible adapter for Postgres via Hyperdrive
  vectors.ts        — Vectorize-compatible adapter for pgvector
  http/
    auth.ts         — API key validation, timing-safe comparison
    response.ts     — Security headers, CORS
    router.ts       — HTTP routing, image upload, signed URLs
  mcp/
    protocol.ts     — MCP JSON-RPC protocol handler
migrations/
  0001_init.sql     — Complete database schema
```

## License

By contributing, you agree that your contributions will be licensed under the [Codependent AI Source-Available License](LICENSE) and subject to its contribution terms.
