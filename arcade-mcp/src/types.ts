/**
 * Arcade MCP Gateway Plugin — Type Declarations
 *
 * Provides type stubs for the OpenClaw plugin SDK, which is a peer
 * dependency provided at runtime by the OpenClaw gateway.
 */

// ============================================================================
// OpenClaw Plugin SDK Types
// ============================================================================

/**
 * Logger interface provided by the OpenClaw plugin runtime.
 */
export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

/**
 * Tool definition accepted by api.registerTool().
 */
export type PluginToolDef = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: unknown;
  }>;
};

/**
 * Gateway RPC method handler signature.
 */
export type GatewayMethodHandler = (ctx: {
  params?: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown) => void;
}) => Promise<void>;

/**
 * Chat command handler context.
 */
export type CommandContext = {
  args?: string;
};

/**
 * Chat command handler return value.
 */
export type CommandResult = {
  text: string;
};

/**
 * The OpenClaw plugin API surface provided to the `register()` function.
 * This is a subset of the actual API — only the methods this plugin uses.
 */
export type OpenClawPluginApi = {
  pluginConfig: unknown;
  logger: PluginLogger;

  registerTool(tool: PluginToolDef, opts?: { optional?: boolean }): void;

  registerGatewayMethod(name: string, handler: GatewayMethodHandler): void;

  registerCommand(cmd: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: CommandContext) => Promise<CommandResult>;
  }): void;

  registerCli(
    fn: (ctx: { program: unknown }) => void,
    opts?: { commands?: string[] },
  ): void;

  registerService(svc: {
    id: string;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }): void;
};
