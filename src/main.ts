import { basicSetup, EditorView } from "codemirror";
import { redo, undo } from "@codemirror/commands";
import { placeholder } from "@codemirror/view";
import {
  Check,
  Copy,
  Download,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  createElement,
} from "lucide";
import mermaid from "mermaid";
import {
  cloneFlowchart,
  nextNodeId,
  NODE_SHAPE_SEMANTICS,
  parseFlowchart,
  serializeFlowchart,
  type FlowDirection,
  type FlowchartModel,
  type NodeShape,
} from "./flowchart";
import "./style.css";

const STORAGE_KEY = "mermaid-editor:document:v2";
const SPLIT_STORAGE_KEY = "mermaid-editor:split";
const RENDER_DELAY_MS = 250;
const DEFAULT_SPLIT_PERCENT = 32;
const MIN_SPLIT_PERCENT = 18;
const MAX_SPLIT_PERCENT = 68;

type StatusState = "ready" | "rendering" | "error";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <main class="mx-auto flex h-dvh w-full max-w-[1800px] flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
    <header class="mb-3 flex min-h-11 items-center px-1 sm:mb-4">
      <div class="min-w-0">
        <h1 class="truncate text-[1.0625rem] font-semibold tracking-[-0.018em] text-[#1d1d1f] dark:text-[#f5f5f7]">
          Mermaid Editor
        </h1>
        <p class="mt-0.5 hidden text-xs text-[#6e6e73] sm:block dark:text-[#a1a1a6]">
          AIが返した謎のコードを貼るだけ。すぐ図に戻します。
        </p>
      </div>
    </header>

    <section id="workspace" class="workspace min-h-0 flex-1" aria-label="Mermaid編集領域">
      <article class="chrome relative flex min-h-0 flex-col overflow-hidden rounded-[1.15rem]">
        <div class="flex h-11 shrink-0 items-center justify-between px-4">
          <div class="flex min-w-0 items-baseline gap-2">
            <h2 class="text-[0.8125rem] font-semibold text-[#3a3a3c] dark:text-[#e5e5ea]">ここにペースト</h2>
            <span class="hidden truncate text-[0.6875rem] text-[#8e8e93] sm:inline">AIから返ってきたMermaidコード</span>
          </div>
          <span class="shrink-0 text-[0.6875rem] font-medium text-[#8e8e93]">Mermaid</span>
        </div>
        <div id="editor" class="editor-shell min-h-0 flex-1 border-t border-black/[0.045] dark:border-white/[0.06]"></div>
        <button
          id="copy-button"
          class="action-button"
          type="button"
          aria-label="コードをコピー"
          data-tooltip="コードをコピー"
          disabled
        ></button>
      </article>

      <div
        id="splitter"
        class="splitter"
        role="separator"
        aria-label="コードと図の表示割合"
        aria-orientation="horizontal"
        aria-valuemin="${MIN_SPLIT_PERCENT}"
        aria-valuemax="${MAX_SPLIT_PERCENT}"
        aria-valuenow="${DEFAULT_SPLIT_PERCENT}"
        tabindex="0"
        title="ドラッグして表示割合を変更"
      >
        <span aria-hidden="true"></span>
      </div>

      <article class="chrome relative flex min-h-0 flex-col overflow-hidden rounded-[1.15rem]">
        <div class="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
          <h2 class="text-[0.8125rem] font-semibold text-[#3a3a3c] dark:text-[#e5e5ea]">できあがった図</h2>
          <div class="flex min-w-0 items-center gap-2">
            <div id="visual-controls" class="visual-controls hidden">
              <button id="undo-button" type="button" aria-label="元に戻す" data-tooltip="元に戻す"></button>
              <button id="redo-button" type="button" aria-label="やり直す" data-tooltip="やり直す"></button>
              <label class="sr-only" for="direction-select">図の方向</label>
              <select id="direction-select" class="compact-control" title="図の方向">
                <option value="TD">上から下</option>
                <option value="LR">左から右</option>
                <option value="BT">下から上</option>
                <option value="RL">右から左</option>
              </select>
            </div>
            <div class="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
              <span id="status-dot" class="status-dot" data-state="ready" aria-hidden="true"></span>
              <span id="status-text" class="hidden truncate text-[0.6875rem] font-medium text-[#6e6e73] sm:inline dark:text-[#a1a1a6]">
                準備完了
              </span>
            </div>
          </div>
        </div>
        <div class="relative min-h-0 flex-1 border-t border-black/[0.045] dark:border-white/[0.06]">
          <div id="preview" class="preview flex h-full items-center justify-center overflow-auto p-5 sm:p-8"></div>
          <div id="node-toolbar" class="node-toolbar hidden" aria-label="選択したノードの編集">
            <label class="sr-only" for="shape-select">ノードの形</label>
            <select id="shape-select" class="compact-control" title="ノードの形">
              <option value="rectangle">処理</option>
              <option value="rounded">角丸</option>
              <option value="terminal">開始・終了</option>
              <option value="decision">判断</option>
              <option value="circle">円</option>
            </select>
            <button id="add-node-button" type="button" aria-label="次のノードを追加" data-tooltip="次を追加"></button>
            <button id="delete-node-button" type="button" class="danger" aria-label="ノードを削除" data-tooltip="削除"></button>
          </div>
          <div id="error-panel" class="absolute inset-x-3 bottom-16 hidden rounded-xl border border-red-500/15 bg-red-50/95 px-3 py-2.5 text-xs leading-relaxed text-red-700 shadow-sm backdrop-blur-md dark:bg-red-950/90 dark:text-red-200" role="alert"></div>
        </div>
        <button
          id="download-button"
          class="action-button"
          type="button"
          aria-label="図をSVGで保存"
          data-tooltip="SVGで保存"
          disabled
        ></button>
      </article>
    </section>
  </main>
`;

const editorHost = requireElement<HTMLDivElement>("#editor");
const workspace = requireElement<HTMLElement>("#workspace");
const splitter = requireElement<HTMLDivElement>("#splitter");
const preview = requireElement<HTMLDivElement>("#preview");
const errorPanel = requireElement<HTMLDivElement>("#error-panel");
const statusDot = requireElement<HTMLSpanElement>("#status-dot");
const statusText = requireElement<HTMLSpanElement>("#status-text");
const copyButton = requireElement<HTMLButtonElement>("#copy-button");
const downloadButton = requireElement<HTMLButtonElement>("#download-button");
const visualControls = requireElement<HTMLDivElement>("#visual-controls");
const nodeToolbar = requireElement<HTMLDivElement>("#node-toolbar");
const undoButton = requireElement<HTMLButtonElement>("#undo-button");
const redoButton = requireElement<HTMLButtonElement>("#redo-button");
const addNodeButton = requireElement<HTMLButtonElement>("#add-node-button");
const deleteNodeButton = requireElement<HTMLButtonElement>("#delete-node-button");
const directionSelect = requireElement<HTMLSelectElement>("#direction-select");
const shapeSelect = requireElement<HTMLSelectElement>("#shape-select");

setButtonIcon(copyButton, Copy);
setButtonIcon(downloadButton, Download);
setButtonIcon(undoButton, Undo2, 17);
setButtonIcon(redoButton, Redo2, 17);
setButtonIcon(addNodeButton, Plus, 17);
setButtonIcon(deleteNodeButton, Trash2, 17);

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral",
});

let latestSvg = "";
let renderSequence = 0;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let currentFlowchart: FlowchartModel | null = null;
let selectedNodeId: string | null = null;
let pointedNodeId: string | null = null;
let focusedNodeId: string | null = null;
let annotationPointedNodeId: string | null = null;
let tooltipPointedNodeId: string | null = null;
let annotationFocusedNodeId: string | null = null;
let pinnedTooltipNodeId: string | null = null;
let dismissedTooltipNodeId: string | null = null;
let annotationFrame: number | undefined;
let tooltipLeaveTimer: ReturnType<typeof setTimeout> | undefined;

const annotationResizeObserver = new ResizeObserver(() => {
  scheduleAnnotationLayout();
});
annotationResizeObserver.observe(preview);
preview.addEventListener("scroll", scheduleAnnotationLayout, { passive: true });
document.addEventListener("pointerdown", (event) => {
  if (!pinnedTooltipNodeId) return;
  const target = event.target as Element | null;
  if (target?.closest(`[data-editor-node-id="${CSS.escape(pinnedTooltipNodeId)}"]`)) return;
  dismissTooltip(pinnedTooltipNodeId, true);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const openNodeId = getOpenTooltipNodeId();
  if (openNodeId) dismissTooltip(openNodeId);
});

const initialDocument = localStorage.getItem(STORAGE_KEY) ?? "";
const savedSplit = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
setSplitPercent(Number.isFinite(savedSplit) && savedSplit > 0 ? savedSplit : DEFAULT_SPLIT_PERCENT);

const editor = new EditorView({
  doc: initialDocument,
  parent: editorHost,
  extensions: [
    basicSetup,
    placeholder("ここにAIから返ってきたコードをペースト"),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      "aria-label": "Mermaidコード",
      "aria-multiline": "true",
      spellcheck: "false",
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;

      const source = update.state.doc.toString();
      localStorage.setItem(STORAGE_KEY, source);
      copyButton.disabled = !source.trim();
      scheduleRender(source);
    }),
  ],
});

copyButton.disabled = !initialDocument.trim();
copyButton.addEventListener("click", () => {
  void copySource();
});

downloadButton.addEventListener("click", downloadSvg);
undoButton.addEventListener("click", () => undo(editor));
redoButton.addEventListener("click", () => redo(editor));
directionSelect.addEventListener("change", changeDirection);
shapeSelect.addEventListener("change", changeSelectedShape);
addNodeButton.addEventListener("click", addNodeAfterSelection);
deleteNodeButton.addEventListener("click", deleteSelectedNode);
splitter.addEventListener("pointerdown", startResize);
splitter.addEventListener("keydown", resizeWithKeyboard);
splitter.addEventListener("dblclick", () => setSplitPercent(DEFAULT_SPLIT_PERCENT));
preview.addEventListener("click", clearNodeSelection);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral",
  });
  scheduleRender(editor.state.doc.toString(), 0);
});

scheduleRender(initialDocument, 0);

function scheduleRender(source: string, delay = RENDER_DELAY_MS): void {
  if (renderTimer !== undefined) clearTimeout(renderTimer);

  if (!source.trim()) {
    ++renderSequence;
    latestSvg = "";
    downloadButton.disabled = true;
    showEmptyPreview();
    errorPanel.replaceChildren();
    errorPanel.classList.add("hidden");
    setStatus("ready", "コードを待っています");
    return;
  }

  setStatus("rendering", "描画中…");
  renderTimer = setTimeout(() => {
    void renderDiagram(source);
  }, delay);
}

async function renderDiagram(source: string): Promise<void> {
  const sequence = ++renderSequence;

  try {
    await mermaid.parse(source, { suppressErrors: false });
    const { svg, bindFunctions } = await mermaid.render(`diagram-${sequence}`, source);

    if (sequence !== renderSequence) return;

    latestSvg = svg;
    downloadButton.disabled = false;
    preview.innerHTML = svg;
    bindFunctions?.(preview);
    configureVisualEditing(source);
    errorPanel.replaceChildren();
    errorPanel.classList.add("hidden");
    setStatus("ready", "保存済み");
  } catch (error: unknown) {
    if (sequence !== renderSequence) return;

    errorPanel.textContent = readableError(error);
    errorPanel.classList.remove("hidden");
    setStatus("error", "構文を確認してください");
  }
}

function configureVisualEditing(source: string): void {
  const result = parseFlowchart(source);
  currentFlowchart = result.model;
  visualControls.classList.toggle("hidden", !currentFlowchart);

  if (!currentFlowchart) {
    selectedNodeId = null;
    nodeToolbar.classList.add("hidden");
    setStatus("ready", result.reason ?? "表示できました");
    return;
  }
  const model = currentFlowchart;
  pointedNodeId = null;
  focusedNodeId = null;
  annotationPointedNodeId = null;
  tooltipPointedNodeId = null;
  annotationFocusedNodeId = null;
  pinnedTooltipNodeId = null;
  dismissedTooltipNodeId = null;
  cancelTooltipLeave();

  const annotationLayer = document.createElement("div");
  annotationLayer.className = "node-annotation-layer";
  preview.append(annotationLayer);

  directionSelect.value = model.direction;
  const nodeElements = preview.querySelectorAll<SVGGElement>("g.node");
  nodeElements.forEach((nodeElement) => {
    const nodeId = getRenderedNodeId(nodeElement, model);
    if (!nodeId) return;

    nodeElement.dataset.editorNodeId = nodeId;
    nodeElement.classList.add("visual-editable");
    nodeElement.tabIndex = 0;
    nodeElement.setAttribute("role", "button");
    const node = model.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const semantics = NODE_SHAPE_SEMANTICS[node.shape];
    nodeElement.setAttribute(
      "aria-label",
      `${node.label}を編集。${semantics.accessibleDescription}`,
    );
    const annotation = document.createElement("button");
    annotation.type = "button";
    annotation.className = "node-shape-annotation";
    annotation.dataset.editorNodeId = nodeId;
    annotation.textContent = semantics.shortLabel;
    annotation.setAttribute("aria-label", `${semantics.shortLabel}の意味を確認`);
    annotation.setAttribute("aria-expanded", "false");
    annotationLayer.append(annotation);
    const tooltip = document.createElement("div");
    tooltip.id = `node-shape-tooltip-${sequenceSafeId(nodeId)}`;
    tooltip.className = "node-shape-tooltip";
    tooltip.dataset.editorNodeId = nodeId;
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    const tooltipTitle = document.createElement("strong");
    tooltipTitle.textContent = semantics.shortLabel;
    const tooltipDescription = document.createElement("span");
    tooltipDescription.textContent = semantics.detailDescription;
    tooltip.append(tooltipTitle, tooltipDescription);
    annotation.setAttribute("aria-describedby", tooltip.id);
    annotationLayer.append(tooltip);
    let annotationPointerType = "";
    annotation.addEventListener("pointerdown", (event) => {
      annotationPointerType = event.pointerType;
      event.stopPropagation();
    });
    annotation.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      cancelTooltipLeave();
      if (dismissedTooltipNodeId === nodeId) dismissedTooltipNodeId = null;
      tooltipPointedNodeId = null;
      annotationPointedNodeId = nodeId;
      updateNodeEmphasis();
    });
    annotation.addEventListener("pointerleave", () => {
      scheduleTooltipLeave(nodeId, "annotation");
    });
    annotation.addEventListener("focus", () => {
      if (dismissedTooltipNodeId === nodeId) dismissedTooltipNodeId = null;
      annotationFocusedNodeId = nodeId;
      updateNodeEmphasis();
    });
    annotation.addEventListener("blur", () => {
      if (annotationFocusedNodeId === nodeId) annotationFocusedNodeId = null;
      updateNodeEmphasis();
    });
    annotation.addEventListener("click", (event) => {
      event.stopPropagation();
      const isKeyboardActivation = annotationPointerType === "";
      const shouldToggle = annotationPointerType === "touch" || isKeyboardActivation;
      annotationPointerType = "";
      if (!shouldToggle) return;
      if (pinnedTooltipNodeId === nodeId) {
        dismissTooltip(nodeId, true);
        return;
      }
      dismissedTooltipNodeId = null;
      pinnedTooltipNodeId = nodeId;
      updateNodeEmphasis();
    });
    annotation.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismissTooltip(nodeId);
      }
    });
    tooltip.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      cancelTooltipLeave();
      annotationPointedNodeId = null;
      tooltipPointedNodeId = nodeId;
      updateNodeEmphasis();
    });
    tooltip.addEventListener("pointerleave", () => {
      scheduleTooltipLeave(nodeId, "tooltip");
    });
    nodeElement.addEventListener("pointerenter", (event) => {
      if ((event.pointerType !== "mouse" && event.pointerType !== "pen") || event.buttons !== 0) {
        return;
      }
      pointedNodeId = nodeId;
      updateNodeEmphasis();
    });
    nodeElement.addEventListener("pointerleave", () => {
      if (pointedNodeId === nodeId) pointedNodeId = null;
      updateNodeEmphasis();
    });
    nodeElement.addEventListener("pointercancel", () => {
      if (pointedNodeId === nodeId) pointedNodeId = null;
      updateNodeEmphasis();
    });
    nodeElement.addEventListener("focus", () => {
      focusedNodeId = nodeId;
      updateNodeEmphasis();
    });
    nodeElement.addEventListener("blur", () => {
      if (focusedNodeId === nodeId) focusedNodeId = null;
      updateNodeEmphasis();
    });
    nodeElement.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(nodeId);
    });
    nodeElement.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      openLabelEditor(nodeId, nodeElement);
    });
    nodeElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openLabelEditor(nodeId, nodeElement);
      if (event.key === "Delete" || event.key === "Backspace") {
        selectNode(nodeId);
        deleteSelectedNode();
      }
    });
  });
  scheduleAnnotationLayout();

  if (selectedNodeId && currentFlowchart.nodes.some((node) => node.id === selectedNodeId)) {
    selectNode(selectedNodeId);
  } else {
    selectedNodeId = null;
    nodeToolbar.classList.add("hidden");
  }
  setStatus("ready", "図をクリックして編集");
}

function updateNodeEmphasis(): void {
  const openTooltipNodeId = getOpenTooltipNodeId();
  const emphasizedNodeId =
    pinnedTooltipNodeId ??
    openTooltipNodeId ??
    annotationPointedNodeId ??
    tooltipPointedNodeId ??
    pointedNodeId ??
    focusedNodeId;

  preview.querySelectorAll<HTMLElement>("[data-editor-node-id]").forEach((element) => {
    element.classList.toggle(
      "is-emphasized",
      emphasizedNodeId !== null && element.dataset.editorNodeId === emphasizedNodeId,
    );
  });
  preview.querySelectorAll<HTMLButtonElement>(".node-shape-annotation").forEach((annotation) => {
    const nodeId = annotation.dataset.editorNodeId;
    const isOpen = nodeId === openTooltipNodeId;
    const tooltip = nodeId
      ? preview.querySelector<HTMLElement>(`#node-shape-tooltip-${sequenceSafeId(nodeId)}`)
      : null;
    annotation.setAttribute("aria-expanded", String(isOpen));
    if (tooltip) tooltip.hidden = !isOpen;
  });
  scheduleAnnotationLayout();
}

function getOpenTooltipNodeId(): string | null {
  const candidate =
    pinnedTooltipNodeId ??
    annotationPointedNodeId ??
    tooltipPointedNodeId ??
    annotationFocusedNodeId;
  return candidate === dismissedTooltipNodeId ? null : candidate;
}

function dismissTooltip(nodeId: string, blurTrigger = false): void {
  pinnedTooltipNodeId = null;
  dismissedTooltipNodeId = nodeId;
  annotationFocusedNodeId = null;
  const trigger = preview.querySelector<HTMLButtonElement>(
    `.node-shape-annotation[data-editor-node-id="${CSS.escape(nodeId)}"]`,
  );
  if (blurTrigger && trigger && document.activeElement === trigger) trigger.blur();
  updateNodeEmphasis();
}

function cancelTooltipLeave(): void {
  if (tooltipLeaveTimer === undefined) return;
  clearTimeout(tooltipLeaveTimer);
  tooltipLeaveTimer = undefined;
}

function scheduleTooltipLeave(nodeId: string, source: "annotation" | "tooltip"): void {
  cancelTooltipLeave();
  tooltipLeaveTimer = setTimeout(() => {
    tooltipLeaveTimer = undefined;
    if (source === "annotation" && annotationPointedNodeId === nodeId) {
      annotationPointedNodeId = null;
    }
    if (source === "tooltip" && tooltipPointedNodeId === nodeId) {
      tooltipPointedNodeId = null;
    }
    if (
      dismissedTooltipNodeId === nodeId &&
      annotationPointedNodeId !== nodeId &&
      tooltipPointedNodeId !== nodeId
    ) {
      dismissedTooltipNodeId = null;
    }
    updateNodeEmphasis();
  }, 140);
}

function scheduleAnnotationLayout(): void {
  if (annotationFrame !== undefined) cancelAnimationFrame(annotationFrame);
  annotationFrame = requestAnimationFrame(() => {
    annotationFrame = undefined;
    layoutNodeAnnotations();
  });
}

function layoutNodeAnnotations(): void {
  const layer = preview.querySelector<HTMLElement>(".node-annotation-layer");
  if (!layer) return;

  const previewBounds = preview.getBoundingClientRect();
  layer.querySelectorAll<HTMLElement>(".node-shape-annotation").forEach((annotation) => {
    const nodeId = annotation.dataset.editorNodeId;
    const nodeElement = [...preview.querySelectorAll<SVGGElement>("g.node.visual-editable")].find(
      (element) => element.dataset.editorNodeId === nodeId,
    );
    if (!nodeElement) return;

    const nodeBounds = nodeElement.getBoundingClientRect();
    annotation.style.left = `${nodeBounds.right - previewBounds.left + preview.scrollLeft}px`;
    annotation.style.top = `${nodeBounds.bottom - previewBounds.top + preview.scrollTop}px`;
    const tooltip = nodeId
      ? layer.querySelector<HTMLElement>(`#node-shape-tooltip-${sequenceSafeId(nodeId)}`)
      : null;
    if (!tooltip) return;
    if (tooltip.hidden) return;
    const tooltipBounds = tooltip.getBoundingClientRect();
    const gap = 8;
    const viewportPadding = 8;
    const annotationBounds = annotation.getBoundingClientRect();
    const minLeft = preview.scrollLeft + viewportPadding;
    const maxLeft =
      preview.scrollLeft + preview.clientWidth - tooltipBounds.width - viewportPadding;
    const preferredLeft =
      annotationBounds.right - previewBounds.left + preview.scrollLeft - tooltipBounds.width * 0.82;
    const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));
    const spaceAbove = annotationBounds.top - previewBounds.top;
    const preferredTop =
      spaceAbove >= tooltipBounds.height + gap
        ? annotationBounds.top -
          previewBounds.top +
          preview.scrollTop -
          tooltipBounds.height -
          gap
        : annotationBounds.bottom - previewBounds.top + preview.scrollTop + gap;
    const minTop = preview.scrollTop + viewportPadding;
    const maxTop =
      preview.scrollTop + preview.clientHeight - tooltipBounds.height - viewportPadding;
    const top = Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });
}

function sequenceSafeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}

function selectNode(nodeId: string): void {
  selectedNodeId = nodeId;
  preview.querySelectorAll(".node.is-selected").forEach((element) => element.classList.remove("is-selected"));
  const selected = [...preview.querySelectorAll<SVGGElement>("g.node.visual-editable")].find(
    (element) => element.dataset.editorNodeId === nodeId,
  );
  selected?.classList.add("is-selected");

  const node = currentFlowchart?.nodes.find((candidate) => candidate.id === nodeId);
  if (node) shapeSelect.value = node.shape;
  nodeToolbar.classList.toggle("hidden", !node);
}

function clearNodeSelection(event: Event): void {
  if ((event.target as Element | null)?.closest(".visual-editable, .node-toolbar")) return;
  selectedNodeId = null;
  nodeToolbar.classList.add("hidden");
  preview.querySelectorAll(".node.is-selected").forEach((element) => element.classList.remove("is-selected"));
}

function openLabelEditor(nodeId: string, nodeElement: SVGGElement): void {
  const node = currentFlowchart?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;

  document.querySelector(".node-label-editor")?.remove();
  const bounds = nodeElement.getBoundingClientRect();
  const input = document.createElement("input");
  input.className = "node-label-editor";
  input.value = node.label;
  input.setAttribute("aria-label", "ノードの名前");
  input.style.left = `${bounds.left + bounds.width / 2}px`;
  input.style.top = `${bounds.top + bounds.height / 2}px`;
  document.body.append(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save: boolean): void => {
    if (finished) return;
    finished = true;
    const nextLabel = input.value.trim();
    input.remove();
    if (save && nextLabel && nextLabel !== node.label) {
      updateFlowchart((model) => {
        const target = model.nodes.find((candidate) => candidate.id === nodeId);
        if (target) target.label = nextLabel;
      });
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function changeDirection(): void {
  updateFlowchart((model) => {
    model.direction = directionSelect.value as FlowDirection;
  });
}

function changeSelectedShape(): void {
  if (!selectedNodeId) return;
  updateFlowchart((model) => {
    const node = model.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (node) node.shape = shapeSelect.value as NodeShape;
  });
}

function addNodeAfterSelection(): void {
  if (!selectedNodeId || !currentFlowchart) return;
  const newId = nextNodeId(currentFlowchart);
  updateFlowchart((model) => {
    const selectedIndex = model.nodes.findIndex((node) => node.id === selectedNodeId);
    model.nodes.splice(selectedIndex + 1, 0, {
      id: newId,
      label: "新しいステップ",
      shape: "rectangle",
    });
    model.edges.push({ from: selectedNodeId!, to: newId, label: "", connector: "-->" });
  });
  selectedNodeId = newId;
}

function deleteSelectedNode(): void {
  if (!selectedNodeId || !currentFlowchart) return;
  if (currentFlowchart.nodes.length <= 1) {
    setStatus("error", "最後のノードは削除できません");
    return;
  }
  const nodeId = selectedNodeId;
  selectedNodeId = null;
  updateFlowchart((model) => {
    model.nodes = model.nodes.filter((node) => node.id !== nodeId);
    model.edges = model.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  });
}

function updateFlowchart(change: (model: FlowchartModel) => void): void {
  if (!currentFlowchart) return;
  const next = cloneFlowchart(currentFlowchart);
  change(next);
  const source = serializeFlowchart(next);
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: source },
    selection: { anchor: 0 },
  });
}

async function copySource(): Promise<void> {
  try {
    await navigator.clipboard.writeText(editor.state.doc.toString());
    setButtonIcon(copyButton, Check);
    copyButton.dataset.tooltip = "コピーしました";
    copyButton.classList.add("is-success");
  } catch {
    copyButton.dataset.tooltip = "コピーできませんでした";
  }

  window.setTimeout(() => {
    setButtonIcon(copyButton, Copy);
    copyButton.dataset.tooltip = "コードをコピー";
    copyButton.classList.remove("is-success");
  }, 1200);
}

function downloadSvg(): void {
  if (!latestSvg) return;

  const blob = new Blob([latestSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "diagram.svg";
  anchor.click();
  URL.revokeObjectURL(url);
}

function startResize(event: PointerEvent): void {
  event.preventDefault();
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("is-resizing");

  const updateFromPointer = (moveEvent: PointerEvent): void => {
    const bounds = workspace.getBoundingClientRect();
    const percent = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
    setSplitPercent(percent);
  };

  const stopResize = (): void => {
    document.body.classList.remove("is-resizing");
    splitter.removeEventListener("pointermove", updateFromPointer);
    splitter.removeEventListener("pointerup", stopResize);
    splitter.removeEventListener("pointercancel", stopResize);
  };

  splitter.addEventListener("pointermove", updateFromPointer);
  splitter.addEventListener("pointerup", stopResize);
  splitter.addEventListener("pointercancel", stopResize);
}

function resizeWithKeyboard(event: KeyboardEvent): void {
  const current = Number(splitter.getAttribute("aria-valuenow")) || DEFAULT_SPLIT_PERCENT;
  const step = event.shiftKey ? 10 : 2;
  let next = current;

  if (event.key === "ArrowUp") next -= step;
  else if (event.key === "ArrowDown") next += step;
  else if (event.key === "Home") next = MIN_SPLIT_PERCENT;
  else if (event.key === "End") next = MAX_SPLIT_PERCENT;
  else return;

  event.preventDefault();
  setSplitPercent(next);
}

function setSplitPercent(percent: number): void {
  const clamped = Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, percent));
  workspace.style.setProperty("--editor-height", `${clamped}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
  localStorage.setItem(SPLIT_STORAGE_KEY, String(clamped));
}

function showEmptyPreview(): void {
  preview.innerHTML = `
    <div class="empty-preview">
      <div class="empty-preview-icon" aria-hidden="true">&lt;/&gt;</div>
      <p>コードを貼ると、ここに図が表示されます</p>
      <span>ChatGPTなどの回答にある <strong>mermaid</strong> のコード部分をコピーしてください</span>
    </div>
  `;
}

function setStatus(state: StatusState, message: string): void {
  statusDot.dataset.state = state;
  statusText.textContent = message;
}

function getRenderedNodeId(element: SVGGElement, model: FlowchartModel): string | null {
  const explicitId = element.dataset.id;
  if (explicitId && model.nodes.some((node) => node.id === explicitId)) return explicitId;

  const matchingNode = model.nodes.find((node) => element.id.includes(`-flowchart-${node.id}-`));
  return matchingNode?.id ?? null;
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

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n").slice(0, 3).join(" ");
  }

  return "Mermaid構文を解析できませんでした。";
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}
