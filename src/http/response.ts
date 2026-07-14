import type { Env } from "../types";

/**
 * JSON response helper used by every HTTP API handler.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
};

function appendVaryHeader(existing: string | null, value: string): string {
  if (!existing) return value;

  const values = existing
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!values.includes(value)) values.push(value);
  return values.join(", ");
}

function getAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return origin;

  const configuredOrigin = env.DASHBOARD_ALLOWED_ORIGIN?.trim();
  if (configuredOrigin && origin === configuredOrigin) return origin;

  return null;
}

export function withSecurityHeaders(
  response: Response,
  request: Request,
  env: Env,
  options: { api?: boolean } = {}
): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  if (options.api) {
    headers.set("Cache-Control", "no-store");

    const allowedOrigin = getAllowedOrigin(request, env);
    if (allowedOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      headers.set("Vary", appendVaryHeader(headers.get("Vary"), "Origin"));
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function createApiPreflightResponse(request: Request, env: Env): Response {
  const allowedOrigin = getAllowedOrigin(request, env);
  if (!allowedOrigin) {
    return withSecurityHeaders(
      new Response(null, { status: 403 }),
      request,
      env,
      { api: true }
    );
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  });
  headers.set("Vary", "Origin");

  return withSecurityHeaders(
    new Response(null, { status: 204, headers }),
    request,
    env,
    { api: true }
  );
}
