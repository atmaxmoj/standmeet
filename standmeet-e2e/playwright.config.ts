import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    headless: true,
  },
  projects: [
    {
      name: "mock",
      use: { browserName: "chromium" },
      testMatch: ["chat.test.ts", "sessions.test.ts", "chat-logs.test.ts", "security.test.ts", "skill-import.test.ts", "session-restore.test.ts", "report.test.ts", "layout.test.ts", "settings.test.ts", "share-buttons.test.ts", "im-bridge.test.ts", "assets.test.ts", "data-io.test.ts", "pages.test.ts"],
    },
    {
      name: "real-ai",
      use: { browserName: "chromium" },
      testMatch: ["invites.test.ts", "content.test.ts", "iam.test.ts", "skills.test.ts", "im-bridge-ai.test.ts"],
    },
  ],
});
