/**
 * LLM-driven consolidation. Finds entities with many active observations,
 * uses co-surfacing data to detect clusters within them, then asks Gemini
 * to summarize each cluster into one consolidated observation. Originals get
 * archived; the summary gets embedded back into Vectorize.
 *
 * Wired in via daemon orchestrator as one of the slow passes.
 */

import type { Env } from "../types";
import { CONSOLIDATION_MIN_OBS, CONSOLIDATION_MAX_ENTITIES_PER_RUN } from "../shared/constants";
import { generateText as geminiGenerateText } from "../embeddings";
import { getEmbedding } from "../shared/mind-helpers";

export async function consolidateRelatedObservations(
  env: Env,
  // Affect-modulated (2026-07-02): calm-positive metabolizes fuller (3),
  // distressed eases off (1), neutral runs at 2. Never zero — consolidation
  // is gist-formation, not forgetting.
  maxEntities: number = CONSOLIDATION_MAX_ENTITIES_PER_RUN
): Promise<number> {
  // Find entities with many active observations — candidates for consolidation
  const candidates = await env.DB.prepare(`
    SELECT e.id, e.name, COUNT(*) as obs_count
    FROM entities e
    JOIN observations o ON e.id = o.entity_id
    WHERE o.archived_at IS NULL
      AND o.valid_until IS NULL
      AND o.superseded_by IS NULL
      AND (o.charge != 'metabolized' OR o.charge IS NULL)
    GROUP BY e.id, e.name
    HAVING COUNT(*) >= ${CONSOLIDATION_MIN_OBS}
    ORDER BY COUNT(*) DESC
    LIMIT ${Math.max(1, Math.floor(maxEntities))}
  `).all();

  let consolidated = 0;

  for (const candidate of candidates.results || []) {
    // Find co-surfacing clusters within this entity
    const obsRows = await env.DB.prepare(`
      SELECT id, content, weight, emotion FROM observations
      WHERE entity_id = ? AND archived_at IS NULL AND valid_until IS NULL AND superseded_by IS NULL
      ORDER BY added_at DESC
    `).bind(candidate.id).all();

    const obsMap = new Map<number, any>();
    for (const o of obsRows.results || []) {
      obsMap.set(o.id as number, o);
    }

    // Use co-surfacing data to find clusters
    const entityObsIds = new Set((obsRows.results || []).map((o: any) => o.id as number));
    const coSurfPairs = await env.DB.prepare(`
      SELECT obs_a_id, obs_b_id, co_count FROM co_surfacing
      WHERE co_count >= 2
    `).all();

    // Build adjacency list for observations in this entity
    const adj = new Map<number, Set<number>>();
    for (const pair of coSurfPairs.results || []) {
      const a = pair.obs_a_id as number;
      const b = pair.obs_b_id as number;
      if (!entityObsIds.has(a) || !entityObsIds.has(b)) continue;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }

    // BFS to find connected components of size 3+
    const visited = new Set<number>();
    const clusters: number[][] = [];
    for (const nodeId of adj.keys()) {
      if (visited.has(nodeId)) continue;
      const cluster: number[] = [];
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        for (const neighbor of adj.get(current) || []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (cluster.length >= 3) clusters.push(cluster);
    }

    // Consolidate each cluster via LLM
    for (const cluster of clusters.slice(0, 2)) { // max 2 clusters per entity per run
      const obsTexts = cluster
        .map(id => obsMap.get(id))
        .filter(Boolean)
        .map((o: any) => o.content as string);

      if (obsTexts.length < 3) continue;

      const prompt = `You are consolidating related memories about "${candidate.name}". Summarize these ${obsTexts.length} observations into ONE concise observation (1-2 sentences) that captures the essential meaning. Preserve emotional significance.\n\n${obsTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n\nConsolidated observation:`;

      try {
        const summary = await geminiGenerateText(env.GEMINI_API_KEY, prompt);
        if (!summary || summary.length < 10) continue;

        // Find the heaviest weight among originals
        const weights = cluster.map(id => obsMap.get(id)?.weight || 'medium');
        const maxWeight = weights.includes('heavy') ? 'heavy' : weights.includes('medium') ? 'medium' : 'light';

        // Embed BEFORE any DB write — an embedding failure aborts the cluster
        // with zero writes instead of stranding a half-consolidated state.
        const embedding = await getEmbedding(env, `${candidate.name}: ${summary.trim()}`);

        // --- Archive-first, no transactions available (adapter is autocommit,
        // one client per statement). Ordering chosen to fail SAFE: worst case
        // is originals restored/active with no summary — never both active.
        // `.success` is hardcoded true in the adapter; trust throws and
        // `.meta.changes` only.

        // Archive the originals, counting rows we actually flipped.
        // `archived_at IS NULL` guard makes `.meta.changes` honest: 0 means
        // the row vanished or was archived by someone else, not double-count.
        const archivedIds: number[] = [];
        try {
          for (const origId of cluster) {
            const upd = await env.DB.prepare(`
              UPDATE observations SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL
            `).bind(origId).run();
            if (upd.meta.changes === 1) archivedIds.push(origId);
          }
        } catch (e) {
          console.error(`Consolidation archive pass failed for "${candidate.name}" cluster [${cluster.join(',')}] after archiving [${archivedIds.join(',')}]: ${e}`);
        }

        // Reconcile: every cluster member must have been archived by US.
        // On mismatch, restore what we archived and skip — no summary written.
        if (archivedIds.length !== cluster.length) {
          console.error(`Consolidation reconciliation: entity "${candidate.name}" (id ${candidate.id}) cluster [${cluster.join(',')}] expected ${cluster.length} archived, got ${archivedIds.length} [${archivedIds.join(',')}] — restoring and skipping`);
          await unarchive(env, archivedIds, candidate.name as string);
          continue;
        }

        // Insert summary + provenance. Any failure here rolls the archive back:
        // a consolidation without provenance is memory loss, so we never leave
        // originals archived unless both rows landed.
        let newObsId: number | undefined;
        try {
          const result = await env.DB.prepare(`
            INSERT INTO observations (entity_id, content, salience, weight, certainty, source, context, valid_from)
            VALUES (?, ?, 'active', ?, 'believed', 'consolidated', 'default', NOW())
          `).bind(candidate.id, summary.trim(), maxWeight).run();

          newObsId = result.meta.last_row_id;

          // Record the consolidation group.
          // source_observation_ids is a Postgres int[] — pass the JS array directly so pg marshals it.
          // Was previously JSON.stringify(cluster), which Postgres rejected silently.
          await env.DB.prepare(`
            INSERT INTO consolidation_groups (summary, entity_id, source_observation_ids, consolidated_observation_id)
            VALUES (?, ?, ?, ?)
          `).bind(summary.trim(), candidate.id, cluster, newObsId).run();
        } catch (e) {
          console.error(`Consolidation summary/provenance write failed for "${candidate.name}" cluster [${cluster.join(',')}]: ${e} — rolling back`);
          if (newObsId) {
            try {
              await env.DB.prepare(`DELETE FROM observations WHERE id = ?`).bind(newObsId).run();
            } catch (delErr) {
              console.error(`Consolidation rollback: failed to delete orphan summary obs ${newObsId} for "${candidate.name}" — manual cleanup needed: ${delErr}`);
            }
          }
          await unarchive(env, archivedIds, candidate.name as string);
          continue;
        }

        // Vectorize last. A failure here leaves a consolidated-but-unembedded
        // summary (still in Postgres, invisible to vector search) — log loudly,
        // don't unwind a completed consolidation over it.
        try {
          await env.VECTORS.upsert([{
            id: `obs-${candidate.id}-${newObsId}`,
            values: embedding,
            metadata: {
              source: "observation", entity: candidate.name as string, content: summary.trim(),
              context: "default", weight: maxWeight, observation_source: "consolidated",
              added_at: new Date().toISOString()
            }
          }]);
        } catch (e) {
          console.error(`Consolidation vector upsert failed for obs ${newObsId} ("${candidate.name}") — summary is unembedded, needs re-embed: ${e}`);
        }

        consolidated++;
      } catch (e) {
        console.log(`Consolidation LLM error for ${candidate.name}: ${e}`);
      }
    }
  }

  return consolidated;
}

/**
 * Best-effort restore of originals we archived during a failed consolidation.
 * Only ids whose archive UPDATE reported changes === 1 are passed in, so
 * clearing archived_at cannot un-archive rows someone else archived.
 * Failures are recoverable (archived, not deleted) — name them loudly.
 */
async function unarchive(env: Env, ids: number[], entityName: string): Promise<void> {
  for (const id of ids) {
    try {
      await env.DB.prepare(`
        UPDATE observations SET archived_at = NULL WHERE id = ?
      `).bind(id).run();
    } catch (e) {
      console.error(`Consolidation rollback: failed to un-archive obs ${id} ("${entityName}") — row is archived, not lost; manual restore needed: ${e}`);
    }
  }
}
