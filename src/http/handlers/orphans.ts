// HTTP handler for /api/orphans — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";
import { archiveObservation } from "../../shared/archive-observation";

export async function handleApiOrphans(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // surface or archive

  // GET /api/orphans - list orphaned observations
  if (request.method === "GET" && !id) {
    const results = await env.DB.prepare(`
      SELECT oo.*, o.content, o.weight, o.emotion, o.added_at, o.charge,
             e.name as entity_name, e.entity_type,
             EXTRACT(DAY FROM AGE(NOW(), o.added_at))::INTEGER as days_old
      FROM orphan_observations oo
      JOIN observations o ON oo.observation_id = o.id
      JOIN entities e ON o.entity_id = e.id
      WHERE o.archived_at IS NULL
      ORDER BY oo.first_marked DESC
      LIMIT 100
    `).all();

    return jsonResponse(results.results);
  }

  // POST /api/orphans/:id/surface - force surface an orphan
  if (request.method === "POST" && id && action === "surface") {
    // Remove from orphan list
    await env.DB.prepare(
      `DELETE FROM orphan_observations WHERE observation_id = ?`
    ).bind(id).run();

    // Reset novelty to make it surface
    await env.DB.prepare(
      `UPDATE observations SET novelty_score = 1.0, last_surfaced_at = NULL WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  // POST /api/orphans/:id/archive - archive an orphan
  // Gate N #3: delegates to the shared archive engine (archived_at + queue
  // cleanup, correct ordering) instead of its own inline SQL.
  if (request.method === "POST" && id && action === "archive") {
    await archiveObservation(env, id);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown orphans endpoint" }, 404);
}
