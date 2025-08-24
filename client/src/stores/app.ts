import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Config, Log } from "@shared/types";

export const useAppStore = defineStore("app", () => {
  // State
  const currentTab = ref<string>("console");
  const isConnected = ref(false);
  const logs = ref<Log[]>([]);
  const config = ref<Config | null>(null);
  const syncInProgress = ref(false);
  const syncPaused = ref(false);
  const currentVersion = ref("LOADING");
  const latestVersion = ref("LOADING");
  const autoSyncTimer = ref<string | null>(null);

  // Getters
  const hasUpdateAvailable = computed(() => {
    return (
      currentVersion.value !== latestVersion.value &&
      currentVersion.value !== "LOADING" &&
      latestVersion.value !== "LOADING"
    );
  });

  const filteredLogs = computed(() => (severity?: string) => {
    if (!severity) return logs.value;
    return logs.value.filter((log) => log.severity === severity);
  });

  const syncButtonText = computed(() => {
    if (syncInProgress.value && syncPaused.value) {
      return "Resume Sync";
    }
    if (syncInProgress.value) {
      return "Stop Sync";
    }
    return "Start Sync";
  });

  const syncButtonIcon = computed(() => {
    if (syncInProgress.value && syncPaused.value) {
      return "mdi-play";
    }
    if (syncInProgress.value) {
      return "mdi-stop";
    }
    return "mdi-sync";
  });

  // Actions
  const setTab = (tab: string) => {
    currentTab.value = tab;
  };

  const addLog = (log: Log) => {
    logs.value.push(log);
    // Keep only last 1000 logs for performance
    if (logs.value.length > 1000) {
      logs.value = logs.value.slice(-1000);
    }
  };

  const setLogs = (newLogs: Log[]) => {
    logs.value = newLogs;
  };

  const setConfig = (newConfig: Config) => {
    config.value = newConfig;
  };

  const setSyncStatus = (status: boolean) => {
    syncInProgress.value = status;
  };

  const setSyncPauseStatus = (status: boolean) => {
    syncPaused.value = status;
  };

  const setConnectionStatus = (status: boolean) => {
    isConnected.value = status;
  };

  const setVersions = (current: string, latest: string) => {
    currentVersion.value = current;
    latestVersion.value = latest;
  };

  const setAutoSyncTimer = (timer: string | null) => {
    autoSyncTimer.value = timer;
  };

  const clearLogs = () => {
    logs.value = [];
  };

  return {
    // State
    currentTab,
    isConnected,
    logs,
    config,
    syncInProgress,
    syncPaused,
    currentVersion,
    latestVersion,
    autoSyncTimer,

    // Getters
    hasUpdateAvailable,
    filteredLogs,
    syncButtonText,
    syncButtonIcon,

    // Actions
    setTab,
    addLog,
    setLogs,
    setConfig,
    setSyncStatus,
    setSyncPauseStatus,
    setConnectionStatus,
    setVersions,
    setAutoSyncTimer,
    clearLogs,
  };
});
