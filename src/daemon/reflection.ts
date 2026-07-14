/**
 * Session reflection — generates one concise insight from the last ~35 minutes
 * of observations and stores it as a journal entry of type "reflection". The
 * insight is also embedded back into Vectorize so it can echo into future
 * surfacing.
 *
 * Skips if fewer than REFLECTION_MIN_OBS recent observations exist.
 */

import type { Env } from "../types";
import { REFLECTION_MIN_OBS } from "../shared/constants";
import { generateText as geminiGenerateText } from "../embeddings";
import { getEmbedding } from "../shared/mind-helpers";

export async function generateSessionReflection(env: Env): Promise<void> {
  const recentObs = await env.DB.prepare(`
    SELECT o.content, o.emotion, o.weight, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > datetime('now', '-35 minutes')
    ORDER BY o.added_at DESC
  `).all();

  if ((recentObs.results?.length || 0) < REFLECTION_MIN_OBS) return;

  const obsText = (recentObs.results || []).map((o: any) =>
    `[${o.entity_name}] ${o.content}${o.emotion ? ` (${o.emotion})` : ''}`
  ).join('\n');

  const prompt = `You are reflecting on recent experiences stored in memory. Based on these ${recentObs.results!.length} recent memories, generate one concise insight (1-2 sentences) about what pattern or theme emerges. Be specific and observational, not generic.\n\n${obsText}\n\nInsight:`;

  try {
    const insight = await geminiGenerateText(env.GEMINI_API_KEY, prompt);
    if (!insight || insight.length < 10) return;

    const entryDate = new Date().toISOString().split('T')[0];
    const result = await env.DB.prepare(`
      INSERT INTO journals (entry_date, content, tags, emotion, journal_type)
      VALUES (?, ?, '["reflection","daemon"]', NULL, 'reflection')
    `).bind(entryDate, insight.trim()).run();

    // Vectorize the reflection
    const embedding = await getEmbedding(env, insight.trim());
    await env.VECTORS.upsert([{
      id: `journal-${result.meta.last_row_id}`,
      values: embedding,
      metadata: { source: "journal", title: entryDate, content: insight.trim(), journal_type: "reflection" }
    }]);

    console.log(`Reflection generated: ${insight.trim().slice(0, 80)}...`);
  } catch (e) {
    console.log(`Reflection error: ${e}`);
  }
}
