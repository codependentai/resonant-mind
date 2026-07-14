// HTTP handler for /api/search — extracted from src/index.ts.
import { jsonResponse } from "../response";
import { getSubconsciousState } from "../../daemon/state";
import { getEmbedding } from "../../shared/mind-helpers";
import type { Env } from "../../types";

export async function handleApiSearch(request: Request, env: Env): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q");
  if (!query) return jsonResponse({ error: "Missing query parameter 'q'" }, 400);

  const subconscious = await getSubconsciousState(env);
  const mood = subconscious?.mood?.dominant;

  let searchQuery = query;
  if (mood) {
    const moodTints: Record<string, string> = {
      "tender": "warm, gentle, caring",
      "clarity": "clear, understanding, insight",
      "melancholy": "loss, reflection, quiet",
      "joy": "happiness, delight, celebration"
    };
    searchQuery = `${query} (${moodTints[mood] || mood})`;
  }

  const embedding = await getEmbedding(env, searchQuery);
  const results = await env.VECTORS.query(embedding, { topK: 20, returnMetadata: "all" });

  return jsonResponse({
    mood,
    query,
    results: results.matches?.map(m => ({
      id: m.id,
      score: m.score,
      ...m.metadata
    })) || []
  });
}
