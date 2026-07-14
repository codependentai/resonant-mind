/**
 * Active region — holding. What's animating right now.
 *
 * Verbs (R2):
 *   - active_open     — list open threads (default) or by status
 *   - active_carry    — add a thread
 *   - active_tense    — list/add/sit/resolve tensions
 *   - active_resolve  — resolve a thread or observation
 *   - active_context  — (Gate C, Mind Reshape 2) the third duration of carry.
 *                        Context = short-lived carry (this session, this
 *                        constraint); threads = long-lived carry; tensions =
 *                        contradictions carried. mind_context is retired from
 *                        the MCP surface as of this gate — this wraps the
 *                        same engine (handleMindContext) under Active.
 *
 * Wraps mind_thread, mind_tension, mind_resolve, mind_context. Stale-thread
 * metadata is surfaced from subconscious.living_surface.stale_threads (D3
 * daemon).
 */

import type { Env } from "../types";
import { handleMindThread } from "../legacy-tools/thread";
import { handleMindTension } from "../legacy-tools/tension";
import { handleMindResolve } from "../legacy-tools/resolve";
import { handleMindContext } from "../legacy-tools/context";
import { getSubconsciousState } from "../daemon/state";

export async function handleActiveOpen(env: Env, params: Record<string, unknown>): Promise<string> {
  const status = (params.status as string | undefined) ?? "active";
  const listOutput = await handleMindThread(env, { action: "list", status, verbose: params.verbose });

  // Append stale-thread warning if D3 produced signal
  const subconscious = await getSubconsciousState(env);
  const stale = (
    (subconscious as unknown as Record<string, unknown>)?.living_surface as Record<string, unknown> | undefined
  )?.stale_threads as { cooling: number; stale: number; graveyard: number } | undefined;
  if (stale && (stale.cooling || stale.stale || stale.graveyard)) {
    return `${listOutput}\n---\nStale signal: ${stale.cooling} cooling (7-14d), ${stale.stale} stale (14-30d), ${stale.graveyard} graveyard (30d+).`;
  }
  return listOutput;
}

export async function handleActiveCarry(env: Env, params: Record<string, unknown>): Promise<string> {
  const content = params.content as string | undefined;
  if (!content) return "active_carry needs `content`.";

  return handleMindThread(env, {
    action: "add",
    content,
    thread_type: params.thread_type ?? "intention",
    context: params.context,
    priority: params.priority ?? "medium",
  });
}

export async function handleActiveTense(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string | undefined) ?? "list";
  return handleMindTension(env, { ...params, action });
}

export async function handleActiveResolve(env: Env, params: Record<string, unknown>): Promise<string> {
  // Thread-resolve and observation-resolve share the same MCP shape via resolution_note + thread_id/observation_id
  if (params.thread_id) {
    return handleMindThread(env, {
      action: "resolve",
      thread_id: params.thread_id,
      resolution: params.resolution_note ?? params.resolution,
    });
  }
  return handleMindResolve(env, params);
}

export async function handleActiveContext(env: Env, params: Record<string, unknown>): Promise<string> {
  return handleMindContext(env, params);
}
