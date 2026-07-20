<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { SourceRange } from "../flowchart";
import type { PreviewStatus } from "../preview";
import CodePane from "./CodePane.vue";
import PreviewPane from "./PreviewPane.vue";
import WorkspaceSplitter from "./WorkspaceSplitter.vue";

const source = defineModel<string>({ required: true });
defineProps<{
  status: PreviewStatus;
  statusMessage: string;
  canDownload: boolean;
}>();
const emit = defineEmits<{
  sourceHover: [position: number | null];
  caretChange: [position: number];
}>();
const codePane = useTemplateRef("codePane");

/** AppとCodeMirrorの間に、Component階層を越える最小のAdapterを公開します。 */
defineExpose({
  getSource: () => codePane.value?.getSource() ?? source.value,
  getCaretPosition: () => codePane.value?.getCaretPosition() ?? 0,
  replaceSource: (nextSource: string) => codePane.value?.replaceSource(nextSource),
  setSourceHighlights: (ranges: readonly SourceRange[]) =>
    codePane.value?.setSourceHighlights(ranges),
  undo: () => codePane.value?.undo() ?? false,
  redo: () => codePane.value?.redo() ?? false,
});
</script>

<template>
  <section
    id="workspace"
    class="workspace min-h-0 flex-1"
    aria-label="Mermaid編集領域"
  >
    <CodePane
      ref="codePane"
      v-model="source"
      @source-hover="emit('sourceHover', $event)"
      @caret-change="emit('caretChange', $event)"
    />
    <WorkspaceSplitter />
    <PreviewPane
      :status="status"
      :status-message="statusMessage"
      :can-download="canDownload"
    />
  </section>
</template>
