import {
  cloneFlowchart,
  getNodeSourceRanges,
  nextNodeId,
  NODE_SHAPE_SEMANTICS,
  parseFlowchart,
  serializeFlowchart,
  type FlowDirection,
  type FlowchartModel,
  type NodeShape,
  type NodeSourceRangeMap,
  type SourceRange,
} from "./flowchart";

/**
 * 図上のNode操作がcode editorに依頼できる操作です。
 *
 * この小さなinterfaceがmoduleの境界になります。このmoduleはFlowchart Nodeを
 * 理解しますが、code editorの実装がCodeMirrorであることは知りません。
 * 将来別のeditorへ交換するときも、この3操作を実装するadapterだけを用意すれば
 * Node操作側を変更せずに済みます。
 */
export interface NodeInteractionEditor {
  /** Mermaid source先頭から数えた現在のcursor位置を返します。 */
  getCaretPosition(): number;
  /** undo/redo履歴を保てるよう、1回のeditor transactionでsourceを置換します。 */
  replaceSource(source: string): void;
  /** 操作中のpreview Nodeに対応するsource範囲を強調表示します。 */
  setSourceHighlights(ranges: readonly SourceRange[]): void;
}

/**
 * Node操作が表示を更新するDOM elementです。
 *
 * element自体は`main.ts`が用意し、このcontrollerは受け取ったelementだけを
 * 操作します。これにより画面全体の生成とNode固有の挙動を分離しています。
 */
export interface NodeInteractionElements {
  preview: HTMLDivElement;
  visualControls: HTMLDivElement;
  nodeToolbar: HTMLDivElement;
  directionSelect: HTMLSelectElement;
  shapeSelect: HTMLSelectElement;
}

/** Applicationのcomposition rootである`main.ts`から受け取る依存関係です。 */
export interface NodeInteractionOptions {
  elements: NodeInteractionElements;
  editor: NodeInteractionEditor;
  /** status UIそのものを所有せず、操作結果の案内だけを通知します。 */
  setStatus(state: "ready" | "error", message: string): void;
}

/**
 * 図上の編集とsource correspondence機能を外部から操作するためのAPIです。
 *
 * controllerはselection、hover/focus correspondence、Annotation、Tooltipの
 * stateを所有します。`main.ts`はそれらの値や変更規則を持たず、Mermaidと
 * source editorから届くlifecycle eventをこのAPIへ渡すだけです。
 */
export interface NodeInteractionController {
  /** 新しくrenderされたMermaid SVGへ操作機能を付け、source modelを解析します。 */
  configureRendered(source: string): void;
  /** source code上でpointerが移動したとき、対応するpreview Nodeを更新します。 */
  updateSourceHover(position: number | null): void;
  /** sourceのcursorが移動したとき、対応するpreview Nodeを更新します。 */
  updateCaret(position: number): void;
  /** document変更直後に古くなったsource rangeを無効化します。 */
  handleSourceChange(): void;
  /** 空入力やrender失敗後に、sourceとNodeの対応stateをすべて消去します。 */
  clearCorrespondence(): void;
  /** select elementで選ばれたFlowchartの方向をmodelへ反映します。 */
  changeDirection(): void;
  /** 選択された形を、現在選択中のNodeへ反映します。 */
  changeSelectedShape(): void;
  /** 選択中のNodeの直後へ新しいNodeを追加します。 */
  addNodeAfterSelection(): void;
  /** 他のNodeが1つ以上残る場合に、選択中のNodeを削除します。 */
  deleteSelectedNode(): void;
  /** preview背景がclickされたとき、Node selectionを解除します。 */
  clearNodeSelection(event: Event): void;
  /** observerとdocument-level event listenerを解除します。 */
  dispose(): void;
}

/**
 * Node interaction機能を生成します。
 *
 * stateは意図的にこのclosure内だけで所有します。別moduleから直接書き換えられ
 * ないため、「古いrenderの選択Node」と「新しいdocumentのsource range」が
 * 同時に存在するような矛盾した組み合わせを防げます。
 */
export function createNodeInteraction(options: NodeInteractionOptions): NodeInteractionController {
  const { preview, visualControls, nodeToolbar, directionSelect, shapeSelect } = options.elements;
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
  let nodeSourceRanges: NodeSourceRangeMap | null = null;
  let sourceHoveredNodeId: string | null = null;
  let sourceCaretNodeId: string | null = null;

  const resizeObserver = new ResizeObserver(scheduleAnnotationLayout);
  resizeObserver.observe(preview);
  preview.addEventListener("scroll", scheduleAnnotationLayout, { passive: true });
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);

  function configureRendered(source: string): void {
    const result = parseFlowchart(source);
    nodeSourceRanges = getNodeSourceRanges(source);
    sourceHoveredNodeId = null;
    sourceCaretNodeId = null;
    currentFlowchart = result.model;
    visualControls.classList.toggle("hidden", !currentFlowchart);
    if (!currentFlowchart) {
      clearCorrespondence();
      selectedNodeId = null;
      nodeToolbar.classList.add("hidden");
      options.setStatus("ready", result.reason ?? "表示できました");
      return;
    }
    const model = currentFlowchart;
    pointedNodeId = focusedNodeId = annotationPointedNodeId = tooltipPointedNodeId = null;
    annotationFocusedNodeId = pinnedTooltipNodeId = dismissedTooltipNodeId = null;
    cancelTooltipLeave();
    const layer = document.createElement("div");
    layer.className = "node-annotation-layer";
    preview.append(layer);
    directionSelect.value = model.direction;

    preview.querySelectorAll<SVGGElement>("g.node").forEach((nodeElement) => {
      const nodeId = getRenderedNodeId(nodeElement, model);
      const node = nodeId ? model.nodes.find((candidate) => candidate.id === nodeId) : null;
      if (!nodeId || !node) return;
      nodeElement.dataset.editorNodeId = nodeId;
      nodeElement.classList.add("visual-editable");
      nodeElement.tabIndex = 0;
      nodeElement.setAttribute("role", "button");
      const semantics = NODE_SHAPE_SEMANTICS[node.shape];
      nodeElement.setAttribute("aria-label", `${node.label}を編集。${semantics.accessibleDescription}`);
      const annotation = document.createElement("button");
      annotation.type = "button";
      annotation.className = "node-shape-annotation";
      annotation.dataset.editorNodeId = nodeId;
      annotation.textContent = semantics.shortLabel;
      annotation.setAttribute("aria-label", `${semantics.shortLabel}の意味を確認`);
      annotation.setAttribute("aria-expanded", "false");
      layer.append(annotation);
      const tooltip = document.createElement("div");
      tooltip.id = `node-shape-tooltip-${sequenceSafeId(nodeId)}`;
      tooltip.className = "node-shape-tooltip";
      tooltip.dataset.editorNodeId = nodeId;
      tooltip.setAttribute("role", "tooltip");
      tooltip.hidden = true;
      const title = document.createElement("strong");
      title.textContent = semantics.shortLabel;
      const description = document.createElement("span");
      description.textContent = semantics.detailDescription;
      tooltip.append(title, description);
      annotation.setAttribute("aria-describedby", tooltip.id);
      layer.append(tooltip);
      bindAnnotation(annotation, tooltip, nodeId);
      bindNode(nodeElement, nodeId);
    });
    updateCaret(options.editor.getCaretPosition());
    scheduleAnnotationLayout();
    if (selectedNodeId && model.nodes.some((node) => node.id === selectedNodeId)) selectNode(selectedNodeId);
    else {
      selectedNodeId = null;
      nodeToolbar.classList.add("hidden");
    }
    options.setStatus("ready", "図をクリックして編集");
  }

  function bindAnnotation(annotation: HTMLButtonElement, tooltip: HTMLDivElement, nodeId: string): void {
    let pointerType = "";
    annotation.addEventListener("pointerdown", (event) => {
      pointerType = event.pointerType;
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
    annotation.addEventListener("pointerleave", () => scheduleTooltipLeave(nodeId, "annotation"));
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
      const shouldToggle = pointerType === "touch" || pointerType === "";
      pointerType = "";
      if (!shouldToggle) return;
      if (pinnedTooltipNodeId === nodeId) return dismissTooltip(nodeId, true);
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
    tooltip.addEventListener("pointerleave", () => scheduleTooltipLeave(nodeId, "tooltip"));
  }

  function bindNode(element: SVGGElement, nodeId: string): void {
    element.addEventListener("pointerenter", (event) => {
      if ((event.pointerType !== "mouse" && event.pointerType !== "pen") || event.buttons !== 0) return;
      pointedNodeId = nodeId;
      updateNodeEmphasis();
      updateCorrespondence();
    });
    const leave = (): void => {
      if (pointedNodeId === nodeId) pointedNodeId = null;
      updateNodeEmphasis();
      updateCorrespondence();
    };
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointercancel", leave);
    element.addEventListener("focus", () => {
      focusedNodeId = nodeId;
      updateNodeEmphasis();
      updateCorrespondence();
    });
    element.addEventListener("blur", () => {
      if (focusedNodeId === nodeId) focusedNodeId = null;
      updateNodeEmphasis();
      updateCorrespondence();
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(nodeId);
    });
    element.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      openLabelEditor(nodeId, element);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openLabelEditor(nodeId, element);
      if (event.key === "Delete" || event.key === "Backspace") {
        selectNode(nodeId);
        deleteSelectedNode();
      }
    });
  }

  function updateNodeEmphasis(): void {
    const open = getOpenTooltipNodeId();
    const emphasized =
      pinnedTooltipNodeId ??
      open ??
      annotationPointedNodeId ??
      tooltipPointedNodeId ??
      pointedNodeId ??
      focusedNodeId;
    preview.querySelectorAll<HTMLElement>("[data-editor-node-id]").forEach((element) => {
      element.classList.toggle(
        "is-emphasized",
        emphasized !== null && element.dataset.editorNodeId === emphasized,
      );
    });
    preview.querySelectorAll<HTMLButtonElement>(".node-shape-annotation").forEach((annotation) => {
      const nodeId = annotation.dataset.editorNodeId;
      const isOpen = nodeId === open;
      const tooltip = nodeId
        ? preview.querySelector<HTMLElement>(`#node-shape-tooltip-${sequenceSafeId(nodeId)}`)
        : null;
      annotation.setAttribute("aria-expanded", String(isOpen));
      if (tooltip) tooltip.hidden = !isOpen;
    });
    scheduleAnnotationLayout();
  }

  function updateSourceHover(position: number | null): void {
    const next = position === null ? null : findNodeIdAtPosition(position);
    if (sourceHoveredNodeId === next) return;
    sourceHoveredNodeId = next;
    updateCorrespondence();
  }
  function updateCaret(position: number): void {
    const next = findNodeIdAtPosition(position);
    if (sourceCaretNodeId !== next) sourceCaretNodeId = next;
    updateCorrespondence();
  }
  function findNodeIdAtPosition(position: number): string | null {
    if (!nodeSourceRanges) return null;
    for (const [nodeId, occurrences] of Object.entries(nodeSourceRanges))
      if (occurrences?.some(({ from, to }) => position >= from && position < to)) return nodeId;
    return null;
  }
  function updateCorrespondence(): void {
    const previewId = pointedNodeId ?? focusedNodeId;
    const sourceId = sourceHoveredNodeId ?? sourceCaretNodeId;
    const activeId = previewId ?? sourceId;
    options.editor.setSourceHighlights(activeId ? (nodeSourceRanges?.[activeId] ?? []) : []);
    preview.querySelectorAll<SVGGElement>("g.node.visual-editable").forEach((node) => {
      node.classList.toggle(
        "is-source-corresponding",
        previewId === null &&
          sourceId !== null &&
          node.dataset.editorNodeId === sourceId,
      );
    });
  }
  function clearCorrespondence(): void {
    nodeSourceRanges = null;
    sourceHoveredNodeId = sourceCaretNodeId = pointedNodeId = focusedNodeId = null;
    updateCorrespondence();
  }
  function handleSourceChange(): void {
    nodeSourceRanges = null;
    sourceHoveredNodeId = sourceCaretNodeId = null;
    queueMicrotask(updateCorrespondence);
  }
  function getOpenTooltipNodeId(): string | null {
    const candidate =
      pinnedTooltipNodeId ??
      annotationPointedNodeId ??
      tooltipPointedNodeId ??
      annotationFocusedNodeId;
    return candidate === dismissedTooltipNodeId ? null : candidate;
  }
  function dismissTooltip(nodeId: string, blur = false): void {
    pinnedTooltipNodeId = null;
    dismissedTooltipNodeId = nodeId;
    annotationFocusedNodeId = null;
    const trigger = preview.querySelector<HTMLButtonElement>(
      `.node-shape-annotation[data-editor-node-id="${CSS.escape(nodeId)}"]`,
    );
    if (blur && trigger && document.activeElement === trigger) trigger.blur();
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
      if (source === "annotation" && annotationPointedNodeId === nodeId) annotationPointedNodeId = null;
      if (source === "tooltip" && tooltipPointedNodeId === nodeId) tooltipPointedNodeId = null;
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
      const node = [...preview.querySelectorAll<SVGGElement>("g.node.visual-editable")].find(
        (item) => item.dataset.editorNodeId === nodeId,
      );
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      annotation.style.left = `${bounds.right - previewBounds.left + preview.scrollLeft}px`;
      annotation.style.top = `${bounds.bottom - previewBounds.top + preview.scrollTop}px`;
      const tooltip = nodeId
        ? layer.querySelector<HTMLElement>(`#node-shape-tooltip-${sequenceSafeId(nodeId)}`)
        : null;
      if (!tooltip || tooltip.hidden) return;
      const tooltipBounds = tooltip.getBoundingClientRect();
      const annotationBounds = annotation.getBoundingClientRect();
      const padding = 8, gap = 8;
      const minLeft = preview.scrollLeft + padding;
      const maxLeft = preview.scrollLeft + preview.clientWidth - tooltipBounds.width - padding;
      const preferredLeft =
        annotationBounds.right -
        previewBounds.left +
        preview.scrollLeft -
        tooltipBounds.width * 0.82;
      const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));
      const above = annotationBounds.top - previewBounds.top;
      const preferredTop = above >= tooltipBounds.height + gap
        ? annotationBounds.top - previewBounds.top + preview.scrollTop - tooltipBounds.height - gap
        : annotationBounds.bottom - previewBounds.top + preview.scrollTop + gap;
      const minTop = preview.scrollTop + padding;
      const maxTop = preview.scrollTop + preview.clientHeight - tooltipBounds.height - padding;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop))}px`;
    });
  }
  function selectNode(nodeId: string): void {
    selectedNodeId = nodeId;
    preview
      .querySelectorAll(".node.is-selected")
      .forEach((element) => element.classList.remove("is-selected"));
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
    preview
      .querySelectorAll(".node.is-selected")
      .forEach((element) => element.classList.remove("is-selected"));
  }
  function openLabelEditor(nodeId: string, element: SVGGElement): void {
    const node = currentFlowchart?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    document.querySelector(".node-label-editor")?.remove();
    const bounds = element.getBoundingClientRect();
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
      const label = input.value.trim();
      input.remove();
      if (save && label && label !== node.label) updateFlowchart((model) => {
        const target = model.nodes.find((candidate) => candidate.id === nodeId);
        if (target) target.label = label;
      });
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
      const index = model.nodes.findIndex((node) => node.id === selectedNodeId);
      model.nodes.splice(index + 1, 0, { id: newId, label: "新しいステップ", shape: "rectangle" });
      model.edges.push({ from: selectedNodeId!, to: newId, label: "", connector: "-->" });
    });
    selectedNodeId = newId;
  }
  function deleteSelectedNode(): void {
    if (!selectedNodeId || !currentFlowchart) return;
    if (currentFlowchart.nodes.length <= 1) return options.setStatus("error", "最後のノードは削除できません");
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
    options.editor.replaceSource(serializeFlowchart(next));
  }
  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!pinnedTooltipNodeId) return;
    const target = event.target as Element | null;
    if (!target?.closest(`[data-editor-node-id="${CSS.escape(pinnedTooltipNodeId)}"]`)) {
      dismissTooltip(pinnedTooltipNodeId, true);
    }
  }
  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    const open = getOpenTooltipNodeId();
    if (open) dismissTooltip(open);
  }
  function dispose(): void {
    resizeObserver.disconnect();
    preview.removeEventListener("scroll", scheduleAnnotationLayout);
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
    cancelTooltipLeave();
    if (annotationFrame !== undefined) cancelAnimationFrame(annotationFrame);
  }

  return {
    configureRendered, updateSourceHover, updateCaret, handleSourceChange,
    clearCorrespondence, changeDirection, changeSelectedShape, addNodeAfterSelection,
    deleteSelectedNode, clearNodeSelection, dispose,
  };
}

function getRenderedNodeId(element: SVGGElement, model: FlowchartModel): string | null {
  const explicitId = element.dataset.id;
  if (explicitId && model.nodes.some((node) => node.id === explicitId)) return explicitId;
  return model.nodes.find((node) => element.id.includes(`-flowchart-${node.id}-`))?.id ?? null;
}

function sequenceSafeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}
