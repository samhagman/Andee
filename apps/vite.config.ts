import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "src",
  base: "/",

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, "src/app/index.html"),
        weather: resolve(__dirname, "src/weather/index.html"),
      },
    },
  },

  server: {
    port: 8788,
  },
});
