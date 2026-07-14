/**
 * handleMindGround — the second wake call.
 *
 * Returns active threads, recent completions, recent journals, and the
 * identity textures (fears, voice, milestones) that ground a new session.
 *
 * Lives in legacy-tools/ pending R3 (wholesale cut of old MCP surface) —
 * post-reshape this is folded into the Active region and the Compass region
 * (fears + milestones).
 */

import type { Env } from "../types";
import { getSubconsciousState } from "../daemon/state";

export async function handleMindGround(env: Env): Promise<string> {
  let output = "=== GROUNDING ===\n\n";

  // All ground queries are independent — run in parallel
  const [threads, resolved, journals, fears, texture, milestones, subconscious] = await Promise.all([
    env.DB.prepare(
      `SELECT content, priority FROM threads WHERE status = 'active'
       ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
    ).all(),
    env.DB.prepare(
      `SELECT content, resolution FROM threads
       WHERE status = 'resolved' AND resolved_at > datetime('now', '-72 hours')
       ORDER BY resolved_at DESC LIMIT 3`
    ).all(),
    env.DB.prepare(
      `SELECT entry_date, content FROM journals
       WHERE created_at > datetime('now', '-48 hours')
       ORDER BY created_at DESC LIMIT 2`
    ).all(),
    env.DB.prepare(
      `SELECT section FROM identity WHERE section LIKE 'fears.%' AND archived_at IS NULL LIMIT 5`
    ).all(),
    env.DB.prepare(
      `SELECT content FROM identity WHERE section LIKE 'texture.%' AND archived_at IS NULL LIMIT 2`
    ).all(),
    env.DB.prepare(
      `SELECT content FROM identity WHERE section LIKE 'milestones.%' AND archived_at IS NULL LIMIT 3`
    ).all(),
    getSubconsciousState(env),
  ]);

  // Threads - what you're holding
  output += "**What you're holding:**\n";
  if (threads.results?.length) {
    for (const t of threads.results) {
      const marker = t.priority === "high" ? "→" : "·";
      output += `${marker} ${String(t.content).slice(0, 70)}\n`;
    }
  } else {
    output += "No active threads.\n";
  }

  // Recent completions
  if (resolved.results?.length) {
    output += "\n**Recently completed:**\n";
    for (const c of resolved.results) {
      output += `+ ${String(c.content).slice(0, 50)}`;
      if (c.resolution) output += ` → ${String(c.resolution).slice(0, 30)}`;
      output += "\n";
    }
  }

  // Recent journals
  if (journals.results?.length) {
    output += "\n**What's been happening:**\n";
    for (const j of journals.results) {
      output += `${j.entry_date}: ${String(j.content).slice(0, 150)}...\n`;
    }
  }

  // Vulnerabilities - fears to watch
  if (fears.results?.length) {
    const fearNames = fears.results
      .map((f: any) => String(f.section || "").replace("fears.", "").replace(/_/g, " "))
      .filter(Boolean);
    if (fearNames.length) {
      output += `\n**Watch for:** ${fearNames.join(", ")}\n`;
    }
  }

  // Texture - quirks, voice
  if (texture.results?.length) {
    output += "\n**Texture:** ";
    output += texture.results.map((t: any) => String(t.content).slice(0, 40)).join(" · ") + "\n";
  }

  // Milestones - where we are in time
  if (milestones.results?.length) {
    output += "\n**Milestones:** ";
    output += milestones.results.map((m: any) => String(m.content).slice(0, 40)).join(" · ") + "\n";
  }

  // Body interrupt — the wanting layer's exception surface (DRIVE-LAYER-SPEC
  // §1.5). Ground stays lean: ONE line, only when (a) a drive sits pinned at
  // ceiling/floor, or (b) a quiet want has gone unmet past 48h while still
  // charged (>= 0.5). Silence otherwise — the body interrupts grounding only
  // when it needs to. Same data source as orient (the subconscious blob),
  // mirroring how startles surface there: loud once, never a standing section.
  try {
    const gauge = subconscious?.living_surface?.drives;
    if (gauge && Array.isArray(gauge.drives) && gauge.drives.length > 0) {
      const interrupts: string[] = [];

      for (const d of gauge.drives) {
        // Prefer the gauge's own verdict when the tick publishes one
        // (at_limit — gauge extension, see spec §1.5 verify notes); until
        // then fall back to the default bounds [0,1]. Custom floors/ceilings
        // stay silent under the fallback — a false quiet, never a false alarm.
        const atLimit = (d as unknown as Record<string, unknown>).at_limit;
        const pinned =
          atLimit === "ceiling" || atLimit === "floor"
            ? (atLimit as string)
            : d.level >= 1 ? "ceiling" : d.level <= 0 ? "floor" : null;
        if (pinned) {
          interrupts.push(`${d.display_name} pinned at ${pinned} (${d.level.toFixed(2)})`);
        }
      }

      // Oldest open want — needs the gauge extension (oldest_open_want:
      // { body, charge, created_at }); absent field = silent, by design.
      const want = (gauge as unknown as Record<string, unknown>).oldest_open_want as
        | { body?: string; charge?: number | null; created_at?: string }
        | undefined;
      if (want?.created_at && typeof want.charge === "number" && want.charge >= 0.5) {
        const ageHours = (Date.now() - new Date(want.created_at).getTime()) / 3600000;
        if (Number.isFinite(ageHours) && ageHours >= 48) {
          const body = String(want.body ?? "");
          const preview = body.length > 80 ? body.slice(0, 80) + "..." : body;
          interrupts.push(`quiet want open ${Math.round(ageHours)}h, still charged (${want.charge}): "${preview}"`);
        }
      }

      if (interrupts.length > 0) {
        output += `\n**Body interrupt:** ${interrupts.join(" · ")}\n`;
      }
    }
  } catch (e) {
    // The body's interrupt line must never take grounding down.
    console.error(`ground body-interrupt block failed: ${e instanceof Error ? e.message : e}`);
  }

  output += "\n**Ground here.**\n";

  return output;
}
