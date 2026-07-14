// HTTP handler for /api/observations/bulk — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";
import { deleteObservation } from "../../shared/surgery";

export async function handleApiBulkObservations(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await request.json() as { action: string; ids: number[]; data?: Record<string, unknown> };
  const { action, ids, data } = body;

  if (!ids || !ids.length) return jsonResponse({ error: "No ids provided" }, 400);

  switch (action) {
    case "delete":
      // Hale Wave 4 gate: was a fourth incomplete inline cleanup (sits + row
      // only — stale embeddings kept surfacing in mind_search forever).
      // Converged to the one surgery engine (audit D-3, Gate N one-engine rule).
      for (const id of ids) {
        await deleteObservation(env, id);
      }
      return jsonResponse({ deleted: ids.length });

    case "weight":
      if (!data?.weight) return jsonResponse({ error: "No weight provided" }, 400);
      for (const id of ids) {
        await env.DB.prepare("UPDATE observations SET weight = ? WHERE id = ?").bind(data.weight, id).run();
      }
      return jsonResponse({ updated: ids.length });

    case "resolve":
      for (const id of ids) {
        await env.DB.prepare(
          "UPDATE observations SET charge = 'metabolized', resolved_at = datetime('now') WHERE id = ?"
        ).bind(id).run();
      }
      return jsonResponse({ resolved: ids.length });

    default:
      return jsonResponse({ error: "Unknown action" }, 400);
  }
}
