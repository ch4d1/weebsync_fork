import { Communication } from "./communication";
import { setupTemplateHelper } from "./template";
import { waitForCorrectConfig, watchConfigChanges } from "./config";
import { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { syncFiles, toggleAutoSync } from "./sync";
import { hookupCommunicationEvents } from "./hookup-communication";
import { ApplicationState } from "./index";
import { initPluginSystem } from "./plugin-system";

// Global application state for cleanup during shutdown
let globalApplicationState: ApplicationState | undefined;

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
  }
}

export async function init(server: FastifyInstance) {
  const communication = new Communication(server.io, server.log);

  const applicationState = await setupApplication(communication);
  globalApplicationState = applicationState; // Store for cleanup

  toggleAutoSync(applicationState, true);
  communication.sendConfig(JSON.parse(JSON.stringify(applicationState.config)));

  watchConfigChanges(applicationState);

  hookupCommunicationEvents(applicationState);

  // Initialize plugins before sync so they can hook into sync events
  await initPluginSystem(applicationState);

  if (applicationState.config.syncOnStart) {
    try {
      await syncFiles(applicationState);
    } catch (e) {
      server.log.error(e);
    }
  }
}

export function cleanup(): void {
  if (globalApplicationState) {
    // Stop auto-sync intervals
    toggleAutoSync(globalApplicationState, false);
    console.log("Stopped auto-sync intervals");

    globalApplicationState = undefined;
  }
}

async function setupApplication(
  communication: Communication,
): Promise<ApplicationState> {
  setupTemplateHelper();

  const config = await waitForCorrectConfig(communication);

  return {
    config,
    communication,
    plugins: [],
    configUpdateInProgress: false,
    syncInProgress: false,
  };
}
