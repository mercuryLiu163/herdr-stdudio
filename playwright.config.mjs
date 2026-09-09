import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/playwright",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "tests/artifacts/pw-output",
});
