#!/usr/bin/env node

import { spawn } from "child_process";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const platforms = [
  { name: "linux", nodeExe: "node-v22.0.0-linux-x64/bin/node" },
  { name: "win", nodeExe: "node-v22.0.0-win-x64/node.exe" },
  { name: "mac", nodeExe: "node-v22.0.0-darwin-x64/bin/node" },
];

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

async function buildSEA() {
  console.log("Building Single Executable Application...");

  // Ensure dist directory exists
  if (!existsSync("dist")) {
    mkdirSync("dist", { recursive: true });
  }

  try {
    // Generate the blob
    console.log("Generating SEA blob...");
    await runCommand("node", ["--experimental-sea-config", "sea-config.json"]);

    for (const platform of platforms) {
      console.log(`Building for ${platform.name}...`);

      // Copy node executable
      const outputName =
        platform.name === "win"
          ? `weebsync-${platform.name}.exe`
          : `weebsync-${platform.name}`;
      const outputPath = join("dist", outputName);

      if (existsSync(platform.nodeExe)) {
        copyFileSync(platform.nodeExe, outputPath);

        // Inject the blob
        await runCommand("npx", [
          "postject",
          outputPath,
          "NODE_SEA_BLOB",
          "sea-prep.blob",
          "--sentinel-fuse",
          "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
        ]);

        console.log(`Built ${outputPath}`);
      } else {
        console.warn(
          `Node.js executable not found for ${platform.name}: ${platform.nodeExe}`,
        );
        console.warn(
          `Download Node.js binaries manually and place them in the project root.`,
        );
      }
    }

    console.log("SEA build completed!");
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

buildSEA();
