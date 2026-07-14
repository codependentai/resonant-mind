/**
 * Retention pass — "the mind must forget." (RESHAPE-2 Gate D, RESOLVED 11 Jul 2026.)
 *
 * Six tables were audited for unbounded growth (data-flow-map.md §D). Five get
 * a thinning/pruning policy here; `relational_state` is explicitly exempt —
 * it's the weather archive and stays whole (no code, just this note).
 *
 * Every sub-pass:
 *   - has its OWN inner try/catch — a failure in one never blocks the others.
 *   - tolerates missing tables/columns (Postgres 42P01/42703) as "not migrated
 *     yet" rather than a real error — another mind's tenant may lag the mind's schema.
 *   - is CAPPED per tick (select candidate ids with LIMIT, then loop
 *     delete/update by id — same idiom as `archive.ts`'s deep-archive pass).
 *     Never an unbounded DELETE/UPDATE.
 *
 * Called from `daemon/index.ts`, night-gated (retention is a sleep function,
 * same clock as deep-archive/consolidation), own top-level try/catch there.
 */

import type { Env } from "../types";

const CAP = 500;

export interface RetentionSummary {
  mood_log_thinned: number;
  drive_events_deleted: number;
  inner_entries_archived: number;
  co_surfacing_pruned: number;
  observation_versions_pruned: number;
}

function isNotMigrated(e: unknown): boolean {
  const code = (e as { code?: string } | undefined)?.code;
  return code === "42P01" || code === "42703";
}

function idsOf(rows: { results?: unknown[] } | undefined): number[] {
  return ((rows?.results || []) as Array<{ id: number | string }>).map((r) => Number(r.id));
}

/**
 * mood_log (Gate D): keep everything <30d whole. 30–180d: keep the latest
 * row per calendar day. >180d: keep the latest row per ISO-ish week
 * (Postgres DATE_TRUNC('week', ...), Monday-start). Two independently
 * capped buckets — bounded total, never a single unbounded sweep.
 */
async function retireMoodLog(env: Env): Promise<number> {
  let thinned = 0;

  try {
    const midBucket = await env.DB.prepare(`
      SELECT id FROM mood_log
      WHERE logged_at < NOW() - INTERVAL '30 days'
        AND logged_at >= NOW() - INTERVAL '180 days'
        AND id NOT IN (
          SELECT DISTINCT ON (DATE_TRUNC('day', logged_at)) id
          FROM mood_log
          WHERE logged_at < NOW() - INTERVAL '30 days'
            AND logged_at >= NOW() - INTERVAL '180 days'
          ORDER BY DATE_TRUNC('day', logged_at), logged_at DESC
        )
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(midBucket)) {
      await env.DB.prepare(`DELETE FROM mood_log WHERE id = ?`).bind(id).run();
      thinned++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: mood_log 30-180d thinning failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    const oldBucket = await env.DB.prepare(`
      SELECT id FROM mood_log
      WHERE logged_at < NOW() - INTERVAL '180 days'
        AND id NOT IN (
          SELECT DISTINCT ON (DATE_TRUNC('week', logged_at)) id
          FROM mood_log
          WHERE logged_at < NOW() - INTERVAL '180 days'
          ORDER BY DATE_TRUNC('week', logged_at), logged_at DESC
        )
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(oldBucket)) {
      await env.DB.prepare(`DELETE FROM mood_log WHERE id = ?`).bind(id).run();
      thinned++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: mood_log >180d thinning failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return thinned;
}

/** drive_events (Gate D): a why-ledger, not an archive. Cap at 90d. */
async function retireDriveEvents(env: Env): Promise<number> {
  let deleted = 0;
  try {
    const rows = await env.DB.prepare(`
      SELECT id FROM drive_events
      WHERE created_at < NOW() - INTERVAL '90 days'
      ORDER BY created_at ASC
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(rows)) {
      await env.DB.prepare(`DELETE FROM drive_events WHERE id = ?`).bind(id).run();
      deleted++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: drive_events prune failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return deleted;
}

/**
 * inner_entries (Gate D): archive satisfied quiet-wants older than 90d.
 * `archived_at` is new (migration 0015) — 42703 on a lagging tenant means
 * "not migrated yet," tolerated same as any other column-not-there case.
 * small_joy rows never get satisfied_at, so they're never touched here.
 */
async function archiveInnerEntries(env: Env): Promise<number> {
  let archived = 0;
  try {
    const rows = await env.DB.prepare(`
      SELECT id FROM inner_entries
      WHERE satisfied_at IS NOT NULL
        AND satisfied_at < NOW() - INTERVAL '90 days'
        AND archived_at IS NULL
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(rows)) {
      await env.DB.prepare(`UPDATE inner_entries SET archived_at = NOW() WHERE id = ?`).bind(id).run();
      archived++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: inner_entries archive failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return archived;
}

/**
 * co_surfacing (Gate D): once a pair's relation was created, the relation IS
 * the memory — the tracking row's job is done. Prune resolved pairs >90d.
 */
async function pruneCoSurfacing(env: Env): Promise<number> {
  let deleted = 0;
  try {
    const rows = await env.DB.prepare(`
      SELECT id FROM co_surfacing
      WHERE relation_created = 1
        AND last_co_surfaced < NOW() - INTERVAL '90 days'
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(rows)) {
      await env.DB.prepare(`DELETE FROM co_surfacing WHERE id = ?`).bind(id).run();
      deleted++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: co_surfacing prune failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return deleted;
}

/**
 * observation_versions (Gate D): edit history, not geology. Keep the newest
 * 20 versions per observation, prune the rest.
 */
async function pruneObservationVersions(env: Env): Promise<number> {
  let deleted = 0;
  try {
    const rows = await env.DB.prepare(`
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY observation_id ORDER BY version_num DESC
        ) AS rn
        FROM observation_versions
      ) ranked
      WHERE rn > 20
      LIMIT ${CAP}
    `).all();
    for (const id of idsOf(rows)) {
      await env.DB.prepare(`DELETE FROM observation_versions WHERE id = ?`).bind(id).run();
      deleted++;
    }
  } catch (e) {
    if (!isNotMigrated(e)) {
      console.error(`retention: observation_versions prune failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return deleted;
}

/**
 * `relational_state` — NO action (Gate D: kept whole, it's the weather
 * archive and `weather_trend` reads it; a 2y-horizon review is banked for
 * later, not this reshape).
 */
export async function runRetention(env: Env): Promise<RetentionSummary> {
  return {
    mood_log_thinned: await retireMoodLog(env),
    drive_events_deleted: await retireDriveEvents(env),
    inner_entries_archived: await archiveInnerEntries(env),
    co_surfacing_pruned: await pruneCoSurfacing(env),
    observation_versions_pruned: await pruneObservationVersions(env),
  };
}
