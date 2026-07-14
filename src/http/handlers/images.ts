// HTTP handler for /api/images — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiImages(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const imageId = pathParts[2] ? parseInt(pathParts[2]) : null;

  if (method === "GET" && !imageId) {
    const params = new URL(request.url).searchParams;
    const entityId = params.get("entity_id");
    const weight = params.get("weight");

    let query = `
      SELECT
        i.id,
        i.path,
        i.description,
        i.context,
        i.emotion,
        i.weight,
        i.charge,
        i.entity_id,
        i.observation_id,
        i.created_at,
        i.last_viewed_at,
        i.view_count,
        e.name as entity_name,
        e.entity_type
      FROM images i
      LEFT JOIN entities e ON i.entity_id = e.id
    `;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (entityId) {
      conditions.push("i.entity_id = ?");
      bindings.push(parseInt(entityId, 10));
    }

    if (weight) {
      conditions.push("i.weight = ?");
      bindings.push(weight);
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += " ORDER BY i.created_at DESC LIMIT 200";

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results || []);
  }

  if (method === "GET" && imageId) {
    const image = await env.DB.prepare(
      `SELECT
         i.id,
         i.path,
         i.description,
         i.context,
         i.emotion,
         i.weight,
         i.charge,
         i.entity_id,
         i.observation_id,
         i.created_at,
         i.last_viewed_at,
         i.view_count,
         e.name as entity_name,
         e.entity_type
       FROM images i
       LEFT JOIN entities e ON i.entity_id = e.id
       WHERE i.id = ?`
    ).bind(imageId).first();

    return image ? jsonResponse(image) : jsonResponse({ error: "Not found" }, 404);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
