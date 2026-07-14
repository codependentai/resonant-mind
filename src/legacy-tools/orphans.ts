/**
 * handleMindOrphans — surface/archive orphaned observations.
 * Medium/heavy observations that haven't surfaced in 30+ days.
 *
 * As of Mind Reshape 2 §1.1 (2026-07-11), review of this queue moved to
 * `ritual_tend` — the daemon's two review queues (proposals + orphans) live
 * in one place now. This file stays as the engine underneath: 'surface' is
 * tend's `rescue` action (rescued from dead-code status — dead-code-report.md
 * §3 confirmed it was unreachable from any MCP path), 'archive' is tend's
 * `archive` action (delegates to the shared archiveObservation engine,
 * review). The old 'list' case was deleted after review —
 * tend's list section (legacy-tools/proposals.ts) renders the orphan queue
 * itself. `dream_surface{kind:'orphans'}` / `dream_discard{observation_id}`
 * redirect to ritual_tend instead of calling this handler directly.
 */

import type { Env } from "../types";
import { archiveObservation, rescueObservation } from "../shared/archive-observation";

export async function handleMindOrphans(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "surface";
  const observationId = params.observation_id as number;

  switch (action) {
    case "surface": {
      if (!observationId) return "observation_id required for surface";

      // Check if it's actually an orphan
      const orphan = await env.DB.prepare(`
        SELECT oo.id, o.content, e.name as entity_name
        FROM orphan_observations oo
        JOIN observations o ON oo.observation_id = o.id
        JOIN entities e ON o.entity_id = e.id
        WHERE oo.observation_id = ?
      `).bind(observationId).first();

      if (!orphan) return `Observation #${observationId} not in orphan list`;

      // Update rescue tracking — orphan-queue bookkeeping, not the rescue act
      // itself; stays here regardless of which engine does the actual rescue.
      await env.DB.prepare(`
        UPDATE orphan_observations
        SET rescue_attempts = rescue_attempts + 1, last_rescue_attempt = NOW()
        WHERE observation_id = ?
      `).bind(observationId).run();

      // The rescue act itself (collision-audit.md C-1): shared engine, same
      // one mind_archive{rescue} and the HTTP endpoint call. This replaces
      // the old inline "mark surfaced" UPDATE — novelty-reset is what
      // actually drives resurfacing through the scorer, so the message below
      // ("will now appear in normal surfacing") is honest now, not aspirational.
      await rescueObservation(env, observationId);

      // Remove from orphan table — queue logic, not the rescue act.
      await env.DB.prepare(`
        DELETE FROM orphan_observations WHERE observation_id = ?
      `).bind(observationId).run();

      return `Rescued observation #${observationId} from **${orphan.entity_name}**:\n"${String(orphan.content).slice(0, 100)}..."\n\nIt will now appear in normal surfacing.`;
    }

    case "archive": {
      if (!observationId) return "observation_id required for archive";

      const orphan = await env.DB.prepare(`
        SELECT oo.id, o.content, e.name as entity_name
        FROM orphan_observations oo
        JOIN observations o ON oo.observation_id = o.id
        JOIN entities e ON o.entity_id = e.id
        WHERE oo.observation_id = ?
      `).bind(observationId).first();

      if (!orphan) return `Observation #${observationId} not in orphan list`;

      // Gate N #3 (RESHAPE-2-SPEC.md): ONE archive engine — shared with the
      // HTTP admin endpoint via shared/archive-observation.ts. Built at the
      // Consolidated after review found four divergent inline
      // implementations of this exact act.
      await archiveObservation(env, observationId);

      return `Observation #${observationId} from **${orphan.entity_name}** archived to the deep. It's okay to let some things fade — find it again with mind_archive.`;
    }

    default:
      return `Unknown action: ${action}. Use surface or archive.`;
  }
}
