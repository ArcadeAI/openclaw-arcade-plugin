/**
 * Arcade MCP Gateway Plugin — CLI Commands
 *
 * Provides management commands under the `arcade-mcp` namespace:
 *
 *   openclaw arcade-mcp:status                Show gateway connection status
 *   openclaw arcade-mcp:tools [--gw <key>]    List registered tools
 *   openclaw arcade-mcp:refresh               Re-fetch tool lists from gateways
 *   openclaw arcade-mcp:reconnect [--gw <key>] Reconnect all or one gateway
 */

import type { GatewayManager } from "./mcp-client.js";
import type { RegisteredTool } from "./tools.js";
import type { PluginLogger } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export type CliContext = {
  manager: GatewayManager;
  tools: RegisteredTool[];
  logger: PluginLogger;
};

// ============================================================================
// Types (Commander subset — provided by OpenClaw at runtime)
// ============================================================================

type CliCommand = {
  description(desc: string): CliCommand;
  option(flags: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => Promise<void>): CliCommand;
};

type CliProgram = {
  command(name: string): CliCommand;
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all CLI commands under the `arcade-mcp` namespace.
 */
export function registerCli(program: CliProgram, ctx: CliContext): void {
  const { manager, tools, logger } = ctx;

  // ==========================================================================
  // arcade-mcp:status
  // ==========================================================================

  program
    .command("arcade-mcp:status")
    .description("Show MCP gateway connection status")
    .action(async () => {
      const statuses = manager.status();

      if (statuses.length === 0) {
        console.log("No gateways configured.");
        return;
      }

      console.log(`\nArcade MCP Gateways (${statuses.length}):\n`);

      for (const s of statuses) {
        const icon = s.connected ? "✓" : "✗";
        const state = s.connected ? "connected" : "disconnected";
        console.log(`  ${icon} ${s.key}`);
        console.log(`    URL:    ${s.url}`);
        console.log(`    Status: ${state}`);
        console.log(`    Tools:  ${s.toolCount}`);
        if (s.error) {
          console.log(`    Error:  ${s.error}`);
        }
        console.log();
      }

      console.log(`Total registered tools: ${tools.length}`);
    });

  // ==========================================================================
  // arcade-mcp:tools
  // ==========================================================================

  program
    .command("arcade-mcp:tools")
    .description("List tools from MCP gateways")
    .option("--gw <key>", "Filter by gateway key")
    .option("--json", "Output as JSON")
    .action(async (...args: unknown[]) => {
      const opts = (args.at(-1) ?? {}) as { gw?: string; json?: boolean };
      const filtered = opts.gw
        ? tools.filter((t) => t.gatewayKey === opts.gw)
        : tools;

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log(
          opts.gw
            ? `No tools found for gateway '${opts.gw}'.`
            : "No tools registered.",
        );
        return;
      }

      // Group by gateway
      const grouped = new Map<string, RegisteredTool[]>();
      for (const tool of filtered) {
        const list = grouped.get(tool.gatewayKey) ?? [];
        list.push(tool);
        grouped.set(tool.gatewayKey, list);
      }

      console.log(`\nArcade MCP Tools (${filtered.length} total):\n`);

      for (const [gw, gwTools] of grouped.entries()) {
        console.log(`  ${gw} (${gwTools.length} tools):`);
        for (const tool of gwTools.slice(0, 20)) {
          console.log(`    • ${tool.name}  →  ${tool.mcpName}`);
        }
        if (gwTools.length > 20) {
          console.log(`    … and ${gwTools.length - 20} more`);
        }
        console.log();
      }
    });

  // ==========================================================================
  // arcade-mcp:refresh
  // ==========================================================================

  program
    .command("arcade-mcp:refresh")
    .description("Refresh tool lists from connected gateways")
    .action(async () => {
      logger.info("[arcade-mcp] Refreshing tools from all gateways…");

      await manager.refreshAll();

      const statuses = manager.status();
      for (const s of statuses) {
        const icon = s.connected ? "✓" : "✗";
        console.log(`  ${icon} ${s.key}: ${s.toolCount} tools`);
      }
    });

  // ==========================================================================
  // arcade-mcp:reconnect
  // ==========================================================================

  program
    .command("arcade-mcp:reconnect")
    .description("Reconnect MCP gateways")
    .option("--gw <key>", "Reconnect a specific gateway (omit for all)")
    .action(async (...args: unknown[]) => {
      const opts = (args.at(-1) ?? {}) as { gw?: string };
      if (opts.gw) {
        // Reconnect a single gateway
        const client = manager.get(opts.gw);
        if (!client) {
          console.log(`Gateway '${opts.gw}' not found.`);
          return;
        }

        logger.info(`[arcade-mcp] Reconnecting gateway '${opts.gw}'…`);
        await client.disconnect();

        try {
          await client.connect();
          console.log(`  ✓ ${opts.gw}: reconnected (${client.getTools().length} tools)`);
        } catch (err) {
          console.log(
            `  ✗ ${opts.gw}: failed — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // Reconnect all gateways
        logger.info("[arcade-mcp] Reconnecting all gateways…");

        // Disconnect first, then reconnect
        for (const client of manager.all()) {
          await client.disconnect();
        }

        const results = await manager.connectAll();
        for (const [key, result] of results.entries()) {
          const icon = result.ok ? "✓" : "✗";
          const msg = result.ok ? "connected" : `failed — ${result.error}`;
          console.log(`  ${icon} ${key}: ${msg}`);
        }
      }
    });
}
