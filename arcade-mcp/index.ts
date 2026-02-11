/**
 * OpenClaw Arcade MCP Gateway Plugin
 *
 * Connects to one or more MCP gateways using Streamable HTTP transport
 * with user-provided headers. Supports centralized tool governance:
 * each gateway exposes its own curated set of tools — this plugin
 * discovers them via MCP and registers them as native OpenClaw tools.
 *
 * Key design constraints:
 *   - No hardcoded URLs, endpoints, or credentials
 *   - Every gateway is explicitly configured by the user
 *   - Headers are opaque — the plugin has no knowledge of their contents
 *   - The gateway governs tool access, not the client
 *
 * Configuration:
 * ```json5
 * {
 *   plugins: {
 *     entries: {
 *       "arcade-mcp": {
 *         enabled: true,
 *         config: {
 *           gateways: {
 *             sales: {
 *               url: "https://api.arcade.dev/mcp/sales",
 *               headers: {
 *                 "Authorization": "Bearer arc_sales_key",
 *                 "Arcade-User-ID": "sales-ops@company.com"
 *               }
 *             },
 *             marketing: {
 *               url: "https://api.arcade.dev/mcp/marketing",
 *               headers: {
 *                 "Authorization": "Bearer arc_marketing_key",
 *                 "Arcade-User-ID": "marketing@company.com"
 *               }
 *             },
 *             support: {
 *               url: "https://api.arcade.dev/mcp/support",
 *               headers: {
 *                 "Authorization": "Bearer arc_support_key",
 *                 "Arcade-User-ID": "support@company.com"
 *               }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { OpenClawPluginApi } from "./src/types.js";
import { resolvePluginConfig, resolveGateways, pluginConfigSchema } from "./src/config.js";
import { GatewayMcpClient, GatewayManager } from "./src/mcp-client.js";
import { registerGatewayTools, type RegisteredTool } from "./src/tools.js";
import { registerCli } from "./src/cli.js";

// ============================================================================
// Plugin State
// ============================================================================

let manager: GatewayManager | null = null;
let registeredTools: RegisteredTool[] = [];

// ============================================================================
// Plugin Definition
// ============================================================================

const arcadeMcpPlugin = {
  id: "arcade-mcp",
  name: "Arcade MCP Gateway",
  description:
    "Connect to MCP gateways with header-based auth for centralized tool governance.",
  configSchema: pluginConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = resolvePluginConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[arcade-mcp] Plugin disabled");
      return;
    }

    // ========================================================================
    // Resolve Gateways
    // ========================================================================

    const gateways = resolveGateways(config);

    if (gateways.length === 0) {
      api.logger.warn("[arcade-mcp] No gateways configured");
      return;
    }

    // ========================================================================
    // Create Gateway Clients
    // ========================================================================

    manager = new GatewayManager();

    for (const gw of gateways) {
      const client = new GatewayMcpClient(gw, {
        requestTimeoutMs: config.requestTimeoutMs,
      });
      manager.add(client);
      api.logger.info(`[arcade-mcp] Gateway '${gw.key}' queued (${gw.url})`);
    }

    // ========================================================================
    // Connect & Register Tools (async, non-blocking)
    // ========================================================================

    const gwMap = new Map(gateways.map((g) => [g.key, g]));

    const boot = async () => {
      if (!manager) return;

      // Connect all gateways in parallel
      const results = await manager.connectAll();

      for (const [key, result] of results.entries()) {
        if (result.ok) {
          api.logger.info(`[arcade-mcp] Gateway '${key}' connected`);
        } else {
          api.logger.warn(`[arcade-mcp] Gateway '${key}' failed: ${result.error}`);
        }
      }

      // Register tools from each connected gateway
      for (const client of manager.connected()) {
        const gwConfig = gwMap.get(client.key);
        if (!gwConfig) continue;

        const tools = registerGatewayTools(api, client, gwConfig);
        registeredTools.push(...tools);

        api.logger.info(
          `[arcade-mcp] Gateway '${client.key}': ${tools.length} tools registered`,
        );
      }

      api.logger.info(
        `[arcade-mcp] Ready — ${registeredTools.length} tools ` +
          `from ${manager.connected().length} gateway(s)`,
      );
    };

    boot().catch((err) => {
      api.logger.error(
        `[arcade-mcp] Boot error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // ========================================================================
    // Gateway RPC Methods
    // ========================================================================

    const sendError = (
      respond: (ok: boolean, payload?: unknown) => void,
      err: unknown,
    ) => {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    };

    // arcade-mcp.status — connection overview
    api.registerGatewayMethod("arcade-mcp.status", async ({ respond }) => {
      try {
        respond(true, {
          gateways: manager?.status() ?? [],
          totalTools: registeredTools.length,
        });
      } catch (err) {
        sendError(respond, err);
      }
    });

    // arcade-mcp.tools.list — enumerate registered tools
    api.registerGatewayMethod(
      "arcade-mcp.tools.list",
      async ({ params, respond }) => {
        try {
          const gwFilter =
            typeof params?.gateway === "string" ? params.gateway : undefined;

          const list = gwFilter
            ? registeredTools.filter((t) => t.gatewayKey === gwFilter)
            : registeredTools;

          respond(true, {
            count: list.length,
            tools: list.map((t) => ({
              name: t.name,
              mcpName: t.mcpName,
              gateway: t.gatewayKey,
              description: t.description,
            })),
          });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    // arcade-mcp.refresh — re-fetch tool lists from gateways
    api.registerGatewayMethod("arcade-mcp.refresh", async ({ respond }) => {
      try {
        await manager?.refreshAll();
        respond(true, {
          message: "Tools refreshed",
          gateways: manager?.status() ?? [],
        });
      } catch (err) {
        sendError(respond, err);
      }
    });

    // ========================================================================
    // Chat Command: /arcade-mcp
    // ========================================================================

    api.registerCommand({
      name: "arcade-mcp",
      description: "Arcade MCP gateway status and tools",
      acceptsArgs: true,
      requireAuth: true,

      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() || "status";

        // /arcade-mcp status (default)
        if (args === "status") {
          const statuses = manager?.status() ?? [];
          if (statuses.length === 0) {
            return { text: "Arcade MCP: no gateways configured." };
          }

          const lines = [`**Arcade MCP** (${statuses.length} gateway(s)):`];
          for (const s of statuses) {
            const icon = s.connected ? "✓" : "✗";
            const suffix = s.error ? ` — ${s.error}` : "";
            lines.push(
              `${icon} **${s.key}** — ${s.toolCount} tools — ${s.url}${suffix}`,
            );
          }
          lines.push(`\nTotal tools: ${registeredTools.length}`);
          return { text: lines.join("\n") };
        }

        // /arcade-mcp tools [gateway]
        if (args === "tools" || args.startsWith("tools ")) {
          const gwFilter = args.replace(/^tools\s*/, "").trim() || undefined;
          const list = gwFilter
            ? registeredTools.filter((t) => t.gatewayKey === gwFilter)
            : registeredTools;

          if (list.length === 0) {
            return {
              text: gwFilter
                ? `No tools found for gateway '${gwFilter}'.`
                : "No tools registered.",
            };
          }

          // Group by gateway
          const grouped = new Map<string, RegisteredTool[]>();
          for (const t of list) {
            const arr = grouped.get(t.gatewayKey) ?? [];
            arr.push(t);
            grouped.set(t.gatewayKey, arr);
          }

          const lines = [`**Tools** (${list.length} total):`];
          for (const [gw, gwTools] of grouped.entries()) {
            lines.push(`\n**${gw}** (${gwTools.length}):`);
            for (const t of gwTools.slice(0, 10)) {
              lines.push(`  • ${t.name} → ${t.mcpName}`);
            }
            if (gwTools.length > 10) {
              lines.push(`  … and ${gwTools.length - 10} more`);
            }
          }
          return { text: lines.join("\n") };
        }

        // /arcade-mcp gateways
        if (args === "gateways") {
          const statuses = manager?.status() ?? [];
          if (statuses.length === 0) {
            return { text: "No gateways configured." };
          }
          const lines = statuses.map(
            (s) =>
              `${s.connected ? "✓" : "✗"} **${s.key}** — ${s.toolCount} tools`,
          );
          return { text: lines.join("\n") };
        }

        return {
          text: "Usage: /arcade-mcp [status | tools [gateway] | gateways]",
        };
      },
    });

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) =>
        registerCli(program as Parameters<typeof registerCli>[0], {
          manager: manager!,
          tools: registeredTools,
          logger: api.logger,
        }),
      { commands: ["arcade-mcp"] },
    );

    // ========================================================================
    // Service Lifecycle
    // ========================================================================

    api.registerService({
      id: "arcade-mcp",

      start: async () => {
        api.logger.info(
          `[arcade-mcp] Service started — ` +
            `${registeredTools.length} tools, ` +
            `${manager?.connected().length ?? 0} gateway(s)`,
        );
      },

      stop: async () => {
        api.logger.info("[arcade-mcp] Shutting down…");
        await manager?.disconnectAll();
        manager = null;
        registeredTools = [];
        api.logger.info("[arcade-mcp] Service stopped");
      },
    });
  },
};

export default arcadeMcpPlugin;
