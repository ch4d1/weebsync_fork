import fs from "fs";
import { match, P } from "ts-pattern";
import chokidar from "chokidar";
import { Config } from "@shared/types";
import { ApplicationState } from "./index";
import { Communication } from "./communication";
import process from "process";

const CONFIG_NAME = "weebsync.config.json";
export const PATH_TO_EXECUTABLE: string = process.cwd()
  ? process.cwd()
  : __dirname;
export const CONFIG_FILE_DIR =
  process.env.WEEB_SYNC_CONFIG_DIR ?? `${PATH_TO_EXECUTABLE}/config`;
export const CONFIG_FILE_PATH = `${CONFIG_FILE_DIR}/${CONFIG_NAME}`;

export function watchConfigChanges(applicationState: ApplicationState): void {
  const configWatcher = chokidar.watch(CONFIG_FILE_PATH);
  let lastProgrammaticSave = 0;

  // Store reference to track programmatic saves
  (applicationState as any).markProgrammaticConfigSave = () => {
    lastProgrammaticSave = Date.now();
  };

  configWatcher.on("change", async (oath) => {
    // Skip if this change was from a recent programmatic save
    if (Date.now() - lastProgrammaticSave < 1000) {
      return;
    }

    if (applicationState.configUpdateInProgress) {
      return;
    }

    applicationState.communication.logInfo(
      `"${oath}" changed, trying to update configuration.`,
    );
    applicationState.configUpdateInProgress = true;

    if (applicationState.syncInProgress && !applicationState.syncPaused) {
      applicationState.communication.logInfo(
        "Sync is in progress, won't update configuration now.",
      );
      applicationState.configUpdateInProgress = false;
      return;
    }

    const tmpConfig = loadConfig(applicationState.communication);
    if (tmpConfig) {
      await applyConfigUpdate(tmpConfig, applicationState);
    } else {
      applicationState.communication.logError(
        "Config was broken, will keep the old config for now.",
      );
    }
    applicationState.configUpdateInProgress = false;
  });
}

export function createDefaultConfig(): Config {
  return {
    syncOnStart: true,
    autoSyncIntervalInMinutes: 30,
    debugFileNames: false,
    startAsTray: false,
    server: {
      host: "",
      password: "",
      port: 21,
      user: "",
    },
    syncMaps: [],
  };
}

export type GetConfigResult =
  | {
      type: "Ok";
      data: Config;
    }
  | { type: "WrongConfigError"; message: string }
  | { type: "UnknownError" };

export async function waitForCorrectConfig(
  communication: Communication,
): Promise<Config> {
  communication.logInfo("Loading configuration.");
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const tmpConfig = loadConfig(communication);
    if (tmpConfig) {
      resolve(tmpConfig);
    } else {
      const watcher = chokidar.watch(CONFIG_FILE_PATH);
      watcher.on("change", async () => {
        const tmpConfig = loadConfig(communication);
        if (tmpConfig) {
          await watcher.close();
          resolve(tmpConfig);
        }
      });
    }
  });
}

export function loadConfig(communication: Communication): Config | undefined {
  return match(getConfig())
    .with({ type: "Ok", data: P.select() }, (res) => {
      const config = { ...res };
      for (const sync of config.syncMaps) {
        sync.rename ??=
          sync.fileRegex.length > 0 || sync.fileRenameTemplate.length > 0;
      }
      return config;
    })
    .with({ type: "UnknownError" }, (): undefined => {
      communication.logError("Unknown error happened. :tehe:");
      return void 0;
    })
    .with(
      { type: "WrongConfigError", message: P.select() },
      (err): undefined => {
        communication.logError(`Config malformed. "${err}"`);
        return void 0;
      },
    )
    .exhaustive();
}

export function saveConfig(
  config: Config,
  communication: Communication,
  applicationState?: ApplicationState,
): void {
  try {
    for (const sync of config.syncMaps) {
      sync.destinationFolder = sync.destinationFolder.replaceAll("\\", "/");
    }
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 4));

    // Apply config changes immediately if application state is available
    if (applicationState) {
      applyConfigUpdate(config, applicationState);
    }
  } catch (e) {
    if (e instanceof Error) {
      communication.logError(`Error while saving config!: ${e.message}`);
    }
  }
}

async function applyConfigUpdate(
  newConfig: Config,
  applicationState: ApplicationState,
): Promise<void> {
  const oldConfig = applicationState.config;
  const communication = applicationState.communication;

  // Apply the new configuration
  applicationState.config = newConfig;

  // Update auto-sync if interval changed
  if (
    oldConfig.autoSyncIntervalInMinutes !== newConfig.autoSyncIntervalInMinutes
  ) {
    const { toggleAutoSync } = await import("./sync");
    if (applicationState.autoSyncIntervalHandler) {
      communication.logInfo("Auto-sync interval updated, restarting timer.");
      toggleAutoSync(applicationState, false);
      toggleAutoSync(applicationState, true);
    }
  }

  communication.logInfo("Config successfully updated.");
  communication.sendConfig(JSON.parse(JSON.stringify(newConfig)));
}

function createConfigFileIfNotExists(): Config {
  const config = createDefaultConfig();
  fs.mkdirSync(CONFIG_FILE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 4));
  return config;
}

function handleFileNotFoundError(): GetConfigResult {
  const config = createConfigFileIfNotExists();
  return { type: "Ok", data: config };
}

function handleError(e: unknown): GetConfigResult {
  if (!e || !(e instanceof Error)) {
    return { type: "UnknownError" };
  }

  const nodeError = e as NodeJS.ErrnoException;
  if ("code" in nodeError && nodeError.code === "ENOENT") {
    return handleFileNotFoundError();
  }

  return { type: "WrongConfigError", message: e.message };
}

function getConfig(): GetConfigResult {
  try {
    const file = fs.readFileSync(CONFIG_FILE_PATH).toString("utf-8");
    const config = JSON.parse(file) as Config;

    return {
      type: "Ok",
      data: config,
    };
  } catch (e) {
    return handleError(e);
  }
}
