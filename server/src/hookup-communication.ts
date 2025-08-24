import { abortSync, syncFiles, pauseSync, resumeSync } from "./sync";
import { saveConfig } from "./config";
import { ApplicationState } from "./index";
import { Config } from "@shared/types";
import { checkDir, listDir } from "./actions";
import { pluginApis, savePluginConfiguration } from "./plugin-system";

export function hookupCommunicationEvents(applicationState: ApplicationState) {
  applicationState.communication.connect.sub((socket) => {
    socket.on("getPlugins", (cb) => {
      cb(
        applicationState.plugins.map((p) => ({
          name: p.name,
          config: p.config,
          pluginConfigurationDefinition: p.pluginConfigurationDefinition,
          version: p.version,
          description: p.description,
        })),
      );
    });
    socket.on("sendPluginConfig", async (name, config) => {
      const plugin = applicationState.plugins.find((p) => p.name === name);
      if (plugin) {
        try {
          applicationState.communication.logInfo(
            `Saving config for plugin ${name}.`,
          );
          await savePluginConfiguration(plugin.name, config);
          if (plugin.onConfigUpdate) {
            await plugin.onConfigUpdate(pluginApis[name], config);
          }
          plugin.config = config;
          applicationState.communication.logInfo(`Config for ${name} saved!`);
        } catch (e) {
          applicationState.communication.logError(
            `Error while onConfigUpdate of "${name}": ${e.message}`,
          );
        }
      }
    });
    socket.on("getLogs", (cb) => {
      cb(applicationState.communication.logs.getAll().filter((v) => v));
    });
    socket.on("getVersion", (cb) => {
      cb(process.env.__APP_VERSION__);
    });
    socket.on("getSyncStatus", (cb) => {
      cb(applicationState.syncInProgress);
    });
    socket.on("getSyncPauseStatus", (cb) => {
      cb(applicationState.syncPaused);
    });
    socket.on("getLatestVersion", (cb) => {
      fetch(
        "https://api.github.com/repos/BastianGanze/weebsync/releases/latest",
      )
        .then((res) => res.json())
        .then((res) => {
          cb(res.tag_name);
        });
    });
    socket.on("sync", () => {
      if (applicationState.syncInProgress) {
        abortSync();
      } else {
        syncFiles(applicationState);
      }
    });
    socket.on("pauseSync", () => {
      pauseSync(applicationState);
    });
    socket.on("resumeSync", () => {
      resumeSync(applicationState);
    });
    socket.on("config", async (config: Config) => {
      // If sync is in progress, stop it first
      if (applicationState.syncInProgress) {
        applicationState.communication.logInfo(
          "Config changed during sync. Stopping current sync and will restart.",
        );
        abortSync();
        // Wait a moment for abort to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Save the new config
      saveConfig(config, applicationState.communication, applicationState);

      // If auto-sync was running, restart it
      if (applicationState.autoSyncIntervalHandler) {
        applicationState.communication.logInfo(
          "Restarting sync with new configuration.",
        );
        setTimeout(() => syncFiles(applicationState), 500);
      }
    });
    socket.on("getConfig", (cb) => {
      cb(applicationState.config);
    });
    socket.on("listDir", async (path, cb) => {
      const info = await listDir(path, applicationState);
      if (info) {
        cb(path, info);
      }
    });
    socket.on("checkDir", async (path, cb) => {
      cb(await checkDir(path, applicationState));
    });
  });
}
