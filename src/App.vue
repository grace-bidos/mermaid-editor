<script setup lang="ts">
import {
  Download,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  createElement,
} from "lucide";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AppHeader from "./components/AppHeader.vue";
import EditorWorkspace from "./components/EditorWorkspace.vue";
import {
  createHistoryPreview,
  type HistoryDirection,
  type HistoryPreviewController,
} from "./history-preview";
import { createNodeInteraction, type NodeInteractionController } from "./node-interaction";
import { createEditorPersistence } from "./persistence";
import {
  createPreviewController,
  type PreviewController,
  type PreviewStatus,
} from "./preview";
import { createSplitPane } from "./split-pane";
import {
  createViewportController,
  type ViewportController,
} from "./viewport-controller";

const persistence = createEditorPersistence(localStorage);
const source = ref(persistence.loadDocument());
const status = ref<PreviewStatus>("ready");
const statusMessage = ref("準備完了");
const canDownload = ref(false);
const workspaceComponent = useTemplateRef("workspaceComponent");

let nodeInteraction: NodeInteractionController | null = null;
let historyPreview: HistoryPreviewController | null = null;
let previewController: PreviewController | null = null;
let viewportController: ViewportController | null = null;
let disposeSplitPane: (() => void) | null = null;
const disposeListeners: Array<() => void> = [];

watch(source, (nextSource) => {
  nodeInteraction?.handleSourceChange();
  persistence.saveDocument(nextSource);
  previewController?.schedule(nextSource);
});

onMounted(() => {
  const workspace = requireElement<HTMLElement>("#workspace");
  const splitter = requireElement<HTMLElement>("#splitter");
  const preview = requireElement<HTMLDivElement>("#preview");
  const viewportStatus = requireElement<HTMLElement>("#viewport-status");
  const errorPanel = requireElement<HTMLDivElement>("#error-panel");
  const historyPreviewLayer = requireElement<HTMLDivElement>("#history-preview-layer");
  const historyPreviewStatus = requireElement<HTMLElement>("#history-preview-status");
  const downloadButton = requireElement<HTMLButtonElement>("#download-button");
  const visualControls = requireElement<HTMLDivElement>("#visual-controls");
  const nodeToolbar = requireElement<HTMLDivElement>("#node-toolbar");
  const undoButton = requireElement<HTMLButtonElement>("#undo-button");
  const redoButton = requireElement<HTMLButtonElement>("#redo-button");
  const addNodeButton = requireElement<HTMLButtonElement>("#add-node-button");
  const deleteNodeButton = requireElement<HTMLButtonElement>("#delete-node-button");
  const directionSelect = requireElement<HTMLSelectElement>("#direction-select");
  const shapeSelect = requireElement<HTMLSelectElement>("#shape-select");

  setButtonIcon(downloadButton, Download);
  setButtonIcon(undoButton, Undo2, 17);
  setButtonIcon(redoButton, Redo2, 17);
  setButtonIcon(addNodeButton, Plus, 17);
  setButtonIcon(deleteNodeButton, Trash2, 17);

  disposeSplitPane = createSplitPane({
    workspace,
    splitter,
    initialPercent: persistence.loadSplitPercent(),
    onPercentChange: persistence.saveSplitPercent,
  });

  nodeInteraction = createNodeInteraction({
    elements: {
      preview,
      visualControls,
      nodeToolbar,
      directionSelect,
      shapeSelect,
    },
    editor: {
      getCaretPosition: () => workspaceComponent.value?.getCaretPosition() ?? 0,
      replaceSource: (nextSource) => workspaceComponent.value?.replaceSource(nextSource),
      setSourceHighlights: (ranges) =>
        workspaceComponent.value?.setSourceHighlights(ranges),
    },
    setStatus,
  });

  viewportController = createViewportController({ preview, statusElement: viewportStatus });
  historyPreview = createHistoryPreview({
    preview,
    layer: historyPreviewLayer,
    statusElement: historyPreviewStatus,
    getCurrentSource: () => workspaceComponent.value?.getSource() ?? source.value,
    peekHistory: (direction) =>
      workspaceComponent.value?.peekHistory(direction) ?? null,
  });

  previewController = createPreviewController({
    previewElement: preview,
    errorElement: errorPanel,
    downloadButton,
    onStatusChange: setStatus,
    onRendered: ({ source: renderedSource }) => {
      canDownload.value = true;
      viewportController?.applyAfterRender();
      nodeInteraction?.configureRendered(renderedSource);
    },
    onEmpty: () => {
      canDownload.value = false;
      nodeInteraction?.clearCorrespondence();
    },
    onError: () => nodeInteraction?.clearCorrespondence(),
  });

  bindHistoryButton(undoButton, "undo");
  bindHistoryButton(redoButton, "redo");
  listen(directionSelect, "change", () => nodeInteraction?.changeDirection());
  listen(shapeSelect, "change", () => nodeInteraction?.changeSelectedShape());
  listen(addNodeButton, "click", () => nodeInteraction?.addNodeAfterSelection());
  listen(deleteNodeButton, "click", () => nodeInteraction?.deleteSelectedNode());
  listen(preview, "click", (event) => nodeInteraction?.clearNodeSelection(event));
  listen(downloadButton, "click", downloadSvg);

  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const updateTheme = (): void => {
    previewController?.updateTheme();
    previewController?.schedule(source.value, 0);
  };
  colorScheme.addEventListener("change", updateTheme);
  disposeListeners.push(() => colorScheme.removeEventListener("change", updateTheme));

  previewController.schedule(source.value, 0);
});

onBeforeUnmount(() => {
  disposeListeners.splice(0).forEach((dispose) => dispose());
  disposeSplitPane?.();
  previewController?.destroy();
  historyPreview?.dispose();
  viewportController?.dispose();
  nodeInteraction?.dispose();
});

function setStatus(nextStatus: PreviewStatus, message: string): void {
  status.value = nextStatus;
  statusMessage.value = message;
}

function handleSourceHover(position: number | null): void {
  nodeInteraction?.updateSourceHover(position);
}

function handleCaretChange(position: number): void {
  nodeInteraction?.updateCaret(position);
}

function downloadSvg(): void {
  const svg = previewController?.getLatestSvg();
  if (!svg) return;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "diagram.svg";
  anchor.click();
  URL.revokeObjectURL(url);
}

function setButtonIcon(
  button: HTMLButtonElement,
  icon: Parameters<typeof createElement>[0],
  size = 19,
): void {
  button.replaceChildren(
    createElement(icon, {
      width: size,
      height: size,
      "stroke-width": 1.8,
      "aria-hidden": "true",
    }),
  );
}

/**
 * Pointer hoverとkeyboard focusを同じPreview操作へ対応させます。
 * Click直前には予告を片付け、実行結果のrenderと重ならないようにします。
 */
function bindHistoryButton(
  button: HTMLButtonElement,
  direction: HistoryDirection,
): void {
  listen(button, "pointerenter", () => historyPreview?.show(direction));
  listen(button, "pointerleave", () => historyPreview?.hide(direction));
  listen(button, "focus", () => historyPreview?.show(direction));
  listen(button, "blur", () => historyPreview?.hide(direction));
  listen(button, "click", () => {
    historyPreview?.hide(direction);
    if (direction === "undo") workspaceComponent.value?.undo();
    else workspaceComponent.value?.redo();
  });
}

function listen<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
): void {
  element.addEventListener(type, listener);
  disposeListeners.push(() => element.removeEventListener(type, listener));
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}
</script>

<template>
  <main class="mx-auto flex h-dvh w-full max-w-[1800px] flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
    <AppHeader />
    <EditorWorkspace
      ref="workspaceComponent"
      v-model="source"
      :status="status"
      :status-message="statusMessage"
      :can-download="canDownload"
      @source-hover="handleSourceHover"
      @caret-change="handleCaretChange"
    />
  </main>
</template>
