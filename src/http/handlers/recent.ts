// HTTP handler for /api/recent — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiRecent(env: Env): Promise<Response> {
  // Last 20 observations with entity names
  const observations = await env.DB.prepare(`
    SELECT o.id, o.content, o.salience, o.emotion, o.weight, o.charge, o.added_at, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    ORDER BY o.added_at DESC
    LIMIT 20
  `).all();

  // Last 5 journals
  const journals = await env.DB.prepare(`
    SELECT id, entry_date, content, emotion, created_at
    FROM journals
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  // Last 5 thread changes (any status change)
  const threads = await env.DB.prepare(`
    SELECT id, thread_type, content, priority, status, context, created_at, updated_at, resolved_at
    FROM threads
    ORDER BY COALESCE(resolved_at, updated_at, created_at) DESC
    LIMIT 5
  `).all();

  return jsonResponse({
    observations: observations.results || [],
    journals: journals.results || [],
    threads: threads.results || []
  });
}
