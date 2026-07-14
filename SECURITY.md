# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v4 preview | Yes   |
| v3.x    | Maintenance only |
| v2.x    | No       |
| v1.x    | No        |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

DM us on [X (@codependent_ai)](https://x.com/codependent_ai) or message the [Telegram channel](https://t.me/+xSE1P_qFPgU4NDhk) with:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)

We'll acknowledge within 48 hours and aim to patch critical issues within 7 days.

## Security model

Resonant Mind runs as a Cloudflare Worker — your deployment, your data.

- **No shared infrastructure** — each deployment is isolated with its own database and secrets
- **No telemetry** — nothing phones home
- **API key authentication** — cognitive APIs, MCP, daemon triggers, and operational routes require auth; `/health` is intentionally public and image objects require bounded signed URLs
- **Timing-safe comparisons** — API keys and HMAC signatures use constant-time comparison
- **Signed image URLs** — time-limited, HMAC-signed URLs for image access (no API key exposure)
- **Parameterized queries** — all SQL uses parameterized bindings to prevent injection
- **Error sanitization** — internal errors are logged server-side, generic messages returned to clients

### What to watch for

- **API key strength** — use a long random string for `MIND_API_KEY`, not a dictionary word
- **Separate signing secret** — set `SIGNING_SECRET` in production so image URL signing doesn't share the API key
- **MCP connector secret** — compatibility mode places a secret in the URL path, which can leak through logs and browser history. Prefer bearer-authenticated `/mcp`; if compatibility requires the path mode, use a separate long random secret and rotate it when exposed.
- **CORS origin** — set `DASHBOARD_ALLOWED_ORIGIN` to restrict which domains can call the API
- **Gemini API key** — this is sent to Google's API for embeddings. Treat it as a secret.
- **Neon connection string** — if using Postgres, the connection string contains credentials. Never commit it — use `wrangler secret` or Hyperdrive.

### Rate limiting

Resonant Mind does not implement application-level rate limiting. For production deployments, we recommend using [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) at the edge.
