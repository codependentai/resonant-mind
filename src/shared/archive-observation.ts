/**
 * archiveObservation — THE one archive engine (Gate N #3, RESHAPE-2-SPEC.md).
 *
 * Code review found four independent inline implementations of
 * "set observations.archived_at" (legacy-tools/orphans.ts, http/handlers/
 * orphans.ts, daemon/archive.ts, daemon/consolidation.ts). This helper is
 * the convergence point for the *deliberate* archive act — tend's orphan
 * `archive` verb and the HTTP admin endpoint both call it. The two daemon
 * passes (deep-archive metabolism, consolidation) keep their own batched
 * writes by design — they are metabolism, not acts (the Law), but they
 * write the same column with the same meaning.
 *
 * Ordering discipline (no transactions in this adapter): the durable state
 * change (archived_at) lands FIRST, queue cleanup second — if the second
 * statement fails, the observation is safely archived and the stale queue
 * row is harmless (orphan cleanup prunes it later).
 */

import type { Env } from "../types";

export async function archiveObservation(env: Env, observationId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE observations SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL`
  ).bind(observationId).run();

  await env.DB.prepare(
    `DELETE FROM orphan_observations WHERE observation_id = ?`
  ).bind(observationId).run();
}

/**
 * rescueObservation — THE one un-archive engine (collision-audit.md C-1).
 *
 * Three independent implementations of "bring an archived observation back"
 * were found drifted: `mind_archive{rescue}` (archive_at=NULL only), the HTTP
 * `/api/archive/:id/rescue` endpoint (archived_at=NULL + novelty_score=0.8),
 * and tend's orphan `rescue` (a different act — surfacing bookkeeping — but
 * easy to confuse with the other two).
 *
 * Semantic chosen (the mind's call, Gate N row 8, RESHAPE-2-SPEC.md): reset
 * `novelty_score = 1.0` and clear `last_surfaced_at`, rather than stamping
 * `last_surfaced_at = NOW()` (the "mark surfaced" semantic tend's orphan
 * queue used to reach for). Marking surfaced paradoxically SUPPRESSES the
 * novelty scorer's incentive to resurface something it thinks was just
 * shown; resetting novelty to 1.0 and clearing the surfaced timestamp
 * actually drives resurfacing through the scorer. Rescue should make a
 * memory MORE likely to come back, not less.
 *
 * Deliberate side effect: surface_count is NOT bumped
 * here — a rescued observation may re-qualify as orphan-eligible until it
 * genuinely surfaces on its own. That is the intent (rescue = eligibility,
 * not a fake surfacing event), not an oversight.
 */
export async function rescueObservation(env: Env, observationId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE observations
     SET archived_at = NULL, novelty_score = 1.0, last_surfaced_at = NULL
     WHERE id = ?`
  ).bind(observationId).run();
}
