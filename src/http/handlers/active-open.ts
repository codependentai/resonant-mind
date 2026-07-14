// HTTP handler for /api/active/open — open threads + daemon D3 stale signal.
import { jsonResponse } from "../response";
import { getSubconsciousState } from "../../daemon/state";
import type { Env } from "../../types";

export async function handleApiActiveOpen(_request: Request, env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT id, thread_type, content, priority, status, context, created_at, updated_at
    FROM threads
    WHERE status = 'active'
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
  `).all();

  const threads = result.results || [];
  const subconscious = await getSubconsciousState(env);
  const surface = (subconscious as unknown as Record<string, unknown>)?.living_surface as
    | Record<string, unknown>
    | undefined;
  const staleSignal = surface?.stale_threads ?? null;

  return jsonResponse({
    count: threads.length,
    threads,
    stale_signal: staleSignal,
  });
}
