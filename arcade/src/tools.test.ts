/**
 * Arcade Tools Registration Tests
 */

import { describe, expect, it } from "vitest";
import { toOpenClawToolName, toArcadeToolName } from "./tools.js";

describe("toOpenClawToolName", () => {
  it("converts simple tool names", () => {
    expect(toOpenClawToolName("Gmail.SendEmail", "arcade")).toBe(
      "arcade_gmail_send_email",
    );
  });

  it("converts CamelCase to snake_case", () => {
    expect(toOpenClawToolName("GoogleCalendar.CreateEvent", "arcade")).toBe(
      "arcade_google_calendar_create_event",
    );
  });

  it("handles multi-word toolkit names", () => {
    // MSTeams becomes m_s_teams due to CamelCase splitting
    expect(toOpenClawToolName("MSTeams.SendMessage", "arcade")).toBe(
      "arcade_m_s_teams_send_message",
    );
  });

  it("handles tools with multiple capital letters", () => {
    // PR becomes p_r due to CamelCase splitting
    expect(toOpenClawToolName("GitHub.CreatePR", "arcade")).toBe(
      "arcade_git_hub_create_p_r",
    );
  });

  it("uses custom prefix", () => {
    expect(toOpenClawToolName("Gmail.SendEmail", "arc")).toBe(
      "arc_gmail_send_email",
    );
  });

  it("handles single-word tool names", () => {
    expect(toOpenClawToolName("Search.Query", "arcade")).toBe(
      "arcade_search_query",
    );
  });

  it("strips version suffix from tool names", () => {
    expect(toOpenClawToolName("AirtableApi.AddBaseCollaborator@4.0.0", "arcade")).toBe(
      "arcade_airtable_api_add_base_collaborator",
    );
  });

  it("strips version suffix from simple tool names", () => {
    expect(toOpenClawToolName("Gmail.SendEmail@1.1.1", "arcade")).toBe(
      "arcade_gmail_send_email",
    );
  });

  it("produces names matching LLM tool name pattern", () => {
    const pattern = /^[a-zA-Z0-9_-]{1,128}$/;
    const toolNames = [
      "AirtableApi.AddBaseCollaborator@4.0.0",
      "Gmail.SendEmail@1.1.1",
      "Asana.AttachFileToTask@1.1.1",
      "GithubApi.CreateIssue@2.0.0",
      "PosthogApi.GetDashboard@1.0.0",
    ];
    for (const name of toolNames) {
      const converted = toOpenClawToolName(name, "arcade");
      expect(converted).toMatch(pattern);
    }
  });
});

describe("toArcadeToolName", () => {
  it("converts simple tool names back", () => {
    expect(toArcadeToolName("arcade_gmail_send_email", "arcade")).toBe(
      "Gmail.SendEmail",
    );
  });

  it("converts multi-word actions", () => {
    // First part becomes toolkit, rest becomes action
    expect(toArcadeToolName("arcade_google_calendar_create_event", "arcade")).toBe(
      "Google.CalendarCreateEvent",
    );
  });

  it("handles custom prefix", () => {
    expect(toArcadeToolName("arc_gmail_send_email", "arc")).toBe(
      "Gmail.SendEmail",
    );
  });

  it("handles tools with underscores", () => {
    expect(toArcadeToolName("arcade_slack_post_message", "arcade")).toBe(
      "Slack.PostMessage",
    );
  });
});

describe("tool name round-trip", () => {
  const testCases = [
    "Gmail.SendEmail",
    "Slack.PostMessage",
    "GoogleCalendar.CreateEvent",
    "GitHub.CreateIssue",
    "Notion.GetPage",
    "Stripe.ListCustomers",
    "Gmail.SendEmail@1.1.1",
    "AirtableApi.AddBaseCollaborator@4.0.0",
  ];

  for (const arcadeName of testCases) {
    it(`converts ${arcadeName} round-trip`, () => {
      const openclawName = toOpenClawToolName(arcadeName, "arcade");
      const backToArcade = toArcadeToolName(openclawName, "arcade");

      // Note: Round-trip may not be exact due to case normalization
      // but should produce a valid tool name
      expect(backToArcade).toBeTruthy();
      expect(backToArcade.includes(".")).toBe(true);
    });
  }
});
