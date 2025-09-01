<template>
  <div v-if="show" class="regex-debugger">
    <v-card class="regex-debugger__card" flat>
      <v-card-title
        class="regex-debugger__title"
        @click="isExpanded = !isExpanded"
        style="cursor: pointer"
      >
        <v-icon :icon="mdiRegex" class="mr-2" />
        Regex Debugger
        <v-spacer />
        <v-icon
          :icon="isExpanded ? mdiChevronUp : mdiChevronDown"
          class="regex-debugger__chevron"
        />
      </v-card-title>
      <v-card-text v-if="isExpanded" class="regex-debugger__content">
        <!-- Test File Name Display -->
        <div class="regex-debugger__section">
          <v-text-field
            :model-value="debugResult?.testFileName || 'No test file'"
            readonly
            density="compact"
            label="Test file name"
            class="regex-debugger__field"
            variant="outlined"
            hide-details
          />
        </div>

        <!-- Regex Match Preview -->
        <div class="regex-debugger__section">
          <v-card class="regex-debugger__preview-card" flat>
            <v-card-subtitle class="pb-2">Regex Match Preview</v-card-subtitle>
            <v-card-text class="pt-0">
              <div v-if="debugResult?.error" class="regex-debugger__error">
                <v-icon
                  :icon="mdiAlert"
                  color="error"
                  size="small"
                  class="mr-1"
                />
                {{ debugResult.error }}
              </div>
              <div
                v-else-if="!debugResult?.testFileName"
                class="regex-debugger__no-file"
              >
                <v-icon
                  :icon="mdiInformation"
                  color="info"
                  size="small"
                  class="mr-1"
                />
                Please specify an origin folder to test regex
              </div>
              <div v-else-if="!fileRegex" class="regex-debugger__no-regex">
                <v-icon
                  :icon="mdiInformation"
                  color="info"
                  size="small"
                  class="mr-1"
                />
                Enter a regex pattern to see matches
              </div>
              <div
                v-else-if="
                  debugResult?.matches && debugResult.matches.length > 0
                "
                class="regex-debugger__matches"
              >
                <div class="regex-debugger__filename-preview">
                  <span
                    v-for="(part, index) in getHighlightedFileName()"
                    :key="index"
                    :class="
                      part.highlight ? 'regex-debugger__match-highlight' : ''
                    "
                    >{{ part.text }}</span
                  >
                </div>
                <div class="regex-debugger__match-details mt-2">
                  <v-chip
                    v-for="(group, index) in debugResult.matches[0]?.groups ||
                    []"
                    :key="index"
                    size="small"
                    :color="index === 0 ? 'primary' : 'secondary'"
                    variant="tonal"
                    class="mr-1 mb-1"
                  >
                    ${{ index }}: "{{ group }}"
                  </v-chip>
                </div>
              </div>
              <div v-else class="regex-debugger__no-match">
                <v-icon
                  :icon="mdiClose"
                  color="warning"
                  size="small"
                  class="mr-1"
                />
                No match found
              </div>
            </v-card-text>
          </v-card>
        </div>

        <!-- Renamed File Preview -->
        <div class="regex-debugger__section">
          <v-text-field
            :model-value="debugResult?.renamedFileName || ''"
            readonly
            density="compact"
            label="Renamed file name"
            class="regex-debugger__field"
            variant="outlined"
            :class="{
              'regex-debugger__field--success': debugResult?.renamedFileName,
            }"
            hide-details
          />
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import { watch, ref } from "vue";
import { useCommunication } from "./communication";
import { RegexDebugResult } from "@shared/types";
import {
  mdiRegex,
  mdiAlert,
  mdiInformation,
  mdiClose,
  mdiChevronUp,
  mdiChevronDown,
} from "@mdi/js";

interface Props {
  show: boolean;
  originFolder: string;
  fileRegex: string;
  fileRenameTemplate: string;
  syncName: string;
}

const props = defineProps<Props>();
const communication = useCommunication();
const debugResult = ref<RegexDebugResult | null>(null);
const isLoading = ref(false);
const isExpanded = ref(false);

// Function to highlight matches in the filename
const getHighlightedFileName = () => {
  if (!debugResult.value?.testFileName || !debugResult.value?.matches?.[0]) {
    return [{ text: debugResult.value?.testFileName || "", highlight: false }];
  }

  const filename = debugResult.value.testFileName;
  const match = debugResult.value.matches[0];
  const parts = [];

  // Add text before match
  if (match.index > 0) {
    parts.push({
      text: filename.slice(0, match.index),
      highlight: false,
    });
  }

  // Add highlighted match
  parts.push({
    text: match.match,
    highlight: true,
  });

  // Add text after match
  if (match.index + match.length < filename.length) {
    parts.push({
      text: filename.slice(match.index + match.length),
      highlight: false,
    });
  }

  return parts;
};

// Watch for changes and fetch debug info
const fetchDebugInfo = async () => {
  if (!props.show || !props.originFolder || !isExpanded.value) {
    debugResult.value = null;
    return;
  }

  isLoading.value = true;
  communication.getRegexDebugInfo(
    props.originFolder,
    props.fileRegex,
    props.fileRenameTemplate,
    props.syncName,
    (result) => {
      debugResult.value = result;
      isLoading.value = false;
    },
  );
};

// Watch for prop changes
watch(
  () => [
    props.show,
    props.originFolder,
    props.fileRegex,
    props.fileRenameTemplate,
    props.syncName,
    isExpanded.value,
  ],
  () => {
    fetchDebugInfo();
  },
  { immediate: true, deep: true },
);
</script>

<style scoped lang="scss">
.regex-debugger {
  margin-top: 16px;

  &__card {
    background-color: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  &__title {
    padding: 16px;
    font-size: 0.9rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    min-height: 56px;

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }

  &__chevron {
    transition: transform 0.2s ease;
  }

  &__content {
    padding: 12px 16px 16px;
  }

  &__section {
    margin-bottom: 14px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__field {
    &--success :deep(.v-field) {
      border-color: rgb(var(--v-theme-success)) !important;
    }
  }

  &__preview-card {
    background-color: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  &__filename-preview {
    font-family: "Consolas", "Monaco", "Courier New", monospace;
    font-size: 0.95rem;
    background: rgba(0, 0, 0, 0.15);
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    word-break: break-all;
  }

  &__match-highlight {
    background-color: rgba(var(--v-theme-primary), 0.2);
    color: rgb(var(--v-theme-primary));
    padding: 1px 2px;
    border-radius: 2px;
    font-weight: 400;
  }

  &__match-details {
    display: flex;
    flex-wrap: wrap;
  }

  &__error,
  &__no-file,
  &__no-regex,
  &__no-match {
    display: flex;
    align-items: center;
    font-size: 0.875rem;
    padding: 8px 12px;
    border-radius: 4px;
  }

  &__error {
    color: rgb(var(--v-theme-error));
    background-color: rgba(var(--v-theme-error), 0.1);
  }

  &__no-file,
  &__no-regex {
    color: rgb(var(--v-theme-info));
    background-color: rgba(var(--v-theme-info), 0.1);
  }

  &__no-match {
    color: rgb(var(--v-theme-warning));
    background-color: rgba(var(--v-theme-warning), 0.1);
  }
}
</style>
