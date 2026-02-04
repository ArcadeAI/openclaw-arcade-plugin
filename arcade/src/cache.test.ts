/**
 * Arcade Cache Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Arcade Cache", () => {
  const testHomeDir = "/tmp/arcade-test-home";
  const expectedCacheDir = path.join(testHomeDir, ".arcade");
  const expectedCacheFile = path.join(expectedCacheDir, "openclaw.json");

  // Store original homedir (for reference)
  const _originalHomedir = os.homedir;

  beforeEach(() => {
    vi.resetModules();
    // Mock os.homedir before importing cache module
    vi.spyOn(os, "homedir").mockReturnValue(testHomeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCacheFilePath", () => {
    it("returns correct path", async () => {
      const { getCacheFilePath } = await import("./cache.js");
      expect(getCacheFilePath()).toBe(expectedCacheFile);
    });
  });

  describe("cacheExists", () => {
    it("returns true when cache file exists", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const { cacheExists } = await import("./cache.js");
      expect(cacheExists()).toBe(true);
    });

    it("returns false when cache file does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const { cacheExists } = await import("./cache.js");
      expect(cacheExists()).toBe(false);
    });
  });

  describe("readCache", () => {
    it("returns null when cache does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const { readCache } = await import("./cache.js");
      expect(readCache()).toBeNull();
    });

    it("returns cache data when valid", async () => {
      const cacheData = {
        version: 1,
        created_at: "2026-01-30T00:00:00Z",
        updated_at: "2026-01-30T00:00:00Z",
        total_tools: 2,
        toolkits: ["Gmail", "Slack"],
        tools: [
          { name: "SendEmail", description: "Send email", toolkit: "Gmail", requires_auth: true },
          { name: "PostMessage", description: "Post message", toolkit: "Slack", requires_auth: true },
        ],
      };

      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { readCache } = await import("./cache.js");
      const result = readCache();
      expect(result).toEqual(cacheData);
    });

    it("returns null for invalid version", async () => {
      const cacheData = { version: 999, tools: [] };

      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { readCache } = await import("./cache.js");
      expect(readCache()).toBeNull();
    });

    it("returns null for invalid JSON", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue("invalid json");

      const { readCache } = await import("./cache.js");
      expect(readCache()).toBeNull();
    });
  });

  describe("writeCache", () => {
    it("creates cache directory if needed", async () => {
      const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(fs, "writeFileSync").mockReturnValue(undefined);

      const { writeCache } = await import("./cache.js");

      const tools = [
        {
          name: "SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail", description: "Gmail toolkit" },
          requires_auth: true,
        },
      ];

      writeCache(tools as any);

      expect(mkdirSpy).toHaveBeenCalledWith(expectedCacheDir, { recursive: true });
    });

    it("writes cache with correct structure", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "writeFileSync").mockReturnValue(undefined);

      const { writeCache } = await import("./cache.js");

      const tools = [
        {
          name: "SendEmail",
          description: "Send email",
          toolkit: { name: "Gmail", description: "Gmail tools", version: "1.0" },
          requires_auth: true,
        },
        {
          name: "PostMessage",
          description: "Post message",
          toolkit: { name: "Slack" },
          requires_auth: false,
        },
      ];

      const result = writeCache(tools as any);

      expect(result.version).toBe(1);
      expect(result.total_tools).toBe(2);
      expect(result.toolkits).toEqual(["Gmail", "Slack"]);
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].toolkit).toBe("Gmail");
      expect(result.tools[0].toolkit_description).toBe("Gmail tools");
      expect(result.tools[0].toolkit_version).toBe("1.0");
    });
  });

  describe("clearCache", () => {
    it("returns true and deletes file when cache exists", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockReturnValue(undefined);

      const { clearCache } = await import("./cache.js");
      expect(clearCache()).toBe(true);
      expect(unlinkSpy).toHaveBeenCalledWith(expectedCacheFile);
    });

    it("returns false when cache does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockReturnValue(undefined);

      const { clearCache } = await import("./cache.js");
      expect(clearCache()).toBe(false);
      expect(unlinkSpy).not.toHaveBeenCalled();
    });
  });

  describe("getCachedTools", () => {
    const cacheData = {
      version: 1,
      created_at: "2026-01-30T00:00:00Z",
      updated_at: "2026-01-30T00:00:00Z",
      total_tools: 3,
      toolkits: ["Gmail", "Slack"],
      tools: [
        { name: "SendEmail", description: "Send an email message", toolkit: "Gmail", requires_auth: true },
        { name: "ReadEmail", description: "Read email inbox", toolkit: "Gmail", requires_auth: true },
        { name: "PostMessage", description: "Post a Slack message", toolkit: "Slack", requires_auth: true },
      ],
    };

    it("returns all tools when no filters", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { getCachedTools } = await import("./cache.js");
      const tools = getCachedTools();
      expect(tools).toHaveLength(3);
    });

    it("filters by toolkit", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { getCachedTools } = await import("./cache.js");
      const tools = getCachedTools({ toolkit: "Gmail" });
      expect(tools).toHaveLength(2);
      expect(tools.every((t) => t.toolkit === "Gmail")).toBe(true);
    });

    it("filters by search query", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { getCachedTools } = await import("./cache.js");
      const tools = getCachedTools({ search: "email" });
      expect(tools).toHaveLength(2);
    });

    it("applies limit", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { getCachedTools } = await import("./cache.js");
      const tools = getCachedTools({ limit: 1 });
      expect(tools).toHaveLength(1);
    });

    it("returns empty array when cache missing", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const { getCachedTools } = await import("./cache.js");
      expect(getCachedTools()).toEqual([]);
    });
  });

  describe("getCacheStats", () => {
    it("returns empty stats when cache missing", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const { getCacheStats } = await import("./cache.js");
      const stats = getCacheStats();
      expect(stats.exists).toBe(false);
      expect(stats.valid).toBe(false);
      expect(stats.totalTools).toBe(0);
    });

    it("returns stats when cache exists", async () => {
      const cacheData = {
        version: 1,
        created_at: "2026-01-30T00:00:00Z",
        updated_at: new Date().toISOString(),
        total_tools: 100,
        toolkits: ["Gmail", "Slack", "GitHub"],
        tools: [],
      };

      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(cacheData));

      const { getCacheStats } = await import("./cache.js");
      const stats = getCacheStats();
      expect(stats.exists).toBe(true);
      expect(stats.totalTools).toBe(100);
      expect(stats.toolkits).toEqual(["Gmail", "Slack", "GitHub"]);
      expect(stats.ageMs).toBeLessThan(1000);
    });
  });

  describe("toToolDefinition", () => {
    it("converts cached tool to ArcadeToolDefinition", async () => {
      const { toToolDefinition } = await import("./cache.js");

      const cached = {
        name: "SendEmail",
        fully_qualified_name: "Gmail.SendEmail@1.0",
        qualified_name: "Gmail.SendEmail",
        description: "Send email",
        toolkit: "Gmail",
        toolkit_description: "Gmail tools",
        toolkit_version: "1.0",
        requires_auth: true,
        auth_provider: "google",
      };

      const result = toToolDefinition(cached);

      expect(result.name).toBe("SendEmail");
      expect(result.fully_qualified_name).toBe("Gmail.SendEmail@1.0");
      expect(result.description).toBe("Send email");
      expect(result.toolkit).toEqual({
        name: "Gmail",
        description: "Gmail tools",
        version: "1.0",
      });
      expect(result.requires_auth).toBe(true);
      expect(result.auth_provider).toBe("google");
    });
  });
});
