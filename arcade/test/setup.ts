/**
 * Arcade Plugin Test Setup
 *
 * Minimal setup for arcade extension tests.
 */

import { afterEach, vi } from "vitest";

// Ensure Vitest environment is properly set
process.env.VITEST = "true";

afterEach(() => {
  // Guard against leaked fake timers across test files.
  vi.useRealTimers();
});
