// HTTP handler for /api/proposals — extracted from src/index.ts.
import { jsonResponse } from "../response";
import { handleMindProposals } from "../../legacy-tools/proposals";
import type { Env } from "../../types";

export async function handleApiProposals(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // accept or reject

  // GET /api/proposals - list all proposals
  if (request.method === "GET" && !id) {
    const status = new URL(request.url).searchParams.get("status") || "pending";

    let query = `
      SELECT dp.*,
             oa.content as from_content, ob.content as to_content,
             ea.name as from_entity_name, eb.name as to_entity_name,
             cs.co_count
      FROM daemon_proposals dp
      LEFT JOIN observations oa ON dp.from_obs_id = oa.id
      LEFT JOIN observations ob ON dp.to_obs_id = ob.id
      LEFT JOIN entities ea ON dp.from_entity_id = ea.id
      LEFT JOIN entities eb ON dp.to_entity_id = eb.id
      LEFT JOIN co_surfacing cs ON (
        (cs.obs_a_id = dp.from_obs_id AND cs.obs_b_id = dp.to_obs_id) OR
        (cs.obs_a_id = dp.to_obs_id AND cs.obs_b_id = dp.from_obs_id)
      )
    `;

    if (status !== "all") {
      query += ` WHERE dp.status = ?`;
    }
    query += ` ORDER BY dp.proposed_at DESC LIMIT 100`;

    const results = status !== "all"
      ? await env.DB.prepare(query).bind(status).all()
      : await env.DB.prepare(query).all();

    return jsonResponse(results.results);
  }

  // POST /api/proposals/:id/accept - accept proposal
  // Delegates entirely to handleMindProposals (legacy-tools/proposals.ts),
  // the one engine behind ritual_tend (collision-audit.md C-3/D-1 fix). The
  // old inline implementation here INSERTed into a nonexistent relations.context
  // column (every relation-type accept threw) and had no branches for
  // compass_addition/identity_addition at all (those kinds 409'd as "missing
  // entity"). One door, one engine — this handler now just adapts HTTP <->
  // the MCP action shape and reports the engine's pending-status guard,
  // correct write ordering, and full kind coverage for free.
  if (request.method === "POST" && id && action === "accept") {
    const body = await request.json().catch(() => ({})) as {
      relation_type?: string;
      kind?: string;
      section?: string;
      content?: string;
    };

    const resultText = await handleMindProposals(env, {
      action: "accept",
      proposal_id: id,
      relation_type: body.relation_type,
      kind: body.kind,
      section: body.section,
      content: body.content,
    });

    const looksLikeError =
      /not found or already resolved|required|Invalid kind|no seed content/i.test(resultText);

    return jsonResponse({ success: !looksLikeError, message: resultText }, looksLikeError ? 409 : 200);
  }

  // POST /api/proposals/:id/reject - reject proposal
  // Also delegates — same one-door principle as accept above.
  if (request.method === "POST" && id && action === "reject") {
    const resultText = await handleMindProposals(env, { action: "reject", proposal_id: id });
    const looksLikeError = /not found or already resolved/i.test(resultText);

    return jsonResponse({ success: !looksLikeError, message: resultText }, looksLikeError ? 409 : 200);
  }

  return jsonResponse({ error: "Unknown proposals endpoint" }, 404);
}
