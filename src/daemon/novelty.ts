/**
 * Novelty + charge progression. Three passes:
 *
 *   1. recalcNoveltyScores — idempotent recalculation:
 *      novelty = GREATEST(weight_floor, LEAST(1.0, base_decay + time_recovery - age_penalty))
 *      base_decay = 1.0 - (surface_count * decay_rate_by_weight)
 *      time_recovery = MIN(cap, days_since_last_surfaced * rate) — only if previously surfaced
 *      age_penalty = MIN(cap, days_since_added * rate) — only if NEVER surfaced
 *
 *   2. progressCharge — fresh → active (2+ surfaces) → processing (5+ surfaces or 30d+2 sits).
 *
 *   3. decayUnaccessed — penalizes observations 30d+ old with zero accesses to drain them.
 *
 * All three are idempotent — running them N times produces the same result as running once.
 */

import type { Env } from "../types";
import {
  NOVELTY_FLOORS,
  NOVELTY_DECAY_RATES,
  NOVELTY_TIME_RECOVERY_RATE,
  NOVELTY_TIME_RECOVERY_CAP,
  NOVELTY_AGE_DECAY_RATE,
  NOVELTY_AGE_DECAY_CAP,
  ACCESS_DECAY_PENALTY,
  ACCESS_DECAY_AGE_DAYS,
} from "../shared/constants";

export async function recalcNoveltyScores(env: Env): Promise<void> {
  await env.DB.prepare(`
    UPDATE observations
    SET novelty_score = GREATEST(
      CASE weight
        WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy}
        WHEN 'medium' THEN ${NOVELTY_FLOORS.medium}
        ELSE ${NOVELTY_FLOORS.light}
      END,
      LEAST(1.0,
        (1.0 - COALESCE(surface_count, 0) *
          CASE weight
            WHEN 'heavy' THEN ${NOVELTY_DECAY_RATES.heavy}
            WHEN 'medium' THEN ${NOVELTY_DECAY_RATES.medium}
            ELSE ${NOVELTY_DECAY_RATES.light}
          END)
        + CASE
            WHEN last_surfaced_at IS NOT NULL
            THEN LEAST(${NOVELTY_TIME_RECOVERY_CAP},
              EXTRACT(EPOCH FROM (NOW() - last_surfaced_at)) / 86400.0 * ${NOVELTY_TIME_RECOVERY_RATE})
            ELSE 0
          END
        - CASE
            WHEN last_surfaced_at IS NULL
              AND added_at < NOW() - INTERVAL '7 days'
            THEN LEAST(${NOVELTY_AGE_DECAY_CAP},
              EXTRACT(EPOCH FROM (NOW() - added_at)) / 86400.0 * ${NOVELTY_AGE_DECAY_RATE})
            ELSE 0
          END
      )
    )
    WHERE archived_at IS NULL
      AND (charge != 'metabolized' OR charge IS NULL)
  `).run();
}

export async function progressCharge(env: Env): Promise<void> {
  // fresh -> active: system has engaged with this observation (surfaced 2+ times)
  await env.DB.prepare(`
    UPDATE observations SET charge = 'active'
    WHERE charge = 'fresh'
      AND COALESCE(surface_count, 0) >= 2
      AND archived_at IS NULL
  `).run();

  // active -> processing: deeply familiar or sat with multiple times
  await env.DB.prepare(`
    UPDATE observations SET charge = 'processing'
    WHERE charge = 'active'
      AND (
        COALESCE(surface_count, 0) >= 5
        OR (added_at < datetime('now', '-30 days') AND COALESCE(sit_count, 0) >= 2)
      )
      AND archived_at IS NULL
  `).run();
}

export async function decayUnaccessed(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      UPDATE observations
      SET novelty_score = GREATEST(
        CASE weight WHEN 'heavy' THEN 0.2 WHEN 'medium' THEN 0.1 ELSE 0.05 END,
        novelty_score - ${ACCESS_DECAY_PENALTY}
      )
      WHERE archived_at IS NULL
        AND (charge != 'metabolized' OR charge IS NULL)
        AND COALESCE(access_count, 0) = 0
        AND added_at < datetime('now', '-${ACCESS_DECAY_AGE_DAYS} days')
        AND novelty_score > 0.3
    `).run();
  } catch (e) {
    // Code-aware catch: tolerate missing-schema errors only.
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`decayUnaccessed(observations): column not migrated yet (${code}) — skipping`);
    } else {
      console.error(`decayUnaccessed(observations) failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Images (Gate G, RESHAPE-2 minimal metabolism extension): a parallel,
  // more conservative decay so visual memories can go quiet too. images
  // carries the same novelty_score/last_surfaced_at/surface_count shape as
  // observations, plus its own access_count/last_accessed_at (0002) and
  // view_count (0001) — treat "never viewed, never accessed" as the signal.
  // Half the observation penalty: images are fewer and costlier to re-derive,
  // so the fade is gentler. Tolerates images.archived_at not existing yet
  // (0016 pending on this tenant — Postgres 42703).
  try {
    await env.DB.prepare(`
      UPDATE images
      SET novelty_score = GREATEST(
        CASE weight WHEN 'heavy' THEN 0.2 WHEN 'medium' THEN 0.1 ELSE 0.05 END,
        novelty_score - ${ACCESS_DECAY_PENALTY / 2}
      )
      WHERE archived_at IS NULL
        AND COALESCE(access_count, 0) = 0
        AND COALESCE(view_count, 0) = 0
        AND created_at < datetime('now', '-${ACCESS_DECAY_AGE_DAYS} days')
        AND novelty_score > 0.3
    `).run();
  } catch (e) {
    // Code-aware catch: tolerate missing-schema errors only.
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`decayUnaccessed(images): column not migrated yet (${code}) — skipping`);
    } else {
      console.error(`decayUnaccessed(images) failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
