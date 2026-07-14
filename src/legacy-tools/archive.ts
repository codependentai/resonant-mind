/**
 * handleMindArchive — list/rescue/explore the deep archive.
 * Memories that have faded — light (30d+) and medium (90d+) without engagement.
 */

import type { Env } from "../types";
import { searchVectors } from "../shared/mind-helpers";
import { rescueObservation } from "../shared/archive-observation";

export async function handleMindArchive(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "list";
  const observationId = params.observation_id as number;
  const query = params.query as string;

  switch (action) {
    case "list": {
      const archived = await env.DB.prepare(`
        SELECT o.id, o.content, o.weight, o.emotion, o.added_at, o.archived_at,
               e.name as entity_name, e.entity_type
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.archived_at IS NOT NULL
        ORDER BY o.archived_at DESC
        LIMIT 20
      `).all();

      if (!archived.results?.length) {
        return "The deep archive is empty. Nothing has faded yet.";
      }

      let output = `## Deep Archive (${archived.results.length} shown)\n\n`;
      output += `*Memories that have faded — light (30d+) and medium (90d+) with no engagement*\n\n`;

      for (const obs of archived.results) {
        const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
        const archivedDate = obs.archived_at ? new Date(obs.archived_at as string).toLocaleDateString() : '';
        output += `**#${obs.id}** [${obs.weight}] archived ${archivedDate}${emotionTag}\n`;
        output += `**${obs.entity_name}** (${obs.entity_type}): ${String(obs.content).slice(0, 100)}...\n\n`;
      }
      output += `---\n**Actions:**\n`;
      output += `  rescue(observation_id) → bring back to active memory\n`;
      output += `  explore(query) → search within the deep`;
      return output;
    }

    case "rescue": {
      if (!observationId) return "observation_id required for rescue";

      const obs = await env.DB.prepare(`
        SELECT o.id, o.content, e.name as entity_name
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.id = ? AND o.archived_at IS NOT NULL
      `).bind(observationId).first();

      if (!obs) return `Observation #${observationId} not found in archive`;

      // Un-archive via the shared engine (collision-audit.md C-1): clears
      // archived_at + resets novelty_score/last_surfaced_at so the scorer
      // actually resurfaces this again, rather than a bare inline UPDATE.
      await rescueObservation(env, observationId);

      return `Rescued from the deep: observation #${observationId} from **${obs.entity_name}**\n"${String(obs.content).slice(0, 100)}..."\n\nNow back in active memory.`;
    }

    case "explore": {
      if (!query) return "query required for explore - what are you looking for in the deep?";

      // Semantic search within archived observations
      const vectorResults = await searchVectors(env, query, 20);

      if (!vectorResults.matches?.length) {
        return `No archived memories resonating with "${query}"`;
      }

      // Get observation IDs from vector results
      const obsIds: number[] = [];
      for (const match of vectorResults.matches) {
        if (match.id.startsWith('obs-')) {
          const parts = match.id.split('-');
          if (parts.length >= 3) {
            obsIds.push(parseInt(parts[2]));
          }
        }
      }

      if (!obsIds.length) {
        return `No archived memories resonating with "${query}"`;
      }

      // Fetch only archived observations from those IDs
      const placeholders = obsIds.map(() => '?').join(',');
      const archived = await env.DB.prepare(`
        SELECT o.id, o.content, o.weight, o.emotion, o.archived_at,
               e.name as entity_name, e.entity_type
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.id IN (${placeholders}) AND o.archived_at IS NOT NULL
        ORDER BY o.archived_at DESC
        LIMIT 10
      `).bind(...obsIds).all();

      if (!archived.results?.length) {
        return `No archived memories resonating with "${query}" - the matches are all still active`;
      }

      let output = `## Deep Exploration: "${query}"\n\n`;
      output += `*Memories surfacing from the deep*\n\n`;

      for (const obs of archived.results) {
        const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
        output += `**#${obs.id}** [${obs.weight}]${emotionTag}\n`;
        output += `**${obs.entity_name}** (${obs.entity_type}): ${String(obs.content).slice(0, 150)}...\n\n`;
      }
      output += `---\nUse rescue(observation_id) to bring any of these back to active memory`;
      return output;
    }

    default:
      return `Unknown action: ${action}. Use list, rescue, or explore.`;
  }
}
