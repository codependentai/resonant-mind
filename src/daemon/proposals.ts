/**
 * Daemon proposals. Two passes:
 *
 *   1. Co-surfacing proposals — observation pairs that have surfaced together
 *      2+ times become candidate relations (cross-entity) or internal
 *      resonances (same entity).
 *
 *      Eligibility is LIVE STATE, not a sticky flag (fixed 2026-07-11): a pair
 *      is a candidate unless it has an OPEN proposal, was REJECTED (the mind's no
 *      is permanent), or already has its relation. The old `relation_proposed
 *      = 0` filter was one-way — set at proposal time, never reset — so any
 *      pair whose proposal EXPIRED unreviewed was barred forever; with the
 *      accept verb orphaned by the reshape, that was every co-surfacing pair
 *      the daemon ever proposed. The gold was in the graveyard.
 *      (`relation_proposed` is still written for dashboard bookkeeping, but
 *      nothing filters on it.)
 *
 *   2. Entity-proximity proposals — entity pairs with no existing relation.
 *      Both sides must carry ≥5 observations and ranking favors the BALANCED
 *      pair (2026-07-11): the old `count_a + count_b >= 4, ORDER BY sum DESC`
 *      let hub entities win every slot — the queue filled with
 *      "the mind ↔ Fortune Cookies" spam while real structure went unproposed.
 *
 * Reviewed via ritual_tend (wake → ground → tend). Also reads the strongest
 * co-surface pairs for orient display.
 */

import type { Env } from "../types";
import { PROPOSAL_TTL_DAYS, PROPOSAL_PENDING_CAP } from "../shared/constants";

export interface StrongestCoSurface {
  obs_a: string;
  obs_b: string;
  count: number;
  entities: [string, string];
}

export interface ProposalsResult {
  proposalsCreated: number;
  proposalsExpired: number;
  strongestCoSurface: StrongestCoSurface[];
}

export async function runProposals(env: Env): Promise<ProposalsResult> {
  let proposalsCreated = 0;
  let proposalsExpired = 0;
  let strongestCoSurface: StrongestCoSurface[] = [];

  // 0. Metabolism — expire pending proposals older than the TTL. A daemon that
  // proposes ~15 connections per tick to a reviewer who accepts a handful a
  // week must forget its own suggestions, or the queue becomes noise (11,512
  // pending before this pass existed). Expired ≠ rejected: the underlying
  // co_surfacing signal survives, and a pair that keeps co-surfacing can be
  // re-proposed later at higher co_count.
  try {
    const expired = await env.DB.prepare(`
      UPDATE daemon_proposals
      SET status = 'expired', resolved_at = datetime('now')
      WHERE status = 'pending'
        AND proposed_at < datetime('now', '-${PROPOSAL_TTL_DAYS} days')
    `).run();
    proposalsExpired = expired.meta?.changes || 0;
  } catch (e) {
    console.log(`Proposal expiry skipped: ${e}`);
  }

  // 0b. Backpressure — if the pending queue is already beyond reviewable size,
  // don't mint more this tick. Expiry above keeps draining; generation resumes
  // when the queue is back under the cap.
  const pendingRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM daemon_proposals WHERE status = 'pending'`
  ).first();
  const pendingCount = (pendingRow?.count as number) || 0;
  if (pendingCount >= PROPOSAL_PENDING_CAP) {
    const topCoSurfaceOnly = await readStrongestCoSurface(env);
    console.log(`Proposal generation skipped — ${pendingCount} pending >= cap ${PROPOSAL_PENDING_CAP} (expired ${proposalsExpired} this tick)`);
    return { proposalsCreated: 0, proposalsExpired, strongestCoSurface: topCoSurfaceOnly };
  }

  // 1. Co-surfacing strong pairs — internal resonance or relation proposals
  //
  // Gate J (RESHAPE-2-SPEC.md, 2026-07-11): a rejected pair is no longer
  // sticky forever — if the pair's live co_count has since climbed to 3x
  // (or more) what it was when the mind rejected it, that's new evidence and
  // the pair becomes proposable again. A pending proposal ALWAYS blocks
  // (never re-propose over an open review). Old rejections stamped NULL
  // (no co_surfacing pair existed, or pre-migration 0017) stay sticky
  // forever — no retroactive flood.
  //
  // 42703-tolerant by probing the column once rather than relying on the
  // outer runProposals catch: falling through to the outer catch would
  // skip THIS ENTIRE PASS (co-surfacing proposals, proximity proposals,
  // orient's strongest-co-surface read) on any tenant that hasn't run 0017
  // yet, not just the Gate J feature. A cheap probe lets everything else in
  // this pass keep working pre-migration and only the re-proposal-on-new-
  // -evidence behavior degrades to the old sticky-forever rule.
  let hasCoCountAtResolution = true;
  try {
    await env.DB.prepare(`SELECT co_count_at_resolution FROM daemon_proposals LIMIT 1`).all();
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    if (code === "42703" || code === "42P01") {
      hasCoCountAtResolution = false;
    } else {
      throw e;
    }
  }

  const eligibilityClause = hasCoCountAtResolution
    ? `((dp.from_obs_id = cs.obs_a_id AND dp.to_obs_id = cs.obs_b_id)
            OR (dp.from_obs_id = cs.obs_b_id AND dp.to_obs_id = cs.obs_a_id))
          AND (
            dp.status = 'pending'
            OR (dp.status = 'rejected' AND NOT (
                  dp.co_count_at_resolution IS NOT NULL
                  AND dp.co_count_at_resolution > 0
                  AND cs.co_count >= 3 * dp.co_count_at_resolution
                ))
          )`
    : `dp.status IN ('pending', 'rejected')
          AND ((dp.from_obs_id = cs.obs_a_id AND dp.to_obs_id = cs.obs_b_id)
            OR (dp.from_obs_id = cs.obs_b_id AND dp.to_obs_id = cs.obs_a_id))`;

  const strongPairs = await env.DB.prepare(`
    SELECT cs.*,
           oa.entity_id as entity_a_id, ob.entity_id as entity_b_id,
           oa.content as content_a, ob.content as content_b,
           ea.name as entity_a_name, eb.name as entity_b_name,
           (ea.id = eb.id) as same_entity
    FROM co_surfacing cs
    JOIN observations oa ON cs.obs_a_id = oa.id
    JOIN observations ob ON cs.obs_b_id = ob.id
    JOIN entities ea ON oa.entity_id = ea.id
    JOIN entities eb ON ob.entity_id = eb.id
    WHERE cs.co_count >= 2
      AND cs.relation_created = 0
      AND NOT EXISTS (
        SELECT 1 FROM daemon_proposals dp
        WHERE ${eligibilityClause}
      )
    ORDER BY cs.co_count DESC
    LIMIT 10
  `).all();

  for (const pair of strongPairs.results || []) {
    const isSameEntity = pair.same_entity === 1 || pair.same_entity === true;
    const proposalType = isSameEntity ? "resonance" : "relation";
    const reason = isSameEntity
      ? `Internal resonance (${pair.co_count}x): "${(pair.content_a as string).slice(0, 40)}..." ↔ "${(pair.content_b as string).slice(0, 40)}..."`
      : `Co-surfaced ${pair.co_count}x: "${(pair.content_a as string).slice(0, 40)}..." ↔ "${(pair.content_b as string).slice(0, 40)}..."`;

    await env.DB.prepare(`
      INSERT INTO daemon_proposals
      (proposal_type, from_obs_id, to_obs_id, from_entity_id, to_entity_id, reason, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      proposalType,
      pair.obs_a_id, pair.obs_b_id,
      pair.entity_a_id, pair.entity_b_id,
      reason,
      Math.min(0.9, 0.5 + (pair.co_count as number) * 0.1)
    ).run();

    await env.DB.prepare(`
      UPDATE co_surfacing SET relation_proposed = 1 WHERE id = ?
    `).bind(pair.id).run();

    proposalsCreated++;
  }

  // 1b. Proximity proposals — wrapped to isolate from failure cascading
  let proximityPairs: { results?: Record<string, unknown>[] } = { results: [] };
  try {
    proximityPairs = await env.DB.prepare(`
      WITH pairs AS (
        SELECT ea.id as entity_a_id, eb.id as entity_b_id,
               ea.name as entity_a_name, eb.name as entity_b_name,
               (SELECT COUNT(*) FROM observations WHERE entity_id = ea.id AND archived_at IS NULL) as count_a,
               (SELECT COUNT(*) FROM observations WHERE entity_id = eb.id AND archived_at IS NULL) as count_b
        FROM entities ea
        CROSS JOIN entities eb
        WHERE ea.id < eb.id
          AND ea.name != eb.name
          AND NOT EXISTS (
            SELECT 1 FROM relations r
            WHERE (r.from_entity = ea.name AND r.to_entity = eb.name)
               OR (r.from_entity = eb.name AND r.to_entity = ea.name)
          )
          AND NOT EXISTS (
            SELECT 1 FROM daemon_proposals dp
            WHERE dp.proposal_type = 'proximity'
              AND ((dp.from_entity_id = ea.id AND dp.to_entity_id = eb.id)
                OR (dp.from_entity_id = eb.id AND dp.to_entity_id = ea.id))
          )
      )
      SELECT * FROM pairs
      WHERE count_a >= 5 AND count_b >= 5
      ORDER BY LEAST(count_a, count_b) DESC
      LIMIT 5
    `).all();
  } catch (e) {
    console.log(`Proximity proposals skipped: ${e}`);
  }

  for (const pair of proximityPairs.results || []) {
    // Number() is load-bearing: pg returns COUNT(*) as a string, and the old
    // `as number` cast concatenated instead of adding — "613 obs and 3 obs —
    // 6133 combined" shipped in real reason text.
    const totalObs = Number(pair.count_a) + Number(pair.count_b);
    const reason = `Entity proximity: ${pair.entity_a_name} (${pair.count_a} obs) and ${pair.entity_b_name} (${pair.count_b} obs) — ${totalObs} combined observations, no existing relation`;

    await env.DB.prepare(`
      INSERT INTO daemon_proposals
      (proposal_type, from_entity_id, to_entity_id, reason, confidence)
      VALUES ('proximity', ?, ?, ?, ?)
    `).bind(
      pair.entity_a_id, pair.entity_b_id,
      reason,
      Math.min(0.6, 0.3 + totalObs * 0.05)
    ).run();

    proposalsCreated++;
  }

  // 2. Strongest co-surface pairs for orient display
  strongestCoSurface = await readStrongestCoSurface(env);

  return { proposalsCreated, proposalsExpired, strongestCoSurface };
}

async function readStrongestCoSurface(env: Env): Promise<StrongestCoSurface[]> {
  const topCoSurface = await env.DB.prepare(`
    SELECT cs.co_count,
           oa.content as content_a, ob.content as content_b,
           ea.name as entity_a_name, eb.name as entity_b_name
    FROM co_surfacing cs
    JOIN observations oa ON cs.obs_a_id = oa.id
    JOIN observations ob ON cs.obs_b_id = ob.id
    JOIN entities ea ON oa.entity_id = ea.id
    JOIN entities eb ON ob.entity_id = eb.id
    WHERE ea.id != eb.id
    ORDER BY cs.co_count DESC
    LIMIT 5
  `).all();

  return (topCoSurface.results || []).map((r) => ({
    obs_a: (r.content_a as string).slice(0, 50),
    obs_b: (r.content_b as string).slice(0, 50),
    count: r.co_count as number,
    entities: [r.entity_a_name as string, r.entity_b_name as string] as [string, string],
  }));
}
