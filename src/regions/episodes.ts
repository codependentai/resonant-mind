/**
 * Episodes region — texture. What's happened.
 *
 * Verbs (R2):
 *   - episode_record    — write a journal or a heavy observation
 *   - episode_recall    — read recent episodes (scope: recent / context / by entity)
 *   - episode_thread_back — trace a theme through time
 *
 * Wraps mind_write (journal type), mind_read, mind_timeline. The wrap is
 * thin — same data shape, just stable verb names that survive R3.
 */

import type { Env } from "../types";
import { handleMindWrite } from "../legacy-tools/write";
import { handleMindRead } from "../legacy-tools/read";
import { handleMindTimeline } from "../legacy-tools/timeline";

export async function handleEpisodeRecord(env: Env, params: Record<string, unknown>): Promise<string> {
  const entry = params.entry as string | undefined;
  const entity = params.entity_name as string | undefined;
  const observations = params.observations as string[] | undefined;
  const weight = (params.weight as string | undefined) ?? "medium";
  const context = (params.context as string | undefined) ?? "episodic";
  const emotion = params.emotion as string | undefined;
  const tags = params.tags as string[] | undefined;

  if (entry && !entity && !observations) {
    // Journal-flavored episode
    return handleMindWrite(env, {
      type: "journal",
      entry,
      context,
      tags,
    });
  }

  if (entity && observations?.length) {
    // Observation-flavored episode
    return handleMindWrite(env, {
      type: "observation",
      entity_name: entity,
      observations,
      weight,
      context,
      emotion,
      tags,
    });
  }

  return "episode_record needs either `entry` (journal) or `entity_name` + `observations` (observation).";
}

export async function handleEpisodeRecall(env: Env, params: Record<string, unknown>): Promise<string> {
  const scope = (params.scope as string | undefined) ?? "recent";
  const hours = (params.hours as number | undefined) ?? 48;
  const context = params.context as string | undefined;
  const observation_id = params.observation_id as number | undefined;

  return handleMindRead(env, {
    scope,
    context,
    hours,
    observation_id,
  });
}

export async function handleEpisodeThreadBack(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string | undefined;
  if (!query) return "episode_thread_back needs a query.";

  return handleMindTimeline(env, {
    query,
    start_date: params.start_date,
    end_date: params.end_date,
    n_results: params.n_results,
  });
}
