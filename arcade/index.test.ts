/**
 * Arcade Plugin Integration Tests
 *
 * Tests the full plugin lifecycle including registration,
 * tool creation, and hook handling.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock fetch for all tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocking
import arcadePlugin from "./index.js";

describe("Arcade Plugin", () => {
  describe("plugin metadata", () => {
    it("has correct id and name", () => {
      expect(arcadePlugin.id).toBe("arcade");
      expect(arcadePlugin.name).toBe("Arcade.dev");
    });

    it("has description", () => {
      expect(arcadePlugin.description).toContain("Arcade.dev");
    });

    it("has config schema", () => {
      expect(arcadePlugin.configSchema).toBeDefined();
      expect(arcadePlugin.configSchema.parse).toBeInstanceOf(Function);
    });
  });

  describe("config schema", () => {
    it("parses minimal config", () => {
      const config = arcadePlugin.configSchema.parse({});

      expect(config.enabled).toBe(true);
      expect(config.baseUrl).toBe("https://api.arcade.dev");
    });

    it("parses full config", () => {
      const config = arcadePlugin.configSchema.parse({
        apiKey: "test_key",
        userId: "user@example.com",
        tools: {
          allow: ["Gmail.*"],
        },
      });

      expect(config.apiKey).toBe("test_key");
      expect(config.userId).toBe("user@example.com");
      expect(config.tools?.allow).toEqual(["Gmail.*"]);
    });
  });

  describe("register function", () => {
    let mockApi: any;
    let registeredTools: any[];
    let registeredCommands: any[];
    let registeredGatewayMethods: Record<string, any>;
    let registeredServices: any[];
    let registeredHooks: any[];

    beforeEach(() => {
      registeredTools = [];
      registeredCommands = [];
      registeredGatewayMethods = {};
      registeredServices = [];
      registeredHooks = [];

      mockApi = {
        pluginConfig: {
          enabled: true,
          apiKey: "test_key",
          userId: "test_user",
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        registerTool: vi.fn((tool, opts) => {
          registeredTools.push({ tool, opts });
        }),
        registerCommand: vi.fn((cmd) => {
          registeredCommands.push(cmd);
        }),
        registerGatewayMethod: vi.fn((name, handler) => {
          registeredGatewayMethods[name] = handler;
        }),
        registerService: vi.fn((service) => {
          registeredServices.push(service);
        }),
        registerCli: vi.fn(),
        registerHttpRoute: vi.fn(),
        on: vi.fn((event, handler) => {
          registeredHooks.push({ event, handler });
        }),
        config: {},
      };

      // Mock successful tools list response (matching SDK format)
      const mockResponse = {
        items: [
          {
            name: "SendEmail",
            fully_qualified_name: "Gmail.SendEmail",
            qualified_name: "Gmail.SendEmail",
            description: "Send email",
            toolkit: { name: "Gmail", description: "Gmail tools" },
            input: { parameters: [] },
            requirements: { authorization: { oauth2: {} } },
          },
          {
            name: "PostMessage",
            fully_qualified_name: "Slack.PostMessage",
            qualified_name: "Slack.PostMessage",
            description: "Post message",
            toolkit: { name: "Slack", description: "Slack tools" },
            input: { parameters: [] },
            requirements: { authorization: { oauth2: {} } },
          },
        ],
        total_count: 2,
        offset: 0,
      };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        clone: function() { return this; },
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("registers static tools", async () => {
      await arcadePlugin.register(mockApi);

      // Should register at least the static tools
      const toolNames = registeredTools.map((t) => t.tool.name);
      expect(toolNames).toContain("arcade_list_tools");
      expect(toolNames).toContain("arcade_authorize");
      expect(toolNames).toContain("arcade_execute");
    });

    it("registers dynamic tools from API (async background loading)", async () => {
      arcadePlugin.register(mockApi);

      // Dynamic tools are loaded in the background (not awaited)
      // Wait for the background promise to resolve
      await vi.waitFor(
        () => {
          const toolNames = registeredTools.map((t) => t.tool.name);
          expect(toolNames).toContain("arcade_gmail_send_email");
          expect(toolNames).toContain("arcade_slack_post_message");
        },
        { timeout: 1000 },
      );
    });

    it("registers gateway methods", async () => {
      await arcadePlugin.register(mockApi);

      expect(registeredGatewayMethods).toHaveProperty("arcade.tools.list");
      expect(registeredGatewayMethods).toHaveProperty("arcade.tools.execute");
      expect(registeredGatewayMethods).toHaveProperty("arcade.auth.status");
      expect(registeredGatewayMethods).toHaveProperty("arcade.auth.authorize");
      expect(registeredGatewayMethods).toHaveProperty("arcade.status");
    });

    it("registers /arcade command", async () => {
      await arcadePlugin.register(mockApi);

      expect(registeredCommands.length).toBeGreaterThan(0);
      const arcadeCmd = registeredCommands.find((c) => c.name === "arcade");
      expect(arcadeCmd).toBeDefined();
      expect(arcadeCmd.handler).toBeInstanceOf(Function);
    });

    it("registers service", async () => {
      await arcadePlugin.register(mockApi);

      expect(registeredServices.length).toBe(1);
      expect(registeredServices[0].id).toBe("arcade");
      expect(registeredServices[0].start).toBeInstanceOf(Function);
      expect(registeredServices[0].stop).toBeInstanceOf(Function);
    });

    it("registers hooks when autoAuth enabled", async () => {
      await arcadePlugin.register(mockApi);

      const hookEvents = registeredHooks.map((h) => h.event);
      expect(hookEvents).toContain("before_tool_call");
      expect(hookEvents).toContain("after_tool_call");
    });

    it("skips dynamic tools when API fails", async () => {
      // Use 400 error which doesn't trigger retries (client errors are not retried)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: "Bad Request" }),
      });

      await arcadePlugin.register(mockApi);

      // Should still register static tools
      const toolNames = registeredTools.map((t) => t.tool.name);
      expect(toolNames).toContain("arcade_list_tools");

      // Dynamic tools should NOT be registered due to API failure
      expect(toolNames).not.toContain("arcade_gmail_send_email");
    });

    it("skips registration when disabled", async () => {
      mockApi.pluginConfig = { enabled: false };

      await arcadePlugin.register(mockApi);

      expect(registeredTools.length).toBe(0);
      expect(mockApi.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Plugin disabled"),
      );
    });
  });

  describe("command handler", () => {
    let mockApi: any;
    let commandHandler: any;

    beforeEach(async () => {
      mockApi = {
        pluginConfig: { enabled: true, apiKey: "test_key", userId: "test_user" },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        registerTool: vi.fn(),
        registerCommand: vi.fn((cmd) => {
          if (cmd.name === "arcade") commandHandler = cmd.handler;
        }),
        registerGatewayMethod: vi.fn(),
        registerService: vi.fn(),
        registerCli: vi.fn(),
        registerHttpRoute: vi.fn(),
        on: vi.fn(),
        config: {},
      };

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }),
      });

      await arcadePlugin.register(mockApi);
    });

    it("handles /arcade status", async () => {
      const result = await commandHandler({ args: "status" });

      expect(result.text).toContain("Arcade.dev Plugin Status");
      expect(result.text).toContain("Enabled:");
      expect(result.text).toContain("Configured:");
    });

    it("handles /arcade with no args", async () => {
      const result = await commandHandler({ args: "" });

      expect(result.text).toContain("Arcade.dev Plugin Status");
    });

    it("handles /arcade tools", async () => {
      const result = await commandHandler({ args: "tools" });

      expect(result.text).toMatch(/Arcade Tools|No tools found/);
    });

    it("handles unknown subcommand", async () => {
      const result = await commandHandler({ args: "unknown" });

      expect(result.text).toContain("Unknown command");
    });
  });
});
