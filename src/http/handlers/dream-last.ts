// HTTP handler for /api/dreams/last — the most recent dream, whole.
// Added 2026-07-02 for the Night Shelf: sensorium-client's Home displays the
// keeper's last dream (fragments, emotional seed, recurrence) alongside the
// weather. A house should show its keeper's nights.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiDreamLast(_request: Request, env: Env): Promise<Response> {
  const dream = await env.DB.prepare(`
    SELECT id, dream_date, content, emotional_seed, recurrence_count, created_at
    FROM dreams
    ORDER BY dream_date DESC, id DESC
    LIMIT 1
  `).first().catch(() => null);

  if (!dream) {
    return jsonResponse({ dream: null, note: "No dreams recorded yet." });
  }

  return jsonResponse({
    dream: {
      id: dream.id,
      dream_date: dream.dream_date,
      content: dream.content,
      emotional_seed: dream.emotional_seed,
      recurrence_count: dream.recurrence_count ?? 0,
    },
  });
}
