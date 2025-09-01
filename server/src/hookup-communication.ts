import { abortSync, syncFiles } from "./sync";
import { saveConfig } from "./config";
import { ApplicationState } from "./index";
import {
  checkDir,
  listDir,
  getRegexDebugInfo,
  listLocalDir,
  checkLocalDir,
} from "./actions";
import { pluginApis, savePluginConfiguration } from "./plugin-system";
import { PluginConfig } from "./types";
import {
  validateConfig,
  validatePath,
  validateRegexDebugInput,
} from "./validation";

// Unified error handling wrapper for socket events
function withErrorHandling<T extends any[]>(
  handler: (...args: T) => Promise<void> | void,
  applicationState: ApplicationState,
) {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      applicationState.communication.logError(
        `Socket error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };
}

export function hookupCommunicationEvents(
  applicationState: ApplicationState,
): void {
  applicationState.communication.connect.sub((socket) => {
    socket?.on("getPlugins", (cb) => {
      const pluginsData = applicationState.plugins.map((p) => ({
        name: p.name,
        config: p.config,
        pluginConfigurationDefinition: p.pluginConfigurationDefinition,
        version: p.version,
        description: p.description,
      }));
      cb(pluginsData);
    });
    socket?.on(
      "sendPluginConfig",
      withErrorHandling(async (name: string, config: unknown) => {
        const plugin = applicationState.plugins.find((p) => p.name === name);
        if (plugin) {
          applicationState.communication.logInfo(
            `Saving config for plugin ${name}.`,
          );
          await savePluginConfiguration(plugin.name, config as PluginConfig);
          if (plugin.onConfigUpdate) {
            await plugin.onConfigUpdate(
              pluginApis[name],
              config as PluginConfig,
            );
          }
          plugin.config = config as PluginConfig;
          applicationState.communication.logInfo(`Config for ${name} saved!`);
        }
      }, applicationState),
    );
    socket?.on("getLogs", (cb) => {
      cb(applicationState.communication.logs.getAll().filter((v) => v));
    });
    socket?.on("getVersion", (cb) => {
      cb(process.env.__APP_VERSION__ ?? "unknown");
    });
    socket?.on("getSyncStatus", (cb) => {
      cb(applicationState.syncInProgress);
    });
    socket?.on("getLatestVersion", async (cb) => {
      try {
        const res = await fetch(
          "https://api.github.com/repos/BastianGanze/weebsync/releases/latest",
        );
        const data = (await res.json()) as { tag_name: string };
        cb(data.tag_name);
      } catch (error) {
        // Log error for debugging but return safe fallback
        applicationState.communication.logError(
          `Failed to fetch latest version: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        cb("unknown");
      }
    });
    socket?.on("sync", () => {
      if (applicationState.syncInProgress) {
        abortSync();
      } else {
        syncFiles(applicationState);
      }
    });
    socket?.on("stopSync", () => {
      abortSync();
    });
    socket?.on("config", async (config: unknown) => {
      // Validate configuration input
      const validation = validateConfig(config);
      if (!validation.isValid) {
        applicationState.communication.logError(
          `Invalid configuration received: ${validation.error}`,
        );
        return;
      }

      const validatedConfig = validation.value!;

      // If sync is in progress, stop it first (but don't restart automatically)
      if (applicationState.syncInProgress) {
        applicationState.communication.logInfo(
          "Config changed during sync. Stopping current sync.",
        );
        abortSync();
        // Wait a moment for abort to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Save the new config (without triggering applyConfigUpdate to prevent file watcher loop)
      saveConfig(validatedConfig, applicationState.communication);

      // Apply config changes manually without file watcher triggering
      applicationState.config = validatedConfig;
      applicationState.communication.sendConfig(
        JSON.parse(JSON.stringify(validatedConfig)),
      );

      applicationState.communication.logInfo(
        "Configuration saved successfully.",
      );
    });
    socket?.on("getConfig", (cb) => {
      cb(applicationState.config);
    });
    socket?.on("listDir", async (path: unknown, cb: any) => {
      const pathValidation = validatePath(path);
      if (!pathValidation.isValid) {
        applicationState.communication.logError(
          `Invalid path for listDir: ${pathValidation.error}`,
        );
        if (cb) cb("", []);
        return;
      }

      const info = await listDir(pathValidation.value!, applicationState);
      if (info && cb) {
        cb(pathValidation.value!, info);
      }
    });
    socket?.on("checkDir", async (path: unknown, cb: any) => {
      const pathValidation = validatePath(path);
      if (!pathValidation.isValid) {
        applicationState.communication.logError(
          `Invalid path for checkDir: ${pathValidation.error}`,
        );
        if (cb) cb(false);
        return;
      }

      if (cb) {
        cb(await checkDir(pathValidation.value!, applicationState));
      }
    });
    socket?.on(
      "getRegexDebugInfo",
      async (
        originFolder: unknown,
        fileRegex: unknown,
        fileRenameTemplate: unknown,
        syncName: unknown,
        cb: any,
      ) => {
        // Create input object from individual parameters
        const input = {
          originFolder,
          fileRegex,
          fileRenameTemplate,
          syncName,
        };

        const validation = validateRegexDebugInput(input);
        if (!validation.isValid) {
          applicationState.communication.logError(
            `Invalid regex debug input: ${validation.error}`,
          );
          if (typeof cb === "function") cb({ error: validation.error });
          return;
        }

        const {
          originFolder: validOriginFolder,
          fileRegex: validFileRegex,
          fileRenameTemplate: validFileRenameTemplate,
          syncName: validSyncName,
        } = validation.value!;

        try {
          const result = await getRegexDebugInfo(
            validOriginFolder,
            validFileRegex,
            validFileRenameTemplate,
            validSyncName,
            applicationState,
          );
          if (typeof cb === "function") cb(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          applicationState.communication.logError(
            `Regex debug error: ${errorMessage}`,
          );
          if (typeof cb === "function") cb({ error: errorMessage });
        }
      },
    );

    socket?.on("listLocalDir", async (path: unknown, cb: any) => {
      const pathValidation = validatePath(path);
      if (pathValidation.error) {
        applicationState.communication.logError(
          `Invalid path for listLocalDir: ${pathValidation.error}`,
        );
        return;
      }

      const info = await listLocalDir(pathValidation.value!);
      if (cb) cb(pathValidation.value, info);
    });

    socket?.on("checkLocalDir", async (path: unknown, cb: any) => {
      const pathValidation = validatePath(path);
      if (pathValidation.error) {
        applicationState.communication.logError(
          `Invalid path for checkLocalDir: ${pathValidation.error}`,
        );
        return;
      }

      if (cb) {
        cb(await checkLocalDir(pathValidation.value!));
      }
    });
  });
}
