import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@/schemas": resolve(__dirname, "src/schemas"),
      "@/firestore": resolve(__dirname, "src/firestore"),
      "@/scrapers": resolve(__dirname, "src/scrapers"),
      "@/pipeline": resolve(__dirname, "src/pipeline"),
      "@/configs": resolve(__dirname, "configs"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
