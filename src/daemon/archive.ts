/**
 * Deep archive pass — fades old observations that were never engaged with.
 *
 *   Light path:  30 days old, 0 sits, not surfaced in 30d, not foundational
 *   Medium path: 90 days old, 0 sits, not surfaced in 60d, not foundational
 *
 * Caps at 50 per run to avoid mass archive in one tick. Returns the count
 * actually archived. Foundational-salience entities are never touched.
 *
 * Gate G (RESHAPE-2) adds a separate, very conservative images candidacy:
 * cap 5/run, low-weight only ('light' or NULL), unviewed 90d+, 90d+ old.
 * Requires images.archived_at (migration 0016) — tolerates 42703 (not yet
 * migrated on this tenant) and skips the images half of the pass silently.
 */

import type { Env } from "../types";
import { ARCHIVE_AGE_DAYS } from "../shared/constants";

export async function runDeepArchivePass(env: Env): Promise<number> {
  const archiveCandidates = await env.DB.prepare(`
    SELECT id FROM (
      SELECT o.id
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE o.archived_at IS NULL
        AND o.weight = 'light'
        AND COALESCE(o.sit_count, 0) = 0
        AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-30 days'))
        AND o.added_at < datetime('now', '-${ARCHIVE_AGE_DAYS} days')
        AND (o.charge != 'processing' OR o.charge IS NULL)
        AND COALESCE(e.salience, 'active') != 'foundational'
      UNION
      SELECT o.id
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE o.archived_at IS NULL
        AND o.weight = 'medium'
        AND COALESCE(o.sit_count, 0) = 0
        AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-60 days'))
        AND o.added_at < datetime('now', '-90 days')
        AND (o.charge != 'processing' OR o.charge IS NULL)
        AND COALESCE(e.salience, 'active') != 'foundational'
    )
    LIMIT 50
  `).all();

  let archivedCount = 0;
  for (const obs of archiveCandidates.results || []) {
    await env.DB.prepare(`
      UPDATE observations SET archived_at = datetime('now') WHERE id = ?
    `).bind(obs.id).run();
    archivedCount++;
  }
  if (archivedCount > 0) {
    console.log(`Archived ${archivedCount} observations to the deep`);
  }

  // Images (Gate G) — separate, capped-at-5, low-weight-only candidacy.
  let imageArchivedCount = 0;
  try {
    const imageCandidates = await env.DB.prepare(`
      SELECT id FROM images
      WHERE archived_at IS NULL
        AND (weight = 'light' OR weight IS NULL)
        AND (last_viewed_at IS NULL OR last_viewed_at < datetime('now', '-90 days'))
        AND created_at < datetime('now', '-90 days')
      LIMIT 5
    `).all();

    for (const img of imageCandidates.results || []) {
      await env.DB.prepare(`
        UPDATE images SET archived_at = datetime('now') WHERE id = ?
      `).bind(img.id).run();
      imageArchivedCount++;
    }
    if (imageArchivedCount > 0) {
      console.log(`Archived ${imageArchivedCount} images to the deep`);
    }
  } catch {
    /* images.archived_at may not exist yet (migration 0016 pending) — degrade gracefully */
  }

  return archivedCount + imageArchivedCount;
}
