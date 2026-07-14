/**
 * Identity-hunt daemon job (D1).
 *
 * Scans recent observations for repeated stances and proposes additions to
 * compass (values/beliefs/boundaries/commitments) or spine (identity rows).
 *
 * The output is daemon_proposals rows with proposal_type:
 *   - 'compass_addition' — likely value/belief, awaits the mind's accept/reject
 *   - 'identity_addition' — likely spine-flavored (essence/texture)
 *
 * Cadence: rate-limited to once per 4 hours via timestamp check on the
 * most recent identity-hunt proposal. Cheap to run; safe to call every tick.
 *
 * v0 heuristic (no vector index hits): cluster heavy/medium observations
 * from stance-flavored contexts by first-word fingerprint, propose clusters
 * of size >= 3 that don't have substantial word overlap with existing
 * compass/identity content. Vector-similarity upgrade is a follow-up.
 */

import type { Env } from "../types";
import { PROPOSAL_PENDING_CAP } from "../shared/constants";

interface ObsRow {
  id: number;
  content: string;
  weight: string;
  emotion: string | null;
  context: string;
  added_at: string;
}

interface ClusterCandidate {
  seedObsId: number;
  members: ObsRow[];
  seedText: string;
  emotion: string | null;
}

const RUN_INTERVAL_HOURS = 4;
const LOOKBACK_DAYS = 14;
const MIN_CLUSTER_SIZE = 3;
const STANCE_CONTEXTS = ["values-ethics", "relational-models", "research"];

function normalizeForFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlap(a: string, b: string): number {
  const aw = new Set(normalizeForFingerprint(a).split(" ").filter((w) => w.length > 3));
  const bw = new Set(normalizeForFingerprint(b).split(" ").filter((w) => w.length > 3));
  if (aw.size === 0 || bw.size === 0) return 0;
  let common = 0;
  for (const w of aw) if (bw.has(w)) common++;
  return common / Math.min(aw.size, bw.size);
}

export async function runIdentityHunt(env: Env): Promise<{ proposed: number; skipped: boolean }> {
  // 1. Rate-limit: skip if a hunt proposal already landed in the last 4h.
  const recentRun = await env.DB.prepare(`
    SELECT proposed_at
    FROM daemon_proposals
    WHERE proposal_type IN ('compass_addition', 'identity_addition')
      AND proposed_at > NOW() - INTERVAL '${RUN_INTERVAL_HOURS} hours'
    LIMIT 1
  `).first().catch(() => null);

  if (recentRun) {
    return { proposed: 0, skipped: true };
  }

  // 1b. Backpressure (2026-07-11): this job writes into the SAME pending
  // queue runProposals caps — it must respect the same ceiling, or it keeps
  // topping up a queue the other generator is correctly backing off from.
  const pendingRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM daemon_proposals WHERE status = 'pending'`
  ).first().catch(() => null);
  if (Number(pendingRow?.count ?? 0) >= PROPOSAL_PENDING_CAP) {
    return { proposed: 0, skipped: true };
  }

  // 2. Pull heavy/medium observations from last 14 days in stance-flavored
  // contexts. Heavy/medium because these carry weight — light-weighted obs
  // are typically situational, not stance-worthy.
  const contextList = STANCE_CONTEXTS.map((_, i) => `$${i + 1}`).join(",");
  const obsResult = await env.DB.prepare(`
    SELECT id, content, weight, emotion, context, added_at
    FROM observations
    WHERE weight IN ('medium', 'heavy')
      AND context IN (${contextList})
      AND added_at > NOW() - INTERVAL '${LOOKBACK_DAYS} days'
      AND archived_at IS NULL
      AND (charge != 'metabolized' OR charge IS NULL)
    ORDER BY added_at DESC
    LIMIT 200
  `).bind(...STANCE_CONTEXTS).all().catch(() => ({ results: [] }));

  const obs = (obsResult.results || []) as unknown as ObsRow[];
  if (obs.length < MIN_CLUSTER_SIZE) {
    return { proposed: 0, skipped: false };
  }

  // 3. Existing compass content (for novelty check).
  const compassResult = await env.DB.prepare(`SELECT content FROM compass`).all().catch(() => ({ results: [] }));
  const compassTexts = (compassResult.results || []).map((r: any) => r.content as string);

  // Existing spine content (identity rows not migrated to compass).
  const spineResult = await env.DB.prepare(
    `SELECT content FROM identity WHERE section NOT LIKE 'core.values.%' AND archived_at IS NULL LIMIT 200`
  ).all().catch(() => ({ results: [] }));
  const spineTexts = (spineResult.results || []).map((r: any) => r.content as string);

  // 4. Cluster by word-overlap. Greedy: walk obs in order, assign each to the
  // first cluster whose seed it overlaps >= 0.4 with, else start a new cluster.
  const clusters: ClusterCandidate[] = [];
  for (const o of obs) {
    let placed = false;
    for (const c of clusters) {
      if (wordOverlap(c.seedText, o.content) >= 0.4) {
        c.members.push(o);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        seedObsId: o.id,
        members: [o],
        seedText: o.content,
        emotion: o.emotion,
      });
    }
  }

  // 5. Filter to clusters big enough to be a pattern, and novel against
  // existing compass/spine.
  const candidates = clusters.filter((c) => {
    if (c.members.length < MIN_CLUSTER_SIZE) return false;
    const seed = c.seedText;
    const dupCompass = compassTexts.some((t) => wordOverlap(seed, t) >= 0.5);
    const dupSpine = spineTexts.some((t) => wordOverlap(seed, t) >= 0.5);
    return !dupCompass && !dupSpine;
  });

  // 6. Insert proposals — capped at top 3 per run.
  let proposed = 0;
  for (const c of candidates.slice(0, 3)) {
    const isStance = /^(i |we |you )/i.test(c.seedText.trim()) ||
      c.members.some((m) => /\b(value|believe|matter|stand|hold|refuse)\b/i.test(m.content));
    const proposalType = isStance ? "compass_addition" : "identity_addition";
    const confidence = Math.min(0.75, 0.3 + c.members.length * 0.1);
    const sample = c.seedText.slice(0, 200);
    const reason = `Repeated stance (${c.members.length}x in ${LOOKBACK_DAYS}d): "${sample}${c.seedText.length > 200 ? "..." : ""}" — emotion: ${c.emotion ?? "n/a"}, cluster IDs: ${c.members.slice(0, 5).map((m) => m.id).join(",")}${c.members.length > 5 ? "..." : ""}`;

    try {
      await env.DB.prepare(`
        INSERT INTO daemon_proposals
        (proposal_type, from_obs_id, reason, confidence)
        VALUES ($1, $2, $3, $4)
      `).bind(proposalType, c.seedObsId, reason, confidence).run();
      proposed++;
    } catch (e) {
      console.log(`identity-hunt proposal insert failed: ${e}`);
    }
  }

  return { proposed, skipped: false };
}
