<script setup lang="ts">
import type { PreviewStatus } from "../preview";

defineProps<{
  status: PreviewStatus;
  statusMessage: string;
  canDownload: boolean;
}>();
</script>

<template>
  <article class="chrome relative flex min-h-0 flex-col overflow-hidden rounded-[1.15rem]">
    <div class="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
      <h2 class="text-[0.8125rem] font-semibold text-[#3a3a3c] dark:text-[#e5e5ea]">
        できあがった図
      </h2>

      <div class="flex min-w-0 items-center gap-2">
        <div id="visual-controls" class="visual-controls hidden">
          <button
            id="undo-button"
            type="button"
            aria-label="元に戻す"
            data-tooltip="元に戻す"
          />
          <button
            id="redo-button"
            type="button"
            aria-label="やり直す"
            data-tooltip="やり直す"
          />
          <label class="sr-only" for="direction-select">図の方向</label>
          <select id="direction-select" class="compact-control" title="図の方向">
            <option value="TD">上から下</option>
            <option value="LR">左から右</option>
            <option value="BT">下から上</option>
            <option value="RL">右から左</option>
          </select>
        </div>

        <div class="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
          <span
            id="status-dot"
            class="status-dot"
            :data-state="status"
            aria-hidden="true"
          />
          <span
            id="status-text"
            class="hidden truncate text-[0.6875rem] font-medium text-[#6e6e73] sm:inline dark:text-[#a1a1a6]"
          >
            {{ statusMessage }}
          </span>
        </div>
      </div>
    </div>

    <div class="relative min-h-0 flex-1 border-t border-black/[0.045] dark:border-white/[0.06]">
      <!-- Mermaidが生成するSVGの所有領域。Vue Templateは内部を管理しない。 -->
      <div
        id="preview"
        class="preview flex h-full items-center justify-center overflow-auto p-5 sm:p-8"
      />

      <div id="node-toolbar" class="node-toolbar hidden" aria-label="選択したノードの編集">
        <label class="sr-only" for="shape-select">ノードの形</label>
        <select id="shape-select" class="compact-control" title="ノードの形">
          <option value="rectangle">処理</option>
          <option value="rounded">角丸</option>
          <option value="terminal">開始・終了</option>
          <option value="decision">判断</option>
          <option value="circle">円</option>
        </select>
        <button
          id="add-node-button"
          type="button"
          aria-label="次のノードを追加"
          data-tooltip="次を追加"
        />
        <button
          id="delete-node-button"
          type="button"
          class="danger"
          aria-label="ノードを削除"
          data-tooltip="削除"
        />
      </div>

      <div
        id="error-panel"
        class="absolute inset-x-3 bottom-16 hidden rounded-xl border border-red-500/15 bg-red-50/95 px-3 py-2.5 text-xs leading-relaxed text-red-700 shadow-sm backdrop-blur-md dark:bg-red-950/90 dark:text-red-200"
        role="alert"
      />
    </div>

    <button
      id="download-button"
      class="action-button"
      type="button"
      aria-label="図をSVGで保存"
      data-tooltip="SVGで保存"
      :disabled="!canDownload"
    />
  </article>
</template>
