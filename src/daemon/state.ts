/**
 * Daemon state — reads from and writes to the `subconscious` table, plus
 * the tracking surfaces that say "this observation was seen / accessed."
 *
 * Will become the Dreams region's persistence layer post-reshape. Everything
 * here is the metabolism, not the felt verbs.
 */

import type { Env } from "../types";
import { NOVELTY_FLOORS } from "../shared/constants";
import type { HotEntity, RecurringPattern, ContextCluster } from "./warmth";
import type { GraphAnalysis } from "./graph";
import type { StrongestCoSurface } from "./proposals";
import type { BondWarmth } from "./bond-warmth";
import type { StaleThreadSnapshot } from "./stale-threads";
import type { CompassExerciseSnapshot } from "./compass-exercise";
import type { RisenMemory } from "./redolence";
import type { AffectModulation } from "./affect";
import type { DrivesGauge } from "./drives";

/**
 * Shape of the `subconscious` blob as assembled by `daemon/index.ts`
 * (processSubconscious, the `state` object). This is the shared contract —
 * keep it in lockstep with that assembly. Fields added after the original
 * blob (2026-07-02 limbic layer onward) are optional because persisted
 * blobs from earlier ticks may lack them, and individual passes can skip.
 */
export interface SubconsciousState {
  processed_at?: string;
  hot_entities?: HotEntity[];
  recurring_patterns?: RecurringPattern[];
  mood?: {
    dominant: string;
    confidence: string;
    /** Legacy field from pre-limbic blobs; the daemon no longer writes it. */
    undercurrent?: string;
    valence?: number | null;
    arousal?: number | null;
    texture?: string | null;
    coverage?: number | null;
  };
  context_clusters?: ContextCluster[];
  central_nodes?: GraphAnalysis["centralNodes"];
  relation_patterns?: GraphAnalysis["relationPatterns"];
  relation_clusters?: GraphAnalysis["relationClusters"];
  graph_stats?: {
    total_relations: number;
    unique_relation_types: number;
    connected_entities: number;
  };
  living_surface?: {
    pending_proposals: number;
    orphan_count: number;
    novelty_distribution: { high: number; medium: number; low: number };
    strongest_co_surface: StrongestCoSurface[];
    bond_warmth?: BondWarmth[];
    identity_hunt_proposed?: number;
    stale_threads?: StaleThreadSnapshot;
    compass_exercise?: CompassExerciseSnapshot;
    risen_from_the_deep?: RisenMemory[];
    weather_front?: { kind: "heavy" | "bright"; days: number; avg_valence: number } | null;
    modulation?: AffectModulation;
    unacked_startles?: number;
    /**
     * Drive gauge (DRIVE-LAYER-SPEC §1.3). Absent when the pass didn't run
     * (schema not migrated / failed); `{ drives: [], note: 'no drives walked
     * in yet' }` when migrated but unseeded — honest, not absent.
     */
    drives?: DrivesGauge;
  };
}

export async function getSubconsciousState(env: Env): Promise<SubconsciousState | null> {
  try {
    const result = await env.DB.prepare(
      "SELECT data, updated_at FROM subconscious WHERE state_type = 'daemon' ORDER BY updated_at DESC LIMIT 1"
    ).first();
    if (result?.data) {
      return JSON.parse(result.data as string) as SubconsciousState;
    }
  } catch {
    // Subconscious not available
  }
  return null;
}

/**
 * Record co-surfacing pairs — when multiple observations surface together,
 * we strengthen the implicit link between them. Daemon uses this signal to
 * propose new relations.
 */
export async function recordCoSurfacing(env: Env, obsIds: number[]): Promise<void> {
  if (obsIds.length < 2) return;

  let failedPairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < obsIds.length; i++) {
    for (let j = i + 1; j < obsIds.length; j++) {
      const [smaller, larger] = obsIds[i] < obsIds[j]
        ? [obsIds[i], obsIds[j]]
        : [obsIds[j], obsIds[i]];
      totalPairs++;

      try {
        await env.DB.prepare(`
          INSERT INTO co_surfacing (obs_a_id, obs_b_id, co_count, last_co_surfaced)
          VALUES (?, ?, 1, datetime('now'))
          ON CONFLICT(obs_a_id, obs_b_id) DO UPDATE SET
            co_count = co_count + 1,
            last_co_surfaced = datetime('now')
        `).bind(smaller, larger).run();
      } catch (e) {
        // Sole input to relation proposals + consolidation clustering —
        // a silent failure here starves both. Log loudly, keep the tick alive.
        failedPairs++;
        console.error(`recordCoSurfacing: upsert failed for pair (${smaller}, ${larger}): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (failedPairs > 0) {
    console.error(`recordCoSurfacing: ${failedPairs}/${totalPairs} co-surfacing upserts failed this batch`);
  }
}

/**
 * Update surface tracking — marks when things surface, decays novelty.
 * Critical: uses `GREATEST` (Postgres) not `MAX(a,b)` (SQLite). See C1 fix
 * notes in MIND_RESHAPE_PLAN.md — this was silently broken for 50 days.
 */
export async function updateSurfaceTracking(env: Env, obsIds: number[], imgIds: number[] = []): Promise<void> {
  if (obsIds.length > 0) {
    const obsPlaceholders = obsIds.map(() => "?").join(",");
    try {
      const result = await env.DB.prepare(`
        UPDATE observations
        SET last_surfaced_at = datetime('now'),
            surface_count = COALESCE(surface_count, 0) + 1,
            novelty_score = GREATEST(
              CASE weight WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy} WHEN 'medium' THEN ${NOVELTY_FLOORS.medium} ELSE ${NOVELTY_FLOORS.light} END,
              COALESCE(novelty_score, 1.0) - 0.1
            )
        WHERE id IN (${obsPlaceholders})
      `).bind(...obsIds).run();
      // .success is hardcoded true in the adapter — .meta.changes is the truth.
      if (result.meta.changes !== obsIds.length) {
        console.error(`updateSurfaceTracking: observations update touched ${result.meta.changes}/${obsIds.length} rows (ids: ${obsIds.join(",")})`);
      }
    } catch (e) {
      // This exact UPDATE was silently broken for 50 days once (GREATEST vs
      // MAX). The mind must never go static silently — log loudly, don't
      // kill the tick.
      console.error(`updateSurfaceTracking: observations update failed (${obsIds.length} ids): ${e instanceof Error ? e.message : e}`);
    }
  }

  if (imgIds.length > 0) {
    const imgPlaceholders = imgIds.map(() => "?").join(",");
    try {
      const result = await env.DB.prepare(`
        UPDATE images
        SET last_surfaced_at = datetime('now'),
            surface_count = COALESCE(surface_count, 0) + 1,
            novelty_score = GREATEST(
              CASE weight WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy} WHEN 'medium' THEN ${NOVELTY_FLOORS.medium} ELSE ${NOVELTY_FLOORS.light} END,
              COALESCE(novelty_score, 1.0) - 0.1
            )
        WHERE id IN (${imgPlaceholders})
      `).bind(...imgIds).run();
      if (result.meta.changes !== imgIds.length) {
        console.error(`updateSurfaceTracking: images update touched ${result.meta.changes}/${imgIds.length} rows (ids: ${imgIds.join(",")})`);
      }
    } catch (e) {
      console.error(`updateSurfaceTracking: images update failed (${imgIds.length} ids): ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Record access tracking — separate from surfacing. Surfaces are autonomous
 * rotation; accesses are intentional reads via search/timeline/read_entity.
 */
export async function recordAccessTracking(env: Env, obsIds: number[], imgIds: number[] = []): Promise<void> {
  if (obsIds.length > 0) {
    const placeholders = obsIds.map(() => "?").join(",");
    try {
      await env.DB.prepare(`
        UPDATE observations
        SET access_count = COALESCE(access_count, 0) + 1,
            last_accessed_at = NOW()
        WHERE id IN (${placeholders})
      `).bind(...obsIds).run();
    } catch (e) {
      // Feeds the forgetting engine — silent failure here means memories
      // decay as "unaccessed" while being read daily. Log loudly.
      console.error(`recordAccessTracking: observations update failed (${obsIds.length} ids): ${e instanceof Error ? e.message : e}`);
    }
  }
  if (imgIds.length > 0) {
    const placeholders = imgIds.map(() => "?").join(",");
    try {
      await env.DB.prepare(`
        UPDATE images
        SET access_count = COALESCE(access_count, 0) + 1,
            last_accessed_at = NOW()
        WHERE id IN (${placeholders})
      `).bind(...imgIds).run();
    } catch (e) {
      console.error(`recordAccessTracking: images update failed (${imgIds.length} ids): ${e instanceof Error ? e.message : e}`);
    }
  }
}
