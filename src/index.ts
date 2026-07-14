/**
 * Resonant Mind — Cloudflare Worker MCP Server.
 *
 * Persistent memory infrastructure accessible from anywhere. This file is
 * bootstrap only: the fetch handler dispatches to the HTTP router or the MCP
 * protocol handler; the scheduled handler kicks the daemon. Everything else
 * lives in regions, daemon, http, mcp, shared, legacy-tools.
 */

import { routeRequest } from "./http/router";
import { handleMcpProtocolRequest } from "./mcp/protocol";
import { createD1Adapter } from "./adapter";
import { createVectorAdapter } from "./vectors";
import { RESONANT_MIND_VERSION } from "./shared/constants";
import { TOOLS, mcpToolHandlers } from "./mcp/registry";
import { processSubconscious } from "./daemon";
import { handleApiEntities } from "./http/handlers/entities";
import { handleApiObservations } from "./http/handlers/observations";
import { handleApiThreads } from "./http/handlers/threads";
import { handleApiSearch } from "./http/handlers/search";
import { handleApiIdentity } from "./http/handlers/identity";
import { handleApiRelations } from "./http/handlers/relations";
import { handleApiImages } from "./http/handlers/images";
import { handleApiContext } from "./http/handlers/context";
import { handleApiBulkObservations } from "./http/handlers/bulk-observations";
import { handleApiHealth } from "./http/handlers/health";
import { handleApiRecent } from "./http/handlers/recent";
import { handleApiInnerWeather } from "./http/handlers/inner-weather";
import { handleApiProposals } from "./http/handlers/proposals";
import { handleApiOrphans } from "./http/handlers/orphans";
import { handleApiArchive } from "./http/handlers/archive";
import { handleApiObservationVersions } from "./http/handlers/observation-versions";
import { handleApiProcess, handleApiDream } from "./http/handlers/daemon";
import { handleApiCompass } from "./http/handlers/compass";
import { handleApiBonds } from "./http/handlers/bonds";
import { handleApiActiveOpen } from "./http/handlers/active-open";
import { handleApiWeatherTrend } from "./http/handlers/weather-trend";
import { handleApiLivingSurface } from "./http/handlers/living-surface";
import { handleApiDreamLast } from "./http/handlers/dream-last";
import { handleApiTelemetry } from "./http/handlers/telemetry";
import { handleApiDrivesEnv } from "./http/handlers/drives-env";
import { handleApiDreamComposeTest } from "./http/handlers/dream-compose-test";
import type { Env } from "./types";

async function handleMCPRequest(request: Request, env: Env): Promise<Response> {
  return handleMcpProtocolRequest(request, env, {
    serverName: "resonant-mind",
    serverVersion: RESONANT_MIND_VERSION,
    tools: TOOLS,
    toolHandlers: mcpToolHandlers,
  });
}

// Expose Postgres through the D1-shaped query adapter used by the cognitive
// core. Public v4 is Postgres-only; a missing Hyperdrive binding fails closed.
function withPostgresAdapters(env: Env): Env {
  if (!env.HYPERDRIVE?.connectionString) {
    throw new Error("HYPERDRIVE binding is required");
  }
  return {
    ...env,
    DB: createD1Adapter(env.HYPERDRIVE) as unknown as D1Database,
    VECTORS: createVectorAdapter(env.HYPERDRIVE.connectionString) as unknown as VectorizeIndex,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const mindEnv = withPostgresAdapters(env);
    return routeRequest(request, mindEnv, {
      processSubconscious,
      handleApiEntities,
      handleApiObservations,
      handleApiThreads,
      handleApiSearch,
      handleApiIdentity,
      handleApiRelations,
      handleApiImages,
      handleApiContext,
      handleApiBulkObservations,
      handleApiProcess,
      handleApiDream,
      handleApiHealth,
      handleApiRecent,
      handleApiInnerWeather,
      handleApiProposals,
      handleApiOrphans,
      handleApiArchive,
      handleApiObservationVersions,
      handleApiCompass,
      handleApiBonds,
      handleApiActiveOpen,
      handleApiWeatherTrend,
      handleApiLivingSurface,
      handleApiDreamLast,
      handleApiTelemetry,
      handleApiDrivesEnv,
      handleApiDreamComposeTest,
      handleMCPRequest,
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      processSubconscious(withPostgresAdapters(env)).catch((e) =>
        console.error("daemon failed:", e)
      )
    );
  },
};
