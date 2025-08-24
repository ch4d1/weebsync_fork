<template>
  <v-app class="main-app">
    <div class="content-container">
      <v-tabs
        v-model="tab"
        class="app-tabs"
        hide-slider
        background-color="transparent"
        dark
      >
        <v-tab class="app-tabs__tab-item" :value="'console'">
          <v-icon :icon="mdiConsole" class="tab-icon" /> Console
        </v-tab>
        <v-tab class="app-tabs__tab-item" :value="'config'">
          <v-icon :icon="mdiCog" class="tab-icon" /> Config
        </v-tab>
        <v-tab class="app-tabs__tab-item" :value="'sync'">
          <v-icon :icon="mdiSync" class="tab-icon" /> Sync
        </v-tab>
        <v-tab class="app-tabs__tab-item" :value="'plugins'">
          <v-icon :icon="mdiPuzzle" class="tab-icon" /> Plugins
        </v-tab>
        <v-tab class="app-tabs__tab-item" :value="'info'">
          <v-icon
            :icon="
              currentVersion !== latestVersion &&
              currentVersion !== 'LOADING' &&
              latestVersion !== 'LOADING'
                ? mdiUpdate
                : mdiInformation
            "
            :color="
              currentVersion !== latestVersion &&
              currentVersion !== 'LOADING' &&
              latestVersion !== 'LOADING'
                ? 'green'
                : ''
            "
            class="tab-icon"
          />
          Info
        </v-tab>
      </v-tabs>
      <v-card-text class="app-tabs-content">
        <v-window v-model="tab">
          <v-window-item
            class="app-tabs-content__tab-content"
            :value="'console'"
          >
            <perfect-scrollbar class="log-wrap">
              <div class="log">
                <div
                  v-for="(log, index) in logs"
                  :key="index"
                  :class="'log-item ' + 'log-item--' + log.severity"
                >
                  [{{ formatDate(log.date) }}] {{ log.content }}
                </div>
              </div>
            </perfect-scrollbar>
          </v-window-item>
          <v-window-item
            class="app-tabs-content__tab-content"
            :value="'config'"
          >
            <perfect-scrollbar class="config">
              <template v-if="configLoaded">
                <v-container :fluid="true">
                  <v-row
                    justify-sm="space-between"
                    justify-md="start"
                    justify-lg="start"
                  >
                    <v-col cols="12" sm="4" md="3" lg="2">
                      <v-switch
                        v-model="config.syncOnStart"
                        class="config__switch"
                        dense
                        hide-details
                        label="Sync on start"
                      />
                    </v-col>
                    <v-col cols="12" sm="4" md="3" lg="2">
                      <v-switch
                        v-model="config.debugFileNames"
                        class="config__switch"
                        dense
                        label="Debug file names"
                      />
                    </v-col>
                  </v-row>
                  <v-row justify="start">
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.autoSyncIntervalInMinutes"
                        dense
                        hide-details="auto"
                        :rules="syncIntervalRules"
                        type="number"
                        label="Auto sync interval in minutes"
                        class="config__text-field"
                      />
                    </v-col>
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.downloadSpeedLimitMbps"
                        dense
                        hide-details="auto"
                        :rules="downloadSpeedLimitRules"
                        type="number"
                        step="0.1"
                        min="0"
                        label="Download speed limit (MB/s, 0 = no limit)"
                        class="config__text-field"
                      />
                    </v-col>
                  </v-row>
                  <v-row justify="start">
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.server.host"
                        dense
                        hide-details
                        label="Host"
                        class="config__text-field"
                      />
                    </v-col>
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.server.port"
                        dense
                        hide-details
                        type="number"
                        label="Port"
                        class="config__text-field"
                      />
                    </v-col>
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.server.user"
                        dense
                        hide-details
                        label="User"
                        class="config__text-field"
                      />
                    </v-col>
                    <v-col cols="12" sm="6" md="3">
                      <v-text-field
                        v-model="config.server.password"
                        dense
                        hide-details
                        type="password"
                        label="Password"
                        class="config__text-field"
                      />
                    </v-col>
                  </v-row>
                </v-container>
              </template>
            </perfect-scrollbar>
          </v-window-item>
          <v-window-item class="app-tabs-content__tab-content" :value="'sync'">
            <div class="config">
              <template v-if="configLoaded">
                <div class="sync__add-button">
                  <v-btn
                    size="x-large"
                    variant="text"
                    :icon="mdiPlusCircleOutline"
                    color="green"
                    @click="addSyncMap()"
                  />
                </div>
                <div class="sync__panel-wrap">
                  <div class="sync__sync-panel-wrap-2">
                    <perfect-scrollbar class="sync__sync-panel-wrap-3">
                      <v-expansion-panels
                        class="sync__panels"
                        :multiple="true"
                        accordion
                      >
                        <v-expansion-panel
                          v-for="(syncItem, index) in config.syncMaps"
                          :key="index"
                          class="sync__panel"
                        >
                          <v-expansion-panel-title class="sync__item-wrap">
                            <div class="sync__item">
                              <span class="sync__item-header-text">{{
                                syncItem.id ? syncItem.id : "Please add name"
                              }}</span>
                              <span class="sync__item-header-delete">
                                <v-btn
                                  size="x-large"
                                  variant="text"
                                  :icon="mdiContentCopy"
                                  color="primary"
                                  @click.stop="copySyncMap($event, index)"
                                />
                                <v-btn
                                  size="x-large"
                                  variant="text"
                                  :icon="mdiDelete"
                                  color="error"
                                  @click.stop="deleteSyncMap($event, index)"
                                />
                              </span>
                            </div>
                          </v-expansion-panel-title>
                          <v-expansion-panel-text>
                            <v-container :fluid="true">
                              <v-row justify="start">
                                <v-col cols="12" sm="12">
                                  <v-text-field
                                    v-model="syncItem.id"
                                    dense
                                    hide-details="auto"
                                    type="text"
                                    label="Sync name"
                                    class="config__text-field"
                                  />
                                </v-col>
                              </v-row>
                              <v-row justify="start">
                                <v-col cols="12" sm="12">
                                  <div class="config__actionable-field">
                                    <v-text-field
                                      :model-value="syncItem.originFolder"
                                      dense
                                      hide-details="auto"
                                      type="text"
                                      label="Origin folder"
                                      class="config__text-field"
                                      @update:model-value="
                                        pathPicked(syncItem, $event)
                                      "
                                    />
                                    <ftp-viewer
                                      :item="syncItem"
                                      @save="pathPicked(syncItem, $event)"
                                    />
                                  </div>
                                </v-col>
                              </v-row>
                              <v-row justify="start">
                                <v-col cols="12" sm="12">
                                  <v-text-field
                                    v-model="syncItem.destinationFolder"
                                    dense
                                    hide-details="auto"
                                    type="text"
                                    label="Destination folder"
                                    class="config__text-field"
                                  />
                                </v-col>
                              </v-row>
                              <v-row justify="start">
                                <v-col cols="12" sm="12">
                                  <v-switch
                                    v-model="syncItem.rename"
                                    class="v-input--reverse config__switch"
                                    dense
                                    hide-details
                                    label="Rename items on sync"
                                  />
                                </v-col>
                              </v-row>
                              <v-row v-if="syncItem.rename" justify="start">
                                <v-col cols="12" sm="12">
                                  <v-text-field
                                    v-model="syncItem.fileRegex"
                                    dense
                                    hide-details="auto"
                                    type="text"
                                    label="File rename regex"
                                    class="config__text-field"
                                  />
                                </v-col>
                              </v-row>
                              <v-row v-if="syncItem.rename" justify="start">
                                <v-col cols="12" sm="12">
                                  <v-text-field
                                    v-model="syncItem.fileRenameTemplate"
                                    dense
                                    hide-details="auto"
                                    type="text"
                                    label="File rename template"
                                    class="config__text-field"
                                  />
                                </v-col>
                              </v-row>
                            </v-container>
                          </v-expansion-panel-text>
                        </v-expansion-panel>
                      </v-expansion-panels>
                    </perfect-scrollbar>
                  </div>
                </div>
              </template>
            </div>
          </v-window-item>
          <v-window-item
            class="app-tabs-content__tab-content"
            :value="'plugins'"
          >
            <plugins-view />
          </v-window-item>
          <v-window-item class="app-tabs-content__tab-content" :value="'info'">
            <v-list class="caption" dense>
              <v-list-item>Version {{ currentVersion }}</v-list-item>
              <v-list-item>
                <span
                  >For updates and general information look
                  <a
                    href="https://github.com/BastianGanze/weebsync/releases"
                    target="_blank"
                    >here</a
                  >.</span
                >
              </v-list-item>
              <v-list-item>
                <update-checker :show-link="true" />
              </v-list-item>
            </v-list>
          </v-window-item>
        </v-window>
      </v-card-text>
    </div>
    <!-- Sync Control Bar -->
    <v-card class="sync-control-bar" flat>
      <v-card-text class="d-flex justify-space-between align-center pa-3">
        <div class="d-flex align-center">
          <!-- Left side: Status and info chips -->
          <v-chip
            v-if="isSyncing"
            :color="isSyncPaused ? 'warning' : 'success'"
            size="default"
            variant="flat"
            class="mr-2"
          >
            <v-icon
              :icon="isSyncPaused ? mdiPause : mdiPlay"
              size="small"
              class="mr-1"
            />
            {{ isSyncPaused ? "Paused" : "Running" }}
          </v-chip>

          <!-- Progress chip -->
          <v-chip
            v-if="bottomBar.fileProgress"
            color="info"
            size="default"
            variant="tonal"
            class="mr-2"
          >
            {{ bottomBar.fileProgress }}
          </v-chip>

          <!-- Download speed chip -->
          <v-chip
            v-if="bottomBar.downloadSpeed"
            color="primary"
            size="default"
            variant="tonal"
            class="mr-2"
          >
            {{ bottomBar.downloadSpeed }}
          </v-chip>

          <!-- Auto-sync timer chip -->
          <v-chip
            v-if="!isSyncing && autoSyncTimeRemaining"
            color="secondary"
            size="default"
            variant="tonal"
          >
            Next sync: {{ autoSyncTimeRemaining }}
          </v-chip>
        </div>

        <div class="d-flex align-center">
          <!-- Right side: Control buttons -->
          <!-- Save button - only visible in config/sync tabs -->
          <v-btn
            v-if="tab === 'config' || tab === 'sync'"
            size="default"
            variant="tonal"
            :prepend-icon="mdiContentSave"
            color="success"
            class="mr-3"
            @click="sendConfig()"
          >
            Save
          </v-btn>

          <!-- Sync control buttons -->
          <v-btn
            size="default"
            variant="tonal"
            :prepend-icon="
              isSyncing ? (isSyncPaused ? mdiPlay : mdiPause) : mdiSync
            "
            :color="
              isSyncing ? (isSyncPaused ? 'success' : 'warning') : 'primary'
            "
            class="mr-2"
            @click="sync()"
          >
            {{ isSyncing ? (isSyncPaused ? "Resume" : "Pause") : "Sync" }}
          </v-btn>
          <v-btn
            v-if="isSyncing"
            size="default"
            variant="tonal"
            :prepend-icon="mdiStop"
            color="error"
            @click="stopSync()"
          >
            Stop
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-app>
</template>

<script lang="ts" setup>
import UpdateChecker from "./UpdateChecker.vue";
import FtpViewer from "./FtpViewer.vue";
import { PerfectScrollbar } from "vue3-perfect-scrollbar";

import { useUiStore } from "./store";
import { SyncMap } from "@shared/types";
import { ref } from "vue";
import { useCommunication } from "./communication";
import dayjs from "dayjs";
import { storeToRefs } from "pinia";
import {
  mdiContentCopy,
  mdiDelete,
  mdiPlusCircleOutline,
  mdiPause,
  mdiPlay,
  mdiStop,
  mdiContentSave,
  mdiSync,
  mdiConsole,
  mdiCog,
  mdiPuzzle,
  mdiInformation,
  mdiUpdate,
} from "@mdi/js";
import PluginsView from "./PluginsView.vue";

const {
  logs,
  configLoaded,
  config,
  isSyncing,
  isSyncPaused,
  currentVersion,
  latestVersion,
  bottomBar,
  autoSyncTimeRemaining,
} = storeToRefs(useUiStore());
const communication = useCommunication();

const tab = ref("tab-1");

const syncIntervalRules: Array<(value: number) => string | boolean> = [
  (_v) => true,
];

const downloadSpeedLimitRules: Array<
  (value: number | string) => string | boolean
> = [
  (v) => {
    const numValue = typeof v === "string" ? parseFloat(v) : v;
    if (isNaN(numValue)) {
      return "Must be a valid number";
    }
    if (numValue < 0) {
      return "Speed limit cannot be negative";
    }
    return true;
  },
];

function formatDate(date: string): string {
  return dayjs(new Date(date)).format("HH:mm:ss");
}

function addSyncMap() {
  config.value.syncMaps.unshift({
    id: "",
    destinationFolder: "",
    fileRenameTemplate: "",
    fileRegex: "",
    originFolder: "",
    rename: false,
  });
}

function deleteSyncMap(_event: MouseEvent, index: number) {
  config.value.syncMaps.splice(index, 1);
}

function copySyncMap(_event: MouseEvent, index: number) {
  config.value.syncMaps.splice(index + 1, 0, {
    ...config.value.syncMaps[index],
  });
}

function sendConfig() {
  communication.config(config.value);
}

function sync() {
  if (isSyncing.value && !isSyncPaused.value) {
    // If syncing and not paused, pause it
    communication.pauseSync();
  } else if (isSyncing.value && isSyncPaused.value) {
    // If syncing and paused, resume it
    communication.resumeSync();
  } else {
    // If not syncing, start sync
    communication.sync();
  }
}

function stopSync() {
  communication.sync(); // This will abort the sync since it's already running
}

function pathPicked(syncItem: SyncMap, update: string) {
  syncItem.originFolder = update;
}
</script>

<style scoped lang="scss">
.main-app {
  color: inherit;
  background: none;
}

.config {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__actionable-field {
    display: flex;
  }
  &__save-button {
    z-index: 200;
    position: absolute;
    bottom: 0;
    right: 0;
  }
  // Remove old sync button styles since they're moved to sync control bar
  &__switch {
    margin: 0;
  }
  &__text-field {
    margin: 0;
  }
}

.log-wrap {
  height: 100%;
}

.log {
  display: flex;
  flex-wrap: wrap;
  flex-direction: column-reverse;
  justify-content: flex-end;
}

.log-item {
  &--warn {
    color: rgb(var(--v-theme-warning));
  }
  &--debug {
    color: rgb(var(--v-theme-info));
  }
  &--error {
    color: rgb(var(--v-theme-error));
  }
}

.sync {
  &__panel-wrap {
    flex-grow: 1;
    min-height: 0;
    position: relative;
  }
  &__sync-panel-wrap-2 {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  &__sync-panel-wrap-3 {
    height: 100%;
  }

  &__panel {
    width: 100%;
    flex-grow: 0;
    background-color: #272727;
  }

  &__item {
    display: flex;
    justify-content: space-between;
    width: 100%;
  }

  &__item-wrap {
    padding: 0 24px;
  }

  &__item-header-text {
    display: flex;
    align-items: center;
  }

  &__item-header-delete {
    text-align: right;
  }

  &__add-button {
    margin-bottom: 5px;
    width: 100%;
  }
}

.content-container {
  display: flex;
  flex-flow: column;
  height: auto;
  position: absolute;
  top: 0;
  left: 5px;
  bottom: 60px; /* Adjusted for sync control bar only */
  right: 5px;
}

.app-tabs:deep(.v-tabs > .v-tabs-bar) {
  background: none;
  height: 30px;
}

.app-tabs {
  min-height: var(--v-tabs-height);
  &__tab-item {
    padding: 8px;
    min-width: auto;
    min-height: auto;
    text-transform: none;
    letter-spacing: inherit;
    font-weight: bold;
  }
  &__tab-item:deep(.v-tab--active) {
    background-color: #282a2d;
  }
}

.app-tabs-content {
  background-color: #282a2d;
  flex-grow: 1;
  padding: 8px 0 0 8px;
  min-height: 0;
}

.sync-control-bar {
  position: absolute;
  bottom: 0; /* At bottom since bottom bar is removed */
  left: 0;
  right: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
</style>
