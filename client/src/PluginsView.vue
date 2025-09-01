<template>
  <div class="plugins">
    <perfect-scrollbar class="plugins__scrollbar-wrap">
      <div v-if="plugins.length === 0">No plugins available.</div>
      <v-expansion-panels :multiple="true">
        <v-expansion-panel
          v-for="plugin in plugins"
          :key="plugin.name"
          class="plugins__panel"
        >
          <v-expansion-panel-title class="plugins__item-wrap">
            <div class="plugins__item">
              <span class="plugins__item-header-text">{{ plugin.name }}</span>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-container :fluid="true">
              <v-row justify="start">
                <v-col cols="12" sm="12" class="plugins__description">
                  {{ plugin.description }}
                </v-col>
              </v-row>
              <v-row
                v-for="(conf, idx) in plugin.pluginConfigurationDefinition"
                :key="plugin.name + idx"
                justify="start"
                @error="console.error('Template error for', plugin.name, conf)"
              >
                <template v-if="conf.type === 'label'">
                  <v-col class="plugins__label" cols="12" sm="12">{{
                    conf.label
                  }}</v-col>
                </template>
                <template v-if="conf.type !== 'label'">
                  <v-col
                    v-if="enabledWhen(plugin, conf.enableWhen)"
                    class="plugins__input"
                    cols="12"
                    sm="12"
                  >
                    <v-text-field
                      v-if="conf.type === 'text'"
                      v-model="plugin.config[conf.key]"
                      dense
                      hide-details="auto"
                      type="text"
                      :label="conf.key"
                      :placeholder="conf.placeholder"
                      :hint="conf.description"
                      class="plugins__text-field"
                    />
                    <v-text-field
                      v-if="conf.type === 'number'"
                      v-model="plugin.config[conf.key]"
                      dense
                      hide-details="auto"
                      type="number"
                      :label="conf.key"
                      class="plugins__text-field"
                    />
                    <v-checkbox
                      v-if="conf.type === 'boolean'"
                      v-model="plugin.config[conf.key]"
                      dense
                      hide-details="auto"
                      type="text"
                      :label="conf.key"
                      class="plugins__text-field"
                    />
                    <!-- Text Array Field -->
                    <div
                      v-if="conf.type === 'text-array'"
                      class="plugins__text-array"
                    >
                      <v-label class="text-caption mb-2">{{
                        conf.key
                      }}</v-label>
                      <div
                        v-for="(_item, arrayIdx) in getTextArrayValue(
                          plugin,
                          conf.key,
                        )"
                        :key="arrayIdx"
                        class="d-flex align-center mb-2"
                      >
                        <v-text-field
                          :model-value="
                            getTextArrayValue(plugin, conf.key)[arrayIdx]
                          "
                          dense
                          hide-details="auto"
                          :placeholder="conf.placeholder || 'Enter path'"
                          class="flex-grow-1 mr-2"
                          @update:model-value="
                            updateTextArrayValue(
                              plugin,
                              conf.key,
                              arrayIdx,
                              $event,
                            )
                          "
                        />
                        <v-btn
                          icon="mdi-delete"
                          size="small"
                          variant="text"
                          color="error"
                          @click="
                            removeTextArrayItem(plugin, conf.key, arrayIdx)
                          "
                        />
                      </div>
                      <v-btn
                        prepend-icon="mdi-plus"
                        size="small"
                        variant="outlined"
                        @click="addTextArrayItem(plugin, conf.key)"
                      >
                        Add Path
                      </v-btn>
                      <div
                        v-if="conf.description"
                        class="text-caption text-grey mt-1"
                      >
                        {{ conf.description }}
                      </div>
                    </div>
                    <!-- FTP Directory Picker using FtpViewer -->
                    <div
                      v-if="conf.type === 'directory-picker'"
                      class="plugins__directory-picker"
                    >
                      <v-text-field
                        v-model="plugin.config[conf.key]"
                        dense
                        hide-details="auto"
                        :label="conf.key"
                        :placeholder="conf.placeholder"
                        :hint="conf.description"
                        readonly
                        class="plugins__text-field"
                      >
                        <template #append>
                          <FtpViewer
                            :item="createSyncMapFromConfig(plugin, conf)"
                            @save="
                              (path: string) =>
                                updatePluginConfig(plugin, conf, path)
                            "
                          >
                            <template #activator="{ props: ftpProps }">
                              <v-btn
                                icon="mdi-folder-open"
                                size="small"
                                variant="text"
                                v-bind="ftpProps"
                              />
                            </template>
                          </FtpViewer>
                        </template>
                      </v-text-field>
                    </div>
                  </v-col>
                </template>
              </v-row>
            </v-container>
            <v-btn
              small
              variant="tonal"
              elevation="0"
              class="plugins__save-button"
              @click="sendConfig(plugin)"
            >
              Save
            </v-btn>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </perfect-scrollbar>
  </div>
</template>

<script lang="ts" setup>
import { useUiStore } from "./store";
import { storeToRefs } from "pinia";
import { PerfectScrollbar } from "vue3-perfect-scrollbar";
import {
  WeebsyncPluginBaseInfo,
  PluginInputDefinition,
  SyncMap,
} from "@shared/types";
import { useCommunication } from "./communication";
import FtpViewer from "./FtpViewer.vue";

const { plugins } = storeToRefs(useUiStore());
const communication = useCommunication();

function sendConfig(plugin: WeebsyncPluginBaseInfo) {
  communication.sendPluginConfig(plugin.name, plugin.config);
}

function enabledWhen(
  config: WeebsyncPluginBaseInfo,
  enableWhenConfig?: PluginInputDefinition["enableWhen"],
): boolean {
  if (!enableWhenConfig) {
    return true;
  }
  return config.config[enableWhenConfig.key] === enableWhenConfig.is;
}

// Create a temporary SyncMap for FtpViewer
function createSyncMapFromConfig(
  plugin: WeebsyncPluginBaseInfo,
  conf: PluginInputDefinition,
): SyncMap {
  const currentPath = (plugin.config[conf.key] as string) || "/";
  return {
    id: `${plugin.name}-${conf.key}`,
    originFolder: currentPath,
    destinationFolder: "",
    fileRegex: "",
    fileRenameTemplate: "",
    rename: false,
  };
}

// Handle directory selection from FtpViewer
function updatePluginConfig(
  plugin: WeebsyncPluginBaseInfo,
  conf: PluginInputDefinition,
  selectedPath: string,
) {
  plugin.config[conf.key] = selectedPath;
}

// Text Array handling methods
function getTextArrayValue(
  plugin: WeebsyncPluginBaseInfo,
  key: string,
): string[] {
  if (!plugin.config[key]) {
    plugin.config[key] = [];
  }
  return plugin.config[key] as string[];
}

function updateTextArrayValue(
  plugin: WeebsyncPluginBaseInfo,
  key: string,
  index: number,
  value: string,
) {
  const array = getTextArrayValue(plugin, key);
  array[index] = value;
}

function addTextArrayItem(plugin: WeebsyncPluginBaseInfo, key: string) {
  const array = getTextArrayValue(plugin, key);
  array.push("");
}

function removeTextArrayItem(
  plugin: WeebsyncPluginBaseInfo,
  key: string,
  index: number,
) {
  const array = getTextArrayValue(plugin, key);
  array.splice(index, 1);
}
</script>

<style scoped lang="scss">
.plugins {
  height: 100%;
  position: relative;
  display: flex;
  width: 100%;

  &__item-header-text {
    font-size: 16px;
    font-weight: bold;
  }

  &__description {
    font-size: 14px;
    white-space: pre-line;
  }

  &__scrollbar-wrap {
    width: 100%;
  }

  &__label {
    font-size: 16px;
    font-weight: bold;
  }

  &__input {
    padding: 0;
  }
}
</style>
