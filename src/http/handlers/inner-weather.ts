// HTTP handler for /api/inner-weather — extracted from src/index.ts.
import { jsonResponse } from "../response";
import { handleMindInnerWeather } from "../../legacy-tools/inner-weather";
import type { Env } from "../../types";

export async function handleApiInnerWeather(env: Env): Promise<Response> {
  const output = await handleMindInnerWeather(env);
  try {
    return jsonResponse(JSON.parse(output));
  } catch {
    return jsonResponse({ output });
  }
}
