import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "dev",
  build: {
    // The dev server serves every page in dev/; a build ships only the card.
    // The receipt page carries a debug HUD and the terminal is unfinished,
    // and neither is something to put on the open internet.
    rollupOptions: {
      input: fileURLToPath(new URL("dev/card.html", import.meta.url)),
    },
  },
});
