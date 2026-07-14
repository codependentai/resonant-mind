// HTTP handler for /api/dreams/living-surface — full structured subconscious state.
// Returns daemon's living_surface JSONB plus the mood/hot_entities envelope. Frontend
// uses this to render the /surface page with deep-linked observation/entity/thread IDs.
import { jsonResponse } from "../response";
import { getSubconsciousState } from "../../daemon/state";
import type { Env } from "../../types";

export async function handleApiLivingSurface(_request: Request, env: Env): Promise<Response> {
  const subconscious = await getSubconsciousState(env);
  if (!subconscious) {
    return jsonResponse({ error: "No subconscious state available — daemon hasn't run yet" }, 404);
  }

  return jsonResponse({
    processed_at: subconscious.processed_at ?? null,
    mood: subconscious.mood ?? null,
    hot_entities: subconscious.hot_entities ?? [],
    central_nodes: subconscious.central_nodes ?? [],
    recurring_patterns: subconscious.recurring_patterns ?? [],
    relation_patterns: subconscious.relation_patterns ?? [],
    living_surface: subconscious.living_surface ?? null,
  });
}
