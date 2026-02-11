/**
 * Arcade MCP Gateway Plugin — MCP Client
 *
 * Manages MCP connections to one or more gateways using Streamable HTTP
 * transport (with SSE fallback). Authentication is handled entirely via
 * user-configured HTTP headers — the client is transport-agnostic and
 * has zero knowledge of what the headers contain.
 *
 * Each gateway runs as an independent connection with its own lifecycle.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ResolvedGateway } from "./config.js";

// ============================================================================
// Constants
// ============================================================================

const CLIENT_NAME = "openclaw-arcade-mcp";
const CLIENT_VERSION = "2026.2.11";

// ============================================================================
// Types
// ============================================================================

/** An MCP tool definition as returned by tools/list. */
export type McpTool = Tool;

/** The result of an MCP tools/call invocation. */
export type McpCallResult = CallToolResult;

/** Snapshot of a gateway connection's current state. */
export type GatewayStatus = {
  key: string;
  url: string;
  connected: boolean;
  toolCount: number;
  error?: string;
};

// ============================================================================
// GatewayMcpClient — Single Gateway Connection
// ============================================================================

/**
 * Manages the MCP client connection to a single gateway.
 *
 * Lifecycle:
 *   1. `connect()` — establish the MCP session and discover tools
 *   2. `callTool()` — invoke a tool on the gateway
 *   3. `refreshTools()` — re-fetch the tool list
 *   4. `disconnect()` — tear down the session
 */
export class GatewayMcpClient {
  /** Gateway config key (e.g., "prod", "dev") */
  readonly key: string;
  /** MCP endpoint URL */
  readonly url: string;

  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  private client: Client | null = null;
  private tools: McpTool[] = [];
  private _connected = false;
  private _error: string | null = null;

  constructor(gateway: ResolvedGateway, opts?: { requestTimeoutMs?: number }) {
    this.key = gateway.key;
    this.url = gateway.url;
    this.headers = gateway.headers;
    this.timeoutMs = opts?.requestTimeoutMs ?? 30000;
  }

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  /**
   * Connect to the MCP gateway.
   *
   * Tries Streamable HTTP transport first. If the gateway does not support
   * it, falls back to SSE transport. Both transports send the configured
   * headers with every request.
   *
   * On success, the tool list is automatically populated via `refreshTools()`.
   *
   * @throws Error if both transports fail.
   */
  async connect(): Promise<void> {
    try {
      const requestInit: RequestInit = { headers: this.headers };
      const clientInfo = { name: `${CLIENT_NAME}-${this.key}`, version: CLIENT_VERSION };
      const clientOpts = { capabilities: {} };

      // Attempt 1: Streamable HTTP
      try {
        const transport = new StreamableHTTPClientTransport(new URL(this.url), { requestInit });
        this.client = new Client(clientInfo, clientOpts);
        await this.client.connect(transport);
      } catch (streamableError) {
        // Attempt 2: SSE fallback
        try {
          const transport = new SSEClientTransport(new URL(this.url), { requestInit });
          this.client = new Client(clientInfo, clientOpts);
          await this.client.connect(transport);
        } catch {
          // SSE also failed — throw the original Streamable HTTP error
          // because it's more likely to contain a useful message.
          throw streamableError;
        }
      }

      this._connected = true;
      this._error = null;

      // Populate the tool list immediately after connecting
      await this.refreshTools();
    } catch (err) {
      this._connected = false;
      this._error = err instanceof Error ? err.message : String(err);
      this.client = null;
      throw err;
    }
  }

  /**
   * Disconnect from the gateway and release resources.
   * Safe to call even if already disconnected.
   */
  async disconnect(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // Swallow close errors — the connection may already be dead.
    } finally {
      this.client = null;
      this._connected = false;
      this.tools = [];
    }
  }

  /** Whether the MCP session is currently active. */
  get connected(): boolean {
    return this._connected;
  }

  /** Last error message, or null if the connection is healthy. */
  get lastError(): string | null {
    return this._error;
  }

  // ==========================================================================
  // Tool Discovery
  // ==========================================================================

  /**
   * (Re-)fetch the tool list from the gateway via MCP `tools/list`.
   *
   * @returns The refreshed tool list.
   * @throws Error if the client is not connected.
   */
  async refreshTools(): Promise<McpTool[]> {
    if (!this.client || !this._connected) {
      throw new Error(`Gateway '${this.key}' is not connected`);
    }

    const result = await this.client.listTools();
    this.tools = result.tools;
    return this.tools;
  }

  /**
   * Get the currently cached tool list (last result of `refreshTools()`).
   * Does not make a network call.
   */
  getTools(): McpTool[] {
    return this.tools;
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

  /**
   * Call a tool on this gateway via MCP `tools/call`.
   *
   * @param name  The MCP tool name (as returned by `tools/list`).
   * @param args  The tool input arguments.
   * @returns The MCP call result.
   * @throws Error if the client is not connected or the request times out.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.client || !this._connected) {
      throw new Error(`Gateway '${this.key}' is not connected`);
    }

    return (await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.timeoutMs },
    )) as McpCallResult;
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  /** Return a snapshot of this gateway's current state. */
  getStatus(): GatewayStatus {
    return {
      key: this.key,
      url: this.url,
      connected: this._connected,
      toolCount: this.tools.length,
      error: this._error ?? undefined,
    };
  }
}

// ============================================================================
// GatewayManager — Multi-Gateway Orchestrator
// ============================================================================

/**
 * Manages multiple independent MCP gateway connections.
 *
 * Each gateway connects, discovers tools, and executes calls in isolation.
 * The manager provides bulk operations (connect all, refresh all, status)
 * and a lookup interface for finding which gateway owns a given tool.
 */
export class GatewayManager {
  private readonly clients = new Map<string, GatewayMcpClient>();

  /** Register a gateway client. Does not connect yet. */
  add(client: GatewayMcpClient): void {
    this.clients.set(client.key, client);
  }

  /**
   * Connect all registered gateways in parallel.
   * Returns per-gateway results; continues even if some fail.
   */
  async connectAll(): Promise<Map<string, { ok: boolean; error?: string }>> {
    const results = new Map<string, { ok: boolean; error?: string }>();

    await Promise.allSettled(
      [...this.clients.entries()].map(async ([key, client]) => {
        try {
          await client.connect();
          results.set(key, { ok: true });
        } catch (err) {
          results.set(key, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return results;
  }

  /** Disconnect all gateways and clear the client registry. */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((c) => c.disconnect()));
    this.clients.clear();
  }

  /** Look up a gateway client by key. */
  get(key: string): GatewayMcpClient | undefined {
    return this.clients.get(key);
  }

  /** All registered gateway clients (connected or not). */
  all(): GatewayMcpClient[] {
    return [...this.clients.values()];
  }

  /** Only the currently connected gateway clients. */
  connected(): GatewayMcpClient[] {
    return this.all().filter((c) => c.connected);
  }

  /** Status snapshot for every registered gateway. */
  status(): GatewayStatus[] {
    return this.all().map((c) => c.getStatus());
  }

  /** Refresh tool lists on all connected gateways in parallel. */
  async refreshAll(): Promise<void> {
    await Promise.allSettled(this.connected().map((c) => c.refreshTools()));
  }
}
