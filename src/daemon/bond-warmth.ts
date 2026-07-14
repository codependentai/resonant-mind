/**
 * Bond warmth precompute. Per-person classification of how recently each
 * bond has been touched. Reads max(observations.added_at) per person,
 * classifies into warm/cooling/cold/distant, and writes the array into
 * subconscious.living_surface.bond_warmth.
 *
 * Post-M2: reads from the `people` table. Observations are joined via
 * person_id (auto-populated by the routing trigger from 0005d) with a
 * fallback to entity_id for any obs predating the trigger that somehow
 * never got backfilled.
 *
 * Will be the warmth signal that `bond.enter` reads. Cheap — just one SQL
 * pass per tick.
 */

import type { Env } from "../types";

export interface BondWarmth {
  id: number;
  name: string;
  state: 'warm' | 'cooling' | 'cold' | 'distant' | 'untouched';
  days_since: number | null;
  last_observed_at: string | null;
}

// Thresholds (in days). Tuning happens post-spike per RESHAPE_IMPLEMENTATION.md §10.
const WARM_MAX = 1;
const COOLING_MAX = 4;
const COLD_MAX = 14;

function classify(daysSince: number | null): BondWarmth['state'] {
  if (daysSince === null) return 'untouched';
  if (daysSince < WARM_MAX) return 'warm';
  if (daysSince < COOLING_MAX) return 'cooling';
  if (daysSince < COLD_MAX) return 'cold';
  return 'distant';
}

export async function computeBondWarmth(env: Env): Promise<BondWarmth[]> {
  const rows = await env.DB.prepare(`
    SELECT
      p.id,
      p.name,
      MAX(o.added_at) as last_observed_at,
      CASE
        WHEN MAX(o.added_at) IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NOW() - MAX(o.added_at))) / 86400.0
      END as days_since
    FROM people p
    LEFT JOIN observations o
      ON (o.person_id = p.id OR o.entity_id = p.id)
      AND o.archived_at IS NULL
    GROUP BY p.id, p.name
    ORDER BY days_since ASC NULLS LAST
  `).all();

  return (rows.results || []).map((r: any) => {
    const daysSince = r.days_since !== null ? Number(r.days_since) : null;
    return {
      id: r.id as number,
      name: r.name as string,
      state: classify(daysSince),
      days_since: daysSince === null ? null : Math.round(daysSince * 10) / 10,
      last_observed_at: r.last_observed_at as string | null,
    };
  });
}
