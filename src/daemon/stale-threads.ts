/**
 * Stale-threads daemon (D3).
 *
 * Surfaces threads not updated in N+ days. Stratifies into cooling/stale/graveyard
 * and writes counts + sample IDs to subconscious.living_surface.stale_threads.
 *
 * Cheap — single aggregation query. Runs every tick.
 */

import type { Env } from "../types";

export interface StaleThreadSnapshot {
  cooling: number;        // 7-14d
  stale: number;          // 14-30d
  graveyard: number;      // 30d+
  samples: { id: string; content: string; age_days: number }[];
}

export async function computeStaleThreads(env: Env): Promise<StaleThreadSnapshot> {
  const rows = await env.DB.prepare(`
    SELECT id, content,
           EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400.0 AS age_days
    FROM threads
    WHERE status = 'active'
      AND updated_at < NOW() - INTERVAL '7 days'
    ORDER BY updated_at ASC
  `).all().catch(() => ({ results: [] }));

  const list = ((rows.results || []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    content: r.content as string,
    age_days: Number(r.age_days),
  }));

  let cooling = 0;
  let stale = 0;
  let graveyard = 0;
  for (const t of list) {
    if (t.age_days >= 30) graveyard++;
    else if (t.age_days >= 14) stale++;
    else cooling++;
  }

  // Sample: oldest of each stratum, up to 5 total
  const samples = list.slice(0, 5).map((t) => ({
    id: t.id,
    content: t.content.length > 120 ? `${t.content.slice(0, 120)}...` : t.content,
    age_days: Math.round(t.age_days * 10) / 10,
  }));

  return { cooling, stale, graveyard, samples };
}
