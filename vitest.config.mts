import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Extractors and analyzers are pure functions over saved HTML fixtures,
    // so the default node environment is all they need — no jsdom.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
