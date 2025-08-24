<template>
  <div v-if="!loading">
    <v-icon
      v-if="!showLink && currentVersion !== latestVersion"
      :title="`New Version available! (${latestVersion})`"
      small
      :icon="mdiAlert"
      color="yellow"
    />
    <a
      v-if="showLink && currentVersion !== latestVersion"
      class="text-decoration-none"
      target="_blank"
      href="https://github.com/BastianGanze/weebsync/releases/latest"
      >Click here to download newest version.</a
    >
    <span v-if="showLink && currentVersion === latestVersion"
      >Weebsync is up to date.</span
    >
  </div>
</template>

<script lang="ts" setup>
import { mdiAlert } from "@mdi/js";
import { useUiStore } from "./store";
import { storeToRefs } from "pinia";
import { computed, toRefs } from "vue";

const { currentVersion, latestVersion } = storeToRefs(useUiStore());
const loading = computed(
  () => currentVersion.value === "LOADING" || latestVersion.value === "LOADING",
);

const props = defineProps<{ showLink?: boolean }>();
const { showLink } = toRefs(props);
</script>
