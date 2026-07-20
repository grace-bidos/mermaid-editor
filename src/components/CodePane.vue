<script setup lang="ts">
import { Check, Copy, createElement } from "lucide";
import { onMounted, shallowRef } from "vue";
import type { SourceRange } from "../flowchart";
import { useCodeMirror } from "../composables/useCodeMirror";

const source = defineModel<string>({ required: true });
const emit = defineEmits<{
  sourceHover: [position: number | null];
  caretChange: [position: number];
}>();

const editorHost = shallowRef<HTMLDivElement | null>(null);
const copyButton = shallowRef<HTMLButtonElement | null>(null);
const editor = useCodeMirror(editorHost, source, {
  onSourceHover: (position) => emit("sourceHover", position),
  onCaretChange: (position) => emit("caretChange", position),
});

onMounted(() => {
  setCopyIcon(Copy);
});

async function copySource(): Promise<void> {
  const button = copyButton.value;
  if (!button) return;

  try {
    await navigator.clipboard.writeText(editor.getSource());
    setCopyIcon(Check);
    button.dataset.tooltip = "コピーしました";
    button.classList.add("is-success");
  } catch {
    button.dataset.tooltip = "コピーできませんでした";
  }

  window.setTimeout(() => {
    setCopyIcon(Copy);
    button.dataset.tooltip = "コードをコピー";
    button.classList.remove("is-success");
  }, 1200);
}

function setCopyIcon(icon: Parameters<typeof createElement>[0]): void {
  copyButton.value?.replaceChildren(
    createElement(icon, {
      width: 19,
      height: 19,
      "stroke-width": 1.8,
      "aria-hidden": "true",
    }),
  );
}

/**
 * Mermaid PreviewとのAdapter境界です。
 *
 * 親ComponentはCodeMirrorのDOMへ触れず、このAPIを通してsourceの置換や
 * Node correspondenceのDecorationを操作します。
 */
defineExpose({
  getSource: editor.getSource,
  getCaretPosition: editor.getCaretPosition,
  replaceSource: editor.replaceSource,
  setSourceHighlights: (ranges: readonly SourceRange[]) => editor.setSourceHighlights(ranges),
  undo: editor.undo,
  redo: editor.redo,
  focus: editor.focus,
});
</script>

<template>
  <article class="chrome relative flex min-h-0 flex-col overflow-hidden rounded-[1.15rem]">
    <div class="flex h-11 shrink-0 items-center justify-between px-4">
      <div class="flex min-w-0 items-baseline gap-2">
        <h2 class="text-[0.8125rem] font-semibold text-[#3a3a3c] dark:text-[#e5e5ea]">
          ここにペースト
        </h2>
        <span class="hidden truncate text-[0.6875rem] text-[#8e8e93] sm:inline">
          AIから返ってきたMermaidコード
        </span>
      </div>
      <span class="shrink-0 text-[0.6875rem] font-medium text-[#8e8e93]">Mermaid</span>
    </div>

    <!-- CodeMirrorがこのhostを所有する。Vueは内部DOMをrenderしない。 -->
    <div
      id="editor"
      ref="editorHost"
      class="editor-shell min-h-0 flex-1 border-t border-black/[0.045] dark:border-white/[0.06]"
    />

    <button
      id="copy-button"
      ref="copyButton"
      class="action-button"
      type="button"
      aria-label="コードをコピー"
      data-tooltip="コードをコピー"
      :disabled="!source.trim()"
      @click="copySource"
    />
  </article>
</template>
