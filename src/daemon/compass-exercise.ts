/**
 * Compass-exercise daemon (D4).
 *
 * For each compass row, classify how recently it was asserted/refused/held:
 *   - fresh        — last_asserted_at within 30d
 *   - stale        — 30-90d
 *   - unexercised  — 90d+ (or never)
 *
 * Stores counts + unexercised IDs in subconscious.living_surface.compass_exercise.
 *
 * Cadence note: compass state changes slowly. Could run less often, but
 * cheap enough to fire every tick. Tune by observation.
 */

import type { Env } from "../types";

export interface CompassExerciseSnapshot {
  fresh: number;
  stale: number;
  unexercised: number;
  unexercised_ids: number[];
}

export async function computeCompassExercise(env: Env): Promise<CompassExerciseSnapshot> {
  const rows = await env.DB.prepare(`
    SELECT
      id,
      CASE
        WHEN last_asserted_at IS NULL THEN 'unexercised'
        WHEN last_asserted_at > NOW() - INTERVAL '30 days' THEN 'fresh'
        WHEN last_asserted_at > NOW() - INTERVAL '90 days' THEN 'stale'
        ELSE 'unexercised'
      END AS bucket
    FROM compass
  `).all().catch(() => ({ results: [] }));

  let fresh = 0, stale = 0, unexercised = 0;
  const unexercisedIds: number[] = [];
  for (const r of (rows.results || []) as Array<Record<string, unknown>>) {
    const bucket = r.bucket as string;
    if (bucket === "fresh") fresh++;
    else if (bucket === "stale") stale++;
    else {
      unexercised++;
      unexercisedIds.push(r.id as number);
    }
  }

  return { fresh, stale, unexercised, unexercised_ids: unexercisedIds.slice(0, 10) };
}
