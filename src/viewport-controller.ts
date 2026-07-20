/**
 * Preview内のPan / Zoomが外部へ公開する最小APIです。
 *
 * Mermaidは再描画のたびにSVG要素を交換します。そのためControllerはSVG要素を
 * 永続的に保持せず、表示状態だけを所有して、`applyAfterRender`で新しいSVGへ
 * 同じtransformを適用します。
 */
export interface ViewportController {
  /** Mermaid SVGの生成直後に、現在のPan / Zoomを新しいSVGへ適用します。 */
  applyAfterRender(): void;
  /** Listenerと進行中のpointer操作を破棄します。 */
  dispose(): void;
}

export interface ViewportControllerOptions {
  /** SVGとannotation layerを収容するPreview領域です。 */
  preview: HTMLDivElement;
  /** Keyboard操作による倍率変更を読み上げるlive regionです。 */
  statusElement?: HTMLElement;
}

interface PanGesture {
  pointerId: number;
  clientX: number;
  clientY: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.002;
const KEYBOARD_PAN_STEP = 40;
const KEYBOARD_ZOOM_RATIO = 1.2;

/**
 * 文書に近いWheel Panと、背景Drag、pointer中心Zoomを設定します。
 *
 * 通常のWheelはtrackpadの`deltaX`と`deltaY`をそのまま両軸へ反映します。
 * Ctrl / Command + Wheelでは、pointer直下の図上座標が動かないようPan量を
 * 補正してZoomします。CSS transformは`translate`をscreen px、`scale`を
 * 図の倍率として扱うため、補正式を単純に保てます。
 */
export function createViewportController(
  options: ViewportControllerOptions,
): ViewportController {
  const { preview, statusElement } = options;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let panGesture: PanGesture | null = null;

  preview.addEventListener("wheel", handleWheel, { passive: false });
  preview.addEventListener("pointerdown", startPan);
  preview.addEventListener("pointermove", movePan);
  preview.addEventListener("pointerup", finishPan);
  preview.addEventListener("pointercancel", finishPan);
  preview.addEventListener("keydown", handleKeydown);

  function currentSvg(): SVGSVGElement | null {
    return preview.querySelector<SVGSVGElement>(":scope > svg");
  }

  /**
   * transform後の矩形と現在のPanから、transform前の左上を復元します。
   * flexによる中央配置を維持したままpointer中心の倍率変更を行うため、
   * layout位置を固定値として仮定しません。
   */
  function getLayoutOrigin(svg: SVGSVGElement): { x: number; y: number } {
    const bounds = svg.getBoundingClientRect();
    return { x: bounds.left - panX, y: bounds.top - panY };
  }

  function applyTransform(): void {
    const svg = currentSvg();
    if (!svg) return;
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    svg.dataset.viewportScale = String(scale);

    // Annotation / TooltipはSVG外のHTML layerなので、既存のscroll時と同じ
    // layout経路へ通知し、移動・拡大したNodeのscreen座標へ追従させます。
    preview.dispatchEvent(new Event("scroll"));
  }

  function handleWheel(event: WheelEvent): void {
    const svg = currentSvg();
    if (!svg) return;
    event.preventDefault();
    const { x: deltaX, y: deltaY } = normalizeWheelDelta(event, preview);

    if (event.ctrlKey || event.metaKey) {
      const previousScale = scale;
      const nextScale = clamp(
        previousScale * Math.exp(-deltaY * ZOOM_SENSITIVITY),
        MIN_SCALE,
        MAX_SCALE,
      );
      if (nextScale === previousScale) return;

      const origin = getLayoutOrigin(svg);
      const ratio = nextScale / previousScale;
      panX = event.clientX - origin.x - ratio * (event.clientX - origin.x - panX);
      panY = event.clientY - origin.y - ratio * (event.clientY - origin.y - panY);
      scale = nextScale;
      applyTransform();
      return;
    }

    panX -= deltaX;
    panY -= deltaY;
    applyTransform();
  }

  function startPan(event: PointerEvent): void {
    if (
      panGesture ||
      event.button !== 0 ||
      !currentSvg() ||
      !isPreviewBackground(event.target)
    ) return;
    panGesture = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add("is-viewport-panning");
    event.preventDefault();
  }

  function movePan(event: PointerEvent): void {
    if (!panGesture || event.pointerId !== panGesture.pointerId) return;
    panX += event.clientX - panGesture.clientX;
    panY += event.clientY - panGesture.clientY;
    panGesture.clientX = event.clientX;
    panGesture.clientY = event.clientY;
    applyTransform();
  }

  function finishPan(event: PointerEvent): void {
    if (!panGesture || event.pointerId !== panGesture.pointerId) return;
    if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
    panGesture = null;
    preview.classList.remove("is-viewport-panning");
  }

  function handleKeydown(event: KeyboardEvent): void {
    // 子のNodeやannotationが独自のkeyboard操作を受ける場合は横取りしません。
    if (event.target !== preview || !currentSvg()) return;

    if (event.key === "ArrowLeft") panX += KEYBOARD_PAN_STEP;
    else if (event.key === "ArrowRight") panX -= KEYBOARD_PAN_STEP;
    else if (event.key === "ArrowUp") panY += KEYBOARD_PAN_STEP;
    else if (event.key === "ArrowDown") panY -= KEYBOARD_PAN_STEP;
    else if (event.key === "+" || event.key === "=") {
      zoomFromCenter(scale * KEYBOARD_ZOOM_RATIO);
      announceScale();
      event.preventDefault();
      return;
    } else if (event.key === "-" || event.key === "_") {
      zoomFromCenter(scale / KEYBOARD_ZOOM_RATIO);
      announceScale();
      event.preventDefault();
      return;
    } else if (event.key === "0") {
      scale = 1;
      panX = 0;
      panY = 0;
      applyTransform();
      announceScale("表示位置と倍率をリセットしました");
      event.preventDefault();
      return;
    } else return;

    applyTransform();
    event.preventDefault();
  }

  /** Keyboard Zoomはpointerがないため、Preview中央の図上座標を固定します。 */
  function zoomFromCenter(requestedScale: number): void {
    const svg = currentSvg();
    if (!svg) return;
    const previousScale = scale;
    const nextScale = clamp(requestedScale, MIN_SCALE, MAX_SCALE);
    if (nextScale === previousScale) return;
    const previewBounds = preview.getBoundingClientRect();
    const clientX = previewBounds.left + previewBounds.width / 2;
    const clientY = previewBounds.top + previewBounds.height / 2;
    const origin = getLayoutOrigin(svg);
    const ratio = nextScale / previousScale;
    panX = clientX - origin.x - ratio * (clientX - origin.x - panX);
    panY = clientY - origin.y - ratio * (clientY - origin.y - panY);
    scale = nextScale;
    applyTransform();
  }

  function announceScale(message = `表示倍率 ${Math.round(scale * 100)}%`): void {
    if (statusElement) statusElement.textContent = message;
  }

  return {
    applyAfterRender: applyTransform,
    dispose(): void {
      preview.removeEventListener("wheel", handleWheel);
      preview.removeEventListener("pointerdown", startPan);
      preview.removeEventListener("pointermove", movePan);
      preview.removeEventListener("pointerup", finishPan);
      preview.removeEventListener("pointercancel", finishPan);
      preview.removeEventListener("keydown", handleKeydown);
      if (panGesture && preview.hasPointerCapture(panGesture.pointerId)) {
        preview.releasePointerCapture(panGesture.pointerId);
      }
      preview.classList.remove("is-viewport-panning");
      panGesture = null;
    },
  };
}

/**
 * Node編集やannotation、Edge endpoint操作を背景Dragより優先します。
 * Mermaid SVG自身とEdge pathなど、操作可能要素に含まれない場所は背景です。
 */
function isPreviewBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest(
    "g.node, .edgePath, .edgeLabel, .flowchart-link, path, .edge-endpoint-handle, .node-shape-annotation, .node-shape-tooltip, button, input, select, textarea, a",
  );
}

/**
 * Browser / deviceごとのWheel単位をCSS pixelへ揃えます。
 *
 * line modeはPreviewの標準的な本文行高、page modeは表示領域1ページ分として
 * 解釈し、pixel modeのtrackpad値と同じPan / Zoom計算へ渡します。
 */
function normalizeWheelDelta(
  event: WheelEvent,
  preview: HTMLElement,
): { x: number; y: number } {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: event.deltaX * 16, y: event.deltaY * 16 };
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return {
      x: event.deltaX * preview.clientWidth,
      y: event.deltaY * preview.clientHeight,
    };
  }
  return { x: event.deltaX, y: event.deltaY };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
