import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js", "tests/e2e/**/*.e2e.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.js"],
      exclude: ["src/cli/**"],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90
      }
    }
  }
});
