// HTTP handler for /api/observations/:id/versions — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiObservationVersions(request: Request, env: Env, obsId: number): Promise<Response> {
  // GET /api/observations/:id/versions - get version history
  if (request.method === "GET") {
    const versions = await env.DB.prepare(`
      SELECT * FROM observation_versions
      WHERE observation_id = ?
      ORDER BY version_num DESC
    `).bind(obsId).all();

    return jsonResponse(versions.results);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
