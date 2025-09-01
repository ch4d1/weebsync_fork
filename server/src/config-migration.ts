import { Communication } from "./communication";

interface ConfigMigration {
  version: number;
  description: string;
  migrate: (config: any) => any;
}

function ensureBasicStructure(config: any): void {
  if (!config.server) {
    config.server = {};
  }
  if (!Array.isArray(config.syncMaps)) {
    config.syncMaps = [];
  }
}

function setDefaultValues(config: any): void {
  if (config.autoSyncIntervalInMinutes === undefined) {
    config.autoSyncIntervalInMinutes = 30;
  }
  if (config.syncOnStart === undefined) {
    config.syncOnStart = false;
  }
  if (config.debugFileNames === undefined) {
    config.debugFileNames = false;
  }
  if (config.startAsTray === undefined) {
    config.startAsTray = false;
  }
}

function ensureServerConfig(config: any): void {
  if (!config.server.host) {
    config.server.host = "";
  }
  if (!config.server.user) {
    config.server.user = "";
  }
  if (!config.server.password) {
    config.server.password = "";
  }

  // Convert string port to number if needed
  if (typeof config.server.port === "string") {
    config.server.port = parseInt(config.server.port, 10);
  }
  if (config.server.port === undefined || isNaN(config.server.port)) {
    config.server.port = 21;
  }
}

function removeDeprecatedFields(config: any): void {
  const deprecatedFields = [
    "downloadSpeedLimitMbps",
    "server.protocol",
    "server.allowSelfSignedCert",
  ];

  for (const field of deprecatedFields) {
    const keys = field.split(".");
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]]) {
        obj = obj[keys[i]];
      } else {
        break;
      }
    }
    const lastKey = keys[keys.length - 1];
    if (obj && obj[lastKey] !== undefined) {
      delete obj[lastKey];
    }
  }
}

function ensureSyncMapStructure(config: any): void {
  for (const syncMap of config.syncMaps) {
    if (syncMap.rename === undefined) {
      syncMap.rename =
        syncMap.fileRegex?.length > 0 || syncMap.fileRenameTemplate?.length > 0;
    }
    if (!syncMap.fileRegex) {
      syncMap.fileRegex = ".*";
    }
    if (syncMap.fileRenameTemplate === undefined) {
      syncMap.fileRenameTemplate = "";
    }
  }
}

const migrations: ConfigMigration[] = [
  {
    version: 1,
    description:
      "Migrate from old config format to FTP-only format (from commit 84de8ea state)",
    migrate: (config: any) => {
      ensureBasicStructure(config);
      setDefaultValues(config);
      ensureServerConfig(config);
      removeDeprecatedFields(config);
      ensureSyncMapStructure(config);
      return config;
    },
  },
];

export function migrateConfig(config: any, communication?: Communication): any {
  let migratedConfig = { ...config };
  const configVersion = migratedConfig.configVersion || 0;

  // Apply all migrations newer than the current config version
  for (const migration of migrations) {
    if (migration.version > configVersion) {
      if (communication) {
        communication.logInfo(
          `Applying config migration v${migration.version}: ${migration.description}`,
        );
      }
      migratedConfig = migration.migrate(migratedConfig);
    }
  }

  // Set the config version to the latest
  if (migrations.length > 0) {
    migratedConfig.configVersion = migrations[migrations.length - 1].version;
  }

  return migratedConfig;
}

export function getCurrentConfigVersion(): number {
  return migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
}
