import { ref, onMounted, onUnmounted, type Ref } from "vue";
import { io, Socket } from "socket.io-client";
import type { Config, Log } from "@shared/types";

export interface UseSocketReturn {
  socket: Ref<Socket | null>;
  isConnected: Ref<boolean>;
  logs: Ref<Log[]>;
  config: Ref<Config | null>;
  syncInProgress: Ref<boolean>;
  syncPaused: Ref<boolean>;
  currentVersion: Ref<string>;
  latestVersion: Ref<string>;
  autoSyncTimer: Ref<string | null>;
  connect: () => void;
  disconnect: () => void;
  sync: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  saveConfig: (config: Config) => void;
}

export function useSocket(): UseSocketReturn {
  const socket = ref<Socket | null>(null);
  const isConnected = ref(false);
  const logs = ref<Log[]>([]);
  const config = ref<Config | null>(null);
  const syncInProgress = ref(false);
  const syncPaused = ref(false);
  const currentVersion = ref("LOADING");
  const latestVersion = ref("LOADING");
  const autoSyncTimer = ref<string | null>(null);

  const connect = () => {
    if (socket.value?.connected) return;

    const socketUrl = import.meta.env.DEV
      ? "ws://localhost:42380"
      : window.location.origin;

    socket.value = io(socketUrl, {
      transports: ["websocket"],
      upgrade: false,
    });

    setupSocketListeners();
  };

  const disconnect = () => {
    socket.value?.disconnect();
    socket.value = null;
    isConnected.value = false;
  };

  const setupSocketListeners = () => {
    if (!socket.value) return;

    socket.value.on("connect", () => {
      isConnected.value = true;
      loadInitialData();
    });

    socket.value.on("disconnect", () => {
      isConnected.value = false;
    });

    socket.value.on("log", (log: Log) => {
      logs.value.push(log);
      // Keep only last 1000 logs for performance
      if (logs.value.length > 1000) {
        logs.value = logs.value.slice(-1000);
      }
    });

    socket.value.on("config", (newConfig: Config) => {
      config.value = newConfig;
    });

    socket.value.on("syncStatus", (status: boolean) => {
      syncInProgress.value = status;
    });

    socket.value.on("syncPauseStatus", (status: boolean) => {
      syncPaused.value = status;
    });

    socket.value.on("autoSyncTimer", (timer: string | null) => {
      autoSyncTimer.value = timer;
    });
  };

  const loadInitialData = () => {
    if (!socket.value) return;

    socket.value.emit("getLogs", (initialLogs: Log[]) => {
      logs.value = initialLogs;
    });

    socket.value.emit("getConfig", (initialConfig: Config) => {
      config.value = initialConfig;
    });

    socket.value.emit("getSyncStatus", (status: boolean) => {
      syncInProgress.value = status;
    });

    socket.value.emit("getSyncPauseStatus", (status: boolean) => {
      syncPaused.value = status;
    });

    socket.value.emit("getVersion", (version: string) => {
      currentVersion.value = version;
    });

    socket.value.emit("getLatestVersion", (version: string) => {
      latestVersion.value = version;
    });
  };

  const sync = () => {
    socket.value?.emit("sync");
  };

  const pauseSync = () => {
    socket.value?.emit("pauseSync");
  };

  const resumeSync = () => {
    socket.value?.emit("resumeSync");
  };

  const saveConfig = (newConfig: Config) => {
    socket.value?.emit("config", newConfig);
  };

  onMounted(() => {
    connect();
  });

  onUnmounted(() => {
    disconnect();
  });

  return {
    socket: socket as Ref<Socket | null>,
    isConnected,
    logs,
    config,
    syncInProgress,
    syncPaused,
    currentVersion,
    latestVersion,
    autoSyncTimer,
    connect,
    disconnect,
    sync,
    pauseSync,
    resumeSync,
    saveConfig,
  };
}
