import Vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import VitePluginVuetify from "vite-plugin-vuetify";
import { defineConfig, type ConfigEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ command }: ConfigEnv) => {
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      },
    },
    base: "",
    define: {
      __HOST__: command === "serve" ? '"ws://localhost:42380"' : '""',
    },
    build: {
      outDir: "../build/client",
      target: "es2022",
      minify: "esbuild" as const,
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["vue", "pinia", "socket.io-client"],
            vuetify: ["vuetify"],
            utils: ["dayjs", "ts-pattern"],
          },
        },
      },
    },
    plugins: [
      Vue(),
      Components(),
      VitePluginVuetify({
        styles: { configFile: "src/styles/settings.scss" },
      }),
    ],
    server: {
      port: 8080,
      host: true,
      open: false,
    },
    preview: {
      port: 8080,
      host: true,
    },
    optimizeDeps: {
      include: ["vue", "pinia", "socket.io-client", "vuetify"],
    },
  };
});
