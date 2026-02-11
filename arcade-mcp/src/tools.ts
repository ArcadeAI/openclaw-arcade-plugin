/**
 * Arcade MCP Gateway Plugin — Tool Registration
 *
 * Converts MCP tool definitions (JSON Schema input schemas) into
 * OpenClaw native tools (TypeBox parameter schemas) and binds each
 * tool to its originating gateway for correct execution routing.
 *
 * Tool naming convention:
 *   MCP name "Gmail_SendEmail" + gateway prefix "prod"
 *   → OpenClaw name "prod_gmail_send_email"
 */

import { Type, type TSchema, type TObject } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "./types.js";
import type { GatewayMcpClient, McpTool } from "./mcp-client.js";
import type { ResolvedGateway } from "./config.js";

// ============================================================================
// Types
// ============================================================================

/** Metadata for a tool that has been registered with OpenClaw. */
export type RegisteredTool = {
  /** OpenClaw-side name (e.g., "prod_gmail_send_email") */
  name: string;
  /** Original MCP tool name from the gateway (e.g., "Gmail_SendEmail") */
  mcpName: string;
  /** Tool description from the MCP definition */
  description: string;
  /** Key of the gateway this tool belongs to */
  gatewayKey: string;
};

// ============================================================================
// Name Conversion
// ============================================================================

/**
 * Convert an MCP tool name to a prefixed, snake_case OpenClaw tool name.
 *
 * Examples:
 *   ("Gmail_SendEmail", "prod")           → "prod_gmail_send_email"
 *   ("GoogleCalendar.ListEvents", "dev")  → "dev_google_calendar_list_events"
 *   ("Slack_PostMessage", "internal")     → "internal_slack_post_message"
 */
export function toOpenClawName(mcpName: string, prefix: string): string {
  // Split on underscores or dots (both conventions appear in Arcade MCP)
  const parts = mcpName.split(/[._]/);

  const snaked = parts
    .map((part) =>
      part
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, ""),
    )
    .join("_");

  return `${prefix}_${snaked}`;
}

// ============================================================================
// JSON Schema → TypeBox Conversion
// ============================================================================

/**
 * Convert a JSON Schema property definition to a TypeBox schema.
 *
 * MCP tool inputSchemas use standard JSON Schema (draft-07+).
 * We map the most common types; anything unknown falls back to Type.Unknown.
 */
function jsonSchemaToTypebox(
  schema: Record<string, unknown>,
  description?: string,
): TSchema {
  const desc = (schema.description as string) ?? description;
  const type = schema.type as string | undefined;

  switch (type) {
    case "string": {
      const enumValues = schema.enum as string[] | undefined;
      if (enumValues?.length) {
        return Type.Union(
          enumValues.map((v) => Type.Literal(v)),
          { description: desc },
        );
      }
      return Type.String({ description: desc, default: schema.default as string });
    }

    case "number":
    case "integer":
      return Type.Number({ description: desc, default: schema.default as number });

    case "boolean":
      return Type.Boolean({ description: desc, default: schema.default as boolean });

    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      return Type.Array(
        items ? jsonSchemaToTypebox(items) : Type.Unknown(),
        { description: desc },
      );
    }

    case "object": {
      const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        const required = new Set((schema.required as string[]) ?? []);
        const mapped: Record<string, TSchema> = {};
        for (const [key, propSchema] of Object.entries(props)) {
          const ts = jsonSchemaToTypebox(propSchema);
          mapped[key] = required.has(key) ? ts : Type.Optional(ts);
        }
        return Type.Object(mapped, { description: desc });
      }
      return Type.Object({}, { description: desc, additionalProperties: true });
    }

    default:
      return Type.Unknown({ description: desc });
  }
}

/**
 * Convert an MCP tool's `inputSchema` to a TypeBox TObject
 * suitable for OpenClaw's tool parameter declaration.
 */
function mcpInputSchemaToTypebox(tool: McpTool): TObject {
  const schema = tool.inputSchema;
  if (!schema?.properties) return Type.Object({});

  const required = new Set((schema.required as string[]) ?? []);
  const properties: Record<string, TSchema> = {};

  for (const [key, propSchema] of Object.entries(
    schema.properties as Record<string, Record<string, unknown>>,
  )) {
    const ts = jsonSchemaToTypebox(propSchema);
    properties[key] = required.has(key) ? ts : Type.Optional(ts);
  }

  return Type.Object(properties);
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register every MCP tool from a connected gateway as a native OpenClaw tool.
 *
 * Each registered tool:
 *   - Has a gateway-prefixed name (e.g., "prod_gmail_send_email")
 *   - Has its parameters converted from JSON Schema to TypeBox
 *   - Routes execution through the originating gateway's MCP connection
 *   - Passes through the gateway's client-side tool filter
 *
 * @param api     The OpenClaw plugin API for tool registration.
 * @param client  A connected GatewayMcpClient with a populated tool list.
 * @param gateway The resolved gateway config (prefix, etc.).
 * @returns An array of metadata for every tool that was registered.
 */
export function registerGatewayTools(
  api: OpenClawPluginApi,
  client: GatewayMcpClient,
  gateway: ResolvedGateway,
): RegisteredTool[] {
  const registered: RegisteredTool[] = [];

  for (const mcpTool of client.getTools()) {
    const openclawName = toOpenClawName(mcpTool.name, gateway.toolPrefix);

    const openclawTool = {
      name: openclawName,
      label: `${mcpTool.name} [${gateway.key}]`,
      description: `[${gateway.key}] ${mcpTool.description ?? mcpTool.name}`,
      parameters: mcpInputSchemaToTypebox(mcpTool),

      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const json = (payload: unknown) => ({
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });

        try {
          if (!client.connected) {
            return json({
              error: `Gateway '${gateway.key}' is not connected`,
              help: "Check gateway status with: /arcade-mcp status",
            });
          }

          api.logger.info(`[arcade-mcp] ${gateway.key} → ${mcpTool.name}`);

          const result = await client.callTool(mcpTool.name, params);

          // Handle MCP-level errors
          if (result.isError) {
            const errorText = (result.content ?? [])
              .filter((c) => c.type === "text")
              .map((c) => ("text" in c ? c.text : ""))
              .join("\n");

            return json({
              error: errorText || "Tool execution failed",
              tool: mcpTool.name,
              gateway: gateway.key,
            });
          }

          // Extract text content parts from the MCP result
          const textParts = (result.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => ("text" in c ? c.text : ""));

          // If the result is a single JSON string, parse it for structured output
          if (textParts?.length === 1) {
            try {
              const parsed = JSON.parse(textParts[0] as string);
              return json({
                success: true,
                output: parsed,
                tool: mcpTool.name,
                gateway: gateway.key,
              });
            } catch {
              // Not JSON — fall through to raw text
            }
          }

          return json({
            success: true,
            output: textParts?.join("\n") ?? null,
            tool: mcpTool.name,
            gateway: gateway.key,
          });
        } catch (err) {
          api.logger.error(
            `[arcade-mcp] ${gateway.key}/${mcpTool.name}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          return json({
            error: err instanceof Error ? err.message : String(err),
            tool: mcpTool.name,
            gateway: gateway.key,
          });
        }
      },
    };

    api.registerTool(openclawTool, { optional: true });

    registered.push({
      name: openclawName,
      mcpName: mcpTool.name,
      description: mcpTool.description ?? "",
      gatewayKey: gateway.key,
    });
  }

  return registered;
}
