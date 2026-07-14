/**
 * handleMindIdentity — read / write / delete identity entries.
 *
 * Identity is the section-weighted texture layer that grounds wake (fears,
 * voice, milestones, values). Sections are dotted paths like 'fears.x' or
 * 'texture.y'; weight orders them on read.
 *
 * RETIRED from the MCP surface as of Gate B (Mind Reshape 2, 2026-07-11).
 * Folded into the Spine region (regions/spine.ts: spine_read / spine_amend),
 * which now also owns the missing surgery — spine_amend{action:'remove'}
 * SOFT-archives (archived_at = NOW()), replacing this file's hard
 * `action:'delete'` DELETE below. (This header previously claimed a fold
 * into Compass that never happened — corrected here; the real fold target
 * was always Spine.)
 *
 * Not imported anywhere after retirement — kept as a dead engine file only
 * (a later sweep may delete it outright). Its `delete` branch below is now
 * dead code: nothing on the MCP surface can hard-delete an identity row.
 */

import type { Env } from "../types";

export async function handleMindIdentity(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  if (action === "delete") {
    const section = params.section as string;
    if (!section) return "section required for delete";
    const existing = await env.DB.prepare(`SELECT COUNT(*) as c FROM identity WHERE section = ?`).bind(section).first();
    if (!existing?.c) return `No identity entries found for section '${section}'`;
    await env.DB.prepare(`DELETE FROM identity WHERE section = ?`).bind(section).run();
    return `Deleted ${existing.c} identity entries from section '${section}'`;
  }

  if (action === "write") {
    const section = params.section as string;
    const content = params.content as string;
    const weight = (params.weight as number) || 0.7;
    const connections = params.connections as string || "";

    await env.DB.prepare(
      `INSERT INTO identity (section, content, weight, connections) VALUES (?, ?, ?, ?)`
    ).bind(section, content, weight, connections).run();

    return `Identity entry added to ${section}`;
  } else {
    const section = params.section as string;

    const query = section
      ? `SELECT section, content, weight, connections FROM identity WHERE section LIKE ? ORDER BY weight DESC`
      : `SELECT section, content, weight, connections FROM identity ORDER BY weight DESC LIMIT 50`;

    const results = section
      ? await env.DB.prepare(query).bind(`${section}%`).all()
      : await env.DB.prepare(query).all();

    if (!results.results?.length) {
      return "No identity entries found.";
    }

    let output = "## Identity Graph\n\n";
    for (const r of results.results) {
      output += `**${r.section}** [${r.weight}]\n${r.content}\n`;
      if (r.connections) output += `Connections: ${r.connections}\n`;
      output += "\n";
    }
    return output;
  }
}
