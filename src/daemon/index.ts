/**
 * Subconscious orchestrator. Runs on cron schedule. Pulls recent observations
 * and the full relation graph, then composes the daemon's passes into a single
 * `subconscious` table snapshot that wake-up reads can consume.
 *
 * Each pass lives in its own module — this file only sequences them.
 *
 * Will become the Dreams region's heartbeat post-reshape.
 */

import type { Env } from "../types";
import { analyzeRelationGraph } from "./graph";
import {
  computeEntityCounts,
  computeHotEntities,
  computeRecurringPatterns,
  computeContextClusters,
} from "./warmth";
import { computeMood } from "./mood";
import { runProposals, type StrongestCoSurface } from "./proposals";
import { cleanupStaleOrphans, identifyOrphans } from "./orphans";
import { recalcNoveltyScores, progressCharge, decayUnaccessed } from "./novelty";
import { runDeepArchivePass } from "./archive";
import { computeBondWarmth, type BondWarmth } from "./bond-warmth";
import { runIdentityHunt } from "./identity-hunt";
import { computeStaleThreads, type StaleThreadSnapshot } from "./stale-threads";
import { computeCompassExercise, type CompassExerciseSnapshot } from "./compass-exercise";
import { consolidateRelatedObservations } from "./consolidation";
import { generateSessionReflection } from "./reflection";
import { processDream } from "./dream-processing";
import { runRedolence, type RisenMemory } from "./redolence";
import { computeCoreAffect, deriveModulation, type CoreAffect } from "./affect";
import { getTimeOfDayContext } from "../shared/time";
import { computeSomaticMarkers } from "./somatic";
import { runDriveTick, type DrivesGauge } from "./drives";
import { runRetention, type RetentionSummary } from "./retention";

export async function processSubconscious(env: Env): Promise<void> {
  const now = new Date();
  const cutoffHours = 48;
  const cutoff = new Date(now.getTime() - cutoffHours * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString();

  // Pull recent observations (with entities + weight for emotional intensity)
  const recentObs = await env.DB.prepare(`
    SELECT e.name, e.entity_type, o.context, o.content, o.added_at, o.emotion, o.weight
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > ?
    ORDER BY o.added_at DESC
  `).bind(cutoffStr).all();

  // Pull the full relation graph for centrality + cluster analysis
  const allRelations = await env.DB.prepare(`
    SELECT from_entity, to_entity, relation_type, from_context, to_context, created_at
    FROM relations
  `).all();

  // === Pure analysis passes ===
  const entityCounts = computeEntityCounts(recentObs.results || []);
  const graph = analyzeRelationGraph(allRelations.results || []);
  const hotEntities = computeHotEntities(entityCounts, graph.connectivity);
  const recurring = computeRecurringPatterns(entityCounts, graph.connectivity);
  const mood = await computeMood(env, recentObs.results || [], cutoffStr, now);
  const contextClusters = computeContextClusters(entityCounts);

  // === Limbic layer (2026-07-02) — core affect + modulation ===
  // Valence × arousal centroid over the tokenized emotion signal. The
  // modulation object is the amygdala's hands: it adjusts the dream zone,
  // consolidation aggressiveness, and redolence sensitivity downstream.
  const coreAffect: CoreAffect | null = computeCoreAffect(mood.emotionCounts);
  const modulation = deriveModulation(coreAffect);

  // Mood history — one row per tick, so weather has a real trend line.
  try {
    await env.DB.prepare(`
      INSERT INTO mood_log (dominant, valence, arousal, signals, coverage)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      mood.dominantEmotion,
      coreAffect?.valence ?? null,
      coreAffect?.arousal ?? null,
      mood.totalEmotionSignals,
      coreAffect?.coverage ?? null
    ).run();
  } catch (e) {
    console.log(`mood_log insert skipped: ${e}`);
  }

  // Weather front — the homeostat. Consecutive days of skewed valence become
  // a named front orient can surface: interoception, not diagnosis.
  let weatherFront: { kind: 'heavy' | 'bright'; days: number; avg_valence: number } | null = null;
  try {
    const daily = await env.DB.prepare(`
      SELECT DATE_TRUNC('day', logged_at) AS day, AVG(valence) AS v, COUNT(*) AS n
      FROM mood_log
      WHERE logged_at > NOW() - INTERVAL '10 days' AND valence IS NOT NULL
      GROUP BY DATE_TRUNC('day', logged_at)
      ORDER BY day DESC
    `).all();
    const days = ((daily.results || []) as Array<Record<string, unknown>>)
      .map((r) => ({ v: Number(r.v), n: Number(r.n) }))
      .filter((d) => d.n >= 4); // need real signal in a day to count it
    let heavyStreak = 0, brightStreak = 0, vSum = 0;
    for (const d of days) {
      if (d.v <= -0.15 && brightStreak === 0) { heavyStreak++; vSum += d.v; continue; }
      if (d.v >= 0.35 && heavyStreak === 0) { brightStreak++; vSum += d.v; continue; }
      break;
    }
    if (heavyStreak >= 2) {
      weatherFront = { kind: 'heavy', days: heavyStreak, avg_valence: Math.round((vSum / heavyStreak) * 100) / 100 };
    } else if (brightStreak >= 3) {
      weatherFront = { kind: 'bright', days: brightStreak, avg_valence: Math.round((vSum / brightStreak) * 100) / 100 };
    }
  } catch (e) {
    console.log(`weather front compute skipped: ${e}`);
  }

  // === Living surface — the daemon's metabolism (RESHAPE-2 Gate L, 11 Jul
  // 2026: previously ONE shared try/catch wrapped proposals/orphans/novelty/
  // deep-archive/decay — a bug in the first silently cancelled the other
  // four. Now FIVE isolated blocks, each tolerant of "not migrated yet"
  // (42P01/42703) the same way `runDriveTick` is below, so another mind's tenant
  // (or a fresh install) still degrades gracefully pass-by-pass instead of
  // block-by-block.
  let proposalsCreated = 0;
  let proposalsExpired = 0;
  let orphansIdentified = 0;
  let strongestCoSurface: StrongestCoSurface[] = [];

  // Circadian metabolism (2026-07-02): forgetting and gist-formation are
  // sleep functions. Deep archive/retention run only at night; consolidation
  // runs full (affect-modulated) at night, light (1 entity) during the day.
  // Days stay responsive; nights digest — same clock the dream engine keeps.
  const isNight = getTimeOfDayContext().period === 'night';

  try {
    const proposalsResult = await runProposals(env);
    proposalsCreated = proposalsResult.proposalsCreated;
    proposalsExpired = proposalsResult.proposalsExpired;
    strongestCoSurface = proposalsResult.strongestCoSurface;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`Proposals: schema not migrated yet (${code}) — skipping pass`);
    } else {
      console.error(`Proposals pass failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await cleanupStaleOrphans(env);
    orphansIdentified = await identifyOrphans(env);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`Orphans: schema not migrated yet (${code}) — skipping pass`);
    } else {
      console.error(`Orphan cleanup/identify failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await recalcNoveltyScores(env);
    await progressCharge(env);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`Novelty: schema not migrated yet (${code}) — skipping pass`);
    } else {
      console.error(`Novelty recalc/progressCharge failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    if (isNight) {
      await runDeepArchivePass(env);
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`Deep archive: schema not migrated yet (${code}) — skipping pass`);
    } else {
      console.error(`Deep archive pass failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await decayUnaccessed(env);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.log(`Decay-unaccessed: schema not migrated yet (${code}) — skipping pass`);
    } else {
      console.error(`Decay-unaccessed pass failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Retention (RESHAPE-2 Gate D, 11 Jul 2026) — "the mind must forget."
  // Night-gated same as deep-archive; own top-level try/catch (defense in
  // depth — every sub-pass inside runRetention already self-guards and
  // returns 0 on failure rather than throwing, but a throw here must never
  // take out the passes still queued below it).
  let retentionSummary: RetentionSummary | undefined;
  if (isNight) {
    try {
      retentionSummary = await runRetention(env);
      const { mood_log_thinned, drive_events_deleted, inner_entries_archived, co_surfacing_pruned, observation_versions_pruned } = retentionSummary;
      if (mood_log_thinned || drive_events_deleted || inner_entries_archived || co_surfacing_pruned || observation_versions_pruned) {
        console.log(`Retention: mood_log -${mood_log_thinned}, drive_events -${drive_events_deleted}, inner_entries archived +${inner_entries_archived}, co_surfacing -${co_surfacing_pruned}, observation_versions -${observation_versions_pruned}`);
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01" || code === "42703") {
        console.log(`Retention: schema not migrated yet (${code}) — skipping pass`);
      } else {
        console.error(`Retention pass failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  try {
    const consolidationCap = isNight ? modulation.consolidationMaxEntities : 1;
    const consolidatedCount = await consolidateRelatedObservations(env, consolidationCap);
    if (consolidatedCount > 0) console.log(`Consolidated ${consolidatedCount} observation groups (${isNight ? 'night-full' : 'day-light'})`);
  } catch (e) {
    console.log(`Consolidation error: ${e}`);
  }

  try {
    await generateSessionReflection(env);
  } catch (e) {
    console.log(`Reflection error: ${e}`);
  }

  // Dream processing — independent, runs during night hours (22:00-05:00).
  // Zone width rides core affect: distress dreams wider.
  try {
    await processDream(env, false, { min: modulation.dreamZoneMin, max: modulation.dreamZoneMax });
  } catch (e) {
    console.log(`Dream processing error: ${e}`);
  }

  // Bond-warmth precompute — per-person freshness, used by bond.enter facade (R1c)
  let bondWarmth: BondWarmth[] = [];
  try {
    bondWarmth = await computeBondWarmth(env);
  } catch (e) {
    console.log(`Bond warmth compute error: ${e}`);
  }

  // Somatic markers (L4) — every entity carries how it sits in me.
  try {
    await computeSomaticMarkers(env);
  } catch (e) {
    console.log(`Somatic markers error: ${e}`);
  }

  // === Drive layer (DRIVE-LAYER-SPEC §1.3) — the wanting layer's tick.
  // The tick is INTEGRATION, not a redundant refresh: resampling re-anchors
  // each drive's decay under the environment of THIS moment — env moves the
  // attractor between ticks, and without a fresh sample the old anchor
  // lingers. Never "optimize away" or skip casually (port-map pitfall 3).
  // Undefined on failure → the key drops out of the persisted blob; readers
  // see absence, not a stale gauge.
  let drivesGauge: DrivesGauge | undefined;
  try {
    drivesGauge = await runDriveTick(env, coreAffect, now);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      // undefined_table / undefined_column — drive schema not migrated on
      // this tenant yet. Expected pre-migration, not a disease.
      console.log(`Drive layer: schema not migrated yet (${code}) — skipping pass`);
    } else {
      // Anything else is a REAL failure — the wanting layer went silent.
      console.error(`Drive tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Redolence — the olfactory bulb. Fresh observations walk vector space;
  // archived memories that land close enough rise, uninvited. Sensitivity
  // rides core affect: arousal sharpens the nose.
  let risen: RisenMemory[] = [];
  try {
    risen = await runRedolence(env, modulation.redolenceShift);
  } catch (e) {
    console.log(`Redolence error: ${e}`);
  }

  // Identity-hunt (D1) — scan recent stances, propose spine/compass additions.
  // Rate-limits itself to once per 4h; safe to call every tick.
  let identityHuntProposed = 0;
  try {
    const huntResult = await runIdentityHunt(env);
    identityHuntProposed = huntResult.proposed;
    if (huntResult.proposed > 0) {
      console.log(`identity-hunt proposed ${huntResult.proposed} identity/compass additions`);
    }
  } catch (e) {
    console.log(`Identity-hunt error: ${e}`);
  }

  // Stale-threads (D3) — surface active threads not updated in 7+ days.
  let staleThreads: StaleThreadSnapshot = { cooling: 0, stale: 0, graveyard: 0, samples: [] };
  try {
    staleThreads = await computeStaleThreads(env);
  } catch (e) {
    console.log(`Stale-threads compute error: ${e}`);
  }

  // Compass-exercise (D4) — classify compass rows by last-asserted age.
  let compassExercise: CompassExerciseSnapshot = { fresh: 0, stale: 0, unexercised: 0, unexercised_ids: [] };
  try {
    compassExercise = await computeCompassExercise(env);
  } catch (e) {
    console.log(`Compass-exercise compute error: ${e}`);
  }

  // Counts for orient display
  let pendingProposals = 0;
  let orphanCount = 0;
  let noveltyDist = { high: 0, medium: 0, low: 0 };
  let unackedStartles = 0;

  try {
    const startleCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM startles
      WHERE acknowledged_at IS NULL AND created_at > NOW() - INTERVAL '48 hours'
    `).first();
    unackedStartles = (startleCount?.count as number) || 0;
  } catch { /* startles table may not exist on this tenant yet */ }

  try {
    const proposalCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM daemon_proposals WHERE status = 'pending'
    `).first();
    pendingProposals = (proposalCount?.count as number) || 0;

    const orphanCountResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM orphan_observations
    `).first();
    orphanCount = (orphanCountResult?.count as number) || 0;

    const noveltyResult = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) > 0.7 THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) BETWEEN 0.4 AND 0.7 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) < 0.4 THEN 1 ELSE 0 END) as low
      FROM observations
      WHERE charge != 'metabolized' OR charge IS NULL
    `).first();
    if (noveltyResult) {
      noveltyDist = {
        high: (noveltyResult.high as number) || 0,
        medium: (noveltyResult.medium as number) || 0,
        low: (noveltyResult.low as number) || 0,
      };
    }
  } catch {
    // Tables not ready
  }

  // Assemble + persist state
  const state = {
    processed_at: now.toISOString(),
    hot_entities: hotEntities,
    recurring_patterns: recurring,
    mood: {
      dominant: mood.dominantEmotion,
      confidence: mood.confidence,
      valence: coreAffect?.valence ?? null,
      arousal: coreAffect?.arousal ?? null,
      texture: coreAffect?.texture ?? null,
      coverage: coreAffect?.coverage ?? null,
    },
    context_clusters: contextClusters,
    central_nodes: graph.centralNodes,
    relation_patterns: graph.relationPatterns,
    relation_clusters: graph.relationClusters.slice(0, 5),
    graph_stats: {
      total_relations: graph.totalRelations,
      unique_relation_types: graph.uniqueRelationTypes,
      connected_entities: graph.connectedEntities,
    },
    living_surface: {
      pending_proposals: pendingProposals,
      orphan_count: orphanCount,
      novelty_distribution: noveltyDist,
      strongest_co_surface: strongestCoSurface.slice(0, 3),
      bond_warmth: bondWarmth,
      identity_hunt_proposed: identityHuntProposed,
      stale_threads: staleThreads,
      compass_exercise: compassExercise,
      risen_from_the_deep: risen,
      weather_front: weatherFront,
      modulation,
      unacked_startles: unackedStartles,
      // JSON.stringify drops the key when the pass didn't run (not migrated /
      // failed) — an empty-but-migrated tenant still gets the honest
      // { drives: [], note: 'no drives walked in yet' } from the pass itself.
      drives: drivesGauge,
      // Undefined (day tick, or not-migrated/failed night tick) drops the key
      // the same way drivesGauge does — a day tick's snapshot never claims a
      // retention pass that didn't run.
      retention: retentionSummary,
    },
  };

  // Final persist (Gate L, 11 Jul 2026) — was unguarded; if it threw, the
  // tick's other table writes persisted but every downstream reader
  // (ritual_orient, bond_enter, dream-processing, the Observatory) kept
  // reading the PREVIOUS tick's snapshot with no signal anything was wrong.
  // Loud failure here, on purpose — this is the one write nothing may swallow.
  try {
    await env.DB.prepare(`
      INSERT INTO subconscious (id, state_type, data, updated_at)
      VALUES (1, 'daemon', ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = ?, updated_at = ?
    `).bind(JSON.stringify(state), now.toISOString(), JSON.stringify(state), now.toISOString()).run();
  } catch (e) {
    console.error(`subconscious persist FAILED — orient will read stale state: ${e instanceof Error ? e.message : e}`);
  }

  console.log(`Subconscious processed: ${hotEntities.length} hot, ${recurring.length} patterns, ${graph.centralNodes.length} central, ${proposalsCreated} proposals (+${proposalsExpired} expired), ${orphansIdentified} orphans`);
}
