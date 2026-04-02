/**
 * Arcade.dev API Client
 *
 * Wraps the official @arcadeai/arcadejs SDK for OpenClaw integration.
 */

import { Arcade, type ClientOptions } from "@arcadeai/arcadejs";
import type { ToolDefinition, ExecuteToolResponse } from "@arcadeai/arcadejs/resources/tools/tools";
import type { AuthorizationResponse } from "@arcadeai/arcadejs/resources/shared";
import type { ArcadeConfig } from "./config.js";

// ============================================================================
// Types - Re-export SDK types with our naming conventions
// ============================================================================

export type ArcadeToolParameter = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: ArcadeToolParameter;
  properties?: Record<string, ArcadeToolParameter>;
};

export type ArcadeToolkit = {
  name: string;
  description?: string;
  version?: string;
};

export type ArcadeToolDefinition = {
  name: string;
  fully_qualified_name?: string;
  qualified_name?: string;
  description: string;
  toolkit: ArcadeToolkit;
  input?: {
    parameters?: Array<{
      name: string;
      required?: boolean;
      description?: string;
      value_schema?: {
        val_type?: string;
        enum?: string[];
      };
      inferrable?: boolean;
    }>;
  };
  requires_auth?: boolean;
  auth_provider?: string;
  auth_provider_id?: string;
  auth_scopes?: string[];
  // Legacy format support
  parameters?: {
    type: "object";
    properties?: Record<string, ArcadeToolParameter>;
    required?: string[];
  };
};

export type ArcadeAuthStatus = "completed" | "pending" | "failed";

export type ArcadeAuthResponse = {
  status: ArcadeAuthStatus;
  authorization_id?: string;
  authorization_url?: string;
  scopes?: string[];
  context?: Record<string, unknown>;
};

export type ArcadeExecuteResult = {
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  authorization_required?: boolean;
  authorization_url?: string;
};

// ============================================================================
// Client Implementation - Wraps @arcadeai/arcadejs SDK
// ============================================================================

export type ArcadeClientOptions = {
  /** Maximum retries on transient errors */
  maxRetries?: number;
  /** Request timeout (ms) */
  timeoutMs?: number;
};

export class ArcadeClient {
  private _sdk: Arcade | null = null;
  private userId: string;
  private baseUrl: string;
  private apiKey: string;
  private toolsCache: Map<string, { tools: ArcadeToolDefinition[]; timestamp: number }> = new Map();
  private cacheTtlMs: number;
  private sdkOptions: ClientOptions;

  constructor(config: ArcadeConfig, options?: ArcadeClientOptions) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey ?? "";
    this.userId = config.userId ?? "";
    this.cacheTtlMs = config.cacheToolsTtlMs;

    // Store SDK options for lazy initialization
    this.sdkOptions = {
      apiKey: this.apiKey || undefined,
      baseURL: this.baseUrl,
      maxRetries: options?.maxRetries ?? 3,
      timeout: options?.timeoutMs ?? 30000,
    };
  }

  /**
   * Get the SDK instance, creating it lazily if needed.
   * Throws if not configured (no API key).
   */
  private get sdk(): Arcade {
    if (!this._sdk) {
      if (!this.apiKey) {
        throw new Error("Arcade API key not configured");
      }
      this._sdk = new Arcade(this.sdkOptions);
    }
    return this._sdk;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update client configuration
   */
  configure(config: Partial<{ apiKey: string; userId: string; baseUrl: string }>) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.userId !== undefined) this.userId = config.userId;
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl.replace(/\/$/, "");

    // Update SDK options and invalidate cached SDK
    this.sdkOptions = {
      ...this.sdkOptions,
      apiKey: this.apiKey || undefined,
      baseURL: this.baseUrl,
    };
    this._sdk = null;
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Get current user ID
   */
  getUserId(): string {
    return this.userId;
  }

  /**
   * Get the underlying SDK instance for advanced usage.
   * Throws if not configured (no API key).
   */
  getSdk(): Arcade {
    return this.sdk; // Uses lazy getter
  }

  // ==========================================================================
  // Health & Config
  // ==========================================================================

  /**
   * Check API health
   */
  async health(): Promise<{ status: string }> {
    const result = await this.sdk.health.check();
    return { status: result.healthy ? "healthy" : "unhealthy" };
  }

  /**
   * Get engine configuration
   */
  async getConfig(): Promise<Record<string, unknown>> {
    // SDK doesn't have a direct config endpoint, use health as proxy
    const health = await this.sdk.health.check();
    return health as unknown as Record<string, unknown>;
  }

  // ==========================================================================
  // Tools
  // ==========================================================================

  /**
   * Convert SDK ToolDefinition to our ArcadeToolDefinition format
   */
  private convertToolDefinition(tool: ToolDefinition): ArcadeToolDefinition {
    // Use fully_qualified_name (e.g., "Gmail.SendEmail") as the name for tool registration
    // This ensures proper naming convention like arcade_gmail_send_email
    return {
      name: tool.fully_qualified_name || `${tool.toolkit.name}.${tool.name}`,
      fully_qualified_name: tool.fully_qualified_name,
      qualified_name: tool.qualified_name,
      description: tool.description ?? "",
      toolkit: {
        name: tool.toolkit.name,
        description: tool.toolkit.description,
        version: tool.toolkit.version,
      },
      input: tool.input ? {
        parameters: tool.input.parameters?.map(p => ({
          name: p.name,
          required: p.required,
          description: p.description,
          value_schema: p.value_schema ? {
            val_type: p.value_schema.val_type,
            enum: p.value_schema.enum,
          } : undefined,
          inferrable: p.inferrable,
        })),
      } : undefined,
      requires_auth: tool.requirements?.authorization?.oauth2 !== undefined ||
                     tool.requirements?.authorization?.custom !== undefined,
      auth_provider_id: tool.requirements?.authorization?.oauth2?.provider_id,
      auth_scopes: tool.requirements?.authorization?.oauth2?.scopes,
    };
  }

  /**
   * List available tools, optionally filtered by toolkit
   */
  async listTools(opts?: {
    toolkit?: string;
    limit?: number;
    offset?: number;
    forceRefresh?: boolean;
  }): Promise<ArcadeToolDefinition[]> {
    const cacheKey = opts?.toolkit ?? "__all__";
    const cached = this.toolsCache.get(cacheKey);

    // Return cached if valid and not forcing refresh
    if (cached && !opts?.forceRefresh && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.tools;
    }

    const response = await this.sdk.tools.list({
      toolkit: opts?.toolkit,
      limit: opts?.limit,
      offset: opts?.offset,
    });

    const tools = response.items.map(t => this.convertToolDefinition(t));

    // Cache the result
    this.toolsCache.set(cacheKey, {
      tools,
      timestamp: Date.now(),
    });

    return tools;
  }

  /**
   * Fetch all available tools with pagination
   * @param opts.batchSize - Number of tools to fetch per request (default: 250)
   * @param opts.onProgress - Callback for progress updates
   */
  async listAllTools(opts?: {
    batchSize?: number;
    onProgress?: (fetched: number, total: number | null) => void;
  }): Promise<ArcadeToolDefinition[]> {
    const batchSize = opts?.batchSize ?? 250;
    const allTools: ArcadeToolDefinition[] = [];
    let offset = 0;
    let totalCount: number | null = null;

    while (true) {
      const response = await this.sdk.tools.list({
        limit: batchSize,
        offset,
      });

      if (totalCount === null) {
        totalCount = response.total_count ?? null;
      }

      const tools = response.items.map(t => this.convertToolDefinition(t));
      allTools.push(...tools);
      opts?.onProgress?.(allTools.length, totalCount);

      // Check if we've fetched all tools
      if (response.items.length === 0 || (totalCount !== null && allTools.length >= totalCount)) {
        break;
      }

      offset += batchSize;
    }

    // Update in-memory cache with all tools
    this.toolsCache.set("__all__", {
      tools: allTools,
      timestamp: Date.now(),
    });

    return allTools;
  }

  /**
   * Get a specific tool definition
   */
  async getTool(toolName: string): Promise<ArcadeToolDefinition> {
    const tool = await this.sdk.tools.get(toolName);
    return this.convertToolDefinition(tool);
  }

  /**
   * Get tools formatted for a specific LLM provider (OpenAI, Anthropic)
   */
  async getFormattedTools(
    provider: "openai" | "anthropic",
    toolkit?: string,
  ): Promise<unknown[]> {
    const response = await this.sdk.tools.formatted.list({
      format: provider,
      toolkit,
    });
    return response.items;
  }

  // ==========================================================================
  // Authorization
  // ==========================================================================

  /**
   * Convert SDK AuthorizationResponse to our format
   */
  private convertAuthResponse(response: AuthorizationResponse): ArcadeAuthResponse {
    return {
      status: response.status as ArcadeAuthStatus,
      authorization_id: response.id,
      authorization_url: response.url,
      scopes: response.scopes,
      context: response.context as Record<string, unknown>,
    };
  }

  /**
   * Initiate authorization for a tool
   */
  async authorize(toolName: string, userId?: string): Promise<ArcadeAuthResponse> {
    const response = await this.sdk.tools.authorize({
      tool_name: toolName,
      user_id: userId ?? this.userId,
    });
    return this.convertAuthResponse(response);
  }

  /**
   * Check authorization status
   */
  async checkAuthStatus(authorizationId: string): Promise<ArcadeAuthResponse> {
    const response = await this.sdk.auth.status({
      id: authorizationId,
    });
    return this.convertAuthResponse(response);
  }

  /**
   * Wait for authorization to complete (polls status)
   */
  async waitForAuthorization(
    authorizationId: string,
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      onPoll?: (status: ArcadeAuthStatus) => void;
    },
  ): Promise<ArcadeAuthResponse> {
    const timeout = opts?.timeoutMs ?? 120000; // 2 minutes default
    const interval = opts?.pollIntervalMs ?? 2000; // 2 seconds default
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.checkAuthStatus(authorizationId);
      opts?.onPoll?.(status.status);

      if (status.status === "completed") {
        return status;
      }

      if (status.status === "failed") {
        throw new ArcadeAuthError("Authorization failed", status);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new ArcadeAuthError("Authorization timed out", {
      status: "pending",
      authorization_id: authorizationId,
    });
  }

  // ==========================================================================
  // Toolkit-Level Authorization
  // ==========================================================================

  /**
   * Authorize all tools in a toolkit with a single OAuth flow.
   * Collects all required scopes across the toolkit's tools and initiates
   * a single auth request with the combined scopes.
   */
  async authorizeToolkit(
    toolkitName: string,
    userId?: string,
  ): Promise<ArcadeAuthResponse> {
    const uid = userId ?? this.userId;

    // List all tools in the toolkit
    const tools = await this.listTools({ toolkit: toolkitName, forceRefresh: true });

    // Collect all OAuth2 scopes and determine provider
    const scopes = new Set<string>();
    let provider: string | undefined;

    for (const tool of tools) {
      if (tool.requires_auth) {
        if (tool.auth_provider_id && !provider) {
          provider = tool.auth_provider_id;
        }
        if (tool.auth_scopes) {
          for (const s of tool.auth_scopes) scopes.add(s);
        }
      }
    }

    // If cached tools don't have scope metadata, fetch full definitions
    if (!provider || scopes.size === 0) {
      const toolsWithAuth = tools.filter((t) => t.requires_auth);
      if (toolsWithAuth.length === 0) {
        return { status: "completed" }; // No auth needed for this toolkit
      }

      for (const tool of toolsWithAuth) {
        try {
          const full = await this.sdk.tools.get(tool.name);
          const oauth2 = full.requirements?.authorization?.oauth2;
          if (oauth2) {
            if (!provider) provider = oauth2.provider_id;
            for (const s of oauth2.scopes ?? []) scopes.add(s);
          }
        } catch {
          // Skip tools we can't fetch
        }
      }
    }

    if (!provider || scopes.size === 0) {
      // Fall back to single-tool auth for the first tool that requires it
      const firstAuth = tools.find((t) => t.requires_auth);
      if (firstAuth) {
        return this.authorize(firstAuth.name, uid);
      }
      return { status: "completed" };
    }

    // Initiate single auth flow with all combined scopes
    const response = await this.sdk.auth.start(uid, provider, {
      scopes: Array.from(scopes),
    });

    return this.convertAuthResponse(response);
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

  /**
   * Convert SDK ExecuteToolResponse to our format
   */
  private convertExecuteResponse(response: ExecuteToolResponse): ArcadeExecuteResult {
    // Check for authorization requirement
    if (response.output?.authorization?.status === "pending") {
      return {
        success: false,
        authorization_required: true,
        authorization_url: response.output.authorization.authorization_url,
        error: {
          code: "AUTH_REQUIRED",
          message: "Authorization required for this tool",
        },
      };
    }

    // Check for error
    if (response.output?.error) {
      return {
        success: false,
        error: {
          code: response.output.error.kind,
          message: response.output.error.message,
          details: response.output.error.extra,
        },
      };
    }

    return {
      success: response.success ?? true,
      output: response.output?.value,
    };
  }

  /**
   * Execute a tool
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    userId?: string,
  ): Promise<ArcadeExecuteResult> {
    try {
      const response = await this.sdk.tools.execute({
        tool_name: toolName,
        input,
        user_id: userId ?? this.userId,
      });
      return this.convertExecuteResponse(response);
    } catch (err) {
      // Check if this is an authorization error from the SDK
      if (err instanceof Arcade.AuthenticationError) {
        return {
          success: false,
          authorization_required: true,
          error: {
            code: "AUTH_REQUIRED",
            message: "Authorization required for this tool",
          },
        };
      }
      throw err;
    }
  }

  /**
   * Execute a tool with automatic authorization handling
   */
  async executeWithAuth(
    toolName: string,
    input: Record<string, unknown>,
    opts?: {
      userId?: string;
      onAuthRequired?: (authUrl: string) => Promise<boolean>;
    },
  ): Promise<ArcadeExecuteResult> {
    const userId = opts?.userId ?? this.userId;

    // First, try to authorize the tool
    const authResponse = await this.authorize(toolName, userId);

    // If authorization required, handle it
    if (authResponse.status !== "completed" && authResponse.authorization_url) {
      if (opts?.onAuthRequired) {
        const shouldProceed = await opts.onAuthRequired(authResponse.authorization_url);
        if (!shouldProceed) {
          return {
            success: false,
            authorization_required: true,
            authorization_url: authResponse.authorization_url,
            error: {
              code: "AUTH_REQUIRED",
              message: "User did not complete authorization",
            },
          };
        }
      }

      // Wait for authorization to complete
      if (authResponse.authorization_id) {
        await this.waitForAuthorization(authResponse.authorization_id);
      }
    }

    // Execute the tool
    return this.execute(toolName, input, userId);
  }

  // ==========================================================================
  // User Connections
  // ==========================================================================

  /**
   * List user's auth connections
   */
  async listUserConnections(userId?: string): Promise<unknown[]> {
    const id = userId ?? this.userId;
    if (!id) return [];

    try {
      const response = await this.sdk.admin.userConnections.list({ user: { id } });
      return response.items ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Delete a user connection
   */
  async deleteUserConnection(connectionId: string): Promise<void> {
    await this.sdk.admin.userConnections.delete(connectionId);
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Clear the tools cache
   */
  clearCache(): void {
    this.toolsCache.clear();
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class ArcadeApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ArcadeApiError";
  }

  /** Check if this is a retriable error */
  isRetriable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export class ArcadeAuthError extends Error {
  constructor(
    message: string,
    public readonly authResponse: ArcadeAuthResponse,
  ) {
    super(message);
    this.name = "ArcadeAuthError";
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new Arcade client instance
 */
export function createArcadeClient(config: ArcadeConfig): ArcadeClient {
  return new ArcadeClient(config);
}
