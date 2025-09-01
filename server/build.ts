import * as esbuild from "esbuild";
import { readFileSync } from "fs";

const packageJson = JSON.parse(readFileSync("../package.json", "utf8"));
const version = packageJson.version;

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    target: "esnext",
    platform: "node",
    format: "esm",
    outfile: "../build/index.mjs",
    external: ["fsevents", "cpu-features"],
    define: {
      "process.env.__APP_VERSION__": JSON.stringify(`v${version}`),
    },
  })
  .then(() => {
    console.log("build done");
  });
