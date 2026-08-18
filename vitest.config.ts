import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Node environment, not jsdom.
 *
 * Everything under test is arithmetic and string handling — hashes, warranty
 * dates, phase currents, region scoping. None of it touches the database or the
 * DOM, which is why these are the four files worth having before any others:
 * they run in a second, on any machine, with nothing set up.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
