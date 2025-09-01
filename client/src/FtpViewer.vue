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
          :icon="mdiCloudCheckVariant"
          title="Directory exists"
        />
        <v-icon
          v-if="!exists && !isLoading"
          :icon="mdiCloudOff"
          title="Directory does not exist"
        /><v-progress-circular
          v-if="isLoading"
          indeterminate
          width="2"
          size="10"
        />
      </v-btn>
    </template>
    <v-card class="d-flex flex-column" style="height: 100vh">
      <v-toolbar>
        <v-btn variant="text" :icon="mdiClose" @click="dialog = false" />
        <v-toolbar-title>{{ current.name }}</v-toolbar-title>
        <v-spacer />
        <!-- Show metadata loading status -->
        <v-chip
          v-if="metadataLoadingStatus"
          class="mx-2"
          size="small"
          color="primary"
        >
          <v-progress-circular size="12" width="2" indeterminate class="mr-2" />
          {{ metadataLoadingStatus }}
        </v-chip>
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

      <!-- Search and Filter Controls - Compact layout (hidden when anime viewer is active) -->
      <div
        v-if="!usingPluginComponent"
        class="px-3 py-2 border-bottom flex-shrink-0"
      >
        <v-row dense no-gutters align="center" class="ga-2">
          <v-col cols="12" sm="5">
            <v-text-field
              v-model="searchTerm"
              :prepend-inner-icon="mdiMagnify"
              label="Filter anime titles..."
              variant="outlined"
              density="compact"
              hide-details
              clearable
              @input="onSearchInput"
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="sortBy"
              :items="sortOptions"
              label="Sort by"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="2">
            <v-select
              v-model="sortOrder"
              :items="[
                { title: 'A-Z', value: 'asc' },
                { title: 'Z-A', value: 'desc' },
              ]"
              label="Order"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col v-if="searchTerm" cols="auto" class="text-center">
            <v-chip size="small" color="primary" variant="outlined">
              {{ filteredItems.length }} of
              {{ (current.children || []).length }}
            </v-chip>
          </v-col>
        </v-row>
      </div>

      <!-- Scrollable content area -->
      <div class="flex-grow-1 overflow-hidden">
        <!-- Use AnimeSeasonViewer for season directories -->
        <AnimeSeasonViewer
          v-if="usingPluginComponent"
          :items="convertedAnimeItems"
          :path="current.path"
          :socket="communication.socket"
          :loading-status="metadataLoadingStatus"
          :origin-folder="originFolder"
          @item-selected="handlePluginItemClick"
          @metadata-update="handleMetadataUpdate"
          @go-back="pathUp"
          @save="handleVersionSave"
          @close-viewer="closeViewer"
        />

        <!-- Default FTP viewer -->
        <perfect-scrollbar v-else style="height: 100%">
          <v-card-text class="pa-0">
            <v-list>
              <v-list-item
                v-if="!isRoot(current.path)"
                :prepend-icon="mdiFolderOutline"
                @click="pathUp()"
              >
                <v-list-item-title>..</v-list-item-title>
              </v-list-item>
              <v-list-item
                v-for="item in filteredItems"
                :key="item.name"
                :prepend-icon="
                  !isAnimeDirectory(item, inSeasonDirectory)
                    ? item.isDir
                      ? mdiFolder
                      : mdiFile
                    : undefined
                "
                @click="handleItemClick(item)"
                :class="{
                  'anime-directory': isAnimeDirectory(item, inSeasonDirectory),
                  'grouped-anime': item.isGrouped && !item.isSingleVersion,
                  'single-anime': item.isGrouped && item.isSingleVersion,
                  'anime-loading':
                    isAnimeDirectory(item, inSeasonDirectory) &&
                    item.isProcessing,
                }"
              >
                <!-- Show anime cover for anime directories -->
                <template
                  v-if="isAnimeDirectory(item, inSeasonDirectory)"
                  #prepend
                >
                  <v-avatar size="48" rounded="lg" class="anime-cover">
                    <v-img
                      v-if="item.animeMetadata?.coverImage"
                      :src="item.animeMetadata.coverImage"
                      :alt="item.animeMetadata?.title || item.name"
                    />
                    <v-progress-circular
                      v-else-if="item.isProcessing && !item.isRateLimited"
                      indeterminate
                      size="24"
                      width="2"
                      color="primary"
                    />
                    <v-icon
                      v-else-if="item.isRateLimited"
                      :icon="mdiClockOutline"
                      size="24"
                      color="orange"
                      :title="'Rate limited - waiting for API'"
                    />
                    <v-icon
                      v-else-if="item.metadataFailed"
                      :icon="mdiHelpCircleOutline"
                      size="24"
                      color="grey"
                      :title="'Anime not found in database'"
                    />
                    <v-icon v-else :icon="mdiFolder" size="24" />
                  </v-avatar>
                </template>

                <v-list-item-title>
                  <div class="anime-title-container">
                    <!-- Show anime title if available, otherwise directory name -->
                    <div class="anime-title-wrapper">
                      <span class="anime-title">{{
                        item.animeMetadata?.title || item.name
                      }}</span>
                      <small
                        v-if="item.animeMetadata?.subtitle"
                        class="anime-subtitle"
                      >
                        {{ item.animeMetadata.subtitle }}
                      </small>
                    </div>

                    <!-- Show version count for grouped anime, but different styling for single vs multiple -->
                    <v-chip
                      v-if="item.isGrouped && !item.isSingleVersion"
                      size="x-small"
                      color="secondary"
                      class="ml-2"
                    >
                      {{ item.versionCount }} versions
                    </v-chip>
                    <v-chip
                      v-if="item.isGrouped && item.isSingleVersion"
                      size="x-small"
                      color="primary"
                      variant="outlined"
                      class="ml-2"
                    >
                      Single
                    </v-chip>

                    <!-- Show file size for files -->
                    <small v-if="!item.isDir">
                      ({{ formatFileSize(item.size || 0) }})
                    </small>

                    <!-- Show episode count and score for anime -->
                    <div
                      v-if="isAnimeDirectory(item, inSeasonDirectory)"
                      class="anime-info"
                    >
                      <!-- Show actual metadata if available -->
                      <template v-if="item.animeMetadata">
                        <v-chip
                          v-if="item.animeMetadata.episodes"
                          size="small"
                          variant="outlined"
                          color="primary"
                        >
                          {{ item.animeMetadata.episodes }} episodes
                        </v-chip>
                        <v-chip
                          v-if="item.animeMetadata.averageScore"
                          size="small"
                          variant="outlined"
                          color="success"
                        >
                          {{ item.animeMetadata.averageScore }}%
                        </v-chip>
                        <v-chip
                          v-for="genre in (
                            item.animeMetadata.genres || []
                          ).slice(0, 2)"
                          :key="genre"
                          size="small"
                          variant="outlined"
                        >
                          {{ genre }}
                        </v-chip>
                      </template>
                      <!-- Show placeholders while loading -->
                      <template
                        v-else-if="item.isProcessing && !item.isRateLimited"
                      >
                        <v-skeleton-loader
                          type="chip"
                          width="80"
                          height="20"
                          class="mr-1"
                        />
                        <v-skeleton-loader
                          type="chip"
                          width="60"
                          height="20"
                          class="mr-1"
                        />
                        <v-skeleton-loader type="chip" width="70" height="20" />
                      </template>
                      <!-- Show rate-limited status -->
                      <template v-else-if="item.isRateLimited">
                        <v-chip size="small" variant="outlined" color="orange">
                          ⏳ Rate limited
                        </v-chip>
                      </template>
                      <!-- Show not found status -->
                      <template v-else-if="item.metadataFailed">
                        <v-chip size="small" variant="outlined" color="grey">
                          ❓ Not found
                        </v-chip>
                      </template>
                      <!-- Show minimal placeholders for unprocessed items -->
                      <template v-else>
                        <v-chip size="small" variant="outlined" disabled>
                          Loading...
                        </v-chip>
                      </template>
                    </div>

                    <small style="color: #666">
                      [{{
                        item.isGrouped && item.isSingleVersion
                          ? "SINGLE"
                          : item.isGrouped
                            ? "GROUPED"
                            : item.isDir
                              ? "DIR"
                              : "FILE"
                      }}]
                    </small>
                  </div>
                </v-list-item-title>

                <!-- Show anime description or placeholder -->
                <v-list-item-subtitle
                  v-if="isAnimeDirectory(item, inSeasonDirectory)"
                  class="anime-description"
                >
                  <template v-if="item.animeMetadata?.description">
                    {{ truncateDescription(item.animeMetadata.description) }}
                  </template>
                  <template
                    v-else-if="item.isProcessing && !item.isRateLimited"
                  >
                    <v-skeleton-loader type="text" width="200" />
                  </template>
                  <template v-else-if="item.isRateLimited">
                    <span style="color: #ff9800; font-style: italic"
                      >⏳ Waiting for API (rate limited)...</span
                    >
                  </template>
                  <template v-else-if="item.metadataFailed">
                    <span style="color: #999; font-style: italic"
                      >❓ Anime not found in AniList database</span
                    >
                  </template>
                  <template v-else>
                    <span style="color: #999; font-style: italic"
                      >Loading description...</span
                    >
                  </template>
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </perfect-scrollbar>
      </div>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { PerfectScrollbar } from "vue3-perfect-scrollbar";
import {
  mdiClose,
  mdiCloudCheckVariant,
  mdiCloudOff,
  mdiFolder,
  mdiFile,
  mdiFolderOutline,
  mdiClockOutline,
  mdiHelpCircleOutline,
  mdiMagnify,
} from "@mdi/js";
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { useCommunication } from "./communication";
import { useFtpViewComponents } from "./composables/useFtpViewComponents";
import { SyncMap } from "@shared/types";
import AnimeSeasonViewer from "./components/AnimeSeasonViewer.vue";

interface TreeChild {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modifiedTime?: string;
  children?: TreeChild[];
  animeMetadata?: {
    title: string;
    subtitle?: string;
    coverImage?: string;
    genres: string[];
    averageScore?: number;
    description?: string;
    episodes?: number;
    status?: string;
    season?: string;
    seasonYear?: number;
  };
  // Grouped anime properties
  isGrouped?: boolean;
  versions?: TreeChild[];
  versionCount?: number;
  searchTitle?: string;
  isProcessing?: boolean;
  metadataFailed?: boolean;
  isRateLimited?: boolean;
  isSingleVersion?: boolean;
  versionInfo?: {
    baseTitle: string;
    providers: Array<{
      code: string;
      name: string;
      color: string;
      icon: string;
    }>;
    audio: Array<{
      code: string;
      type: string;
      full: string;
      flag: string;
    }>;
    subtitles: Array<{
      code: string;
      type: string;
      full: string;
      flag: string;
    }>;
    quality?: string;
    season?: number;
    special: boolean;
  };
  versionDescription?: string;
}

const emit = defineEmits(["save"]);

const isLoading = computed(() => loading.value || exists.value === null);

const inSeasonDirectory = computed(() => {
  return isSeasonDirectory(current.value.path || "");
});

// Filtered and sorted items
const filteredItems = computed(() => {
  let items = current.value.children || [];

  // Apply search filter
  if (searchTerm.value) {
    const search = searchTerm.value.toLowerCase();
    items = items.filter((item) => {
      // Search in directory name
      if (item.name.toLowerCase().includes(search)) return true;

      // Search in anime title if available
      if (item.animeMetadata?.title?.toLowerCase().includes(search))
        return true;

      // Search in anime subtitle if available
      if (item.animeMetadata?.subtitle?.toLowerCase().includes(search))
        return true;

      // Search in genres if available
      if (
        item.animeMetadata?.genres?.some((genre) =>
          genre.toLowerCase().includes(search),
        )
      )
        return true;

      return false;
    });
  }

  // Apply sorting
  const sorted = [...items].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortBy.value) {
      case "name":
        aValue = a.name?.toLowerCase() || "";
        bValue = b.name?.toLowerCase() || "";
        break;
      case "animeTitle":
        aValue =
          a.animeMetadata?.title?.toLowerCase() || a.name?.toLowerCase() || "";
        bValue =
          b.animeMetadata?.title?.toLowerCase() || b.name?.toLowerCase() || "";
        break;
      case "score":
        aValue = a.animeMetadata?.averageScore || 0;
        bValue = b.animeMetadata?.averageScore || 0;
        break;
      case "episodes":
        aValue = a.animeMetadata?.episodes || 0;
        bValue = b.animeMetadata?.episodes || 0;
        break;
      case "modifiedTime":
        aValue = a.modifiedTime || "";
        bValue = b.modifiedTime || "";
        break;
      case "size":
        aValue = a.size || 0;
        bValue = b.size || 0;
        break;
      default:
        // Sort directories first, then by name
        aValue = a.isDir
          ? "0" + (a.name?.toLowerCase() || "")
          : "1" + (a.name?.toLowerCase() || "");
        bValue = b.isDir
          ? "0" + (b.name?.toLowerCase() || "")
          : "1" + (b.name?.toLowerCase() || "");
    }

    // Handle string comparison
    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortOrder.value === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    // Handle numeric comparison
    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortOrder.value === "asc" ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });

  return sorted;
});

function save() {
  if (loading.value) {
    return;
  }
  dialog.value = false;
  emit("save", current.value.path);
}

function onSearchInput() {
  // The computed property will automatically react to searchTerm changes
}

let timeout: ReturnType<typeof setTimeout>;
const ftpProps = defineProps<{ item: SyncMap }>();
const syncItem = ref(ftpProps.item);

watch(
  [ftpProps],
  () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      // Use root directory if originFolder is empty
      const pathToCheck = syncItem.value.originFolder || "/";
      checkDirectory(pathToCheck);
    }, 250);
  },
  { immediate: true },
);

const dialog = ref(false);
const exists = ref<boolean | null>(null);
const loading = ref(false);
const selectedItem = ref(-1);
const metadataLoadingStatus = ref<string | null>(null);
const processingAnimeCount = ref(0);

// Filter and sort state
const searchTerm = ref("");
const sortBy = ref("name");
const sortOrder = ref("asc");

const sortOptions = [
  { title: "Name", value: "name" },
  { title: "Anime Title", value: "animeTitle" },
  { title: "Score", value: "score" },
  { title: "Episodes", value: "episodes" },
  { title: "Modified Date", value: "modifiedTime" },
  { title: "File Size", value: "size" },
];

const current = ref<TreeChild>({
  id: "root",
  name: ".",
  path: "",
  isDir: true,
  children: [],
});

function getIconColor(): string {
  if (loading.value) {
    return "white";
  }

  return exists.value ? "green" : "red";
}

function pathUp() {
  if (current.value.path.includes("/")) {
    const parentPath = current.value.path.split("/").slice(0, -1).join("/");
    // If parent path is empty, use root
    const validParentPath = parentPath || "/";
    fetchDirectory(validParentPath);
  }
}

function isRoot(path: string) {
  return !path.includes("/");
}

// Extract season directory from origin folder path
function getSeasonDirFromOriginFolder(originFolder: string): string {
  if (!originFolder || originFolder === "/") {
    return "/";
  }

  // Check if this looks like a season directory path
  // e.g. "/server/2025-2 Spring/WIND BREAKER S2 [JapDub,GerEngSub,CR]"
  // should return "/server/2025-2 Spring"
  const parts = originFolder.split("/").filter((part) => part.length > 0);

  // Look for season pattern in the path parts
  const seasonIndex = parts.findIndex(
    (part) =>
      /^\d{4}-\d+\s+(Spring|Summer|Fall|Winter|Autumn)/i.test(part) ||
      /^\d{4}\s+(Spring|Summer|Fall|Winter|Autumn)/i.test(part),
  );

  if (seasonIndex !== -1) {
    // Return path up to and including the season directory
    const seasonPath = "/" + parts.slice(0, seasonIndex + 1).join("/");
    return seasonPath;
  }

  // Fallback: if no season pattern found, try to go up one level
  if (parts.length > 1) {
    const parentPath = "/" + parts.slice(0, -1).join("/");
    return parentPath;
  }

  // Last resort: return root
  return "/";
}

function onOpenModal() {
  const originFolder = syncItem.value.originFolder;

  if (!originFolder || originFolder === "/") {
    // Start from root if originFolder is empty
    fetchDirectory("/");
  } else {
    // Extract season directory and navigate there instead of direct originFolder
    const seasonDir = getSeasonDirFromOriginFolder(originFolder);
    fetchDirectory(seasonDir);
  }
}

const communication = useCommunication();
const { getBestComponentForPath, initializeComponents } =
  useFtpViewComponents();

// Computed property for origin folder
const originFolder = computed(() => syncItem.value.originFolder);

// Convert TreeChild[] to AnimeItem[] for AnimeSeasonViewer
const convertedAnimeItems = computed(() => {
  const children = current.value.children || [];

  // Debug: Log when conversion happens
  console.log(
    "🔄 FtpViewer: Converting",
    children.length,
    "children to AnimeItems",
    {
      path: current.value.path,
      sampleMetadata: children.slice(0, 3).map((c) => ({
        name: c.name,
        hasMetadata: !!c.animeMetadata,
        isProcessing: c.isProcessing,
      })),
    },
  );

  return children.map((child: TreeChild) => {
    // Convert TreeChild.versions to Version[]
    const versions = child.versions?.map((version: TreeChild) => {
      // Convert TreeChild versionInfo to VersionInfo format
      const versionInfo = version.versionInfo
        ? {
            providers:
              version.versionInfo.providers?.map((p) => ({
                tag: p.code,
                name: p.name,
                color: p.color,
              })) || [],
            dubLanguages:
              version.versionInfo.audio?.map((a) => ({
                code: a.code,
                language: a.full || a.type,
              })) || [],
            subLanguages:
              version.versionInfo.subtitles?.map((s) => ({
                code: s.code,
                language: s.full || s.type,
              })) || [],
            audio: version.versionInfo.audio?.map((a) => ({
              code: a.code,
              language: a.full || a.type,
              full: a.full,
            })),
            subtitles: version.versionInfo.subtitles?.map((s) => ({
              code: s.code,
              language: s.full || s.type,
              full: s.full,
            })),
            quality: version.versionInfo.quality,
            season: version.versionInfo.season,
            special: version.versionInfo.special,
          }
        : undefined;

      return {
        name: version.name,
        path: version.path,
        versionDescription: versionInfo,
        simpleVersionDescription: version.versionDescription,
        versionInfo: versionInfo,
      };
    });

    return {
      name: child.name,
      path: child.path,
      isDir: child.isDir,
      animeMetadata: child.animeMetadata,
      versionCount: child.versionCount,
      isGrouped: child.isGrouped,
      isSingleVersion: child.isSingleVersion,
      versions: versions,
      type: 2, // Directory type
      size: child.size,
      modifiedTime: child.modifiedTime,
      isProcessing: child.isProcessing,
      metadataFailed: child.metadataFailed,
      isRateLimited: child.isRateLimited,
      searchTitle: child.searchTitle,
    };
  });
});

// Plugin component integration
const usingPluginComponent = ref(false);
const activePluginComponent = ref<any>(null);

// Handle plugin component item clicks
function handlePluginItemClick(item: any) {
  handleItemClick(item);
}

// Handle metadata updates from plugin
function handleMetadataUpdate(data: any) {
  console.log("🎯 FtpViewer: metadata update received:", data);

  // If this is a full directory refresh from AnimeSeasonViewer
  if (data && Array.isArray(data) && data.length > 0) {
    console.log(
      "🔄 FtpViewer: Updating children with new metadata from AnimeSeasonViewer",
    );

    // Process the data as an enhanced directory listing
    processEnhancedDirectoryListing(current.value.path, data);
  } else if (data && data.updates && Array.isArray(data.updates)) {
    // Process individual metadata updates
    console.log(
      "🔄 FtpViewer: Processing individual metadata updates",
      data.updates.length,
    );

    for (const update of data.updates) {
      const matchingChildren =
        current.value.children?.filter(
          (c: any) =>
            c.searchTitle === update.searchTitle || c.name === update.name,
        ) || [];

      for (const child of matchingChildren) {
        child.animeMetadata = update.metadata;
        child.isProcessing = false;

        if (child.isGrouped && child.versions) {
          for (const version of child.versions) {
            version.animeMetadata = update.metadata;
            version.isProcessing = false;
          }
        }
      }
    }
  }
}

// Handle version selection save event from AnimeSeasonViewer
function handleVersionSave(path: string) {
  // Update the origin folder with the selected version path
  syncItem.value.originFolder = path;
  // Emit save event to parent
  emit("save", path);
}

// Handle close viewer event from AnimeSeasonViewer
function closeViewer() {
  dialog.value = false;
}

// Check if we should use plugin component for current path
function checkForPluginComponent() {
  const currentPath = current.value.path || "/";

  // Check if this is a season directory that should use AnimeSeasonViewer
  if (isSeasonDirectory(currentPath)) {
    usingPluginComponent.value = true;
    activePluginComponent.value = {
      id: "anilist-seasons-anime-viewer",
      name: "Anime Season Viewer",
    };
    return;
  }

  // Try to get plugin component from registry
  const pluginComponent = getBestComponentForPath(currentPath);
  if (pluginComponent) {
    usingPluginComponent.value = true;
    activePluginComponent.value = pluginComponent;
  } else {
    usingPluginComponent.value = false;
    activePluginComponent.value = null;
  }
}

// Listen for async metadata updates and status
onMounted(async () => {
  // Initialize plugin components
  try {
    await initializeComponents();
  } catch (error) {
    console.error("Failed to initialize plugin components:", error);
  }
  // Listen for status updates (Context7: progress feedback)
  (communication.socket as any)?.on(
    "animeMetadataStatus",
    (data: {
      path: string;
      status: string;
      cachedCount?: number;
      uncachedCount?: number;
      remaining?: number;
      progress?: any;
    }) => {
      if (current.value.path === data.path) {
        if (data.status === "loading_cached") {
          metadataLoadingStatus.value = `Loading ${data.cachedCount} cached anime instantly...`;
        } else if (data.status === "loading_api") {
          metadataLoadingStatus.value = `Fetching ${data.remaining} anime from API...`;
        } else if (data.status === "completed") {
          metadataLoadingStatus.value = "Loading completed!";
          setTimeout(() => {
            metadataLoadingStatus.value = null;
          }, 2000);
        }
      }
    },
  );

  // Helper function to update loading status
  function updateLoadingStatus(data: any) {
    if (!data.updates || data.updates.length === 0) return;

    if (data.isCached) {
      metadataLoadingStatus.value = `Loaded ${data.updates.length} cached anime instantly! ${data.remaining ? data.remaining + " remaining..." : ""}`;
    } else if (data.progress) {
      metadataLoadingStatus.value = `Fetched ${data.updates.length} anime from API (${data.progress.percentage}% complete)`;
    } else {
      metadataLoadingStatus.value = `Processing ${data.updates.length} anime titles...`;
    }
    processingAnimeCount.value = data.updates.length;

    setTimeout(() => {
      metadataLoadingStatus.value = null;
      processingAnimeCount.value = 0;
    }, 3000);
  }

  // Helper function to update child metadata
  function updateChildMetadata(child: any, metadata: any) {
    child.animeMetadata = metadata;
    child.isProcessing = false;

    if (child.isGrouped && child.versions) {
      for (const version of child.versions) {
        version.animeMetadata = metadata;
        version.isProcessing = false;
      }
    }
  }

  // Helper function to process metadata updates
  function processMetadataUpdates(data: any) {
    if (current.value.path !== data.path) {
      return;
    }

    for (const update of data.updates) {
      const matchingChildren =
        current.value.children?.filter(
          (c: any) => c.searchTitle === update.searchTitle,
        ) || [];

      for (const child of matchingChildren) {
        updateChildMetadata(child, update.metadata);
      }
    }
  }

  (communication.socket as any)?.on(
    "animeMetadataUpdate",
    (data: {
      path: string;
      updates: any[];
      isCached?: boolean;
      remaining?: number;
      progress?: any;
    }) => {
      updateLoadingStatus(data);
      if (data.updates && data.updates.length > 0) {
        processMetadataUpdates(data);
      }
    },
  );
});

onUnmounted(() => {
  (communication.socket as any)?.off("animeMetadataUpdate");
  (communication.socket as any)?.off("animeMetadataStatus");
});

function handleItemClick(item: any) {
  if (!item.isDir) return;

  // Check if this is a grouped anime - version selection is now handled by AnimeSeasonViewer
  if (item.isGrouped) {
    console.warn(
      "Grouped anime clicked in FtpViewer - version selection should be handled by AnimeSeasonViewer:",
      item.name,
    );
    // Don't navigate to /GROUPED/ paths - they don't exist on FTP server
    return;
  }

  // Check if this is a special grouped path (shouldn't happen, but safety check)
  if (item.path && item.path.startsWith("/GROUPED/")) {
    console.warn(
      "Attempted to navigate to non-existent grouped path:",
      item.path,
    );
    return;
  }

  // Regular directory navigation
  fetchDirectory(item.path);
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function truncateDescription(description: string): string {
  if (!description) return "";
  // Remove HTML tags and truncate to 150 characters
  const cleanDescription = description.replace(/<[^>]*>/g, "");
  return cleanDescription.length > 150
    ? cleanDescription.substring(0, 150) + "..."
    : cleanDescription;
}

function isSeasonDirectory(path: string): boolean {
  // Check if path matches season directory pattern
  const seasonPatterns = [
    /\d{4}-\d+\s+(Season|Winter|Spring|Summer|Fall)/i, // 2025-1 Winter
    /\d{4}-\d+(Winter|Spring|Summer|Fall)/i, // 2025-1Winter (no space)
    /Season\s+\d+/i, // Season 1, Season 2, etc.
    /(Winter|Spring|Summer|Fall)\s+\d{4}/i, // Winter 2025, etc.
    /\d{4}\s+(Winter|Spring|Summer|Fall)/i, // 2025 Winter
  ];

  return (
    seasonPatterns.some((pattern) => pattern.test(path)) ||
    path.includes("Season") ||
    path.includes("Winter") ||
    path.includes("Spring") ||
    path.includes("Summer") ||
    path.includes("Fall")
  );
}

function isAnimeDirectory(
  item: TreeChild,
  inSeasonDirectory: boolean,
): boolean {
  // In season directories, treat all directories as potential anime directories
  return (
    item.isDir &&
    (inSeasonDirectory || item.isGrouped || item.animeMetadata !== undefined)
  );
}

// Temporarily removed directories and files computed properties for debugging

function checkDirectory(path: string): Promise<void> {
  if (!path) {
    return Promise.resolve();
  }
  if (loading.value) {
    return Promise.resolve();
  }

  // Ensure path is valid for server (not empty string)
  const validPath = path.trim() || "/";

  loading.value = true;
  return new Promise((resolve) => {
    communication.checkDir(validPath, (pathExists) => {
      exists.value = pathExists;
      loading.value = false;
      resolve();
    });
  });
}

function fetchDirectory(itemPath: string) {
  if (loading.value) {
    return Promise.resolve();
  }

  // Ensure path is valid for server (not empty string)
  const validPath = itemPath.trim() || "/";

  loading.value = true;
  return new Promise((resolve) => {
    // Debug log to see what we're trying to fetch

    // Try enhanced listing first (with anime metadata), fall back to regular
    let timeoutId: number;
    let resolved = false;

    const tryEnhancedListing = () => {
      // Set a timeout to fallback if no response from enhanced listing
      timeoutId = window.setTimeout(() => {
        if (!resolved) {
          useRegularListing();
        }
      }, 2000); // 2 second timeout

      // @ts-ignore - Enhanced event may not exist if plugin is disabled
      (communication.socket as any)?.emit(
        "listDirWithAnimeMetadata",
        validPath,
        (path: string, result: any) => {
          if (resolved) return; // Already resolved

          if (timeoutId) clearTimeout(timeoutId);

          if (result && Array.isArray(result)) {
            resolved = true;
            processEnhancedDirectoryListing(path, result);
            resolve(undefined);
          } else {
            useRegularListing();
          }
        },
      );
    };

    const useRegularListing = () => {
      if (resolved) return; // Already resolved

      if (timeoutId) clearTimeout(timeoutId);

      communication.listDir(validPath, (path, result) => {
        if (resolved) return; // Already resolved
        resolved = true;
        processDirectoryListing(path, result);
        resolve(undefined);
      });
    };

    // Always try enhanced listing first - it will fallback gracefully
    tryEnhancedListing();
  });
}

function processDirectoryListing(path: string, result: any[]) {
  loading.value = false;
  selectedItem.value = -1;
  current.value = {
    path: path,
    name: path,
    isDir: true,
    children: [],
    id: path,
  };

  current.value.children = result.map((r: any) => {
    // Proper path construction to avoid double slashes
    const parentPath = current.value.path === "/" ? "" : current.value.path;
    const fullPath = parentPath ? `${parentPath}/${r.name}` : `/${r.name}`;

    // Use original method: r.type === 2 for directories (from commit 84de8ea7)
    return {
      id: fullPath,
      path: fullPath,
      isDir: r.type === 2,
      name: r.name,
      size: r.size || 0,
      modifiedTime: r.modifiedTime,
      children: r.type === 2 ? ([] as TreeChild[]) : undefined,
      // Include anime metadata if available
      animeMetadata: r.animeMetadata || undefined,
    } as TreeChild;
  });

  // Check if we should use plugin component for this path
  checkForPluginComponent();
}

function processEnhancedDirectoryListing(path: string, result: any[]) {
  loading.value = false;
  selectedItem.value = -1;
  current.value = {
    path: path,
    name: path,
    isDir: true,
    children: [],
    id: path,
  };

  current.value.children = result.map((r: any) => {
    // Proper path construction to avoid double slashes
    const parentPath = current.value.path === "/" ? "" : current.value.path;

    // For grouped anime, use the special path or the first version's path
    let fullPath: string;
    if (r.path && r.path.startsWith("/GROUPED/")) {
      // Special grouped path
      fullPath = r.path;
    } else if (r.path) {
      // Use the provided path
      fullPath = r.path;
    } else {
      // Fallback: construct path from name
      fullPath = parentPath ? `${parentPath}/${r.name}` : `/${r.name}`;
    }

    const isDirectory = r.type === 2 || r.isDir || r.isGrouped;

    // Create enhanced TreeChild with all metadata
    return {
      id: fullPath,
      path: fullPath,
      isDir: isDirectory,
      name: r.name,
      size: r.size || 0,
      modifiedTime: r.modifiedTime,
      children: isDirectory ? ([] as TreeChild[]) : undefined,

      // Enhanced properties from plugin
      animeMetadata: r.animeMetadata || undefined,
      isGrouped: r.isGrouped || false,
      isSingleVersion: r.isSingleVersion || false,
      versions: r.versions || undefined,
      versionCount: r.versionCount || undefined,
      searchTitle: r.searchTitle || r.name,
      isProcessing: r.isProcessing || false,
      metadataFailed: r.metadataFailed || false,
      isRateLimited: r.isRateLimited || false,
      versionInfo: r.versionInfo || undefined,
      versionDescription: r.versionDescription || undefined,
    } as TreeChild;
  });

  // Check if we should use plugin component for this path
  checkForPluginComponent();
}
</script>

<style scoped lang="scss">
.anime-directory {
  background: linear-gradient(
    135deg,
    rgba(25, 118, 210, 0.05),
    rgba(156, 39, 176, 0.05)
  );
  border-left: 3px solid #1976d2;
  margin: 4px 0;

  &:hover {
    background: linear-gradient(
      135deg,
      rgba(25, 118, 210, 0.1),
      rgba(156, 39, 176, 0.1)
    );
  }
}

.anime-cover {
  margin-right: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.anime-title-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.anime-title-wrapper {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.anime-title {
  font-weight: 600;
  font-size: 1.1em;
  color: #1976d2;
}

.anime-subtitle {
  font-size: 0.75rem;
  color: #666;
  font-style: italic;
  line-height: 1;
}

.anime-info {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.anime-description {
  font-size: 0.85em;
  color: #666;
  line-height: 1.3;
  margin-top: 6px;
  padding-left: 0;
}

// Enhanced anime directory styling (removed duplicates)

.grouped-anime {
  border-left-color: #9c27b0;
  background: linear-gradient(
    90deg,
    rgba(156, 39, 176, 0.05) 0%,
    rgba(156, 39, 176, 0.01) 100%
  );
}

.grouped-anime:hover {
  background: linear-gradient(
    90deg,
    rgba(156, 39, 176, 0.08) 0%,
    rgba(156, 39, 176, 0.02) 100%
  );
}

.single-anime {
  border-left-color: #2196f3;
  background: linear-gradient(
    90deg,
    rgba(33, 150, 243, 0.05) 0%,
    rgba(33, 150, 243, 0.01) 100%
  );
}

.single-anime:hover {
  background: linear-gradient(
    90deg,
    rgba(33, 150, 243, 0.08) 0%,
    rgba(33, 150, 243, 0.02) 100%
  );
}

.anime-loading {
  position: relative;
}

.anime-loading::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  animation: shimmer 2s infinite;
  pointer-events: none;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* Ensure non-anime directories retain original styling */
.v-list-item:not(.anime-directory) {
  /* Standard styling preserved - keeping for future use */
  margin: 0;
}

.border-bottom {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
