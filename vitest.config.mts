import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // *.test.tsx files are component tests and opt in to jsdom with `// @vitest-environment jsdom`.
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
    // Setup hooks of the heavy suites (PDF generation, real processes) can take longer when the whole suite runs in parallel.
    hookTimeout: 60000,
  },
});
