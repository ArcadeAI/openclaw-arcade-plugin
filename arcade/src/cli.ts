/**
 * Arcade CLI Commands
 *
 * Provides CLI commands for managing Arcade integration:
 * - arcade init
 * - arcade tools list
 * - arcade tools search
 * - arcade auth status
 * - arcade auth login
 * - arcade config show
 */

import type { Command } from "commander";
import type { ArcadeClient } from "./client.js";
import type { ArcadeConfig } from "./config.js";
import {
  cacheExists,
  isCacheValid,
  writeCache,
  getCachedTools,
  getCacheStats,
  getCacheFilePath,
  clearCache,
  type CachedTool,
} from "./cache.js";

// ============================================================================
// Types
// ============================================================================

export type ArcadeCliContext = {
  client: ArcadeClient;
  config: ArcadeConfig;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run init if cache doesn't exist or is invalid
 */
async function ensureCache(
  client: ArcadeClient,
  logger: ArcadeCliContext["logger"],
  opts?: { force?: boolean; silent?: boolean },
): Promise<boolean> {
  if (!opts?.force && isCacheValid()) {
    return true;
  }

  if (!client.isConfigured()) {
    if (!opts?.silent) {
      logger.error("Arcade API key not configured");
      logger.info(
        'Set ARCADE_API_KEY or run: openclaw config set plugins.entries.arcade.config.apiKey="<key>"',
      );
    }
    return false;
  }

  if (!opts?.silent) {
    logger.info("Initializing Arcade tools cache...");
  }

  try {
    const allTools = await client.listAllTools({
      batchSize: 250,
      onProgress: (fetched, total) => {
        if (!opts?.silent) {
          process.stdout.write(`\r  Fetched ${fetched}${total ? ` / ${total}` : ""} tools...`);
        }
      },
    });

    if (!opts?.silent) {
      console.log(); // newline after progress
    }

    const cache = writeCache(allTools);

    if (!opts?.silent) {
      logger.info(`Cached ${cache.total_tools} tools from ${cache.toolkits.length} toolkits`);
      logger.info(`Cache file: ${getCacheFilePath()}`);
    }

    return true;
  } catch (err) {
    if (!opts?.silent) {
      logger.error(`Failed to initialize cache: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

/**
 * Format age in human-readable form
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

// ============================================================================
// CLI Registration
// ============================================================================

export function registerArcadeCli(program: Command, ctx: ArcadeCliContext): void {
  const { client, config, logger } = ctx;

  const arcade = program.command("arcade").description("Arcade.dev tool integration commands");

  // ==========================================================================
  // Init Command
  // ==========================================================================

  arcade
    .command("init")
    .description("Initialize/refresh the local tools cache from Arcade API")
    .option("-f, --force", "Force refresh even if cache is valid")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const stats = getCacheStats();

      if (!opts.force && stats.valid) {
        if (opts.json) {
          console.log(JSON.stringify({ status: "valid", ...stats }, null, 2));
        } else {
          logger.info(`Cache is valid (${stats.totalTools} tools, updated ${formatAge(stats.ageMs!)})`);
          logger.info("Use --force to refresh anyway");
        }
        return;
      }

      const success = await ensureCache(client, logger, { force: true });

      if (opts.json) {
        const newStats = getCacheStats();
        console.log(
          JSON.stringify(
            {
              status: success ? "refreshed" : "failed",
              ...newStats,
            },
            null,
            2,
          ),
        );
      }
    });

  // ==========================================================================
  // Cache Command
  // ==========================================================================

  arcade
    .command("cache")
    .description("Manage the local tools cache")
    .option("--status", "Show cache status (default)")
    .option("--clear", "Clear the cache")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (opts.clear) {
        const cleared = clearCache();
        if (opts.json) {
          console.log(JSON.stringify({ cleared }));
        } else if (cleared) {
          logger.info("Cache cleared");
        } else {
          logger.info("No cache to clear");
        }
        return;
      }

      // Default: show status
      const stats = getCacheStats();

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log("\nArcade Cache Status:");
      console.log(`  File: ${getCacheFilePath()}`);
      console.log(`  Exists: ${stats.exists}`);
      console.log(`  Valid: ${stats.valid}`);

      if (stats.exists && stats.updatedAt) {
        console.log(`  Total Tools: ${stats.totalTools}`);
        console.log(`  Toolkits: ${stats.toolkits.length}`);
        console.log(`  Updated: ${stats.updatedAt} (${formatAge(stats.ageMs!)})`);

        if (stats.toolkits.length > 0) {
          console.log(`\n  Available Toolkits:`);
          for (const tk of stats.toolkits.slice(0, 20)) {
            console.log(`    - ${tk}`);
          }
          if (stats.toolkits.length > 20) {
            console.log(`    ... and ${stats.toolkits.length - 20} more`);
          }
        }
      }

      console.log();
    });

  // ==========================================================================
  // Tools Commands
  // ==========================================================================

  const tools = arcade.command("tools").description("Manage Arcade tools");

  tools
    .command("list")
    .description("List available Arcade tools")
    .option("-t, --toolkit <name>", "Filter by toolkit (e.g., Gmail, Slack)")
    .option("-a, --all", "Show all tools (not just summary)")
    .option("--no-cache", "Bypass cache and fetch directly from API")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        let toolList: CachedTool[];

        if (opts.cache === false) {
          // Fetch directly from API
          if (!client.isConfigured()) {
            logger.error("Arcade API key not configured");
            return;
          }

          const apiTools = await client.listAllTools();

          toolList = apiTools.map((t) => ({
            name: t.name,
            description: t.description,
            toolkit: typeof t.toolkit === "string" ? t.toolkit : t.toolkit?.name ?? "unknown",
            requires_auth: t.requires_auth,
          }));
        } else {
          // Use cache, auto-init if needed
          if (!cacheExists() || !isCacheValid()) {
            const success = await ensureCache(client, logger);
            if (!success) {
              return;
            }
          }

          toolList = getCachedTools({
            toolkit: opts.toolkit,
          });
        }

        if (opts.json) {
          console.log(JSON.stringify(toolList, null, 2));
          return;
        }

        if (toolList.length === 0) {
          logger.info("No tools found");
          return;
        }

        // Group by toolkit
        const byToolkit = new Map<string, CachedTool[]>();
        for (const tool of toolList) {
          const list = byToolkit.get(tool.toolkit) ?? [];
          list.push(tool);
          byToolkit.set(tool.toolkit, list);
        }

        // Sort toolkits: prefer *Api toolkits first, then alphabetically
        const sortedToolkits = Array.from(byToolkit.entries()).sort((a, b) => {
          const aIsApi = a[0].endsWith("Api");
          const bIsApi = b[0].endsWith("Api");
          if (aIsApi && !bIsApi) return -1;
          if (!aIsApi && bIsApi) return 1;
          return a[0].localeCompare(b[0]);
        });

        console.log(`\n${toolList.length} tools across ${sortedToolkits.length} toolkits:\n`);

        if (opts.all || opts.toolkit) {
          // Show all tools when --all flag or filtering by toolkit
          for (const [toolkit, tkTools] of sortedToolkits) {
            console.log(`${toolkit} (${tkTools.length} tools):`);
            for (const tool of tkTools) {
              const auth = tool.requires_auth ? " [auth]" : "";
              console.log(`  - ${tool.name}${auth}`);
            }
            console.log();
          }
        } else {
          // Show summary by toolkit
          console.log("Available Toolkits:");
          console.log("(Toolkits ending in 'Api' are preferred - they have more comprehensive coverage)\n");

          for (const [toolkit, tkTools] of sortedToolkits) {
            const isApi = toolkit.endsWith("Api");
            const marker = isApi ? "[preferred]" : "";
            console.log(`  ${toolkit}: ${tkTools.length} tools ${marker}`);
          }

          console.log("\n---");
          console.log("To list tools for a specific toolkit, use:");
          console.log("  arcade_list_tools with toolkit parameter (e.g., toolkit: \"Gmail\")");
          console.log("  or run: openclaw arcade tools list --toolkit <name>");
          console.log("\nNote: When multiple toolkits exist for a service (e.g., Github and GithubApi),");
          console.log("prefer the 'Api' version as it provides more complete API coverage.");
        }
      } catch (err) {
        logger.error(`Failed to list tools: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  tools
    .command("search <query>")
    .description("Search for Arcade tools by name or description")
    .option("--no-cache", "Bypass cache and fetch directly from API")
    .option("--json", "Output as JSON")
    .action(async (query, opts) => {
      try {
        let matches: CachedTool[];

        if (opts.cache === false) {
          // Fetch all tools from API
          if (!client.isConfigured()) {
            logger.error("Arcade API key not configured");
            return;
          }

          const allTools = await client.listAllTools();
          const lowerQuery = query.toLowerCase();

          matches = allTools
            .filter((t) => {
              const toolkitName = typeof t.toolkit === "string" ? t.toolkit : t.toolkit?.name ?? "";
              return (
                t.name.toLowerCase().includes(lowerQuery) ||
                t.description?.toLowerCase().includes(lowerQuery) ||
                toolkitName.toLowerCase().includes(lowerQuery)
              );
            })
            .map((t) => ({
              name: t.name,
              description: t.description,
              toolkit: typeof t.toolkit === "string" ? t.toolkit : t.toolkit?.name ?? "unknown",
              requires_auth: t.requires_auth,
            }));
        } else {
          // Use cache, auto-init if needed
          if (!cacheExists() || !isCacheValid()) {
            const success = await ensureCache(client, logger);
            if (!success) {
              return;
            }
          }

          matches = getCachedTools({ search: query });
        }

        if (opts.json) {
          console.log(JSON.stringify(matches, null, 2));
          return;
        }

        if (matches.length === 0) {
          logger.info(`No tools found matching "${query}"`);
          return;
        }

        console.log(`\nFound ${matches.length} tools matching "${query}":\n`);

        for (const tool of matches) {
          const auth = tool.requires_auth ? " [auth]" : "";
          console.log(`${tool.name}${auth}`);
          console.log(`  Toolkit: ${tool.toolkit}`);
          if (tool.description) {
            console.log(`  ${tool.description.slice(0, 100)}${tool.description.length > 100 ? "..." : ""}`);
          }
          console.log();
        }
      } catch (err) {
        logger.error(`Failed to search tools: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  tools
    .command("info <tool>")
    .description("Show detailed information about a tool")
    .action(async (toolName) => {
      try {
        // First check cache
        if (cacheExists()) {
          const cached = getCachedTools({ search: toolName });
          const exactMatch = cached.find(
            (t) => t.name.toLowerCase() === toolName.toLowerCase() || t.qualified_name === toolName,
          );

          if (exactMatch) {
            console.log(`\n${exactMatch.name}`);
            console.log(`${"=".repeat(exactMatch.name.length)}`);
            console.log(`Toolkit: ${exactMatch.toolkit}`);
            console.log(`Requires Auth: ${exactMatch.requires_auth ? "Yes" : "No"}`);
            if (exactMatch.auth_provider) {
              console.log(`Auth Provider: ${exactMatch.auth_provider}`);
            }
            console.log();
            console.log("Description:");
            console.log(`  ${exactMatch.description}`);
            console.log();
            console.log("(Use API for full parameter details: openclaw arcade tools info <tool> --no-cache)");
            console.log();
            return;
          }
        }

        // Fall back to API
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        const tool = await client.getTool(toolName);

        const toolkitName = typeof tool.toolkit === "string" ? tool.toolkit : tool.toolkit?.name ?? "unknown";
        console.log(`\n${tool.name}`);
        console.log(`${"=".repeat(tool.name.length)}`);
        console.log(`Toolkit: ${toolkitName}`);
        console.log(`Requires Auth: ${tool.requires_auth ? "Yes" : "No"}`);
        if (tool.auth_provider) {
          console.log(`Auth Provider: ${tool.auth_provider}`);
        }
        console.log();
        console.log("Description:");
        console.log(`  ${tool.description}`);

        if (tool.parameters?.properties) {
          console.log();
          console.log("Parameters:");
          for (const [name, param] of Object.entries(tool.parameters.properties)) {
            const required = tool.parameters.required?.includes(name) ? " (required)" : "";
            console.log(`  ${name}: ${param.type}${required}`);
            if (param.description) {
              console.log(`    ${param.description}`);
            }
          }
        }

        console.log();
      } catch (err) {
        logger.error(`Failed to get tool info: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  tools
    .command("execute <tool>")
    .description("Execute an Arcade tool")
    .option("-i, --input <json>", "Tool input as JSON string", "{}")
    .option("--json", "Output as JSON")
    .action(async (toolName, opts) => {
      try {
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        let input: Record<string, unknown>;
        try {
          input = JSON.parse(opts.input);
        } catch {
          logger.error("Invalid JSON input");
          return;
        }

        logger.info(`Executing ${toolName}...`);

        const result = await client.executeWithAuth(toolName, input, {
          onAuthRequired: async (authUrl) => {
            console.log(`\nAuthorization required. Please visit:\n${authUrl}\n`);
            console.log("Waiting for authorization...");
            return true; // Wait for auth
          },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log("\nSuccess!");
          console.log(JSON.stringify(result.output, null, 2));
        } else {
          logger.error(`Execution failed: ${result.error?.message}`);
          if (result.authorization_url) {
            console.log(`\nAuthorization required: ${result.authorization_url}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to execute tool: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  // ==========================================================================
  // Auth Commands
  // ==========================================================================

  const auth = arcade.command("auth").description("Manage Arcade authorization");

  auth
    .command("status")
    .description("Check authorization status for tools or toolkits")
    .option("-t, --tool <name>", "Check specific tool")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        if (opts.tool) {
          const response = await client.authorize(opts.tool);

          if (opts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(`\nTool: ${opts.tool}`);
          console.log(`Status: ${response.status}`);
          if (response.authorization_url) {
            console.log(`Auth URL: ${response.authorization_url}`);
          }
          if (response.scopes?.length) {
            console.log(`Scopes: ${response.scopes.join(", ")}`);
          }
        } else {
          // List all connections
          const connections = await client.listUserConnections();

          if (opts.json) {
            console.log(JSON.stringify(connections, null, 2));
            return;
          }

          console.log("\nAuthorized Connections:");
          if (Array.isArray(connections) && connections.length > 0) {
            for (const conn of connections) {
              console.log(`  - ${JSON.stringify(conn)}`);
            }
          } else {
            console.log("  No connections found");
          }
        }

        console.log();
      } catch (err) {
        logger.error(`Failed to check auth status: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  auth
    .command("login <tool>")
    .description("Initiate authorization for a tool")
    .action(async (toolName) => {
      try {
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        const response = await client.authorize(toolName);

        if (response.status === "completed") {
          logger.info(`Already authorized for ${toolName}`);
          return;
        }

        if (response.authorization_url) {
          console.log(`\nPlease visit the following URL to authorize ${toolName}:`);
          console.log(`\n  ${response.authorization_url}\n`);

          if (response.authorization_id) {
            logger.info("Waiting for authorization...");

            try {
              await client.waitForAuthorization(response.authorization_id, {
                timeoutMs: 300000, // 5 minutes
                onPoll: () => {
                  process.stdout.write(".");
                },
              });

              console.log();
              logger.info(`Successfully authorized ${toolName}`);
            } catch (err) {
              console.log();
              logger.error(
                `Authorization failed or timed out: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } else {
          logger.error("No authorization URL returned");
        }
      } catch (err) {
        logger.error(`Failed to initiate auth: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  auth
    .command("revoke <connectionId>")
    .description("Revoke an authorization connection")
    .action(async (connectionId) => {
      try {
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        await client.deleteUserConnection(connectionId);
        logger.info(`Revoked connection: ${connectionId}`);
      } catch (err) {
        logger.error(`Failed to revoke: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  // ==========================================================================
  // Config Commands
  // ==========================================================================

  arcade
    .command("config")
    .description("Show current Arcade configuration")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const safeConfig = {
        ...config,
        apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}...` : "(not set)",
      };

      if (opts.json) {
        console.log(JSON.stringify(safeConfig, null, 2));
        return;
      }

      console.log("\nArcade Configuration:");
      console.log(`  Enabled: ${config.enabled}`);
      console.log(`  API Key: ${safeConfig.apiKey}`);
      console.log(`  User ID: ${config.userId || "(not set)"}`);
      console.log(`  Base URL: ${config.baseUrl}`);
      console.log(`  Tool Prefix: ${config.toolPrefix}`);
      console.log(`  Auto Auth: ${config.autoAuth}`);
      console.log(`  Cache TTL: ${config.cacheToolsTtlMs}ms`);

      if (config.tools?.allow?.length || config.tools?.deny?.length) {
        console.log("\n  Tool Filters:");
        if (config.tools.allow?.length) {
          console.log(`    Allow: ${config.tools.allow.join(", ")}`);
        }
        if (config.tools.deny?.length) {
          console.log(`    Deny: ${config.tools.deny.join(", ")}`);
        }
      }

      if (config.toolkits && Object.keys(config.toolkits).length > 0) {
        console.log("\n  Toolkit Config:");
        for (const [id, cfg] of Object.entries(config.toolkits)) {
          console.log(`    ${id}: enabled=${cfg.enabled}`);
          if (cfg.tools?.length) {
            console.log(`      tools: ${cfg.tools.join(", ")}`);
          }
        }
      }

      // Show cache status
      const cacheStats = getCacheStats();
      console.log("\n  Cache Status:");
      console.log(`    File: ${getCacheFilePath()}`);
      console.log(`    Valid: ${cacheStats.valid}`);
      if (cacheStats.valid) {
        console.log(`    Tools: ${cacheStats.totalTools}`);
        console.log(`    Updated: ${formatAge(cacheStats.ageMs!)}`);
      }

      console.log();
    });

  // ==========================================================================
  // Health Check
  // ==========================================================================

  arcade
    .command("health")
    .description("Check Arcade API health")
    .action(async () => {
      try {
        if (!client.isConfigured()) {
          logger.error("Arcade API key not configured");
          return;
        }

        const health = await client.health();
        logger.info(`Arcade API is healthy: ${JSON.stringify(health)}`);
      } catch (err) {
        logger.error(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}
