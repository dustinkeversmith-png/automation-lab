import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      outDir: "dist-electron/main"
    }
  },
  preload: {
    build: {
      outDir: "dist-electron/preload"
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@main": resolve("src/main"),
        "@preload": resolve("src/preload")
      }
    }
  },
});