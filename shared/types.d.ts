export type Log = {
  date: string;
  content: string;
  severity: "info" | "warn" | "error" | "debug";
};

export interface PluginInputDefinition {
  key: string;
  type: "number" | "text" | "boolean" | "directory-picker" | "text-array";
  default: number | string | boolean | string[];
  placeholder?: string;
  description?: string;
  enableWhen?: {
    key: string;
    is: number | string | boolean;
  };
}

export interface PluginInputLabel {
  label: string;
  type: "label";
}

export interface WeebsyncPluginBaseInfo {
  name: string;
  version: string;
  description: string;
  config: { [key: string]: number | boolean | string | string[] };
  pluginConfigurationDefinition: (PluginInputDefinition | PluginInputLabel)[];
}

export interface ServerToClientEvents {
  log: (log: Log) => void;
  updateBottomBar: (content: BottomBarUpdateEvent) => void;
  syncStatus: (syncStatus: boolean) => void;
  config: (config: Config) => void;
  autoSyncTimer: (timeRemaining: string | null) => void;
}

export interface RegexDebugResult {
  testFileName: string;
  matches: RegexMatch[] | null;
  renamedFileName: string | null;
  error?: string;
}

export interface RegexMatch {
  match: string;
  index: number;
  length: number;
  groups: string[];
}

export interface ClientToServerEvents {
  getLogs: (cb: (logs: Log[]) => void) => void;
  getVersion: (cb: (version: string) => void) => void;
  getLatestVersion: (cb: (version: string) => void) => void;
  getPlugins: (cb: (plugins: WeebsyncPluginBaseInfo[]) => void) => void;
  sendPluginConfig: (
    name: string,
    config: WeebsyncPluginBaseInfo["config"],
  ) => void;
  listDir: (
    path: string,
    cb: (path: string, result: FileInfo[]) => void,
  ) => void;
  checkDir: (path: string, cb: (exists: boolean) => void) => void;
  listLocalDir: (
    path: string,
    cb: (path: string, result: FileInfo[]) => void,
  ) => void;
  checkLocalDir: (path: string, cb: (exists: boolean) => void) => void;
  config: (config: Config) => void;
  getConfig: (cb: (config: Config) => void) => void;
  getSyncStatus: (cb: (syncStatus: boolean) => void) => void;
  sync: () => void;
  stopSync: () => void;
  getRegexDebugInfo: (
    originFolder: string,
    fileRegex: string,
    fileRenameTemplate: string,
    syncName: string,
    cb: (result: RegexDebugResult) => void,
  ) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface Config {
  syncOnStart?: boolean;
  autoSyncIntervalInMinutes?: number;
  debugFileNames?: boolean;
  startAsTray?: boolean;
  server: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
  syncMaps: SyncMap[];
}

export interface SyncMap {
  id: string;
  originFolder: string;
  destinationFolder: string;
  fileRegex: string;
  fileRenameTemplate: string;
  rename: boolean;
}

export interface FileInfo {
  name: string;
  path?: string;
  size: number;
  rawModifiedAt: string;
  modifiedTime?: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  isFile: boolean;
  date: string;
  type: number;
}

export interface BottomBarUpdateEvent {
  fileProgress: string;
  downloadSpeed: string;
}
