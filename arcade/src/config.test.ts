/**
 * Arcade Plugin Configuration Tests
 */

import { describe, expect, it } from "vitest";
import {
  ArcadeConfigSchema,
  resolveArcadeConfig,
  matchesToolFilter,
} from "./config.js";

describe("ArcadeConfigSchema", () => {
  it("parses minimal config with defaults", () => {
    const config = ArcadeConfigSchema.parse({});

    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe("https://api.arcade.dev");
    expect(config.toolPrefix).toBe("arcade");
    expect(config.autoAuth).toBe(true);
    expect(config.cacheToolsTtlMs).toBe(300000);
  });

  it("parses full config", () => {
    const config = ArcadeConfigSchema.parse({
      enabled: true,
      apiKey: "arc_test_key",
      userId: "user@example.com",
      baseUrl: "https://custom.api.arcade.dev",
      toolPrefix: "arc",
      autoAuth: false,
      cacheToolsTtlMs: 60000,
      toolkits: {
        gmail: { enabled: true, tools: ["Gmail.SendEmail"] },
        slack: { enabled: false },
      },
      tools: {
        allow: ["Gmail.*", "Slack.*"],
        deny: ["*.Delete*"],
      },
    });

    expect(config.apiKey).toBe("arc_test_key");
    expect(config.userId).toBe("user@example.com");
    expect(config.baseUrl).toBe("https://custom.api.arcade.dev");
    expect(config.toolPrefix).toBe("arc");
    expect(config.autoAuth).toBe(false);
    expect(config.toolkits?.gmail?.enabled).toBe(true);
    expect(config.toolkits?.gmail?.tools).toEqual(["Gmail.SendEmail"]);
    expect(config.toolkits?.slack?.enabled).toBe(false);
    expect(config.tools?.allow).toEqual(["Gmail.*", "Slack.*"]);
    expect(config.tools?.deny).toEqual(["*.Delete*"]);
  });

  it("handles missing optional fields", () => {
    const config = ArcadeConfigSchema.parse({
      enabled: true,
    });

    expect(config.apiKey).toBeUndefined();
    expect(config.userId).toBeUndefined();
    expect(config.toolkits).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });
});

describe("resolveArcadeConfig", () => {
  it("resolves config from raw input", () => {
    const config = resolveArcadeConfig({
      apiKey: "test_key",
    });

    expect(config.apiKey).toBe("test_key");
    expect(config.enabled).toBe(true);
  });

  it("handles null/undefined input", () => {
    const config1 = resolveArcadeConfig(null);
    const config2 = resolveArcadeConfig(undefined);

    expect(config1.enabled).toBe(true);
    expect(config2.enabled).toBe(true);
  });

  it("picks up API key from environment", () => {
    const originalEnv = process.env.ARCADE_API_KEY;
    process.env.ARCADE_API_KEY = "env_test_key";

    try {
      const config = resolveArcadeConfig({});
      expect(config.apiKey).toBe("env_test_key");
    } finally {
      if (originalEnv) {
        process.env.ARCADE_API_KEY = originalEnv;
      } else {
        delete process.env.ARCADE_API_KEY;
      }
    }
  });
});

describe("matchesToolFilter", () => {
  it("returns true when no filter provided", () => {
    expect(matchesToolFilter("Gmail.SendEmail")).toBe(true);
    expect(matchesToolFilter("Gmail.SendEmail", undefined)).toBe(true);
    expect(matchesToolFilter("Gmail.SendEmail", {})).toBe(true);
  });

  it("matches exact tool names in allowlist", () => {
    const filter = { allow: ["Gmail.SendEmail", "Slack.PostMessage"] };

    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
    expect(matchesToolFilter("Slack.PostMessage", filter)).toBe(true);
    expect(matchesToolFilter("GitHub.CreateIssue", filter)).toBe(false);
  });

  it("matches wildcard patterns in allowlist", () => {
    const filter = { allow: ["Gmail.*", "Slack.*"] };

    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
    expect(matchesToolFilter("Gmail.SearchMessages", filter)).toBe(true);
    expect(matchesToolFilter("Slack.PostMessage", filter)).toBe(true);
    expect(matchesToolFilter("GitHub.CreateIssue", filter)).toBe(false);
  });

  it("denies tools matching denylist", () => {
    const filter = {
      allow: ["*"],
      deny: ["*.Delete*", "*.Remove*"],
    };

    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
    expect(matchesToolFilter("Gmail.DeleteMessage", filter)).toBe(false);
    expect(matchesToolFilter("Slack.RemoveUser", filter)).toBe(false);
  });

  it("denylist takes precedence over allowlist", () => {
    const filter = {
      allow: ["Gmail.*"],
      deny: ["Gmail.DeleteMessage"],
    };

    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
    expect(matchesToolFilter("Gmail.DeleteMessage", filter)).toBe(false);
  });

  it("handles case-insensitive matching", () => {
    const filter = { allow: ["gmail.*"] };

    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
    expect(matchesToolFilter("GMAIL.SENDEMAIL", filter)).toBe(true);
  });

  it("handles complex wildcard patterns", () => {
    const filter = { allow: ["*Search*", "*List*"] };

    expect(matchesToolFilter("Gmail.SearchMessages", filter)).toBe(true);
    expect(matchesToolFilter("Slack.ListChannels", filter)).toBe(true);
    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(false);
  });

  it("handles empty allowlist as no filter (allows all)", () => {
    // Empty array is treated as "no filter" - use explicit deny patterns to block
    const filter = { allow: [] };

    // Empty allowlist doesn't block - use deny patterns for that
    expect(matchesToolFilter("Gmail.SendEmail", filter)).toBe(true);
  });
});
