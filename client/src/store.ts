import { defineStore } from "pinia";
import {
  BottomBarUpdateEvent,
  Config,
  Log,
  WeebsyncPluginBaseInfo,
} from "@shared/types";
import { reactive, ref } from "vue";
import { useCommunication } from "./communication";

export function createDefaultConfig(): Config {
  return {
    syncOnStart: true,
    autoSyncIntervalInMinutes: 30,
    debugFileNames: false,
    startAsTray: false,
    downloadSpeedLimitMbps: 0,
    server: {
      host: "",
      password: "",
      port: 21,
      user: "",
    },
    syncMaps: [],
  };
}

export const useUiStore = defineStore("uiStore", () => {
  const communication = useCommunication();

  const logs = reactive<Log[]>([]);
  let config = ref(createDefaultConfig());
  const configLoaded = ref(false);
  const isSyncing = ref(false);
  const isSyncPaused = ref(false);
  const currentVersion = ref("LOADING");
  const latestVersion = ref("LOADING");
  const plugins = reactive<WeebsyncPluginBaseInfo[]>([]);
  const bottomBar = ref<BottomBarUpdateEvent>({
    fileProgress: "",
    downloadSpeed: "",
  });
  const autoSyncTimeRemaining = ref<string | null>(null);

  communication.getVersion((v) => {
    currentVersion.value = v;
  });

  communication.getPlugins((pluginsFromServer) => {
    plugins.splice(0, plugins.length);
    plugins.push(...pluginsFromServer);
  });

  communication.getLatestVersion((v) => {
    latestVersion.value = v;
  });

  communication.getLogs((logsFromServer) => {
    logs.splice(0, logs.length);
    logs.push(...logsFromServer);
  });

  communication.getConfig((configFromServer) => {
    config.value = configFromServer;
    configLoaded.value = true;
  });

  communication.getSyncSatus((syncStatusFromServer) => {
    isSyncing.value = syncStatusFromServer;
  });

  communication.getSyncPauseStatus((syncPauseStatusFromServer) => {
    isSyncPaused.value = syncPauseStatusFromServer;
  });

  communication.socket.on("log", (log) => {
    logs.push(log);
  });

  communication.socket.on("config", (configFromServer) => {
    config.value = configFromServer;
  });

  communication.socket.on("updateBottomBar", (bottomBarEvent) => {
    bottomBar.value = bottomBarEvent;
  });

  communication.socket.on("syncStatus", (isSyncingStatus) => {
    isSyncing.value = isSyncingStatus;
  });

  communication.socket.on("syncPauseStatus", (isSyncPausedStatus) => {
    isSyncPaused.value = isSyncPausedStatus;
  });

  communication.socket.on("autoSyncTimer", (timeRemaining) => {
    autoSyncTimeRemaining.value = timeRemaining;
  });

  return {
    config,
    configLoaded,
    logs,
    isSyncing,
    isSyncPaused,
    currentVersion,
    latestVersion,
    bottomBar,
    plugins,
    autoSyncTimeRemaining,
  };
});
