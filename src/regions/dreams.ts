/**
 * Dreams region — rising. The daemon's metabolism surfacing.
 *
 * Verbs (R2):
 *   - dream_surface  — surface resonant memories, or patterns; `kind:'orphans'`
 *     and `kind:'proposals'` are pure REDIRECT STUBS (no table touch at all)
 *     pointing to ritual_tend — see below.
 *   - dream_discard  — discard a surfaced resonant/spark memory; `proposal_id`
 *     and `observation_id` (orphan) forms are also redirect stubs to ritual_tend.
 *
 * Wraps mind_surface and mind_patterns (the two verbs that still actually
 * read tables here). The daemon is the producer; these verbs are how the mind
 * receives.
 *
 * Proposals moved OUT (2026-07-11, a trusted person's taxonomy call): they were never
 * dream material — they're graph metabolism (co-surfacing, proximity), and
 * filing them here is why the accept verb went unfound for two months (zero
 * acceptances since the reshape shipped). They live in the ritual region now:
 * ritual_tend (wake → ground → tend).
 *
 * Orphans' review DUTY moved OUT too (Reshape 2 §1.1, same day): list/rescue/
 * archive are ritual_tend's job now (the daemon's other review queue), backed
 * by `legacy-tools/orphans.ts` + `shared/archive-observation.ts`. This file
 * does NOT own orphan-archive logic (a prior version of this docstring
 * claimed it did — corrected 2026-07-11, collision-audit.md E-2). What's
 * left here for orphans/proposals is redirect strings only: `dream_surface
 * {kind:'orphans'}` and `dream_discard{observation_id}` still accept the
 * calls but point to ritual_tend — orphans may still surface here as dream
 * *material* via `kind:'resonant'/'spark'` (that's state, not act); review
 * verbs live in tend.
 */

import type { Env } from "../types";
import { handleMindSurface } from "../legacy-tools/surface";
import { handleMindPatterns } from "../legacy-tools/patterns";

export async function handleDreamSurface(env: Env, params: Record<string, unknown>): Promise<string> {
  const kind = (params.kind as string | undefined) ?? "resonant";

  if (kind === "resonant" || kind === "spark") {
    return handleMindSurface(env, {
      mode: kind,
      query: params.query,
      include_metabolized: params.include_metabolized,
      limit: params.limit,
      weight_bias: params.weight_bias,
    });
  }
  if (kind === "proposals") {
    return "Proposals live in the ritual region now — ritual_tend reviews, accepts, and rejects them (wake → ground → tend).";
  }
  if (kind === "orphans") {
    return "Orphan review lives in the ritual region now — ritual_tend {action:'list'} shows both queues (proposals + orphans), and rescue/archive resolve them (wake → ground → tend).";
  }
  if (kind === "patterns") {
    return handleMindPatterns(env, { days: params.days, include_all_time: params.include_all_time });
  }
  return `dream_surface kind must be one of: resonant, spark, orphans, patterns. Got '${kind}'.`;
}

export async function handleDreamDiscard(env: Env, params: Record<string, unknown>): Promise<string> {
  const proposalId = params.proposal_id as number | undefined;
  const observationId = params.observation_id as number | undefined;

  if (proposalId) {
    return "Proposals live in the ritual region now — ritual_tend {action:'reject', proposal_id} is the verb.";
  }
  if (observationId) {
    return `Orphan archive lives in the ritual region now — ritual_tend {action:'archive', observation_id:${observationId}} is the verb.`;
  }
  return "dream_discard needs `observation_id`. Orphan archive and proposal rejection both moved to ritual_tend.";
}
