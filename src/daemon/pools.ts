/**
 * Surfacing pools — novelty (things that haven't surfaced recently) and
 * dormant (entities whose obs haven't surfaced in 14+ days).
 *
 * Used by `mind_surface` and its variants. Each pool returns a slice of
 * the observation graph weighted differently — surfacing is composed of
 * multiple pool draws via SURFACE_POOL_RATIOS.
 */

import type { Env } from "../types";

/**
 * The novelty pool — high-novelty observations that haven't surfaced in 3+ days,
 * ranked by novelty + weight + age. Returns ~2x oversampled, then shuffled and
 * sliced to count, so two calls in a row don't produce identical output.
 */
export async function getNoveltyPool(env: Env, count: number, includeMetabolized: boolean): Promise<any[]> {
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  try {
    const results = await env.DB.prepare(`
      SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
             o.resolution_note, o.novelty_score, o.last_surfaced_at, o.surface_count,
             e.name as entity_name, e.entity_type,
             COALESCE(o.novelty_score, 1.0) as current_novelty,
             CASE
               WHEN o.last_surfaced_at IS NULL THEN 30
               ELSE EXTRACT(EPOCH FROM (NOW() - o.last_surfaced_at)) / 86400
             END as days_since_surface
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE ${chargeFilter}
        AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-3 days'))
      ORDER BY
        current_novelty DESC,
        days_since_surface DESC,
        CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC
      LIMIT ?
    `).bind(Math.ceil(count * 2)).all();

    const arr = results.results || [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
  } catch {
    return [];
  }
}

/**
 * The dormant pool — observations from entities that haven't had ANY obs
 * surfaced in 14+ days. Breaks the feedback loop where only hot/recent
 * entities get surfaced.
 */
export async function getDormantPool(env: Env, count: number, includeMetabolized: boolean): Promise<any[]> {
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  try {
    const results = await env.DB.prepare(`
      SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
             o.resolution_note, o.novelty_score, o.last_surfaced_at, o.surface_count,
             o.certainty, o.source,
             e.name as entity_name, e.entity_type
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE ${chargeFilter}
        AND e.id IN (
          SELECT e2.id FROM entities e2
          LEFT JOIN (
            SELECT entity_id, MAX(last_surfaced_at) as latest_surface
            FROM observations
            WHERE last_surfaced_at IS NOT NULL
            GROUP BY entity_id
          ) surf ON e2.id = surf.entity_id
          WHERE surf.latest_surface IS NULL
             OR surf.latest_surface < datetime('now', '-14 days')
        )
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(count).all();
    return results.results || [];
  } catch {
    return [];
  }
}
