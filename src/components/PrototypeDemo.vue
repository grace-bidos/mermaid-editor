<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export type PrototypeKind =
  | "fullscreen-native"
  | "fullscreen-app"
  | "zoom-wheel"
  | "zoom-document"
  | "pan-background"
  | "pan-space"
  | "edge-nearest"
  | "edge-handles"
  | "tooltip-floating"
  | "tooltip-panel";

const props = defineProps<{ kind: PrototypeKind }>();

const canvas = ref<HTMLElement | null>(null);
const scale = ref(1);
const panX = ref(0);
const panY = ref(0);
const isExpanded = ref(false);
const isNativeFullscreen = ref(false);
const isSpacePressed = ref(false);
const tooltipOpen = ref(false);
const tooltipNodeY = ref(42);
const edgeStartX = ref(38);
const edgeEndX = ref(202);
const edgeDragging = ref<"start" | "end" | null>(null);
let panPointerId: number | null = null;
let panOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

const isViewportDemo = computed(() =>
  ["zoom-wheel", "zoom-document", "pan-background", "pan-space"].includes(props.kind),
);
const isEdgeDemo = computed(() => props.kind.startsWith("edge-"));
const isTooltipDemo = computed(() => props.kind.startsWith("tooltip-"));
const transform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
);
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const tooltipBelow = computed(() => tooltipNodeY.value < 66);

onMounted(() => {
  document.addEventListener("fullscreenchange", syncFullscreenState);
});

onBeforeUnmount(() => {
  document.body.classList.remove("spike-expanded");
  document.removeEventListener("fullscreenchange", syncFullscreenState);
});

function handleWheel(event: WheelEvent): void {
  if (!isViewportDemo.value) return;

  const shouldZoom =
    props.kind === "zoom-wheel" ||
    (props.kind === "zoom-document" && (event.ctrlKey || event.metaKey));

  if (shouldZoom) {
    event.preventDefault();
    const next = scale.value * Math.exp(-event.deltaY * 0.002);
    scale.value = clamp(next, 0.5, 2);
    return;
  }

  if (props.kind === "zoom-document") {
    event.preventDefault();
    panX.value -= event.deltaX;
    panY.value -= event.deltaY;
  }
}

function startPan(event: PointerEvent): void {
  if (!isViewportDemo.value) return;
  const target = event.target as Element;
  if (target.closest("button")) return;

  const canPan =
    props.kind === "pan-background" ||
    props.kind.startsWith("zoom-") ||
    (props.kind === "pan-space" && (isSpacePressed.value || event.button === 1));
  if (!canPan) return;

  panPointerId = event.pointerId;
  panOrigin = {
    x: event.clientX,
    y: event.clientY,
    panX: panX.value,
    panY: panY.value,
  };
  canvas.value?.setPointerCapture(event.pointerId);
}

function movePan(event: PointerEvent): void {
  if (panPointerId !== event.pointerId) return;
  panX.value = panOrigin.panX + event.clientX - panOrigin.x;
  panY.value = panOrigin.panY + event.clientY - panOrigin.y;
}

function stopPan(event: PointerEvent): void {
  if (panPointerId !== event.pointerId) return;
  panPointerId = null;
}

function handleKey(event: KeyboardEvent, pressed: boolean): void {
  if (event.code !== "Space") return;
  event.preventDefault();
  isSpacePressed.value = pressed;
}

async function toggleFullscreen(): Promise<void> {
  const element = canvas.value;
  if (!element) return;

  if (props.kind === "fullscreen-native" && document.fullscreenEnabled) {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
    return;
  }

  isExpanded.value = !isExpanded.value;
  document.body.classList.toggle("spike-expanded", isExpanded.value);
}

function startEdgeDrag(event: PointerEvent, endpoint?: "start" | "end"): void {
  if (!isEdgeDemo.value) return;
  const bounds = canvas.value?.getBoundingClientRect();
  if (!bounds) return;
  const pointerX = ((event.clientX - bounds.left) / bounds.width) * 240;

  edgeDragging.value =
    endpoint ??
    (Math.abs(pointerX - edgeStartX.value) <
    Math.abs(pointerX - edgeEndX.value)
      ? "start"
      : "end");
  canvas.value?.setPointerCapture(event.pointerId);
  moveEdge(event);
}

function moveEdge(event: PointerEvent): void {
  if (!edgeDragging.value) return;
  const bounds = canvas.value?.getBoundingClientRect();
  if (!bounds) return;
  const nextX = clamp(((event.clientX - bounds.left) / bounds.width) * 240, 32, 208);
  if (edgeDragging.value === "start") edgeStartX.value = nextX;
  else edgeEndX.value = nextX;
}

function stopEdge(): void {
  if (!edgeDragging.value) return;
  const value = edgeDragging.value === "start" ? edgeStartX.value : edgeEndX.value;
  const snapped = value < 120 ? 38 : 202;
  if (edgeDragging.value === "start") edgeStartX.value = snapped;
  else edgeEndX.value = snapped;
  edgeDragging.value = null;
}

function moveTooltipNode(): void {
  tooltipNodeY.value = tooltipNodeY.value < 66 ? 112 : 42;
}

function resetViewport(): void {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function syncFullscreenState(): void {
  isNativeFullscreen.value = document.fullscreenElement === canvas.value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
</script>

<template>
  <div
    ref="canvas"
    class="prototype-canvas"
    :class="{
      'is-expanded': isExpanded,
      'is-space-ready': isSpacePressed,
      'is-panning': panPointerId !== null,
    }"
    tabindex="0"
    @wheel="handleWheel"
    @pointerdown="startPan"
    @pointermove="movePan"
    @pointerup="stopPan"
    @pointercancel="stopPan"
    @keydown="handleKey($event, true)"
    @keyup="handleKey($event, false)"
    @blur="isSpacePressed = false"
  >
    <template v-if="kind.startsWith('fullscreen-')">
      <div class="prototype-toolbar">
        <span>Preview</span>
        <button type="button" @click="toggleFullscreen">
          {{ isExpanded || isNativeFullscreen ? "終了" : "試す" }}
        </button>
      </div>
      <div class="prototype-fullscreen-content">
        <span class="prototype-node">Idea</span>
        <span class="prototype-arrow">→</span>
        <span class="prototype-node">Share</span>
      </div>
      <p class="prototype-hint">
        {{ kind === "fullscreen-native" ? "Browser fullscreen。Escで終了" : "Page内でPreviewだけを拡大" }}
      </p>
    </template>

    <template v-else-if="isViewportDemo">
      <div class="prototype-toolbar">
        <span>{{ zoomLabel }}</span>
        <button type="button" @click="resetViewport">Reset</button>
      </div>
      <div class="prototype-scene" :style="{ transform }">
        <span class="prototype-node">Idea</span>
        <span class="prototype-arrow">→</span>
        <span class="prototype-node">Preview</span>
      </div>
      <p class="prototype-hint">
        <template v-if="kind === 'zoom-wheel'">WheelでZoom。DragでPan</template>
        <template v-else-if="kind === 'zoom-document'">WheelでPan。Ctrl / ⌘ + WheelでZoom</template>
        <template v-else-if="kind === 'pan-background'">背景をそのままDrag</template>
        <template v-else>Canvasをfocusし、Spaceを押しながらDrag</template>
      </p>
    </template>

    <template v-else-if="isEdgeDemo">
      <svg
        class="prototype-edge-svg"
        viewBox="0 0 240 150"
        @pointermove="moveEdge"
        @pointerup="stopEdge"
        @pointercancel="stopEdge"
      >
        <rect x="16" y="55" width="54" height="40" rx="12" />
        <rect x="170" y="55" width="54" height="40" rx="12" />
        <text x="43" y="80">A</text>
        <text x="197" y="80">B</text>
        <line
          :x1="edgeStartX"
          y1="75"
          :x2="edgeEndX"
          y2="75"
          class="prototype-edge"
        />
        <line
          v-if="kind === 'edge-nearest'"
          :x1="edgeStartX"
          y1="75"
          :x2="edgeEndX"
          y2="75"
          class="prototype-edge-hit"
          @pointerdown.stop="startEdgeDrag($event)"
        />
        <template v-else>
          <circle
            :cx="edgeStartX"
            cy="75"
            r="10"
            class="prototype-edge-handle"
            @pointerdown.stop="startEdgeDrag($event, 'start')"
          />
          <circle
            :cx="edgeEndX"
            cy="75"
            r="10"
            class="prototype-edge-handle"
            @pointerdown.stop="startEdgeDrag($event, 'end')"
          />
        </template>
      </svg>
      <p class="prototype-hint">
        {{ kind === "edge-nearest" ? "線を掴むと近い端を変更" : "変更する端のHandleをDrag" }}
      </p>
    </template>

    <template v-else-if="isTooltipDemo">
      <div
        class="prototype-tooltip-node"
        :style="{ top: `${tooltipNodeY}px` }"
        @click="moveTooltipNode"
      >
        Process
        <button type="button" @click.stop="tooltipOpen = !tooltipOpen">処理</button>
      </div>
      <div
        v-if="tooltipOpen && kind === 'tooltip-floating'"
        class="prototype-floating-tooltip"
        :class="{ 'is-below': tooltipBelow }"
        :style="{ top: `${tooltipNodeY}px` }"
      >
        <strong>処理</strong>
        <span>実行する作業を表します。</span>
      </div>
      <div v-if="tooltipOpen && kind === 'tooltip-panel'" class="prototype-detail-panel">
        <strong>処理</strong>
        <span>実行する作業を表します。</span>
      </div>
      <p class="prototype-hint">NodeをClickして位置変更。Annotationで説明を表示</p>
    </template>
  </div>
</template>

<style scoped>
.prototype-canvas {
  position: relative;
  min-height: 12rem;
  overflow: hidden;
  border: 1px solid rgb(118 118 128 / 18%);
  border-radius: 1rem;
  background:
    linear-gradient(rgb(255 255 255 / 78%), rgb(250 250 252 / 88%)),
    repeating-linear-gradient(0deg, transparent 0 23px, rgb(0 0 0 / 3%) 24px),
    repeating-linear-gradient(90deg, transparent 0 23px, rgb(0 0 0 / 3%) 24px);
  outline: none;
  touch-action: none;
  user-select: none;
}

.prototype-canvas:focus-visible {
  box-shadow: 0 0 0 3px rgb(0 122 255 / 24%);
}

.prototype-canvas.is-expanded,
.prototype-canvas:fullscreen {
  position: fixed;
  z-index: 100;
  inset: 0;
  min-height: 100dvh;
  border: 0;
  border-radius: 0;
}

.prototype-toolbar {
  position: absolute;
  z-index: 5;
  top: 0.65rem;
  right: 0.65rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.35rem 0.3rem 0.55rem;
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 0.65rem;
  background: rgb(255 255 255 / 78%);
  box-shadow: 0 5px 16px rgb(0 0 0 / 8%);
  font-size: 0.6875rem;
  font-weight: 650;
  backdrop-filter: blur(16px);
}

.prototype-toolbar button {
  padding: 0.28rem 0.5rem;
  border: 0;
  border-radius: 0.45rem;
  background: rgb(0 122 255 / 10%);
  color: #007aff;
  cursor: pointer;
}

.prototype-scene,
.prototype-fullscreen-content {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  transform: translate(-50%, -50%);
  transform-origin: center;
}

.prototype-scene {
  transition: none;
}

.prototype-node {
  display: grid;
  min-width: 4.5rem;
  min-height: 2.5rem;
  place-items: center;
  border: 1px solid rgb(0 122 255 / 28%);
  border-radius: 0.75rem;
  background: #fff;
  color: #1d1d1f;
  box-shadow: 0 5px 14px rgb(0 0 0 / 7%);
  font-size: 0.75rem;
  font-weight: 650;
}

.prototype-arrow {
  color: #8e8e93;
  font-size: 1.1rem;
}

.prototype-hint {
  position: absolute;
  right: 0.75rem;
  bottom: 0.65rem;
  left: 0.75rem;
  margin: 0;
  color: #6e6e73;
  font-size: 0.6875rem;
  text-align: center;
}

.is-panning {
  cursor: grabbing;
}

.is-space-ready {
  cursor: grab;
}

.prototype-edge-svg {
  width: 100%;
  height: 9.5rem;
}

.prototype-edge-svg rect {
  fill: white;
  stroke: rgb(0 122 255 / 35%);
}

.prototype-edge-svg text {
  fill: #1d1d1f;
  font: 650 12px system-ui;
  text-anchor: middle;
}

.prototype-edge {
  stroke: #636366;
  stroke-width: 2;
}

.prototype-edge-hit {
  cursor: grab;
  stroke: transparent;
  stroke-width: 18;
}

.prototype-edge-handle {
  cursor: grab;
  fill: #fff;
  stroke: #007aff;
  stroke-width: 3;
}

.prototype-tooltip-node {
  position: absolute;
  left: 50%;
  width: 6.2rem;
  height: 3rem;
  transform: translateX(-50%);
  border: 1px solid rgb(0 122 255 / 28%);
  border-radius: 0.8rem;
  background: #fff;
  box-shadow: 0 5px 14px rgb(0 0 0 / 7%);
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 3rem;
  text-align: center;
  transition: top 180ms ease;
}

.prototype-tooltip-node button {
  position: absolute;
  right: -0.6rem;
  bottom: -0.5rem;
  padding: 0.25rem 0.42rem;
  border: 1px solid rgb(0 122 255 / 22%);
  border-radius: 999px;
  background: #eef6ff;
  color: #0066cc;
  cursor: pointer;
  font-size: 0.625rem;
  line-height: 1;
}

.prototype-floating-tooltip {
  position: absolute;
  left: 50%;
  z-index: 4;
  display: grid;
  width: 9.5rem;
  gap: 0.2rem;
  padding: 0.65rem;
  transform: translate(-50%, calc(-100% - 0.75rem));
  border-radius: 0.7rem;
  background: rgb(29 29 31 / 92%);
  color: white;
  box-shadow: 0 8px 22px rgb(0 0 0 / 18%);
  font-size: 0.6875rem;
}

.prototype-floating-tooltip.is-below {
  transform: translate(-50%, 3.75rem);
}

.prototype-floating-tooltip span,
.prototype-detail-panel span {
  opacity: 0.76;
}

.prototype-detail-panel {
  position: absolute;
  right: 0.65rem;
  bottom: 2.2rem;
  left: 0.65rem;
  display: grid;
  gap: 0.15rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid rgb(118 118 128 / 14%);
  border-radius: 0.8rem;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 6px 20px rgb(0 0 0 / 8%);
  font-size: 0.6875rem;
}

@media (prefers-color-scheme: dark) {
  .prototype-canvas {
    border-color: rgb(255 255 255 / 10%);
    background: #1c1c1e;
  }

  .prototype-node,
  .prototype-edge-svg rect,
  .prototype-tooltip-node {
    background: #2c2c2e;
    fill: #2c2c2e;
    color: #f5f5f7;
  }

  .prototype-edge-svg text {
    fill: #f5f5f7;
  }

  .prototype-toolbar,
  .prototype-detail-panel {
    background: rgb(44 44 46 / 88%);
    color: #f5f5f7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .prototype-tooltip-node {
    transition: none;
  }
}
</style>
