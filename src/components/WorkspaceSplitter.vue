<script setup lang="ts">
import {
  DEFAULT_SPLIT_PERCENT,
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
} from "../split-pane";
</script>

<template>
  <div
    id="splitter"
    class="splitter"
    role="separator"
    aria-label="コードと図の表示割合"
    aria-orientation="horizontal"
    :aria-valuemin="MIN_SPLIT_PERCENT"
    :aria-valuemax="MAX_SPLIT_PERCENT"
    :aria-valuenow="DEFAULT_SPLIT_PERCENT"
    tabindex="0"
    title="ドラッグして表示割合を変更"
  >
    <span aria-hidden="true" />
  </div>
</template>
