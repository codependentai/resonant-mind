/**
 * Orphan observation tracking. Two passes:
 *
 *   1. Cleanup — remove stale orphan records when underlying observations
 *      become light/archived/metabolized (they shouldn't be orphans anymore).
 *
 *   2. Identify — observations never surfaced, 30+ days old, medium/heavy only,
 *      not archived. Inserted into orphan_observations for later surfacing.
 *
 * Will feed Dreams region's "things rising" channel post-reshape.
 */

import type { Env } from "../types";
import { ORPHAN_AGE_DAYS } from "../shared/constants";

export async function cleanupStaleOrphans(env: Env): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM orphan_observations WHERE observation_id IN (
      SELECT oo.observation_id FROM orphan_observations oo
      JOIN observations o ON oo.observation_id = o.id
      WHERE o.weight = 'light' OR o.archived_at IS NOT NULL OR o.charge = 'metabolized'
    )
  `).run();
}

export async function identifyOrphans(env: Env): Promise<number> {
  const orphans = await env.DB.prepare(`
    SELECT o.id FROM observations o
    LEFT JOIN orphan_observations oo ON o.id = oo.observation_id
    WHERE (o.last_surfaced_at IS NULL OR o.surface_count = 0)
      AND o.added_at < datetime('now', '-${ORPHAN_AGE_DAYS} days')
      AND oo.observation_id IS NULL
      AND (o.charge != 'metabolized' OR o.charge IS NULL)
      AND o.weight IN ('medium', 'heavy')
      AND o.archived_at IS NULL
  `).all();

  let orphansIdentified = 0;
  for (const orphan of orphans.results || []) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO orphan_observations (observation_id) VALUES (?)
    `).bind(orphan.id).run();
    orphansIdentified++;
  }

  return orphansIdentified;
}
