import { Config } from "@shared/types";
import Fastify from "fastify";
import process from "process";
import socketIoFastify from "fastify-socket.io";
import staticFastify from "@fastify/static";
import { Communication } from "./communication";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { init, cleanup } from "./init";
import { WeebsyncPlugin } from "./plugin-system";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ApplicationState {
  config: Config;
  configUpdateInProgress: boolean;
  syncInProgress: boolean;
  communication: Communication;
  plugins: WeebsyncPlugin[];
  autoSyncIntervalHandler?: NodeJS.Timeout;
  autoSyncTimerUpdateHandler?: NodeJS.Timeout;
}

const server = Fastify({
  logger: true,
});
server.register(socketIoFastify, {
  cors: { origin: "*" },
  transports: ["websocket"],
});
// Determine client path based on environment
interface ProcessWithPkg extends NodeJS.Process {
  pkg?: unknown;
}
const isPkg = !!(process as ProcessWithPkg).pkg;
const isDockerBuild = !isPkg && !__dirname.includes("build");

let clientPath: string;
if (isPkg) {
  // For pkg native builds, client assets are in build/client within the snapshot
  // PKG detects path.join(__dirname, ...) patterns and includes referenced files
  clientPath = join(__dirname, "client");
} else if (isDockerBuild) {
  // For Docker builds, client is in ./client
  clientPath = join(__dirname, "client");
} else {
  // For dev builds, client is at ../client
  clientPath = join(__dirname, "..", "client");
}

// Only register static plugin for non-PKG builds
if (!isPkg) {
  server.register(staticFastify, {
    root: clientPath,
  });

  server.get("/", function (_req, reply) {
    reply.sendFile("index.html");
  });
} else {
  // Manual file serving for PKG binaries
  server.get("/", function (_req, reply) {
    const indexPath = join(clientPath, "index.html");
    try {
      const content = readFileSync(indexPath, "utf-8");
      reply.type("text/html").send(content);
    } catch {
      reply.code(404).send({ error: "Not found" });
    }
  });

  // Serve static assets for PKG binaries
  server.get("/assets/*", function (req, reply) {
    try {
      const params = req.params as { "*": string };
      const assetPath = "assets/" + params["*"];
      const filePath = join(clientPath, assetPath);
      const content = readFileSync(filePath);

      // Set appropriate content-type based on file extension
      const ext = filePath.split(".").pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        eot: "application/vnd.ms-fontobject",
      };

      reply
        .type(contentTypes[ext || ""] || "application/octet-stream")
        .send(content);
    } catch {
      reply.code(404).send({ error: "Not found" });
    }
  });

  // Serve other static files (PNG files in root)
  server.get("/:file(.*\\.png|.*\\.ico)", function (req, reply) {
    try {
      const params = req.params as { file: string };
      const fileName = params.file;
      const filePath = join(clientPath, fileName);
      const content = readFileSync(filePath);

      const ext = fileName.split(".").pop()?.toLowerCase();
      const contentType = ext === "png" ? "image/png" : "image/x-icon";
      reply.type(contentType).send(content);
    } catch {
      reply.code(404).send({ error: "Not found" });
    }
  });
}

server.get("/health", function (_req, reply) {
  reply.send({ status: "ok", timestamp: new Date().toISOString() });
});

server
  .listen({
    host: process.env.WEEB_SYNC_SERVER_HOST ?? "0.0.0.0",
    port: process.env.WEEB_SYNC_SERVER_HTTP_PORT
      ? Number(process.env.WEEB_SYNC_SERVER_HTTP_PORT)
      : 42380,
  })
  .then(() => {
    server.ready(async (err) => {
      if (err) throw err;

      await init(server);
    });
  });

// Graceful shutdown handling
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, starting graceful shutdown...`);

  // Close server
  server.close(() => {
    console.log("HTTP server closed");

    // Stop intervals and clean up application state
    cleanup();

    console.log("Cleanup completed");

    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000);
}

export const viteNodeServer = server;
