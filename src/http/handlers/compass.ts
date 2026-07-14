// HTTP handler for /api/compass — list compass rows with freshness bucket
// derived in SQL (matches D4 daemon's bucketing logic).
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiCompass(_request: Request, env: Env): Promise<Response> {
  const rowsResult = await env.DB.prepare(`
    SELECT
      id, kind, content, weight, asserted_count, last_asserted_at,
      source_identity_id, created_at,
      CASE
        WHEN last_asserted_at IS NULL THEN 'unexercised'
        WHEN last_asserted_at > NOW() - INTERVAL '30 days' THEN 'fresh'
        WHEN last_asserted_at > NOW() - INTERVAL '90 days' THEN 'stale'
        ELSE 'unexercised'
      END AS freshness
    FROM compass
    ORDER BY kind, weight DESC, last_asserted_at DESC NULLS LAST
  `).all();
  const rows = (rowsResult.results || []) as Array<Record<string, unknown>>;

  return jsonResponse({
    count: rows.length,
    rows,
  });
}
