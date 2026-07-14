// HTTP handler for /api/context — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiContext(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const contextId = pathParts[2] || null;
  const url = new URL(request.url);
  const scopeFilter = url.searchParams.get("scope");

  // GET /api/context - list all or filter by scope
  if (method === "GET" && !contextId) {
    let query = "SELECT * FROM context_entries";
    const bindings: unknown[] = [];

    if (scopeFilter) {
      query += " WHERE scope = ?";
      bindings.push(scopeFilter);
    }
    query += " ORDER BY updated_at DESC";

    const results = bindings.length
      ? await env.DB.prepare(query).bind(...bindings).all()
      : await env.DB.prepare(query).all();
    return jsonResponse(results.results || []);
  }

  // GET /api/context/:id - get one
  if (method === "GET" && contextId) {
    const entry = await env.DB.prepare("SELECT * FROM context_entries WHERE id = ?").bind(contextId).first();
    return entry ? jsonResponse(entry) : jsonResponse({ error: "Not found" }, 404);
  }

  // POST /api/context - create
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const id = body.id || `ctx-${Date.now()}`;
    await env.DB.prepare(
      "INSERT INTO context_entries (id, scope, content, links) VALUES (?, ?, ?, ?)"
    ).bind(id, body.scope || "default", body.content, body.links || "[]").run();
    return jsonResponse({ id, ...body }, 201);
  }

  // PUT /api/context/:id - update
  if (method === "PUT" && contextId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE context_entries SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.content, contextId).run();
    return jsonResponse({ id: contextId, ...body });
  }

  // DELETE /api/context/:id - delete
  if (method === "DELETE" && contextId) {
    await env.DB.prepare("DELETE FROM context_entries WHERE id = ?").bind(contextId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
