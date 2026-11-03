import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test needs the edge runtime and must be inlined (not externalized).
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts", "checks/**/*.test.ts", "sim/**/*.test.ts", "stats/**/*.test.ts", "operator/**/*.test.ts", "app/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
