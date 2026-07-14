// HTTP handler for /api/health — extracted from src/index.ts.
import { jsonResponse } from "../response";
import { handleMindHealth } from "../../legacy-tools/health";
import type { Env } from "../../types";

export async function handleApiHealth(env: Env): Promise<Response> {
  const output = await handleMindHealth(env);
  return jsonResponse({ output });
}
