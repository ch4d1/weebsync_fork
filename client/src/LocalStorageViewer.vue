<template>
  <v-dialog
    v-model="dialog"
    :fullscreen="true"
    :scrollable="true"
    hide-overlay
    transition="dialog-bottom-transition"
  >
    <template #activator="{ props }">
      <v-btn
        size="x-large"
        variant="text"
        v-bind="props"
        :color="getIconColor()"
        @click="onOpenModal()"
      >
        <v-icon
          v-if="exists && !isLoading"
          :icon="mdiFolderCheck"
          title="Directory exists"
        />
        <v-icon
          v-if="!exists && !isLoading"
          :icon="mdiFolderOff"
          title="Directory does not exist"
        />
        <v-progress-circular
          v-if="isLoading"
          indeterminate
          width="2"
          size="10"
        />
      </v-btn>
    </template>
    <v-card>
      <v-toolbar>
        <v-btn variant="text" :icon="mdiClose" @click="dialog = false" />
        <v-toolbar-title>{{ current.name }}</v-toolbar-title>
        <v-spacer />
        <v-toolbar-items>
          <v-btn color="secondary" :disabled="isLoading" @click="save()">
            <v-progress-circular
              v-if="isLoading"
              indeterminate
              width="2"
              size="14"
            />Pick
          </v-btn>
        </v-toolbar-items>
      </v-toolbar>
      <perfect-scrollbar class="scroll-wrapper">
        <v-card-text class="pa-0">
          <v-list>
            <v-list-item
              v-if="current.path !== '/'"
              :prepend-icon="mdiFolderOutline"
              @click="navigateUp()"
            >
              <v-list-item-title>..</v-list-item-title>
            </v-list-item>
            <v-list-item
              v-for="item in directories"
              :key="item.name"
              :prepend-icon="mdiFolder"
              @click="navigate(item.path)"
            >
              <v-list-item-title>{{ item.name }}</v-list-item-title>
            </v-list-item>
            <v-list-item
              v-for="item in files"
              :key="item.name"
              :prepend-icon="mdiFile"
            >
              <v-list-item-title>{{ item.name }}</v-list-item-title>
              <template #append>
                <v-list-item-action>
                  <v-chip size="x-small" variant="outlined">
                    {{ formatFileSize(item.size || 0) }}
                  </v-chip>
                </v-list-item-action>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </perfect-scrollbar>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { PerfectScrollbar } from "vue3-perfect-scrollbar";
import { useCommunication } from "./communication";
import { FileInfo, SyncMap } from "@shared/types";
import {
  mdiClose,
  mdiFolderCheck,
  mdiFolderOff,
  mdiFolderOutline,
  mdiFolder,
  mdiFile,
} from "@mdi/js";

interface TreeChild {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modifiedTime?: string;
  children?: TreeChild[];
}

const emit = defineEmits(["save"]);

const isLoading = computed(() => loading.value || exists.value === null);

function save() {
  if (loading.value) {
    return;
  }
  dialog.value = false;
  emit("save", current.value.path);
}

let timeout: ReturnType<typeof setTimeout>;
const localProps = defineProps<{ item: SyncMap }>();
const syncItem = ref(localProps.item);

watch(
  [localProps],
  () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      checkDirectory(syncItem.value.destinationFolder);
    }, 250);
  },
  { immediate: true },
);

const dialog = ref(false);
const exists = ref<boolean | null>(null);
const loading = ref(false);

const current = ref<TreeChild>({
  id: "root",
  name: ".",
  path: "/",
  isDir: true,
  children: [],
});

const communication = useCommunication();

function getIconColor() {
  if (isLoading.value) return "primary";
  return exists.value ? "success" : "error";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function checkDirectory(path: string): Promise<void> {
  return new Promise((resolve) => {
    if (path === "") {
      exists.value = false;
      resolve();
      return;
    }
    loading.value = true;
    exists.value = null;
    communication.checkLocalDir(path, (result) => {
      exists.value = result;
      loading.value = false;
      resolve();
    });
  });
}

const directories = computed(() => {
  if (!current.value.children) return [];
  return current.value.children
    .filter((child) => child.isDir)
    .sort((a, b) => a.name.localeCompare(b.name));
});

const files = computed(() => {
  if (!current.value.children) return [];
  return current.value.children
    .filter((child) => !child.isDir)
    .sort((a, b) => a.name.localeCompare(b.name));
});

function navigate(itemPath: string): void {
  loading.value = true;
  communication.listLocalDir(itemPath, (path, result) => {
    if (result) {
      const children: TreeChild[] = result.map((item: FileInfo) => ({
        id: item.path || `${path}/${item.name}`,
        name: item.name,
        path: item.path || `${path}/${item.name}`,
        isDir: item.isDirectory,
        size: item.size,
        modifiedTime: item.modifiedTime,
      }));

      current.value = {
        id: path,
        name: path === "/" ? "/" : path.split("/").pop() || path,
        path,
        isDir: true,
        children,
      };
    } else {
      current.value.children = [];
    }
    loading.value = false;
  });
}

function navigateUp() {
  const pathParts = current.value.path.split("/").filter((p) => p);
  if (pathParts.length === 0) {
    navigate("/");
  } else {
    pathParts.pop();
    const parentPath = "/" + pathParts.join("/");
    navigate(parentPath || "/");
  }
}

function onOpenModal() {
  const initialPath = syncItem.value.destinationFolder || "/";
  navigate(initialPath);
}
</script>

<style scoped lang="scss">
.scroll-wrapper {
  height: calc(100vh - 64px);
}
</style>
