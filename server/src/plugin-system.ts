import process from "process";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  rmSync,
  existsSync,
} from "fs";
import { ApplicationState } from "./index";
import extract from "extract-zip";
import axios, { AxiosInstance, CreateAxiosDefaults } from "axios";
import { Communication } from "./communication";
import { WeebsyncPluginBaseInfo } from "@shared/types";
import { CONFIG_FILE_DIR } from "./config";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import {
  listDir as serverListDir,
  checkDir as serverCheckDir,
} from "./actions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine the root directory of the application
function findApplicationRoot(): string {
  const cwd = process.cwd();

  // Check if we're in a Docker container or development environment
  const possiblePaths = [
    join(cwd, "..", "plugins"), // Docker: /app/server -> /app/plugins
    join(cwd, "plugins"), // Native/dev: /path/to/app -> /path/to/app/plugins
    join(__dirname, "..", "..", "..", "plugins"), // Compiled: build/server/src -> plugins
    join(__dirname, "..", "..", "plugins"), // Dev: server/src -> plugins
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return resolve(path);
    }
  }

  // Fallback: create plugins directory in current working directory
  const fallback = join(cwd, "plugins");
  return resolve(fallback);
}

export const PLUGINS_DIRECTORY: string = findApplicationRoot();

export const pluginApis: { [name: string]: WeebsyncApi } = {};
export async function initPluginSystem(applicationState: ApplicationState) {
  const pluginDir = process.env.WEEB_SYNC_PLUGIN_DIR ?? PLUGINS_DIRECTORY;
  try {
    const allFolders = readdirSync(pluginDir);

    const pluginFolders = allFolders.filter(
      (folder) =>
        folder !== ".DS_Store" &&
        folder !== "node_modules" &&
        folder !== ".git" &&
        folder !== "Thumbs.db" &&
        folder !== "desktop.ini" &&
        folder !== "._.DS_Store" &&
        folder !== "package.json" &&
        folder !== "package-lock.json" &&
        folder !== "yarn.lock" &&
        folder !== "pnpm-lock.yaml",
    );

    if (pluginFolders.length > 0) {
      applicationState.communication.logInfo(
        `Loading ${pluginFolders.length} plugin${pluginFolders.length > 1 ? "s" : ""}`,
      );
    }

    for (const pluginFolder of pluginFolders) {
      try {
        await loadPlugin(pluginDir, pluginFolder, applicationState);
      } catch (e) {
        applicationState.communication.logError(
          `Could not load plugin "${pluginFolder}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return;
    }
    applicationState.communication.logError(
      `Could not setup plugins due to unknown error: "${e instanceof Error ? e.message : String(e)}"`,
    );
  }
}

export interface WeebsyncPlugin extends WeebsyncPluginBaseInfo {
  register: (api: WeebsyncApi) => Promise<void>;
  onFilesDownloadSuccess?: (
    api: WeebsyncApi,
    config: WeebsyncPluginBaseInfo["config"],
  ) => Promise<void>;
  onConfigUpdate?: (
    api: WeebsyncApi,
    config: WeebsyncPluginBaseInfo["config"],
  ) => Promise<void>;
}

interface WeebsyncApi {
  applicationState: ApplicationState;
  communication: Communication;
  thisPluginDirectory: string;
  getAxiosInstance: (config?: CreateAxiosDefaults) => Promise<AxiosInstance>;
  downloadPluginResourceZipAndUnzip: (
    directoryPath: string,
    url: string,
  ) => Promise<void>;
  listDir: (path: string) => Promise<any>;
  checkDir: (path: string) => Promise<boolean>;
}

async function downloadPluginResourceZipAndUnzip(
  directoryPath: string,
  url: string,
) {
  const tmpZipPath = `${directoryPath}/archive.zip`;
  const file = createWriteStream(tmpZipPath);

  const response = await axios({ method: "GET", url, responseType: "stream" });

  await new Promise((resolve, reject) => {
    response.data.pipe(file);
    file.on("finish", () => {
      file.close(resolve);
    });
    file.on("error", reject);
  });

  await extract(tmpZipPath, { dir: `${directoryPath}` });
  rmSync(tmpZipPath);
}

async function getAxiosInstance(config?: CreateAxiosDefaults) {
  return Promise.resolve(axios.create(config ?? {}));
}

async function createListDirWrapper(applicationState: ApplicationState) {
  return async (path: string) => {
    return await serverListDir(path, applicationState);
  };
}

async function createCheckDirWrapper(applicationState: ApplicationState) {
  return async (path: string) => {
    return await serverCheckDir(path, applicationState);
  };
}

async function loadOrCreatePluginConfiguration(
  plugin: WeebsyncPlugin,
): Promise<WeebsyncPlugin["config"]> {
  const configFileName = `${plugin.name}-config.json`;
  let pluginConfig: WeebsyncPlugin["config"] = {};
  try {
    pluginConfig = JSON.parse(
      readFileSync(`${CONFIG_FILE_DIR}/${configFileName}`, "utf-8"),
    );
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      pluginConfig = {};
      for (const def of plugin.pluginConfigurationDefinition) {
        if (def.type === "label") {
          continue;
        }
        pluginConfig[def.key] = def.default;
      }
      await savePluginConfiguration(plugin.name, pluginConfig);
    }
  }

  return pluginConfig;
}

export async function savePluginConfiguration(
  pluginName: string,
  config: WeebsyncPlugin["config"],
) {
  const configFileName = `${pluginName}-config.json`;
  writeFileSync(
    `${CONFIG_FILE_DIR}/${configFileName}`,
    JSON.stringify(config, null, 2),
  );
}
async function loadPlugin(
  pluginDir: string,
  pluginFolder: string,
  applicationState: ApplicationState,
) {
  try {
    const thisPluginDirectory = `${pluginDir}/${pluginFolder}`;
    let plugin: WeebsyncPlugin;
    try {
      plugin = (
        (await import(`${thisPluginDirectory}/index.mjs`)) as {
          default: WeebsyncPlugin;
        }
      ).default;
    } catch (mjsError) {
      try {
        const imported = await import(`${thisPluginDirectory}/index.js`);
        plugin = imported.default || imported;
      } catch (jsError) {
        // Try with require for CommonJS modules
        try {
          const { createRequire } = await import("module");
          const require = createRequire(import.meta.url);
          plugin = require(`${thisPluginDirectory}/index.js`);
        } catch (cjsError) {
          throw new Error(
            `Could not load plugin: .mjs error: ${mjsError}, .js error: ${jsError}, .cjs error: ${cjsError}`,
          );
        }
      }
    }

    pluginApis[plugin.name] = {
      applicationState,
      communication: applicationState.communication,
      getAxiosInstance,
      downloadPluginResourceZipAndUnzip,
      thisPluginDirectory,
      listDir: await createListDirWrapper(applicationState),
      checkDir: await createCheckDirWrapper(applicationState),
    };
    await plugin.register(pluginApis[plugin.name]);
    plugin.config = await loadOrCreatePluginConfiguration(plugin);
    if (plugin.onConfigUpdate) {
      await plugin.onConfigUpdate(pluginApis[plugin.name], plugin.config);
    }
    applicationState.plugins.push(plugin);
  } catch (e) {
    applicationState.communication.logError(
      `Could not load plugin in dir "${pluginFolder}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
