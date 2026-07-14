/**
 * Weather region — temperature. Interior state.
 *
 * Verbs (R2):
 *   - weather_notice  — current inner weather (mood + relational)
 *   - weather_log     — log a feeling toward someone (writes relational_state)
 *   - weather_trend   — mood trend over time from relational_state
 *
 * Wraps mind_inner_weather and parts of mind_feel_toward.
 */

import type { Env } from "../types";
import { handleMindInnerWeather } from "../legacy-tools/inner-weather";
import { handleMindFeelToward } from "../legacy-tools/feel-toward";
import { textureOf } from "../daemon/affect";
import { getSubconsciousState } from "../daemon/state";

export async function handleWeatherNotice(env: Env): Promise<string> {
  return handleMindInnerWeather(env);
}

export async function handleWeatherLog(env: Env, params: Record<string, unknown>): Promise<string> {
  const person = params.person as string | undefined;
  if (!person) return "weather_log needs `person`.";
  return handleMindFeelToward(env, params);
}

export async function handleWeatherTrend(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = (params.days as number | undefined) ?? 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let out = `=== WEATHER (last ${days} days) ===\n`;

  // 1. Mood curve from mood_log (limbic layer, 2026-07-02) — the real trend
  // line. Daily valence/arousal averages named via the affect textures.
  try {
    const moodDays = await env.DB.prepare(`
      SELECT
        DATE_TRUNC('day', logged_at) AS day,
        AVG(valence) AS v,
        AVG(arousal) AS a,
        COUNT(*) AS n,
        mode() WITHIN GROUP (ORDER BY dominant) AS dom
      FROM mood_log
      WHERE logged_at > $1 AND valence IS NOT NULL
      GROUP BY DATE_TRUNC('day', logged_at)
      ORDER BY day DESC
    `).bind(cutoff).all();

    const mRows = (moodDays.results || []) as Array<Record<string, unknown>>;
    if (mRows.length) {
      out += `\n**Mood curve:**\n`;
      for (const r of mRows) {
        const day = String(r.day).slice(0, 10);
        const v = Math.round(Number(r.v) * 100) / 100;
        const a = Math.round(Number(r.a) * 100) / 100;
        const vSign = v >= 0 ? '+' : '';
        out += `${day}: ${textureOf(v, a)} (valence ${vSign}${v}, arousal ${a}) — dominant: ${r.dom} [${r.n} ticks]\n`;
      }
    }
  } catch {
    /* mood_log may not exist yet — fall through to relational */
  }

  // Standing front, if the homeostat has named one.
  try {
    const subconscious = await getSubconsciousState(env);
    const front = ((subconscious as unknown as Record<string, unknown>)?.living_surface as Record<string, unknown> | undefined)
      ?.weather_front as { kind: string; days: number; avg_valence: number } | null | undefined;
    if (front) {
      out += `\n**Front:** ${front.kind === 'heavy' ? 'heavy' : 'bright spell'} for ${front.days} day${front.days > 1 ? 's' : ''} (avg valence ${front.avg_valence})\n`;
    }
  } catch { /* non-fatal */ }

  // 2. Feelings toward people (the original relational trend).
  const result = await env.DB.prepare(`
    SELECT
      DATE_TRUNC('day', timestamp) AS day,
      feeling,
      intensity,
      COUNT(*) AS n
    FROM relational_state
    WHERE timestamp > $1
    GROUP BY DATE_TRUNC('day', timestamp), feeling, intensity
    ORDER BY day DESC, n DESC
  `).bind(cutoff).all();

  const rows = (result.results || []) as Array<Record<string, unknown>>;
  if (rows.length) {
    const byDay: Record<string, { feeling: string; intensity: string; n: number }> = {};
    for (const r of rows) {
      const day = String(r.day).slice(0, 10);
      if (!byDay[day]) {
        byDay[day] = {
          feeling: r.feeling as string,
          intensity: r.intensity as string,
          n: Number(r.n),
        };
      }
    }
    out += `\n**Toward people:**\n`;
    for (const [day, top] of Object.entries(byDay)) {
      out += `${day}: ${top.feeling} (${top.intensity}) — ${top.n}x\n`;
    }
  } else if (out === `=== WEATHER (last ${days} days) ===\n`) {
    return `No weather recorded in the last ${days} days.`;
  }

  return out;
}
