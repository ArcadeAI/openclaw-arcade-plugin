/**
 * Arcade Client Tests
 *
 * Tests the ArcadeClient wrapper around @arcadeai/arcadejs SDK.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ArcadeClient,
  ArcadeApiError,
  createArcadeClient,
} from "./client.js";
import type { ArcadeConfig } from "./config.js";

// Helper to create mock Response objects that the SDK expects
function mockResponse(body: unknown, options: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}) {
  const status = options.status ?? 200;
  const ok = options.ok ?? (status >= 200 && status < 300);
  const headers = new Headers(options.headers ?? { "content-type": "application/json" });

  return {
    ok,
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: function() { return this; },
  };
}

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ArcadeClient", () => {
  const defaultConfig: ArcadeConfig = {
    enabled: true,
    apiKey: "test_api_key",
    userId: "test_user",
    baseUrl: "https://api.arcade.dev",
    toolPrefix: "arcade",
    autoAuth: true,
    cacheToolsTtlMs: 300000,
  };

  let client: ArcadeClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new ArcadeClient(defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isConfigured", () => {
    it("returns true when API key is set", () => {
      expect(client.isConfigured()).toBe(true);
    });

    it("returns false when API key is empty", () => {
      const unconfiguredClient = new ArcadeClient({
        ...defaultConfig,
        apiKey: undefined,
      });
      expect(unconfiguredClient.isConfigured()).toBe(false);
    });
  });

  describe("getUserId", () => {
    it("returns configured user ID", () => {
      expect(client.getUserId()).toBe("test_user");
    });
  });

  describe("configure", () => {
    it("updates client configuration", () => {
      client.configure({ userId: "new_user" });
      expect(client.getUserId()).toBe("new_user");
    });
  });

  describe("health", () => {
    it("checks API health", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ healthy: true }));

      const result = await client.health();

      expect(result).toEqual({ status: "healthy" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/health"),
        expect.anything(),
      );
    });

    it("returns unhealthy status when health check fails", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ healthy: false }));

      const result = await client.health();

      expect(result).toEqual({ status: "unhealthy" });
    });
  });

  describe("listTools", () => {
    it("lists available tools", async () => {
      const mockTools = {
        items: [
          {
            name: "SendEmail",
            fully_qualified_name: "Gmail.SendEmail",
            qualified_name: "Gmail.SendEmail",
            description: "Send email",
            toolkit: { name: "Gmail", description: "Gmail tools" },
            input: { parameters: [] },
          },
          {
            name: "PostMessage",
            fully_qualified_name: "Slack.PostMessage",
            qualified_name: "Slack.PostMessage",
            description: "Post message",
            toolkit: { name: "Slack", description: "Slack tools" },
            input: { parameters: [] },
          },
        ],
        total_count: 2,
        offset: 0,
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockTools));

      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      // name is fully_qualified_name (Gmail.SendEmail) for proper tool registration
      expect(tools[0].name).toBe("Gmail.SendEmail");
      expect(tools[0].toolkit.name).toBe("Gmail");
      expect(tools[1].name).toBe("Slack.PostMessage");
    });

    it("filters by toolkit", async () => {
      const mockTools = {
        items: [{
          name: "SendEmail",
          fully_qualified_name: "Gmail.SendEmail",
          qualified_name: "Gmail.SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail" },
          input: { parameters: [] },
        }],
        total_count: 1,
        offset: 0,
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockTools));

      await client.listTools({ toolkit: "Gmail" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("toolkit=Gmail"),
        expect.anything(),
      );
    });

    it("caches tool list", async () => {
      const mockTools = {
        items: [{
          name: "SendEmail",
          fully_qualified_name: "Gmail.SendEmail",
          qualified_name: "Gmail.SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail" },
          input: { parameters: [] },
        }],
        total_count: 1,
        offset: 0,
      };

      mockFetch.mockResolvedValue(mockResponse(mockTools));

      // First call - hits API
      await client.listTools();
      // Second call - should use cache
      await client.listTools();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("bypasses cache with forceRefresh", async () => {
      const mockTools = {
        items: [{
          name: "SendEmail",
          fully_qualified_name: "Gmail.SendEmail",
          qualified_name: "Gmail.SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail" },
          input: { parameters: [] },
        }],
        total_count: 1,
        offset: 0,
      };

      mockFetch.mockResolvedValue(mockResponse(mockTools));

      await client.listTools();
      await client.listTools({ forceRefresh: true });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("authorize", () => {
    it("initiates authorization", async () => {
      const mockAuthResponse = {
        status: "pending",
        authorization_id: "auth_123",
        authorization_url: "https://arcade.dev/auth/123",
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockAuthResponse));

      const result = await client.authorize("Gmail.SendEmail");

      expect(result.status).toBe("pending");
      expect(result.authorization_url).toBe("https://arcade.dev/auth/123");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/tools/authorize"),
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("returns completed status when already authorized", async () => {
      const mockAuthResponse = {
        status: "completed",
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockAuthResponse));

      const result = await client.authorize("Gmail.SendEmail");

      expect(result.status).toBe("completed");
      expect(result.authorization_url).toBeUndefined();
    });
  });

  describe("execute", () => {
    it("executes a tool", async () => {
      const mockExecResponse = {
        success: true,
        output: { value: { messageId: "msg_123" } },
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockExecResponse));

      const result = await client.execute("Gmail.SendEmail", {
        to: "test@example.com",
        subject: "Test",
        body: "Hello",
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ messageId: "msg_123" });
    });

    it("handles authorization required in response", async () => {
      const mockExecResponse = {
        success: false,
        output: {
          authorization: {
            status: "pending",
            authorization_url: "https://arcade.dev/auth/456",
          },
        },
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockExecResponse));

      const result = await client.execute("Gmail.SendEmail", {});

      expect(result.success).toBe(false);
      expect(result.authorization_required).toBe(true);
      expect(result.authorization_url).toBe("https://arcade.dev/auth/456");
    });
  });

  describe("clearCache", () => {
    it("clears the tools cache", async () => {
      const mockTools = {
        items: [{
          name: "SendEmail",
          fully_qualified_name: "Gmail.SendEmail",
          qualified_name: "Gmail.SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail" },
          input: { parameters: [] },
        }],
        total_count: 1,
        offset: 0,
      };

      mockFetch.mockResolvedValue(mockResponse(mockTools));

      await client.listTools();
      client.clearCache();
      await client.listTools();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe("createArcadeClient", () => {
  it("creates a client instance", () => {
    const client = createArcadeClient({
      enabled: true,
      apiKey: "test_key",
      baseUrl: "https://api.arcade.dev",
      toolPrefix: "arcade",
      autoAuth: true,
      cacheToolsTtlMs: 300000,
    });

    expect(client).toBeInstanceOf(ArcadeClient);
    expect(client.isConfigured()).toBe(true);
  });
});

describe("ArcadeApiError", () => {
  it("stores error details", () => {
    const error = new ArcadeApiError(400, "Bad request", { field: "invalid" });

    expect(error.status).toBe(400);
    expect(error.message).toBe("Bad request");
    expect(error.details).toEqual({ field: "invalid" });
    expect(error.name).toBe("ArcadeApiError");
  });

  it("identifies retriable errors", () => {
    expect(new ArcadeApiError(500, "Server error").isRetriable()).toBe(true);
    expect(new ArcadeApiError(502, "Bad gateway").isRetriable()).toBe(true);
    expect(new ArcadeApiError(429, "Rate limited").isRetriable()).toBe(true);
    expect(new ArcadeApiError(400, "Bad request").isRetriable()).toBe(false);
    expect(new ArcadeApiError(401, "Unauthorized").isRetriable()).toBe(false);
  });
});

describe("SDK integration", () => {
  const defaultConfig: ArcadeConfig = {
    enabled: true,
    apiKey: "test_api_key",
    userId: "test_user",
    baseUrl: "https://api.arcade.dev",
    toolPrefix: "arcade",
    autoAuth: true,
    cacheToolsTtlMs: 300000,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("exposes the underlying SDK", () => {
    const client = new ArcadeClient(defaultConfig);
    const sdk = client.getSdk();

    expect(sdk).toBeDefined();
    expect(sdk.tools).toBeDefined();
    expect(sdk.auth).toBeDefined();
    expect(sdk.health).toBeDefined();
  });

  it("handles SDK errors gracefully", async () => {
    const client = new ArcadeClient(defaultConfig);

    mockFetch.mockResolvedValueOnce(mockResponse(
      { error: { message: "Invalid request" } },
      { status: 400, ok: false },
    ));

    await expect(client.health()).rejects.toThrow();
  });
});
