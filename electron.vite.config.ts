import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    envPrefix: ["VITE_", "DEBUG"],
    plugins: [react(), tailwindcss()],
    server: {
      fs: {
        // 覆盖 allow 时必须带上项目根，否则 index.html 也会 403
        allow: [resolve("."), resolve("src/shared")],
      },
      port: 8081,
    },
  },
});
