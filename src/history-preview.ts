import mermaid from "mermaid";
import { parseFlowchart, type FlowchartModel } from "./flowchart";

export type HistoryDirection = "undo" | "redo";

export interface HistoryPreviewOptions {
  preview: HTMLElement;
  layer: HTMLElement;
  statusElement: HTMLElement;
  getCurrentSource(): string;
  peekHistory(direction: HistoryDirection): string | null;
}

export interface HistoryPreviewController {
  show(direction: HistoryDirection): void;
  hide(direction?: HistoryDirection): void;
  dispose(): void;
}

/**
 * Undo / Redoを実行せず、次のhistory stateとの差分だけを図へ重ねます。
 *
 * 現在存在する要素は実SVGを強調し、次のstateだけに存在する要素はMermaidで
 * 別SVGを描画してghostとして重ねます。Label変更では現在の文字をstrikeし、
 * 次の文字を同じNodeの直上へ置くため、視線を図から外さず比較できます。
 */
export function createHistoryPreview(
  options: HistoryPreviewOptions,
): HistoryPreviewController {
  let activeDirection: HistoryDirection | null = null;
  let sequence = 0;

  function show(direction: HistoryDirection): void {
    activeDirection = direction;
    const currentSource = options.getCurrentSource();
    const targetSource = options.peekHistory(direction);
    const request = ++sequence;
    clearVisuals();

    if (!targetSource) {
      options.statusElement.textContent =
        direction === "undo" ? "戻せる変更はありません" : "やり直せる変更はありません";
      return;
    }

    const current = parseFlowchart(currentSource).model;
    const target = parseFlowchart(targetSource).model;
    if (!current || !target) {
      options.statusElement.textContent = "この変更は図上でPreviewできません";
      return;
    }

    applyCurrentStateDiff(current, target, direction);
    options.statusElement.textContent =
      `${direction === "undo" ? "Undo" : "Redo"}後に変わる部分をPreviewしています`;
    void renderAddedElements(targetSource, current, target, direction, request);
  }

  function hide(direction?: HistoryDirection): void {
    if (direction && activeDirection !== direction) return;
    activeDirection = null;
    ++sequence;
    clearVisuals();
    options.statusElement.textContent = "";
  }

  function clearVisuals(): void {
    options.layer.replaceChildren();
    options.preview
      .querySelectorAll(".is-history-removed, .is-history-changed")
      .forEach((element) =>
        element.classList.remove("is-history-removed", "is-history-changed"));
  }

  function applyCurrentStateDiff(
    current: FlowchartModel,
    target: FlowchartModel,
    direction: HistoryDirection,
  ): void {
    const targetNodes = new Map(target.nodes.map((node) => [node.id, node]));
    const currentEdges = current.edges.map(edgeKey);
    const targetEdges = new Set(target.edges.map(edgeKey));

    for (const node of current.nodes) {
      const element = findNode(options.preview, node.id);
      const nextNode = targetNodes.get(node.id);
      if (!element || !nextNode) {
        element?.classList.add("is-history-removed");
        continue;
      }
      if (node.label !== nextNode.label) {
        element.classList.add("is-history-changed");
        addLabelChange(element, node.label, nextNode.label, direction);
      }
    }

    options.preview.querySelectorAll<SVGPathElement>("path.flowchart-link")
      .forEach((path, index) => {
        const key = currentEdges[index];
        if (key && !targetEdges.has(key)) path.classList.add("is-history-removed");
      });
  }

  function addLabelChange(
    node: SVGGElement,
    previousLabel: string,
    nextLabel: string,
    direction: HistoryDirection,
  ): void {
    const previewBounds = options.preview.getBoundingClientRect();
    const nodeBounds = node.getBoundingClientRect();
    const label = document.createElement("div");
    label.className = "history-label-change";
    label.dataset.direction = direction;
    label.style.left = `${nodeBounds.left - previewBounds.left + nodeBounds.width / 2}px`;
    label.style.top = `${nodeBounds.top - previewBounds.top}px`;
    label.innerHTML = `<del></del><span aria-hidden="true">→</span><strong></strong>`;
    label.querySelector("del")!.textContent = previousLabel;
    label.querySelector("strong")!.textContent = nextLabel;
    options.layer.append(label);
  }

  async function renderAddedElements(
    source: string,
    current: FlowchartModel,
    target: FlowchartModel,
    direction: HistoryDirection,
    request: number,
  ): Promise<void> {
    const currentNodeIds = new Set(current.nodes.map((node) => node.id));
    const currentEdges = new Set(current.edges.map(edgeKey));
    const hasAddedNode = target.nodes.some((node) => !currentNodeIds.has(node.id));
    const hasAddedEdge = target.edges.some((edge) => !currentEdges.has(edgeKey(edge)));
    if (!hasAddedNode && !hasAddedEdge) return;

    try {
      const { svg } = await mermaid.render(`history-preview-${request}`, source);
      if (request !== sequence || activeDirection !== direction) return;
      const wrapper = document.createElement("div");
      wrapper.className = "history-added-overlay";
      wrapper.innerHTML = svg;
      const renderedSvg = wrapper.querySelector("svg");
      if (!renderedSvg) return;

      renderedSvg.querySelectorAll<SVGGElement>("g.node").forEach((node) => {
        const id = target.nodes.find(({ id }) => node.id.includes(`-${id}-`))?.id;
        node.classList.toggle("is-history-added", Boolean(id && !currentNodeIds.has(id)));
        if (!node.classList.contains("is-history-added")) node.remove();
      });
      renderedSvg.querySelectorAll<SVGPathElement>("path.flowchart-link").forEach((path) => {
        const edge = target.edges.find(({ from, to }) => path.id.includes(`-L_${from}_${to}_`));
        path.classList.toggle("is-history-added", Boolean(edge && !currentEdges.has(edgeKey(edge))));
        if (!path.classList.contains("is-history-added")) path.remove();
      });
      renderedSvg.querySelectorAll("marker, defs").forEach((element) => {
        // Added edgeのmarker参照に必要なdefinitionは残します。
        if (element.tagName.toLowerCase() !== "defs" && !hasAddedEdge) element.remove();
      });
      options.layer.append(wrapper);
    } catch {
      // 現在のPreviewを壊さず、表示可能なcurrent-state差分だけを残します。
    }
  }

  return { show, hide, dispose: () => hide() };
}

function edgeKey(edge: FlowchartModel["edges"][number]): string {
  return `${edge.from}\u0000${edge.connector}\u0000${edge.label}\u0000${edge.to}`;
}

function findNode(root: HTMLElement, id: string): SVGGElement | null {
  return [...root.querySelectorAll<SVGGElement>("g.node")]
    .find((node) => node.dataset.editorNodeId === id || node.id.includes(`-${id}-`)) ?? null;
}
