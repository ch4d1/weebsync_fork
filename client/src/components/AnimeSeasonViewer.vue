<template>
  <div class="anime-ftp-viewer d-flex flex-column" style="height: 100%">
    <!-- Enhanced search and filter controls -->
    <div class="px-3 py-2 border-bottom flex-shrink-0">
      <v-row dense no-gutters align="center" class="ga-2">
        <v-col cols="12" sm="4">
          <v-text-field
            v-model="searchQuery"
            :prepend-inner-icon="mdiMagnify"
            label="Search anime..."
            variant="outlined"
            density="compact"
            hide-details
            clearable
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
          <v-btn-toggle
            v-model="viewMode"
            mandatory
            density="compact"
            variant="outlined"
            class="ml-2"
          >
            <v-btn value="grid" size="small">
              <v-icon>{{ mdiViewGrid }}</v-icon>
            </v-btn>
            <v-btn value="list" size="small">
              <v-icon>{{ mdiViewList }}</v-icon>
            </v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col cols="auto">
          <v-chip
            v-if="loadingStatus"
            :color="loadingStatus.includes('completed') ? 'success' : 'primary'"
            size="small"
            class="ml-2"
          >
            {{ loadingStatus }}
          </v-chip>
        </v-col>
      </v-row>

      <!-- Pagination Mode Warning -->
      <v-alert
        v-if="isPaginatedMode"
        type="info"
        density="compact"
        class="mt-2 mb-2"
        border="start"
        variant="tonal"
      >
        <v-icon start>{{ mdiPageNext }}</v-icon>
        <strong>Paginated Mode:</strong>
        Large directory with {{ totalItems }} items. Showing
        {{ loadedItems }} items.
        <template #append>
          <v-btn
            v-if="hasMoreItems"
            size="small"
            variant="text"
            :loading="loadingMore"
            @click="loadMoreItems"
            class="mr-2"
          >
            Load More
          </v-btn>
          <v-btn
            v-if="hasMoreItems && searchQuery"
            size="small"
            variant="outlined"
            :loading="loadingAll"
            @click="loadAllItems"
          >
            Load All for Search
          </v-btn>
        </template>
      </v-alert>

      <!-- Additional Filter Row for Genre and Audio/Subtitle -->
      <div>
        <v-row dense no-gutters align="center" class="ga-2 mt-2">
          <v-col cols="12" sm="4">
            <v-select
              v-model="selectedGenres"
              :items="availableGenres"
              label="Filter by Genre"
              variant="outlined"
              density="compact"
              multiple
              chips
              closable-chips
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="selectedAudioLanguages"
              :items="
                availableAudioLanguages.filter(
                  (item: { value: string; title: string }) => item.value !== '',
                )
              "
              label="Audio Languages"
              variant="outlined"
              density="compact"
              multiple
              chips
              closable-chips
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="selectedSubtitleLanguages"
              :items="
                availableSubtitleLanguages.filter(
                  (item: { value: string; title: string }) => item.value !== '',
                )
              "
              label="Subtitle Languages"
              variant="outlined"
              density="compact"
              multiple
              chips
              closable-chips
              hide-details
            />
          </v-col>
          <v-col cols="auto" v-if="hasActiveFilters">
            <v-btn
              variant="outlined"
              color="secondary"
              size="small"
              @click="clearFilters"
            >
              Clear Filters
            </v-btn>
          </v-col>
        </v-row>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex-grow-1 overflow-auto content-area">
      <div class="pa-3 content-wrapper">
        <!-- Back navigation button -->
        <div class="mb-3">
          <v-btn
            variant="text"
            :prepend-icon="mdiFolderOutline"
            @click="goBack"
            class="text-body-2"
          >
            ..
          </v-btn>
        </div>
        <!-- Version Selection Dialog - Fullscreen -->
        <v-dialog
          v-model="versionDialog"
          fullscreen
          hide-overlay
          transition="dialog-bottom-transition"
        >
          <v-card
            v-if="selectedAnime"
            class="d-flex flex-column"
            :style="getVersionDialogStyle(selectedAnime.animeMetadata)"
          >
            <v-toolbar
              :style="getVersionDialogToolbarStyle(selectedAnime.animeMetadata)"
            >
              <v-btn variant="text" @click="versionDialog = false">
                <v-icon>{{ mdiClose }}</v-icon>
              </v-btn>
              <v-toolbar-title>Select Version</v-toolbar-title>
              <v-spacer />
            </v-toolbar>

            <div class="flex-grow-1 overflow-auto">
              <v-container fluid class="pa-6">
                <!-- Anime Info Header - Enhanced -->
                <v-row class="mb-6">
                  <v-col
                    cols="12"
                    md="4"
                    lg="3"
                    v-if="selectedAnime.animeMetadata?.coverImage"
                  >
                    <v-img
                      :src="getBestCoverImage(selectedAnime.animeMetadata)"
                      aspect-ratio="0.7"
                      max-width="300"
                      rounded="lg"
                      class="mx-auto"
                      @load="
                        console.log(
                          'Cover loaded:',
                          selectedAnime.animeMetadata.coverImageLarge,
                          selectedAnime.animeMetadata.coverImage,
                        )
                      "
                    />
                  </v-col>
                  <v-col
                    cols="12"
                    :md="selectedAnime.animeMetadata?.coverImage ? 8 : 12"
                    :lg="selectedAnime.animeMetadata?.coverImage ? 9 : 12"
                  >
                    <h1 class="text-h4 font-weight-bold mb-3">
                      {{
                        selectedAnime.animeMetadata?.title || selectedAnime.name
                      }}
                    </h1>

                    <div class="mb-3">
                      <v-btn
                        v-if="selectedAnime.animeMetadata?.id"
                        :href="`https://anilist.co/anime/${selectedAnime.animeMetadata.id}`"
                        target="_blank"
                        color="primary"
                        variant="outlined"
                        size="small"
                      >
                        View on AniList
                      </v-btn>
                    </div>

                    <h2
                      v-if="selectedAnime.animeMetadata?.subtitle"
                      class="text-h6 text-grey-darken-1 mb-3"
                    >
                      {{ selectedAnime.animeMetadata.subtitle }}
                    </h2>

                    <!-- Enhanced Metadata Row -->
                    <v-row class="mb-4">
                      <v-col
                        cols="12"
                        sm="6"
                        md="4"
                        v-if="selectedAnime.animeMetadata?.averageScore"
                      >
                        <v-card
                          variant="outlined"
                          class="pa-3"
                          :style="
                            getVersionDialogCardStyle(
                              selectedAnime.animeMetadata,
                            )
                          "
                        >
                          <div class="text-caption text-grey">Score</div>
                          <div class="d-flex align-center">
                            <v-rating
                              :model-value="
                                selectedAnime.animeMetadata.averageScore / 20
                              "
                              readonly
                              density="compact"
                              size="small"
                            />
                            <span class="ml-2 text-h6"
                              >{{
                                selectedAnime.animeMetadata.averageScore
                              }}%</span
                            >
                          </div>
                        </v-card>
                      </v-col>
                      <v-col
                        cols="12"
                        sm="6"
                        md="4"
                        v-if="selectedAnime.animeMetadata?.episodes"
                      >
                        <v-card
                          variant="outlined"
                          class="pa-3"
                          :style="
                            getVersionDialogCardStyle(
                              selectedAnime.animeMetadata,
                            )
                          "
                        >
                          <div class="text-caption text-grey">Episodes</div>
                          <div class="text-h6">
                            {{ selectedAnime.animeMetadata.episodes }}
                          </div>
                        </v-card>
                      </v-col>
                      <v-col
                        cols="12"
                        sm="6"
                        md="4"
                        v-if="selectedAnime.animeMetadata?.status"
                      >
                        <v-card
                          variant="outlined"
                          class="pa-3"
                          :style="
                            getVersionDialogCardStyle(
                              selectedAnime.animeMetadata,
                            )
                          "
                        >
                          <div class="text-caption text-grey">Status</div>
                          <div class="text-h6">
                            {{ selectedAnime.animeMetadata.status }}
                          </div>
                        </v-card>
                      </v-col>
                      <v-col
                        cols="12"
                        sm="6"
                        md="4"
                        v-if="
                          selectedAnime.animeMetadata?.season &&
                          selectedAnime.animeMetadata?.seasonYear
                        "
                      >
                        <v-card
                          variant="outlined"
                          class="pa-3"
                          :style="
                            getVersionDialogCardStyle(
                              selectedAnime.animeMetadata,
                            )
                          "
                        >
                          <div class="text-caption text-grey">Season</div>
                          <div class="text-h6">
                            {{ selectedAnime.animeMetadata.season }}
                            {{ selectedAnime.animeMetadata.seasonYear }}
                          </div>
                        </v-card>
                      </v-col>
                    </v-row>

                    <!-- Genres -->
                    <div
                      v-if="selectedAnime.animeMetadata?.genres"
                      class="mb-4"
                    >
                      <div class="text-subtitle-1 mb-2 font-weight-medium">
                        Genres
                      </div>
                      <v-chip-group>
                        <v-chip
                          v-for="(genre, index) in selectedAnime.animeMetadata
                            .genres"
                          :key="genre"
                          variant="flat"
                          :style="
                            getAnimeChipStyle(
                              selectedAnime.animeMetadata,
                              index % 3 === 0
                                ? 'primary'
                                : index % 3 === 1
                                  ? 'secondary'
                                  : 'accent',
                            )
                          "
                        >
                          {{ genre }}
                        </v-chip>
                      </v-chip-group>
                    </div>

                    <!-- Description -->
                    <div
                      v-if="selectedAnime.animeMetadata?.description"
                      class="mb-4"
                    >
                      <div class="text-subtitle-1 mb-2 font-weight-medium">
                        Description
                      </div>
                      <div
                        class="text-body-1 description-content"
                        v-html="
                          formatDescription(
                            selectedAnime.animeMetadata.description,
                          )
                        "
                      />
                    </div>
                  </v-col>
                </v-row>

                <!-- Version List -->
                <v-divider class="mb-6" />
                <div class="d-flex align-center mb-4">
                  <h2 class="text-h5 font-weight-bold">
                    Available Versions ({{
                      selectedAnime.versions?.length || 0
                    }})
                  </h2>
                </div>

                <v-list style="background: transparent">
                  <v-list-item
                    v-for="(version, index) in selectedAnime.versions"
                    :key="index"
                    @click="selectVersion(version)"
                    :prepend-icon="mdiFolder"
                    lines="two"
                    class="mb-2 version-list-item"
                    rounded
                    :style="
                      hoveredVersion === index
                        ? getVersionDialogCardHoverStyle(
                            selectedAnime.animeMetadata,
                          )
                        : getVersionDialogCardStyle(selectedAnime.animeMetadata)
                    "
                    @mouseenter="hoveredVersion = index"
                    @mouseleave="hoveredVersion = -1"
                  >
                    <v-list-item-title>{{ version.name }}</v-list-item-title>
                    <v-list-item-subtitle>
                      <div class="version-details">
                        <!-- Source/Provider Information -->
                        <div
                          v-if="
                            getStructuredVersionInfo(version)?.providers?.length
                          "
                          class="version-row"
                        >
                          <strong>Source:</strong>
                          <v-chip
                            v-for="provider in getStructuredVersionInfo(version)
                              ?.providers || []"
                            :key="provider.tag"
                            size="x-small"
                            class="ml-1"
                            :style="{
                              backgroundColor: provider.color,
                              color: 'white',
                            }"
                          >
                            {{ provider.name }}
                          </v-chip>
                        </div>

                        <!-- Audio Languages -->
                        <div
                          v-if="
                            getStructuredVersionInfo(version)?.dubLanguages
                              ?.length
                          "
                          class="version-row"
                        >
                          <strong>Audio:</strong>
                          <v-chip
                            v-for="lang in getStructuredVersionInfo(version)
                              ?.dubLanguages || []"
                            :key="lang.code"
                            size="x-small"
                            variant="outlined"
                            class="ml-1"
                          >
                            {{ lang.language }}
                          </v-chip>
                        </div>

                        <!-- Subtitle Languages -->
                        <div
                          v-if="
                            getStructuredVersionInfo(version)?.subLanguages
                              ?.length
                          "
                          class="version-row"
                        >
                          <strong>Subs:</strong>
                          <v-chip
                            v-for="lang in getStructuredVersionInfo(version)
                              ?.subLanguages || []"
                            :key="lang.code"
                            size="x-small"
                            variant="outlined"
                            class="ml-1"
                          >
                            {{ lang.language }}
                          </v-chip>
                        </div>

                        <!-- Quality and Special Info in one line -->
                        <div
                          v-if="
                            getStructuredVersionInfo(version)?.quality ||
                            getStructuredVersionInfo(version)?.season ||
                            getStructuredVersionInfo(version)?.special
                          "
                          class="version-row"
                        >
                          <span
                            v-if="getStructuredVersionInfo(version)?.quality"
                            class="mr-3"
                          >
                            <strong>Quality:</strong>
                            {{ getStructuredVersionInfo(version)?.quality }}
                          </span>
                          <span
                            v-if="getStructuredVersionInfo(version)?.season"
                            class="mr-3"
                          >
                            <strong>Season:</strong>
                            {{ getStructuredVersionInfo(version)?.season }}
                          </span>
                          <v-chip
                            v-if="getStructuredVersionInfo(version)?.special"
                            size="x-small"
                            color="accent"
                            variant="outlined"
                          >
                            Special/OVA
                          </v-chip>
                        </div>
                      </div>
                    </v-list-item-subtitle>
                  </v-list-item>
                </v-list>
              </v-container>
            </div>
          </v-card>
        </v-dialog>

        <!-- Grid view (default) -->
        <div
          v-if="viewMode === 'grid'"
          class="anime-grid"
          :style="{ minWidth: '100%', width: '100%' }"
        >
          <v-card
            v-for="item in filteredItems"
            :key="item.name"
            class="anime-card"
            :style="getAnimeCardStyle(item.animeMetadata)"
            @click="handleItemClick(item)"
            hover
          >
            <div class="anime-card-content">
              <div class="anime-cover-container">
                <v-img
                  v-if="
                    item.animeMetadata?.coverImageLarge ||
                    item.animeMetadata?.coverImage
                  "
                  :src="getBestCoverImage(item.animeMetadata)"
                  class="anime-cover"
                  aspect-ratio="0.7"
                  cover
                  @error="
                    console.log(
                      'Image load error for:',
                      item.name,
                      item.animeMetadata.coverImage,
                    )
                  "
                  @load="
                    console.log(
                      'Image loaded for:',
                      item.name,
                      item.animeMetadata.coverImage,
                    )
                  "
                >
                  <template v-slot:placeholder>
                    <v-skeleton-loader type="image"></v-skeleton-loader>
                  </template>
                </v-img>
                <div v-else class="anime-cover-placeholder">
                  <v-icon size="64" color="grey">{{ mdiFolder }}</v-icon>
                </div>

                <!-- Airing Status Badge -->
                <v-chip
                  v-if="item.animeMetadata?.status"
                  :color="getStatusColor(item.animeMetadata.status)"
                  size="x-small"
                  class="status-badge"
                  variant="flat"
                >
                  {{ getStatusLabel(item.animeMetadata.status) }}
                </v-chip>
              </div>

              <div class="anime-info">
                <h3 class="anime-title">
                  {{ item.animeMetadata?.title || item.name }}
                </h3>
                <p v-if="item.animeMetadata?.subtitle" class="anime-subtitle">
                  {{ item.animeMetadata.subtitle }}
                </p>

                <div v-if="item.animeMetadata?.genres" class="anime-genres">
                  <v-chip
                    v-for="(genre, index) in item.animeMetadata.genres.slice(
                      0,
                      3,
                    )"
                    :key="genre"
                    size="x-small"
                    variant="flat"
                    :style="
                      getAnimeChipStyle(
                        item.animeMetadata,
                        index === 0
                          ? 'primary'
                          : index === 1
                            ? 'secondary'
                            : 'accent',
                      )
                    "
                  >
                    {{ genre }}
                  </v-chip>
                </div>

                <div class="anime-stats">
                  <v-rating
                    v-if="item.animeMetadata?.averageScore"
                    :model-value="item.animeMetadata.averageScore / 20"
                    half-increments
                    readonly
                    size="small"
                    density="compact"
                  />
                  <span v-if="item.animeMetadata" class="episodes-count">
                    {{ formatEpisodeCount(item) }} eps
                  </span>
                </div>

                <v-chip
                  v-if="(item.versionCount ?? 0) > 1"
                  size="small"
                  variant="flat"
                  class="mt-2"
                  :style="getAnimeChipStyle(item.animeMetadata, 'primary')"
                >
                  {{ item.versionCount }} versions
                </v-chip>
              </div>
            </div>
          </v-card>
        </div>

        <!-- List view -->
        <v-list
          v-else-if="viewMode === 'list'"
          class="anime-list"
          :style="{ minWidth: '100%', width: '100%' }"
        >
          <v-list-item
            v-for="item in filteredItems"
            :key="item.name"
            @click="handleItemClick(item)"
            :class="[
              {
                'anime-directory': isAnimeDirectory(item),
                'anime-loading': item.isProcessing,
              },
              getRatingColorClass(item),
            ]"
            lines="two"
          >
            <!-- Anime cover for anime directories -->
            <template v-if="isAnimeDirectory(item)" #prepend>
              <v-avatar size="48" rounded="lg" class="anime-cover">
                <v-img
                  v-if="item.animeMetadata?.coverImage"
                  :src="getBestCoverImage(item.animeMetadata, 'small')"
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

            <!-- Regular directory/file icon for non-anime items -->
            <template v-else #prepend>
              <v-icon :icon="item.isDir ? mdiFolder : mdiFile" />
            </template>

            <v-list-item-title>
              <div class="anime-title-container">
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

                <!-- Version count chips -->
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

                <!-- File size for files -->
                <small v-if="!item.isDir">
                  ({{ formatFileSize(item.size || 0) }})
                </small>
              </div>
            </v-list-item-title>

            <v-list-item-subtitle v-if="isAnimeDirectory(item)">
              <div class="d-flex align-center flex-wrap mb-1">
                <v-rating
                  v-if="item.animeMetadata?.averageScore"
                  :model-value="item.animeMetadata.averageScore / 20"
                  half-increments
                  readonly
                  size="x-small"
                  density="compact"
                  class="mr-2"
                />
                <span>{{ formatEpisodeCount(item) }} episodes</span>
                <span v-if="(item.versionCount ?? 0) > 1" class="ml-2">
                  • {{ item.versionCount }} versions
                </span>
              </div>
              <div v-if="item.animeMetadata?.genres" class="mt-1">
                <v-chip
                  v-for="(genre, index) in item.animeMetadata.genres.slice(
                    0,
                    3,
                  )"
                  :key="genre"
                  size="x-small"
                  variant="flat"
                  class="mr-1"
                  :style="
                    getAnimeChipStyle(
                      item.animeMetadata,
                      index === 0
                        ? 'primary'
                        : index === 1
                          ? 'secondary'
                          : 'accent',
                    )
                  "
                >
                  {{ genre }}
                </v-chip>
              </div>

              <!-- Description with loading states -->
              <div class="anime-description mt-2">
                <template v-if="item.animeMetadata?.description">
                  {{ truncateDescription(item.animeMetadata.description) }}
                </template>
                <template v-else-if="item.isProcessing && !item.isRateLimited">
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
              </div>
            </v-list-item-subtitle>

            <template v-slot:append>
              <v-icon>{{ mdiChevronRight }}</v-icon>
            </template>
          </v-list-item>
        </v-list>
      </div>

      <!-- Pagination Controls for Load More (shown at bottom) -->
      <div v-if="isPaginatedMode && hasMoreItems" class="text-center pa-4">
        <v-btn
          variant="outlined"
          :loading="loadingMore"
          @click="loadMoreItems"
          class="mr-2"
        >
          Load More Items
          <template #append>
            <v-chip size="small" class="ml-2">
              {{ loadedItems }} / {{ totalItems }}
            </v-chip>
          </template>
        </v-btn>
        <v-btn
          v-if="searchQuery"
          variant="tonal"
          :loading="loadingAll"
          @click="loadAllItems"
        >
          Load All for Search
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  mdiClose,
  mdiFolder,
  mdiFile,
  mdiClockOutline,
  mdiHelpCircleOutline,
  mdiMagnify,
  mdiViewList,
  mdiViewGrid,
  mdiChevronRight,
  mdiFolderOutline,
  mdiPageNext,
} from "@mdi/js";

interface AnimeMetadata {
  title?: string;
  subtitle?: string;
  coverImage?: string;
  coverImageExtraLarge?: string;
  coverImageLarge?: string;
  coverImageMedium?: string;
  coverImageSmall?: string;
  coverImageColor?: string;
  genres?: string[];
  averageScore?: number;
  description?: string;
  episodes?: number;
  totalEpisodes?: number; // AniList total episodes
  scannedEpisodes?: number; // Actually found episodes
  status?: string;
  season?: string;
  seasonYear?: number;
  id?: string;
}

interface VersionInfo {
  providers: Array<{ tag: string; name: string; color: string }>;
  dubLanguages: Array<{ code: string; language: string }>;
  subLanguages: Array<{ code: string; language: string }>;
  audio?: Array<{ code: string; language: string; full?: string }>;
  subtitles?: Array<{ code: string; language: string; full?: string }>;
  quality?: string;
  season?: number;
  special?: boolean;
}

interface Version {
  name: string;
  path: string;
  versionDescription?: VersionInfo;
  simpleVersionDescription?: string;
  versionInfo?: VersionInfo;
}

interface AnimeItem {
  name: string;
  path: string;
  isDir: boolean;
  animeMetadata?: AnimeMetadata;
  versionCount?: number;
  isGrouped?: boolean;
  isSingleVersion?: boolean;
  versions?: Version[];
  type?: number;
  size?: number;
  modifiedTime?: string;
  isProcessing?: boolean;
  metadataFailed?: boolean;
  isRateLimited?: boolean;
  isPaginated?: boolean;
  totalItems?: number;
  loadedItems?: number;
  searchTitle?: string;
}

interface Props {
  items: AnimeItem[];
  path: string;
  socket: any;
  loadingStatus?: string | null;
  originFolder?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "item-selected": [item: AnimeItem];
  "metadata-update": [data: any];
  "go-back": [];
  save: [path: string];
  "close-viewer": [];
}>();

// Reactive data
const searchQuery = ref("");
const sortBy = ref("name");
const viewMode = ref("grid");
const selectedGenres = ref<string[]>([]);
const selectedAudioLanguages = ref<string[]>([]);
const selectedSubtitleLanguages = ref<string[]>([]);
// Use loading status from props (passed from FtpViewer) or local state
const localLoadingStatus = ref<string | null>(null);
const loadingStatus = computed(
  () => props.loadingStatus || localLoadingStatus.value,
);

// Pagination mode detection
const isPaginatedMode = computed(() => {
  return props.items.some((item) => item.isPaginated);
});

const totalItems = computed(() => {
  if (isPaginatedMode.value && props.items.length > 0) {
    return props.items[0].totalItems || props.items.length;
  }
  return props.items.length;
});

const loadedItems = computed(() => {
  if (isPaginatedMode.value && props.items.length > 0) {
    return props.items[0].loadedItems || props.items.length;
  }
  return props.items.length;
});

const hasMoreItems = computed(() => {
  return isPaginatedMode.value && loadedItems.value < totalItems.value;
});

const loadingMore = ref(false);
const loadingAll = ref(false);
const versionDialog = ref(false);
const selectedAnime = ref<AnimeItem | null>(null);
const hoveredVersion = ref(-1);
const processedItems = ref<AnimeItem[]>([]);

// Color extraction cache for anime without API colors
const extractedColors = ref<Map<string, string>>(new Map());
const colorExtractionQueue = ref<Set<string>>(new Set());

// Computed properties
const sortOptions = computed(() => [
  { title: "Name", value: "name" },
  { title: "Anime Title", value: "animeTitle" },
  { title: "Score", value: "score" },
  { title: "Episodes", value: "episodes" },
  { title: "Date Added", value: "date" },
]);

const availableGenres = computed(() => {
  const genres = new Set<string>();
  props.items?.forEach((item) => {
    item.animeMetadata?.genres?.forEach((genre) => genres.add(genre));
  });
  return Array.from(genres).sort();
});

const availableAudioLanguages = computed(() => {
  const audioLangsMap = new Map<string, { title: string; value: string }>();
  audioLangsMap.set("", { title: "All Audio", value: "" });

  console.log(
    "🎧 Computing available audio languages from",
    props.items?.length || 0,
    "items",
  );

  props.items?.forEach((item) => {
    // Check if item has versions with versionInfo
    if (item.versions && item.versions.length > 0) {
      console.log(
        `🎧 Item "${item.name}" has ${item.versions.length} versions`,
      );
      item.versions.forEach((version) => {
        if (version.versionInfo?.audio) {
          console.log(
            `🎧 Found audio in version "${version.name}":`,
            version.versionInfo.audio,
          );
          version.versionInfo.audio.forEach(
            (audio: { code: string; language: string; full?: string }) => {
              const value = audio.code.toLowerCase() + "dub";
              audioLangsMap.set(value, {
                title: `${audio.full} Dub`,
                value: value,
              });
            },
          );
        }
      });
    } else {
      // Fallback to directory name parsing for non-grouped items
      const itemName = item.name.toLowerCase();
      if (itemName.includes("japdub") || itemName.includes("jap")) {
        audioLangsMap.set("japdub", { title: "Japanese Dub", value: "japdub" });
      }
      if (
        itemName.includes("engdub") ||
        (itemName.includes("eng") && itemName.includes("dub"))
      ) {
        audioLangsMap.set("engdub", { title: "English Dub", value: "engdub" });
      }
      if (
        itemName.includes("gerdub") ||
        (itemName.includes("ger") && itemName.includes("dub"))
      ) {
        audioLangsMap.set("gerdub", { title: "German Dub", value: "gerdub" });
      }
      if (
        itemName.includes("frendub") ||
        (itemName.includes("fre") && itemName.includes("dub"))
      ) {
        audioLangsMap.set("frendub", { title: "French Dub", value: "frendub" });
      }
    }
  });

  const result = Array.from(audioLangsMap.values());
  console.log("🎧 Final audio languages:", result);
  return result;
});

const availableSubtitleLanguages = computed(() => {
  const subLangsMap = new Map<string, { title: string; value: string }>();
  subLangsMap.set("", { title: "All Subtitles", value: "" });

  console.log(
    "💬 Computing available subtitle languages from",
    props.items?.length || 0,
    "items",
  );

  props.items?.forEach((item) => {
    // Check if item has versions with versionInfo
    if (item.versions && item.versions.length > 0) {
      console.log(
        `💬 Item "${item.name}" has ${item.versions.length} versions`,
      );
      item.versions.forEach((version) => {
        if (version.versionInfo?.subtitles) {
          console.log(
            `💬 Found subtitles in version "${version.name}":`,
            version.versionInfo.subtitles,
          );
          version.versionInfo.subtitles.forEach(
            (sub: { code: string; language: string; full?: string }) => {
              const value = sub.code.toLowerCase() + "sub";
              subLangsMap.set(value, {
                title: `${sub.full} Subs`,
                value: value,
              });
            },
          );
        }
      });
    } else {
      // Fallback to directory name parsing for non-grouped items
      const itemName = item.name.toLowerCase();
      if (
        itemName.includes("gersub") ||
        (itemName.includes("ger") && itemName.includes("sub"))
      ) {
        subLangsMap.set("gersub", { title: "German Subs", value: "gersub" });
      }
      if (
        itemName.includes("engsub") ||
        (itemName.includes("eng") && itemName.includes("sub"))
      ) {
        subLangsMap.set("engsub", { title: "English Subs", value: "engsub" });
      }
      if (
        itemName.includes("fresub") ||
        (itemName.includes("fre") && itemName.includes("sub"))
      ) {
        subLangsMap.set("fresub", { title: "French Subs", value: "fresub" });
      }
      if (
        itemName.includes("spasub") ||
        (itemName.includes("spa") && itemName.includes("sub"))
      ) {
        subLangsMap.set("spasub", { title: "Spanish Subs", value: "spasub" });
      }
    }
  });

  const result = Array.from(subLangsMap.values());
  console.log("💬 Final subtitle languages:", result);
  return result;
});

const hasActiveFilters = computed(() => {
  return (
    selectedGenres.value.length > 0 ||
    selectedAudioLanguages.value.length > 0 ||
    selectedSubtitleLanguages.value.length > 0
  );
});

const filteredItems = computed(() => {
  // Use allLoadedItems for pagination mode, props.items otherwise
  let filtered = isPaginatedMode.value
    ? allLoadedItems.value
    : props.items || [];

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter((item) => {
      const title = (item.animeMetadata?.title || item.name).toLowerCase();
      const subtitle = (item.animeMetadata?.subtitle || "").toLowerCase();
      const genres = (item.animeMetadata?.genres || []).join(" ").toLowerCase();

      return (
        title.includes(query) ||
        subtitle.includes(query) ||
        genres.includes(query)
      );
    });
  }

  // Apply genre filter
  if (selectedGenres.value.length > 0) {
    filtered = filtered.filter((item) => {
      const itemGenres = item.animeMetadata?.genres || [];
      return selectedGenres.value.some((selectedGenre) =>
        itemGenres.includes(selectedGenre),
      );
    });
  }

  // Apply audio filter
  if (selectedAudioLanguages.value.length > 0) {
    filtered = filtered.filter((item) => {
      // Check versions with structured versionInfo first
      if (item.versions && item.versions.length > 0) {
        return item.versions.some((version) => {
          if (version.versionInfo?.audio) {
            return version.versionInfo.audio.some(
              (audio: { code: string; language: string; full?: string }) => {
                const audioCode = audio.code.toLowerCase() + "dub";
                return selectedAudioLanguages.value.includes(audioCode);
              },
            );
          }
          return false;
        });
      } else {
        // Fallback to directory name parsing for non-grouped items
        const itemName = item.name.toLowerCase();
        return selectedAudioLanguages.value.some((selectedAudio) => {
          switch (selectedAudio) {
            case "japdub":
              return itemName.includes("japdub") || itemName.includes("jap");
            case "engdub":
              return (
                itemName.includes("engdub") ||
                (itemName.includes("eng") && itemName.includes("dub"))
              );
            case "gerdub":
              return (
                itemName.includes("gerdub") ||
                (itemName.includes("ger") && itemName.includes("dub"))
              );
            case "frendub":
              return (
                itemName.includes("frendub") ||
                (itemName.includes("fre") && itemName.includes("dub"))
              );
            default:
              return false;
          }
        });
      }
    });
  }

  // Apply subtitle filter
  if (selectedSubtitleLanguages.value.length > 0) {
    filtered = filtered.filter((item) => {
      // Check versions with structured versionInfo first
      if (item.versions && item.versions.length > 0) {
        return item.versions.some((version) => {
          if (version.versionInfo?.subtitles) {
            return version.versionInfo.subtitles.some(
              (sub: { code: string; language: string; full?: string }) => {
                const subCode = sub.code.toLowerCase() + "sub";
                return selectedSubtitleLanguages.value.includes(subCode);
              },
            );
          }
          return false;
        });
      } else {
        // Fallback to directory name parsing for non-grouped items
        const itemName = item.name.toLowerCase();
        return selectedSubtitleLanguages.value.some((selectedSub) => {
          switch (selectedSub) {
            case "gersub":
              return (
                itemName.includes("gersub") ||
                (itemName.includes("ger") && itemName.includes("sub"))
              );
            case "engsub":
              return (
                itemName.includes("engsub") ||
                (itemName.includes("eng") && itemName.includes("sub"))
              );
            case "fresub":
              return (
                itemName.includes("fresub") ||
                (itemName.includes("fre") && itemName.includes("sub"))
              );
            case "spasub":
              return (
                itemName.includes("spasub") ||
                (itemName.includes("spa") && itemName.includes("sub"))
              );
            default:
              return false;
          }
        });
      }
    });
  }

  // Apply sorting
  filtered.sort((a, b) => {
    if (sortBy.value === "score") {
      const scoreA = a.animeMetadata?.averageScore || 0;
      const scoreB = b.animeMetadata?.averageScore || 0;
      return scoreB - scoreA;
    } else if (sortBy.value === "episodes") {
      const episodesA = a.animeMetadata?.episodes || 0;
      const episodesB = b.animeMetadata?.episodes || 0;
      return episodesB - episodesA;
    } else if (sortBy.value === "date") {
      return (
        new Date((b as any).date || 0).getTime() -
        new Date((a as any).date || 0).getTime()
      );
    } else if (sortBy.value === "animeTitle") {
      const titleA = (a.animeMetadata?.title || a.name).toLowerCase();
      const titleB = (b.animeMetadata?.title || b.name).toLowerCase();
      return titleA.localeCompare(titleB);
    } else {
      const nameA = (a.animeMetadata?.title || a.name).toLowerCase();
      const nameB = (b.animeMetadata?.title || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    }
  });

  return filtered;
});

// Methods
function handleItemClick(item: AnimeItem) {
  // Check if this is a grouped anime
  if (item.isGrouped && item.versions && item.versions.length > 0) {
    // Show version selection dialog for grouped anime
    selectedAnime.value = item;
    versionDialog.value = true;
  } else {
    // Regular navigation for non-grouped items or single version items
    emit("item-selected", item);
  }
}

function selectVersion(version: Version) {
  console.log(
    "🎯 AnimeSeasonViewer: selectVersion called, metadata before close:",
    processedItems.value.map((item) => ({
      name: item.name,
      hasMetadata: !!item.animeMetadata,
    })),
  );

  // Close version dialog and clear selected anime
  versionDialog.value = false;
  selectedAnime.value = null;

  // Emit save event with version path to update origin folder in sync map
  // This will cause the FtpViewer/PluginsView to update the originFolder
  emit("save", version.path);

  // Close the FtpViewer dialog after version selection
  emit("close-viewer");

  console.log("Selected version path to save as origin folder:", version.path);

  // Debug metadata state after version dialog closes
  setTimeout(() => {
    console.log(
      "🎯 AnimeSeasonViewer: metadata state after version dialog close:",
      processedItems.value.map((item) => ({
        name: item.name,
        hasMetadata: !!item.animeMetadata,
      })),
    );
  }, 100);
}

function goBack() {
  emit("go-back");
}

function clearFilters() {
  selectedGenres.value = [];
  selectedAudioLanguages.value = [];
  selectedSubtitleLanguages.value = [];
}

// Pagination functions
const allLoadedItems = ref<AnimeItem[]>([...props.items]);

// Watch for props.items changes to update allLoadedItems
watch(
  () => props.items,
  (newItems) => {
    if (newItems) {
      allLoadedItems.value = [...newItems];
    }
  },
  { immediate: true },
);

function loadMoreItems() {
  if (!props.socket || loadingMore.value) return;

  loadingMore.value = true;
  console.log("🔄 Loading more items...", {
    currentCount: allLoadedItems.value.length,
    path: props.path,
  });

  props.socket.emit(
    "loadMoreItems",
    {
      path: props.path,
      currentCount: allLoadedItems.value.length,
    },
    (response: any) => {
      loadingMore.value = false;

      if (response.error) {
        console.error("❌ Error loading more items:", response.error);
        return;
      }

      if (response.items && response.items.length > 0) {
        console.log(`✅ Loaded ${response.items.length} more items`);
        allLoadedItems.value.push(...response.items);

        // Update the metadata if items come with it
        emit("metadata-update", {
          path: props.path,
          items: response.items,
        });
      }

      console.log("📊 Pagination status:", {
        loaded: response.loadedItems,
        total: response.totalItems,
        hasMore: response.hasMore,
      });
    },
  );
}

function loadAllItems() {
  if (!props.socket || loadingAll.value) return;

  loadingAll.value = true;
  console.log("📥 Loading all remaining items for search...");

  props.socket.emit(
    "loadAllItems",
    {
      path: props.path,
    },
    (response: any) => {
      loadingAll.value = false;

      if (response.error) {
        console.error("❌ Error loading all items:", response.error);
        return;
      }

      if (response.items && response.items.length > 0) {
        console.log(`✅ Loaded all ${response.items.length} remaining items`);
        allLoadedItems.value.push(...response.items);

        // Update the metadata
        emit("metadata-update", {
          path: props.path,
          items: response.items,
        });
      }

      console.log(
        "🔍 All items loaded for search. Total items:",
        response.totalItems,
      );
    },
  );
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
  const cleanDescription = description.replace(/<[^>]*>/g, "");
  return cleanDescription.length > 150
    ? cleanDescription.substring(0, 150) + "..."
    : cleanDescription;
}

function formatDescription(description: string): string {
  if (!description) return "";

  // Clean up the HTML and make it safe for rendering
  return description
    .replace(/<br\s*\/?>/gi, "<br>") // Normalize br tags
    .replace(/<i>/gi, "<em>") // Convert i tags to em
    .replace(/<\/i>/gi, "</em>") // Convert closing i tags
    .replace(/<b>/gi, "<strong>") // Convert b tags to strong
    .replace(/<\/b>/gi, "</strong>"); // Convert closing b tags
}

function isAnimeDirectory(item: AnimeItem): boolean {
  return item.isDir && (item.isGrouped || item.animeMetadata !== undefined);
}

function getStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case "releasing":
    case "currently airing":
      return "green";
    case "finished":
    case "completed":
      return "blue";
    case "not_yet_released":
    case "not yet released":
      return "orange";
    case "cancelled":
      return "red";
    case "hiatus":
      return "amber";
    default:
      return "grey";
  }
}

function getStatusLabel(status: string): string {
  switch (status?.toLowerCase()) {
    case "releasing":
    case "currently airing":
      return "AIRING";
    case "finished":
    case "completed":
      return "FINISHED";
    case "not_yet_released":
    case "not yet released":
      return "UPCOMING";
    case "cancelled":
      return "CANCELLED";
    case "hiatus":
      return "HIATUS";
    default:
      return status?.toUpperCase() || "UNKNOWN";
  }
}

// Get rating-based color class (AniChart style: 100-75% Green, 61-74% Orange, 0-60% Red)
function getRatingColorClass(item: AnimeItem): string {
  const score = item.animeMetadata?.averageScore;
  if (!score) return "rating-unknown";

  if (score >= 75) return "rating-high"; // 75-100: High (Green)
  if (score >= 61) return "rating-medium"; // 61-74: Medium (Orange)
  return "rating-low"; // 0-60: Low (Red)
}

// Extract dominant color from cover image using Canvas API
function extractDominantColorFromImage(
  imageUrl: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          resolve(null);
          return;
        }

        // Use smaller canvas for better performance
        const sampleSize = 50;
        canvas.width = sampleSize;
        canvas.height = sampleSize;

        // Draw and scale image to sample size
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

        // Get image data
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const pixels = imageData.data;

        // Color buckets for clustering
        const colorMap = new Map<string, number>();

        // Sample pixels (skip transparent and very dark)
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          // Skip transparent or very dark pixels
          if (a < 200 || r + g + b < 30) continue;

          // Quantize colors to reduce variations
          const quantize = (val: number) => Math.round(val / 25) * 25;
          const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;

          colorMap.set(key, (colorMap.get(key) || 0) + 1);
        }

        // Find most vibrant non-gray color
        let bestColor: { r: number; g: number; b: number } | null = null;
        let bestScore = 0;

        colorMap.forEach((count, colorStr) => {
          const [r, g, b] = colorStr.split(",").map(Number);

          // Calculate color vibrance and characteristics
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max === 0 ? 0 : (max - min) / max;
          const brightness = max / 255;

          // Avoid very gray colors (low saturation)
          if (saturation < 0.15) return;

          // HSL conversion for better color detection
          const hue = getHue(r, g, b);

          // Anime-specific color preference system
          let colorBoost = 1;

          // Check for typical anime color ranges
          const isAnimeHairColor = (
            _r: number,
            g: number,
            _b: number,
            h: number,
          ) => {
            // Typical anime hair colors
            if (h >= 300 || h <= 30) return true; // Pink, red, orange hair
            if (h >= 45 && h <= 75 && g > 180) return true; // Blonde/yellow hair
            if (h >= 240 && h <= 270 && saturation > 0.4) return true; // Blue hair
            if (h >= 270 && h <= 310) return true; // Purple/violet hair
            return false;
          };

          const isAnimeSkinColor = (r: number, g: number, b: number) => {
            // Anime skin tones - peachy, warm tones
            return (
              r >= 220 &&
              r <= 255 &&
              g >= 180 &&
              g <= 230 &&
              b >= 150 &&
              b <= 200
            );
          };

          const isAnimeEyeColor = (
            _r: number,
            _g: number,
            _b: number,
            h: number,
          ) => {
            // Bright, saturated eye colors common in anime
            if (saturation > 0.6 && brightness > 0.4) {
              if (h >= 180 && h <= 240) return true; // Bright blue eyes
              if (h >= 90 && h <= 150) return true; // Green eyes
              if (h >= 270 && h <= 330) return true; // Purple/violet eyes
              if (h >= 30 && h <= 60) return true; // Golden/amber eyes
            }
            return false;
          };

          // Anime-specific color boosting
          if (isAnimeSkinColor(r, g, b)) {
            // Skin tones - very high priority
            colorBoost = 4.0;
          } else if (isAnimeHairColor(r, g, b, hue)) {
            // Hair colors - high priority
            colorBoost = 3.5;
          } else if (isAnimeEyeColor(r, g, b, hue)) {
            // Eye colors - high priority
            colorBoost = 3.0;
          } else if (hue >= 300 || hue <= 60) {
            // General warm colors (clothing, accessories)
            colorBoost = 2.5;
          } else if (hue >= 270 && hue < 300) {
            // Purples (magical elements)
            colorBoost = 2.0;
          } else if (hue >= 45 && hue <= 75 && saturation > 0.5) {
            // Bright yellows (energy, powers)
            colorBoost = 1.8;
          } else if (hue >= 180 && hue <= 240) {
            // Blues - penalty (unless it's hair/eyes)
            colorBoost = 0.4;
          } else if (hue >= 120 && hue < 180) {
            // Greens - slight penalty (unless eyes)
            colorBoost = 0.8;
          }

          // Enhanced scoring with stronger bias against cool colors
          const score = count * saturation * brightness * colorBoost;

          if (score > bestScore) {
            bestScore = score;
            bestColor = { r, g, b };
          }
        });

        // Helper function to calculate hue
        function getHue(r: number, g: number, b: number): number {
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const diff = max - min;

          if (diff === 0) return 0;

          let hue = 0;
          switch (max) {
            case r:
              hue = ((g - b) / diff) % 6;
              break;
            case g:
              hue = (b - r) / diff + 2;
              break;
            case b:
              hue = (r - g) / diff + 4;
              break;
          }

          return Math.round(hue * 60);
        }

        if (bestColor !== null) {
          const color = bestColor as { r: number; g: number; b: number };
          const hex = `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`;

          // Debug: Log detailed extraction info
          const hue = getHue(color.r, color.g, color.b);
          const max = Math.max(color.r, color.g, color.b);
          const min = Math.min(color.r, color.g, color.b);
          const saturation = max === 0 ? 0 : (max - min) / max;

          console.log(`🔍 EXTRACTION DEBUG for ${imageUrl}:`);
          console.log(
            `📊 Clusters: ${colorMap.size} | Winner: RGB(${color.r}, ${color.g}, ${color.b}) = ${hex}`,
          );
          console.log(
            `🌈 HSL: ${hue}° hue, ${(saturation * 100).toFixed(1)}% sat | Score: ${bestScore.toFixed(2)}`,
          );

          // Show anime-specific color category
          let category = "neutral";
          if (
            color.r >= 220 &&
            color.r <= 255 &&
            color.g >= 180 &&
            color.g <= 230 &&
            color.b >= 150 &&
            color.b <= 200
          ) {
            category = "👤SKIN(4.0x)";
          } else if (
            hue >= 300 ||
            hue <= 30 ||
            (hue >= 45 && hue <= 75 && color.g > 180) ||
            (hue >= 240 && hue <= 310)
          ) {
            category = "💇HAIR(3.5x)";
          } else if (
            saturation > 0.6 &&
            ((hue >= 180 && hue <= 240) ||
              (hue >= 90 && hue <= 150) ||
              (hue >= 270 && hue <= 330) ||
              (hue >= 30 && hue <= 60))
          ) {
            category = "👁️EYES(3.0x)";
          } else if (hue >= 300 || hue <= 60) {
            category = "🔥WARM(2.5x)";
          } else if (hue >= 270 && hue < 300) {
            category = "✨MAGIC(2.0x)";
          } else if (hue >= 45 && hue <= 75 && saturation > 0.5) {
            category = "⚡ENERGY(1.8x)";
          } else if (hue >= 180 && hue <= 240) {
            category = "❄️BLUE(0.4x)";
          } else if (hue >= 120 && hue < 180) {
            category = "🌿GREEN(0.8x)";
          }

          console.log(`🎨 Anime Category: ${category}`);

          resolve(hex);
        } else {
          resolve(null);
        }
      } catch (error) {
        console.warn("Color extraction failed:", error);
        resolve(null);
      }
    };

    img.onerror = () => {
      console.warn("Failed to load image for color extraction:", imageUrl);
      resolve(null);
    };

    img.src = imageUrl;
  });
}

// Process color extraction queue
async function processColorExtractionQueue() {
  const queue = Array.from(colorExtractionQueue.value);
  if (queue.length === 0) return;

  for (const imageUrl of queue) {
    if (extractedColors.value.has(imageUrl)) {
      colorExtractionQueue.value.delete(imageUrl);
      continue;
    }

    try {
      const color = await extractDominantColorFromImage(imageUrl);
      if (color) {
        extractedColors.value.set(imageUrl, color);
        console.log(`✨ Extracted color ${color} from ${imageUrl}`);

        // Debug: Log color analysis
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        console.log(
          `🎨 Color analysis: RGB(${r},${g},${b}) Saturation: ${saturation.toFixed(2)}`,
        );
      }
    } catch (error) {
      console.warn("Error in color extraction:", error);
    }

    colorExtractionQueue.value.delete(imageUrl);
  }
}

// Get or extract color for metadata
function getMetadataColor(metadata: AnimeMetadata | undefined): string | null {
  // Return API color if available
  if (metadata?.coverImageColor) {
    return metadata.coverImageColor;
  }

  // Check if we have an extracted color
  const imageUrl = getBestCoverImage(metadata, "medium");
  if (imageUrl && extractedColors.value.has(imageUrl)) {
    return extractedColors.value.get(imageUrl) || null;
  }

  // Add to extraction queue if not already processing
  if (imageUrl && !colorExtractionQueue.value.has(imageUrl)) {
    colorExtractionQueue.value.add(imageUrl);
    // Process queue asynchronously
    setTimeout(() => processColorExtractionQueue(), 100);
  }

  return null;
}

// Material Design 3 Color Token System Generator
function generateMaterial3TokensFromCoverImage(
  metadata: AnimeMetadata | undefined,
) {
  const coverColor = getMetadataColor(metadata);

  if (!coverColor) {
    // Default Material 3 tokens for dark theme
    return {
      // Primary tokens
      primary: "#bb86fc",
      onPrimary: "#000000",
      primaryContainer: "#3700b3",
      onPrimaryContainer: "#e7d6ff",

      // Secondary tokens
      secondary: "#03dac6",
      onSecondary: "#000000",
      secondaryContainer: "#005047",
      onSecondaryContainer: "#a4f1e7",

      // Surface tokens
      surface: "#121212",
      onSurface: "#e3e3e3",
      surfaceVariant: "#2c2c2c",
      onSurfaceVariant: "#cac4d0",
      surfaceContainer: "#1e1e1e",
      surfaceContainerHigh: "#2a2a2a",
      surfaceContainerHighest: "#363636",

      // Background tokens
      background: "#121212",
      onBackground: "#e3e3e3",

      // Outline tokens
      outline: "#938f99",
      outlineVariant: "#49454f",

      // Shadow and overlay
      shadow: "#000000",
      scrim: "#000000",

      // Inverse tokens
      inverseSurface: "#e3e3e3",
      inverseOnSurface: "#313131",
      inversePrimary: "#6750a4",
    };
  }

  // Parse cover color and generate Material 3 palette
  const hex = coverColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Convert to HSL for better color manipulation
  const toHsl = (r: number, g: number, b: number) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0,
      l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  };

  const fromHsl = (h: number, s: number, l: number) => {
    h = h % 360;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0,
      g = 0,
      b = 0;

    if (0 <= h && h < 60) {
      r = c;
      g = x;
      b = 0;
    } else if (60 <= h && h < 120) {
      r = x;
      g = c;
      b = 0;
    } else if (120 <= h && h < 180) {
      r = 0;
      g = c;
      b = x;
    } else if (180 <= h && h < 240) {
      r = 0;
      g = x;
      b = c;
    } else if (240 <= h && h < 300) {
      r = x;
      g = 0;
      b = c;
    } else if (300 <= h && h < 360) {
      r = c;
      g = 0;
      b = x;
    }

    return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`;
  };

  const [hue, saturation, lightness] = toHsl(r, g, b);

  // Generate Material 3 tokens based on cover image color
  return {
    // Primary tokens - derived from cover image
    primary: fromHsl(hue, Math.max(70, saturation), 60),
    onPrimary: lightness > 50 ? "#000000" : "#ffffff",
    primaryContainer: fromHsl(hue, Math.max(60, saturation), 25),
    onPrimaryContainer: fromHsl(hue, Math.max(80, saturation), 90),

    // Secondary tokens - complementary color
    secondary: fromHsl((hue + 60) % 360, Math.max(50, saturation * 0.8), 70),
    onSecondary: "#000000",
    secondaryContainer: fromHsl(
      (hue + 60) % 360,
      Math.max(40, saturation * 0.6),
      20,
    ),
    onSecondaryContainer: fromHsl(
      (hue + 60) % 360,
      Math.max(60, saturation),
      85,
    ),

    // Surface tokens - neutral with hint of cover color
    surface: fromHsl(hue, Math.min(15, saturation * 0.3), 8),
    onSurface: "#e3e3e3",
    surfaceVariant: fromHsl(hue, Math.min(20, saturation * 0.4), 15),
    onSurfaceVariant: "#cac4d0",
    surfaceContainer: fromHsl(hue, Math.min(18, saturation * 0.35), 12),
    surfaceContainerHigh: fromHsl(hue, Math.min(22, saturation * 0.4), 18),
    surfaceContainerHighest: fromHsl(hue, Math.min(25, saturation * 0.45), 24),

    // Background tokens
    background: fromHsl(hue, Math.min(12, saturation * 0.25), 6),
    onBackground: "#e3e3e3",

    // Outline tokens
    outline: fromHsl(hue, Math.min(30, saturation * 0.5), 50),
    outlineVariant: fromHsl(hue, Math.min(25, saturation * 0.4), 30),

    // Shadow and overlay
    shadow: "#000000",
    scrim: "rgba(0, 0, 0, 0.32)",

    // Inverse tokens
    inverseSurface: "#e3e3e3",
    inverseOnSurface: "#313131",
    inversePrimary: fromHsl(hue, Math.max(60, saturation), 40),
  };
}

// Apply Material 3 styling to version dialog based on cover image color
function getVersionDialogStyle(metadata: AnimeMetadata | undefined): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);
  return `
    background: ${tokens.surface};
    border: 1px solid ${tokens.outlineVariant};
    color: ${tokens.onSurface};
    height: 100vh;
  `.trim();
}

// Get Material 3 toolbar styling based on cover image color
function getVersionDialogToolbarStyle(
  metadata: AnimeMetadata | undefined,
): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);
  return `
    background-color: ${tokens.surfaceContainerHigh};
    color: ${tokens.onSurface};
    border-bottom: 1px solid ${tokens.outlineVariant};
  `.trim();
}

// Get Material 3 card styling based on cover image color
function getVersionDialogCardStyle(
  metadata: AnimeMetadata | undefined,
): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);
  return `
    background-color: ${tokens.surfaceContainer};
    border: 1px solid ${tokens.outlineVariant};
    color: ${tokens.onSurface};
    transition: all 0.2s ease;
  `.trim();
}

// Get Material 3 card hover styling based on cover image color
function getVersionDialogCardHoverStyle(
  metadata: AnimeMetadata | undefined,
): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);
  return `
    background-color: ${tokens.surfaceContainerHigh};
    border-color: ${tokens.primary};
    box-shadow: 0 4px 8px ${tokens.shadow}20;
    transform: translateY(-2px);
  `.trim();
}

// Get Material 3 primary button styling

// Get Material 3 styling for anime cards based on cover image color
function getAnimeCardStyle(metadata: AnimeMetadata | undefined): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);
  return `
    background: linear-gradient(135deg, ${tokens.surfaceContainer} 0%, ${tokens.surfaceVariant} 100%);
    border: 1px solid ${tokens.outlineVariant};
    color: ${tokens.onSurface};
    box-shadow: 0 2px 8px ${tokens.shadow}15;
    transition: all 0.3s ease;
  `.trim();
}

// Get Material 3 chip styling for anime metadata with enhanced readability
function getAnimeChipStyle(
  metadata: AnimeMetadata | undefined,
  type: "primary" | "secondary" | "accent" = "primary",
): string {
  const tokens = generateMaterial3TokensFromCoverImage(metadata);

  // Enhanced readability with better contrast ratios and typography
  switch (type) {
    case "primary":
      return `
        background-color: ${tokens.primaryContainer};
        color: ${tokens.onPrimaryContainer};
        border: 1px solid ${tokens.primary}60;
        font-weight: 500;
        font-size: 0.75rem;
        letter-spacing: 0.025em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      `.trim();
    case "secondary":
      return `
        background-color: ${tokens.secondaryContainer};
        color: ${tokens.onSecondaryContainer};
        border: 1px solid ${tokens.secondary}60;
        font-weight: 500;
        font-size: 0.75rem;
        letter-spacing: 0.025em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      `.trim();
    case "accent":
      return `
        background-color: ${tokens.surfaceContainerHigh};
        color: ${tokens.onSurface};
        border: 1px solid ${tokens.outline}80;
        font-weight: 500;
        font-size: 0.75rem;
        letter-spacing: 0.025em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      `.trim();
    default:
      return `
        background-color: ${tokens.surfaceContainer};
        color: ${tokens.onSurface};
        border: 1px solid ${tokens.outlineVariant};
        font-weight: 500;
        font-size: 0.75rem;
        letter-spacing: 0.025em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      `.trim();
  }
}

// Get best available cover image based on context and priority
function getBestCoverImage(
  metadata: AnimeMetadata | undefined,
  context: "large" | "medium" | "small" = "large",
): string {
  if (!metadata) return "";

  if (context === "small") {
    // For list view avatars - prefer smaller sizes to save bandwidth
    return (
      metadata.coverImageSmall ||
      metadata.coverImageMedium ||
      metadata.coverImageLarge ||
      metadata.coverImageExtraLarge ||
      metadata.coverImage ||
      ""
    );
  } else if (context === "medium") {
    // For medium contexts - balanced approach
    return (
      metadata.coverImageMedium ||
      metadata.coverImageLarge ||
      metadata.coverImageExtraLarge ||
      metadata.coverImage ||
      ""
    );
  } else {
    // For large contexts (version dialog) - prefer highest quality
    return (
      metadata.coverImageExtraLarge ||
      metadata.coverImageLarge ||
      metadata.coverImageMedium ||
      metadata.coverImage ||
      ""
    );
  }
}

// Format episode count with scanned/total logic
function formatEpisodeCount(item: AnimeItem): string {
  const metadata = item.animeMetadata;
  if (!metadata) return "Unknown";

  const scanned = metadata.scannedEpisodes;
  const total = metadata.totalEpisodes;
  const episodes = metadata.episodes;

  // If we have scanned episodes and they differ from AniList total
  if (scanned !== null && scanned !== undefined && total && scanned !== total) {
    return `${scanned}/${total}`;
  }

  // If we have scanned episodes but no AniList total
  if (scanned !== null && scanned !== undefined && !total) {
    return `${scanned}/?`;
  }

  // If we have episodes count (either scanned or AniList)
  if (episodes) {
    return `${episodes}`;
  }

  // If we have AniList total but no scanned episodes
  if (total) {
    return `${total}`;
  }

  return "Unknown";
}

// Handle metadata updates from plugin
function handleMetadataUpdate(data: any) {
  console.log("🎯 AnimeSeasonViewer: metadata update received:", data);

  if (data.groupedAnime) {
    // Merge new grouped data with existing items to preserve any metadata
    console.log(
      "🎯 AnimeSeasonViewer: Merging grouped anime data with existing items",
    );
    const mergedItems = data.groupedAnime.map((newItem: AnimeItem) => {
      const existingItem = processedItems.value.find(
        (existing) =>
          existing.name === newItem.name ||
          (existing.path && newItem.path && existing.path === newItem.path),
      );

      if (
        existingItem &&
        existingItem.animeMetadata &&
        !newItem.animeMetadata
      ) {
        // Preserve existing metadata if new item doesn't have it
        console.log(
          `🎯 AnimeSeasonViewer: Preserving existing metadata for ${newItem.name}`,
        );
        return { ...newItem, animeMetadata: existingItem.animeMetadata };
      }

      return newItem;
    });

    processedItems.value = mergedItems;
    console.log(
      "🎯 AnimeSeasonViewer: updated with",
      processedItems.value.length,
      "grouped items (merged with existing metadata)",
    );
  } else if (data.updates && Array.isArray(data.updates)) {
    data.updates.forEach((update: any) => {
      const existingIndex = processedItems.value.findIndex(
        (item) =>
          item.name === update.searchTitle ||
          item.animeMetadata?.title === update.searchTitle,
      );

      if (existingIndex >= 0 && update.metadata) {
        processedItems.value[existingIndex].animeMetadata = update.metadata;
      }
    });
    console.log(
      "🎯 AnimeSeasonViewer: applied metadata updates for",
      data.updates.length,
      "items",
    );
  }

  emit("metadata-update", data);
}

// Check if metadata is missing and trigger loading if needed
function triggerMetadataLoadingIfNeeded() {
  console.log("🎯 AnimeSeasonViewer: Checking metadata loading need", {
    hasSocket: !!props.socket,
    path: props.path,
    itemsLength: props.items?.length,
  });

  if (!props.socket) {
    console.warn(
      "🎯 AnimeSeasonViewer: No socket available for metadata loading",
    );
    return;
  }
  if (!props.path) {
    console.warn(
      "🎯 AnimeSeasonViewer: No path available for metadata loading",
    );
    return;
  }
  if (!props.items) {
    console.warn(
      "🎯 AnimeSeasonViewer: No items available for metadata loading",
    );
    return;
  }

  // Check if most items are missing metadata (indicating direct load without navigation)
  const animeDirectories = props.items.filter(
    (item) => item.isDir && !item.name.startsWith("."),
  );
  const itemsWithoutMetadata = animeDirectories.filter(
    (item) => !item.animeMetadata && !item.isProcessing && !item.metadataFailed,
  );

  console.log("🎯 AnimeSeasonViewer: Metadata analysis", {
    totalItems: props.items.length,
    animeDirectories: animeDirectories.length,
    itemsWithoutMetadata: itemsWithoutMetadata.length,
    percentage:
      animeDirectories.length > 0
        ? (
            (itemsWithoutMetadata.length / animeDirectories.length) *
            100
          ).toFixed(1) + "%"
        : "0%",
    sampleItems: animeDirectories.slice(0, 3).map((item) => ({
      name: item.name,
      hasMetadata: !!item.animeMetadata,
      isProcessing: !!item.isProcessing,
      metadataFailed: !!item.metadataFailed,
    })),
  });

  // If more than 50% of anime directories don't have metadata, trigger loading
  if (
    animeDirectories.length > 0 &&
    itemsWithoutMetadata.length / animeDirectories.length > 0.5
  ) {
    console.log(
      "🎯 AnimeSeasonViewer: Triggering metadata reload - threshold exceeded",
    );

    // Emit a request to reload this directory with metadata
    props.socket.emit(
      "listDirWithAnimeMetadata",
      props.path,
      (path: string, result: any) => {
        console.log(
          "🎯 AnimeSeasonViewer: Received metadata reload response:",
          { path, resultLength: result?.length, hasResult: !!result },
        );
        if (result && Array.isArray(result)) {
          console.log(
            "🎯 AnimeSeasonViewer: Sample metadata items:",
            result.slice(0, 3).map((item) => ({
              name: item.name,
              hasAnimeMetadata: !!item.animeMetadata,
              isGrouped: !!item.isGrouped,
            })),
          );

          // Emit the metadata update to FtpViewer so it can update its children
          console.log(
            "🎯 AnimeSeasonViewer: Emitting metadata-update to FtpViewer with",
            result.length,
            "items",
          );
          emit("metadata-update", result);
        }
      },
    );
  } else {
    console.log(
      "🎯 AnimeSeasonViewer: Metadata threshold not reached, no reload needed",
    );
  }
}

// Check if origin folder points to specific anime version and auto-open dialog
function checkAutoOpenVersionDialog() {
  if (!props.originFolder || !props.path) return;

  console.log("🎯 AnimeSeasonViewer: checking auto-open for:", {
    originFolder: props.originFolder,
    currentPath: props.path,
  });

  // Normalize paths by ensuring consistent trailing slashes
  const normalizeOriginPath = props.originFolder.endsWith("/")
    ? props.originFolder
    : props.originFolder + "/";
  const normalizeCurrentPath = props.path.endsWith("/")
    ? props.path
    : props.path + "/";

  // Check if originFolder points to a specific anime version within current season path
  if (
    normalizeOriginPath.startsWith(normalizeCurrentPath) &&
    normalizeOriginPath !== normalizeCurrentPath
  ) {
    // Extract anime directory name from originFolder
    // should match anime in current season directory
    const relativePath = normalizeOriginPath.substring(
      normalizeCurrentPath.length,
    );
    const pathParts = relativePath.split("/").filter((part) => part.length > 0);
    const animeDir = pathParts[0]; // Get first directory name

    console.log("🎯 AnimeSeasonViewer: looking for anime:", {
      relativePath,
      pathParts,
      animeDir,
      availableItems: props.items?.map((i) => ({
        name: i.name,
        isGrouped: i.isGrouped,
        versions: i.versions?.map((v) => v.name),
      })),
    });

    // Find the anime in current items that matches this directory
    const targetAnime = props.items?.find((item) => {
      // Check if this anime has versions that include the target directory
      if (item.isGrouped && item.versions) {
        return item.versions.some(
          (version) =>
            version.name === animeDir ||
            version.path?.includes(animeDir) ||
            version.path?.endsWith(animeDir) ||
            version.path?.endsWith(animeDir + "/"),
        );
      }
      // Also check direct name match for non-grouped items
      return item.name === animeDir;
    });

    console.log("🎯 AnimeSeasonViewer: target anime found:", {
      found: !!targetAnime,
      name: targetAnime?.name,
      isGrouped: targetAnime?.isGrouped,
      hasVersions: !!targetAnime?.versions,
      versionsCount: targetAnime?.versions?.length,
    });

    if (targetAnime && targetAnime.isGrouped && targetAnime.versions) {
      console.log(
        "🎯 AnimeSeasonViewer: auto-opening version dialog for:",
        targetAnime.name,
      );
      // Auto-open version dialog
      selectedAnime.value = targetAnime;
      versionDialog.value = true;
    }
  }
}

// Watch for extracted colors changes to trigger UI updates
watch(
  extractedColors,
  () => {
    // Force re-render by triggering a reactive update
    console.log(
      "Color extracted, updating UI. Total colors:",
      extractedColors.value.size,
    );
  },
  { deep: true },
);

// Trigger color extraction for items without API colors
function triggerColorExtractionForItems(items: AnimeItem[]) {
  items.forEach((item) => {
    if (item.animeMetadata && !item.animeMetadata.coverImageColor) {
      // Trigger color extraction by calling getMetadataColor
      getMetadataColor(item.animeMetadata);
    }
  });
}

// Get structured version information from version description
function getStructuredVersionInfo(version: Version) {
  return version.versionDescription;
}

// Lifecycle hooks
onMounted(() => {
  console.log(
    "🎯 AnimeSeasonViewer: mounted with",
    props.items?.length || 0,
    "items",
  );

  if (props.items && props.items.length > 0) {
    console.log(
      "🎯 AnimeSeasonViewer: onMounted setting processedItems with metadata status:",
      props.items.map((item) => ({
        name: item.name,
        hasMetadata: !!item.animeMetadata,
      })),
    );
    processedItems.value = [...props.items];

    // Check if metadata is missing and trigger loading if needed
    triggerMetadataLoadingIfNeeded();

    // Trigger color extraction for items without API colors
    triggerColorExtractionForItems(props.items);

    // Check if we should auto-open version dialog
    checkAutoOpenVersionDialog();
  }

  // Also watch for items changes in case they load later
  watch(
    () => props.items,
    (newItems, oldItems) => {
      console.log("🎯 AnimeSeasonViewer: watch fired - props.items changed:", {
        newItemsCount: newItems?.length || 0,
        oldItemsCount: oldItems?.length || 0,
        versionDialogOpen: versionDialog.value,
        currentProcessedItemsCount: processedItems.value.length,
        propsItemsHaveMetadata:
          newItems?.some((item) => item.animeMetadata) || false,
        processedItemsHaveMetadata:
          processedItems.value.some((item) => item.animeMetadata) || false,
      });

      if (newItems && newItems.length > 0) {
        // Always update processedItems when props.items change
        console.log(
          "🎯 AnimeSeasonViewer: Updating processedItems from props.items change",
        );
        processedItems.value = [...newItems];

        if (!versionDialog.value) {
          console.log(
            "🎯 AnimeSeasonViewer: watch triggering metadata loading and auto-open checks",
          );
          triggerMetadataLoadingIfNeeded();
          triggerColorExtractionForItems(newItems);
          checkAutoOpenVersionDialog();
        }
      }
    },
  );

  if (props.socket) {
    props.socket.on("animeMetadataUpdate", (data: any) => {
      console.log("🎯 AnimeSeasonViewer: Received animeMetadataUpdate event:", {
        eventPath: data.path,
        currentPath: props.path,
        pathMatches: data.path === props.path,
        updatesLength: data.updates?.length,
        hasUpdates: !!data.updates,
      });

      if (data.path === props.path) {
        console.log(
          "🎯 AnimeSeasonViewer: Processing metadata update for matching path",
        );
        handleMetadataUpdate(data);
      } else {
        console.log(
          "🎯 AnimeSeasonViewer: Ignoring metadata update for different path",
        );
      }
    });

    props.socket.on("animeMetadataStatus", (data: any) => {
      console.log("🎯 AnimeSeasonViewer: Received animeMetadataStatus event:", {
        eventPath: data.path,
        currentPath: props.path,
        status: data.status,
        pathMatches: data.path === props.path,
      });

      if (data.path === props.path) {
        localLoadingStatus.value = data.status;
        if (data.status === "lightweight_mode") {
          localLoadingStatus.value = `Lightweight mode: ${data.totalItems} items`;
        }
        console.log(
          "🎯 AnimeSeasonViewer: Applied status update:",
          data.status,
          data,
        );
      }
    });

    props.socket.on("episodeCountUpdate", (data: any) => {
      console.log("🎯 AnimeSeasonViewer: Received episodeCountUpdate event:", {
        eventPath: data.path,
        currentPath: props.path,
        pathMatches: data.path === props.path,
        updatesLength: data.updates?.length,
      });

      if (data.path === props.path && data.updates) {
        data.updates.forEach((update: any) => {
          // Find the item by searchTitle and update scannedEpisodes
          const itemIndex = processedItems.value.findIndex((item) => {
            return (
              item.name === update.searchTitle ||
              item.animeMetadata?.title === update.searchTitle ||
              item.searchTitle === update.searchTitle
            );
          });

          if (itemIndex >= 0) {
            if (!processedItems.value[itemIndex].animeMetadata) {
              processedItems.value[itemIndex].animeMetadata = {};
            }
            processedItems.value[itemIndex].animeMetadata.scannedEpisodes =
              update.scannedEpisodes;
            console.log(
              `🎯 AnimeSeasonViewer: Updated scannedEpisodes for ${update.searchTitle}: ${update.scannedEpisodes}`,
            );
          } else {
            console.warn(
              `🎯 AnimeSeasonViewer: Could not find item for episode update: ${update.searchTitle}`,
            );
          }
        });
      }
    });

    // Don't trigger metadata loading here - rely on FtpViewer to pass the data
    console.log(
      "🎯 AnimeSeasonViewer: listening for metadata updates from FtpViewer",
    );
  }
});

onBeforeUnmount(() => {
  if (props.socket) {
    props.socket.off("animeMetadataUpdate");
    props.socket.off("animeMetadataStatus");
    props.socket.off("episodeCountUpdate");
  }
});
</script>

<style scoped lang="scss">
.anime-ftp-viewer {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.border-bottom {
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.content-area {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden !important;
  overflow-y: auto;
}

.content-wrapper {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.anime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  padding: 16px 0;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: hidden !important;
}

.anime-card {
  transition: all 0.3s ease;
  cursor: pointer;
  border-radius: 8px;
  // Dynamic styles from getAnimeCardStyle() will override defaults
}

// Hover effects now handled by dynamic styling functions
// This ensures smooth transitions with the Material Design tokens

.anime-card-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.anime-cover-container {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.anime-cover {
  border-radius: 8px;
  margin-bottom: 8px;
  width: 100%;
  max-width: 200px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.3);
  display: block !important;
  visibility: visible !important;

  // Only add margin-right in list view, not in grid view
  .v-list-item & {
    margin-right: 12px;
  }
}

.status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none; /* Don't block image interactions */
}

.anime-cover-placeholder {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 8px;
  height: 280px;
  width: 100%;
  max-width: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.anime-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  line-height: 1.2;
  color: #1976d2;
}

.anime-subtitle {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 8px;
  color: #666;
  font-style: italic;
  line-height: 1;
}

.anime-genres {
  margin-bottom: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.anime-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.episodes-count {
  font-size: 12px;
  opacity: 0.8;
}

.anime-list-item {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 4px;
}

.anime-list {
  width: 100% !important;
  min-width: 100% !important;
  max-width: 100% !important;
  overflow-x: hidden !important;
}

.anime-list .v-list-item {
  padding: 12px;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: hidden;
}

// List view styles (from original FtpViewer)
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

.anime-title-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.anime-title-wrapper {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.anime-description {
  font-size: 0.85em;
  color: #666;
  line-height: 1.3;
  margin-top: 6px;
  padding-left: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

// Rating-based color classes (AniChart style with subtle pastels)
.rating-high {
  // Soft pastel green for high ratings (75-100%)
  background: linear-gradient(
    90deg,
    rgba(168, 213, 186, 0.04) 0%,
    rgba(168, 213, 186, 0.01) 100%
  );

  &:hover {
    background: linear-gradient(
      90deg,
      rgba(168, 213, 186, 0.08) 0%,
      rgba(168, 213, 186, 0.02) 100%
    );
  }

  // Left border only for list items
  &.v-list-item {
    border-left-color: #a8d5ba !important;
  }

  // Full border for grid cards
  &.anime-card {
    border: 1px solid rgba(168, 213, 186, 0.2);
    background: rgba(168, 213, 186, 0.03);

    &:hover {
      border-color: rgba(168, 213, 186, 0.3);
      background: rgba(168, 213, 186, 0.06);
    }
  }
}

.rating-medium {
  // Soft pastel orange for medium ratings (61-74%)
  background: linear-gradient(
    90deg,
    rgba(242, 201, 138, 0.04) 0%,
    rgba(242, 201, 138, 0.01) 100%
  );

  &:hover {
    background: linear-gradient(
      90deg,
      rgba(242, 201, 138, 0.08) 0%,
      rgba(242, 201, 138, 0.02) 100%
    );
  }

  // Left border only for list items
  &.v-list-item {
    border-left-color: #f2c98a !important;
  }

  // Full border for grid cards
  &.anime-card {
    border: 1px solid rgba(242, 201, 138, 0.2);
    background: rgba(242, 201, 138, 0.03);

    &:hover {
      border-color: rgba(242, 201, 138, 0.3);
      background: rgba(242, 201, 138, 0.06);
    }
  }
}

.rating-low {
  // Soft pastel red for low ratings (0-60%)
  background: linear-gradient(
    90deg,
    rgba(242, 168, 168, 0.04) 0%,
    rgba(242, 168, 168, 0.01) 100%
  );

  &:hover {
    background: linear-gradient(
      90deg,
      rgba(242, 168, 168, 0.08) 0%,
      rgba(242, 168, 168, 0.02) 100%
    );
  }

  // Left border only for list items
  &.v-list-item {
    border-left-color: #f2a8a8 !important;
  }

  // Full border for grid cards
  &.anime-card {
    border: 1px solid rgba(242, 168, 168, 0.2);
    background: rgba(242, 168, 168, 0.03);

    &:hover {
      border-color: rgba(242, 168, 168, 0.3);
      background: rgba(242, 168, 168, 0.06);
    }
  }
}

.rating-unknown {
  // Very subtle grey for unknown ratings
  background: linear-gradient(
    90deg,
    rgba(192, 192, 192, 0.02) 0%,
    rgba(192, 192, 192, 0.005) 100%
  );

  &:hover {
    background: linear-gradient(
      90deg,
      rgba(192, 192, 192, 0.04) 0%,
      rgba(192, 192, 192, 0.01) 100%
    );
  }

  // Left border only for list items
  &.v-list-item {
    border-left-color: #c0c0c0 !important;
  }

  // Full border for grid cards
  &.anime-card {
    border: 1px solid rgba(192, 192, 192, 0.15);
    background: rgba(192, 192, 192, 0.02);

    &:hover {
      border-color: rgba(192, 192, 192, 0.2);
      background: rgba(192, 192, 192, 0.04);
    }
  }
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

.description-content {
  line-height: 1.6;

  :deep(br) {
    margin-bottom: 0.5em;
  }

  :deep(em) {
    font-style: italic;
    color: rgb(var(--v-theme-primary));
  }

  :deep(strong) {
    font-weight: 600;
    color: rgb(var(--v-theme-secondary));
  }
}

// Version Details Styles
.version-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.version-row {
  display: flex;
  align-items: center;
  line-height: 1.2;

  strong {
    color: var(--md-sys-color-primary, rgb(var(--v-theme-primary)));
    margin-right: 6px;
    font-weight: 600;
    font-size: 0.8em;
    min-width: 50px;
    display: inline-block;
  }

  span {
    font-size: 0.85em;
  }
}

// Beautiful Version List Styles
:deep(.version-list-item) {
  // Base styling - elegant and clean
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-surface-variant), 0.02) 0%,
    rgba(var(--v-theme-surface-variant), 0.05) 100%
  ) !important;
  border: 1px solid rgba(var(--v-theme-outline), 0.12) !important;
  border-radius: 16px !important;
  backdrop-filter: blur(8px) !important;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  margin: 8px 0 !important;

  // Elegant hover state
  &:hover {
    background: linear-gradient(
      135deg,
      rgba(var(--v-theme-primary), 0.06) 0%,
      rgba(var(--v-theme-primary), 0.02) 100%
    ) !important;
    border-color: rgba(var(--v-theme-primary), 0.25) !important;
    transform: translateY(-2px) !important;
    box-shadow:
      0 8px 24px rgba(var(--v-theme-shadow), 0.15),
      0 4px 12px rgba(var(--v-theme-primary), 0.12) !important;
  }

  // Focus/Active states
  &:focus {
    outline: 2px solid rgba(var(--v-theme-primary), 0.4) !important;
    outline-offset: 2px !important;
  }

  &:active {
    transform: translateY(0) !important;
    box-shadow: 0 4px 12px rgba(var(--v-theme-shadow), 0.1) !important;
  }

  // Remove default overlays but keep theming
  .v-list-item__overlay {
    opacity: 0 !important;
  }

  .v-list-item__underlay {
    background: transparent !important;
  }
}

// Beautiful Version Chip Styles
:deep(.version-details .v-chip) {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  font-weight: 500 !important;
  letter-spacing: 0.02em !important;

  // Source chips (with background color)
  &:not(.v-chip--variant-outlined) {
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;

    &:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      border-color: rgba(255, 255, 255, 0.25) !important;
    }
  }

  // Outlined chips (audio/subtitle)
  &.v-chip--variant-outlined {
    border: 1px solid rgba(var(--v-theme-outline), 0.3) !important;
    background: rgba(var(--v-theme-surface-variant), 0.05) !important;

    &:hover {
      background: rgba(var(--v-theme-primary), 0.08) !important;
      border-color: rgba(var(--v-theme-primary), 0.4) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 2px 8px rgba(var(--v-theme-primary), 0.15) !important;
    }
  }

  // Smooth transitions
  * {
    transition: inherit !important;
  }
}

// Enhanced version details styling
:deep(.version-details) {
  .version-row {
    margin: 6px 0 !important;
    align-items: center !important;

    strong {
      color: rgba(var(--v-theme-primary), 1) !important;
      font-weight: 600 !important;
      margin-right: 8px !important;
      min-width: 55px !important;
      font-size: 0.82em !important;
    }

    .v-chip {
      margin-left: 4px !important;
      margin-right: 2px !important;
    }
  }
}

// List container improvements
:deep(.v-list) {
  padding: 8px !important;

  // Smooth scrolling
  scroll-behavior: smooth !important;
}
</style>
