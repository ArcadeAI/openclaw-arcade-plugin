/**
 * Arcade MCP Gateway Plugin — Configuration
 *
 * Defines the configuration schema for connecting to MCP gateways.
 * All values are user-provided: URLs and headers.
 * There are no defaults, no hardcoded endpoints, no implicit credentials.
 *
 * The `gateways` map is the sole configuration surface. Each entry
 * represents a discrete MCP connection with its own URL and headers.
 *
 * Tool governance is entirely server-side — the gateway controls which
 * tools are visible. There is no client-side filtering.
 */

import { z } from "zod";

// ============================================================================
// Schema Definitions
// ============================================================================

export const GatewaySchema = z.object({
  /** Whether this gateway connection is active */
  enabled: z.boolean().default(true),
  /** MCP endpoint URL — must be provided, no default */
  url: z.string().min(1, "Gateway URL is required"),
  /** HTTP headers sent with every MCP request (e.g., Authorization, Arcade-User-ID) */
  headers: z.record(z.string(), z.string()),
  /** Override the tool-name prefix; defaults to the gateway key */
  toolPrefix: z.string().optional(),
});

export const PluginConfigSchema = z.object({
  /** Master switch for the plugin */
  enabled: z.boolean().default(true),
  /** Named gateway connections */
  gateways: z.record(z.string(), GatewaySchema),
  /** Timeout for individual MCP requests (ms) */
  requestTimeoutMs: z.number().default(30000),
});

// ============================================================================
// Types
// ============================================================================

export type GatewayConfig = z.infer<typeof GatewaySchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

/**
 * Fully resolved gateway ready for connection.
 * Contains everything the MCP client needs to connect and register tools.
 */
export type ResolvedGateway = {
  /** Config key (e.g., "prod", "dev") — also the default tool prefix */
  key: string;
  /** MCP endpoint URL */
  url: string;
  /** HTTP headers (Authorization, Arcade-User-ID, custom tokens, …) */
  headers: Record<string, string>;
  /** Prefix prepended to every tool name from this gateway */
  toolPrefix: string;
};

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Parse and validate raw plugin config.
 * Throws a ZodError if the input is invalid.
 */
export function resolvePluginConfig(raw: unknown): PluginConfig {
  return PluginConfigSchema.parse(raw ?? { gateways: {} });
}

/**
 * Extract the list of enabled, valid gateways from a parsed config.
 * Gateways that are disabled or missing a URL are silently skipped.
 */
export function resolveGateways(config: PluginConfig): ResolvedGateway[] {
  const gateways: ResolvedGateway[] = [];

  for (const [key, gw] of Object.entries(config.gateways)) {
    if (!gw.enabled) continue;
    if (!gw.url) continue;

    gateways.push({
      key,
      url: gw.url,
      headers: gw.headers,
      toolPrefix: gw.toolPrefix ?? key,
    });
  }

  return gateways;
}

// ============================================================================
// OpenClaw Plugin Schema Export
// ============================================================================

/**
 * Schema wrapper consumed by OpenClaw's plugin registration system.
 */
export const pluginConfigSchema = {
  parse(value: unknown): PluginConfig {
    return resolvePluginConfig(value);
  },
};
