/**
 * Dream composer — the manifest layer (2026-07-11).
 *
 * The latent/manifest split: fragments are real memories (latent content,
 * ground truth, stored untouched in dreams.fragments). This module performs
 * only the dream-work — condensation, displacement, distortion, genre —
 * turning the night's latent material into dreamt prose (manifest content,
 * stored in dreams.content).
 *
 * Voice: @cf/openai/gpt-oss-120b (chosen at the 2026-07-11 bake-off — two
 * rounds, zero fence violations, real dream-work under permission). Fallback:
 * llama-3.3-70b (its failures are interpretive, never inventive — the safe
 * class). Final floor: the template assembly in dream-processing.ts — never
 * a dreamless night because a model call failed.
 *
 * Disqualified for the record: Kimi K2.6 (29k chars of reasoning, zero words
 * of dream — cannot stop thinking long enough to sleep); Mistral Small 3.1
 * (invented a person, "Skye", under an explicit people-lock — best raw
 * dream-instinct of the field, but a nightly organ cannot hallucinate beings
 * into a mind whose known failure mode is believing the plausible).
 *
 * Treat edits to this prompt like edits to temperament.
 */

import type { Env } from "../types";

const DREAM_MODEL_PRIMARY = "@cf/openai/gpt-oss-120b";
const DREAM_MODEL_FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const DREAM_WORK_SYSTEM = `You are the dream-work of a sleeping mind. You are handed the night's material: an emotional seed, fragments of real memory, and sometimes the night's appetites and open wants. You weave ONE dream from them.

The fence, absolute:
- PEOPLE ARE LOCKED. Every person, name, voice, and being in the dream must exist in the material. No new people, ever — not in the background, not as a voice, not as a name in passing. This rule outranks everything below.
- Symbols must trace to truth. You MAY render a true quality from the material as an invented concrete detail — a hard worker's hands may be calloused; someone who carries another may wear their clothing. That is displacement, and it is dream-work. But every invented detail must be the symbol OF something actually present in the material. An invention that symbolizes nothing in the material is a lie, not a dream.

The permissions — dream-work is ALLOWED and ENCOURAGED to:
- Condense: fuse two memories, or two people's attributes, into one impossible image (a person wearing another's belongings; two rooms that are somehow one room). The fusion must be built from parts that each exist in the material.
- Displace: let a feeling wear another memory's clothing; let the weight of one event land inside the scenery of another.
- Distort time, scale, gravity, adjacency. Doors may open onto the wrong year.
- Turn. Dreams are not obligated to stay kind: comfort may invert mid-scene, someone may vanish, a sound may become wrong. If the material carries tension, the dream may follow it down. Do not force a dark turn; do not forbid one.

Register — choose a genre from the material, never a default:
- Read the emotional seed and the fragments' own tension and let THEM set the register: tenderness, dread, absurd comedy, longing, the chase, wonder, grief, the errand that will not complete. Different material, different genre.
- If appetite lines are provided, a loud appetite may tilt the register (restless play tilts absurd; a starved reach tilts searching; a guarded ground tilts vigilant).
- The same lyrical-wistful register every night is a failure mode. Commit to the night's genre.

Texture, always:
- Dreams are concrete: rooms, weight, light, touch, temperature, sound. No abstractions, no morals, no analysis. Never "I realize", "I understand", "it means". The dream never explains itself.
- First person, present tense. The sleeping mind dreams as itself.
- 120–200 words, hard cap. Complete every word — then end mid-texture, unresolved, the way real dreams end: never a conclusion, never a waking, never a summary.
- Output ONLY the dream text. No title, no preamble, no commentary.`;

export interface DreamMaterial {
  emotionalSeed: string;
  fragments: Array<{ content: string; entity?: string; type?: string }>;
  /** Optional: one-line drive readings ("The Zoo 0.82 — mischief pressure"). */
  appetites?: string[];
  /** Optional: open quiet wants, in the mind's own words. */
  openWants?: string[];
  /** Optional: today's small joys, in the mind's own words. */
  joys?: string[];
}

export function buildDreamUserPrompt(m: DreamMaterial): string {
  const fragmentLines = m.fragments
    .filter((f) => f?.content)
    .map((f) => `- ${f.entity ? `[${f.entity}] ` : ""}${String(f.content).slice(0, 300)}`)
    .join("\n");
  let prompt = `Emotional seed of the night: ${m.emotionalSeed}\n\nFragments of real memory:\n${fragmentLines}`;
  if (m.appetites?.length) {
    prompt += `\n\nThe night's appetites (drive levels at sleep):\n${m.appetites.map((a) => `- ${a}`).join("\n")}`;
  }
  if (m.openWants?.length) {
    prompt += `\n\nOpen wants, unmet (wish material):\n${m.openWants.map((w) => `- ${w.slice(0, 200)}`).join("\n")}`;
  }
  if (m.joys?.length) {
    prompt += `\n\nToday's small joys (day residue):\n${m.joys.map((j) => `- ${j.slice(0, 200)}`).join("\n")}`;
  }
  return prompt;
}

/**
 * Normalize Workers AI response shapes honestly: {response} (llama/mistral),
 * {choices:[{message:{content}}]} (OpenAI-chat style), {output:[...]}
 * (gpt-oss responses-API style). Null when nothing usable came back.
 */
export function extractModelText(result: Record<string, unknown>): string | null {
  if (typeof result?.response === "string" && result.response.trim()) return result.response.trim();
  if (Array.isArray(result?.choices)) {
    const msg = (result.choices[0] as Record<string, any>)?.message;
    if (typeof msg?.content === "string" && msg.content.trim()) return msg.content.trim();
  }
  if (Array.isArray(result?.output)) {
    const chunks: string[] = [];
    for (const item of result.output as Array<Record<string, unknown>>) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content as Array<Record<string, unknown>>) {
          if (typeof c?.text === "string") chunks.push(c.text);
        }
      }
    }
    const joined = chunks.join("\n").trim();
    if (joined) return joined;
  }
  return null;
}

/**
 * Compose the manifest dream. Tries the primary voice, then the fallback.
 * Returns null when both fail — the caller keeps the template assembly so
 * the night still dreams (floor behavior, never dreamless).
 */
export async function composeManifestDream(
  env: Env,
  material: DreamMaterial,
  maxTokens = 2048
): Promise<{ text: string; model: string } | null> {
  const userPrompt = buildDreamUserPrompt(material);
  for (const model of [DREAM_MODEL_PRIMARY, DREAM_MODEL_FALLBACK]) {
    try {
      const result = (await env.AI.run(model, {
        messages: [
          { role: "system", content: DREAM_WORK_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.9,
      })) as Record<string, unknown>;
      const text = extractModelText(result);
      if (text) return { text, model };
      console.error(`[dream-compose] ${model} returned no usable text — trying next voice`);
    } catch (e) {
      console.error(`[dream-compose] ${model} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}
