// HTTP handler for /api/relations — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiRelations(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const relationId = pathParts[2] ? parseInt(pathParts[2]) : null;

  // GET /api/relations - list all
  // Schema: from_entity (TEXT name), to_entity (TEXT name), relation_type, from_context, to_context, store_in, created_at
  if (method === "GET" && !relationId) {
    const entityFilter = new URL(request.url).searchParams.get("entity");
    const typeFilter = new URL(request.url).searchParams.get("type");

    let query = `SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (entityFilter) {
      conditions.push("(from_entity = ? OR to_entity = ?)");
      bindings.push(entityFilter, entityFilter);
    }
    if (typeFilter) {
      conditions.push("relation_type = ?");
      bindings.push(typeFilter);
    }

    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at DESC LIMIT 200";

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results);
  }

  // GET /api/relations/:id - get one
  if (method === "GET" && relationId) {
    const relation = await env.DB.prepare("SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations WHERE id = ?").bind(relationId).first();
    return relation ? jsonResponse(relation) : jsonResponse({ error: "Not found" }, 404);
  }

  // POST /api/relations - create
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const result = await env.DB.prepare(
      "INSERT INTO relations (from_entity, to_entity, relation_type, from_context, to_context, store_in) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(body.from_entity, body.to_entity, body.relation_type, body.from_context || "default", body.to_context || "default", body.store_in || "default").run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  // PUT /api/relations/:id - update
  if (method === "PUT" && relationId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE relations SET relation_type = ? WHERE id = ?"
    ).bind(body.relation_type, relationId).run();
    return jsonResponse({ id: relationId, ...body });
  }

  // DELETE /api/relations/:id - delete
  if (method === "DELETE" && relationId) {
    await env.DB.prepare("DELETE FROM relations WHERE id = ?").bind(relationId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
