<script setup lang="ts">
import { Focus, Fullscreen, Maximize2, Minimize2, Redo2, Scan, Undo2 } from "lucide";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import LucideGlyph from "./LucideGlyph";

export type PrototypeKind =
  | "fullscreen-native"
  | "fullscreen-app"
  | "fullscreen-button-stateful"
  | "fullscreen-button-dual"
  | "fullscreen-button-menu"
  | "fullscreen-icon-corners"
  | "fullscreen-icon-frame"
  | "fullscreen-icon-focus"
  | "guidance-hover"
  | "guidance-first-use"
  | "guidance-both"
  | "guidance-anchored"
  | "guidance-top"
  | "guidance-bottom"
  | "zoom-wheel"
  | "zoom-document"
  | "pan-background"
  | "pan-space"
  | "edge-nearest"
  | "edge-handles"
  | "edge-handle-toolbar"
  | "edge-emphasis-scale"
  | "edge-emphasis-outline"
  | "edge-emphasis-combined"
  | "tooltip-floating"
  | "tooltip-panel"
  | "history-preview-miniature"
  | "history-preview-replace"
  | "history-preview-overlay"
  | "history-text-above"
  | "history-text-inline"
  | "history-text-replacement";

const props = defineProps<{ kind: PrototypeKind }>();

const canvas = ref<HTMLElement | null>(null);
const scale = ref(1);
const panX = ref(0);
const panY = ref(0);
const isExpanded = ref(false);
const isNativeFullscreen = ref(false);
const fullscreenMode = ref<"browser" | "page">("browser");
const guidanceVisible = ref(false);
const modeMenuOpen = ref(false);
const isSpacePressed = ref(false);
const tooltipOpen = ref(false);
const tooltipNodeY = ref(42);
const historyDirection = ref<"undo" | "redo" | null>(null);
const edgeStartX = ref(62);
const edgeStartY = ref(75);
const edgeEndX = ref(178);
const edgeEndY = ref(45);
const edgeDragging = ref<"start" | "end" | null>(null);
const edgeOriginY = ref(45);
const edgeTransitionActive = ref(false);
let guidanceTimer: ReturnType<typeof setTimeout> | undefined;
let edgeTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let panPointerId: number | null = null;
let panOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

const isViewportDemo = computed(() =>
  ["zoom-wheel", "zoom-document", "pan-background", "pan-space"].includes(props.kind),
);
const isEdgeDemo = computed(() => props.kind.startsWith("edge-"));
const isTooltipDemo = computed(() => props.kind.startsWith("tooltip-"));
const isFullscreenButtonDemo = computed(() => props.kind.startsWith("fullscreen-button-"));
const isHistoryDemo = computed(() => props.kind.startsWith("history-"));
const isHistoryTextDemo = computed(() => props.kind.startsWith("history-text-"));
const isFullscreenIconDemo = computed(() => props.kind.startsWith("fullscreen-icon-"));
const isGuidanceDemo = computed(() => props.kind.startsWith("guidance-"));
const isEdgeEmphasisDemo = computed(() => props.kind.startsWith("edge-emphasis-"));
const transform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
);
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const historyStatusId = computed(() => `history-preview-status-${props.kind}`);
const historyAnnouncement = computed(() => {
  if (historyDirection.value === "undo") {
    return isHistoryTextDemo.value
      ? "Undo preview。BuildがDraftへ変わります。"
      : "Undo preview。BとBへの接続が削除され、Aだけになります。";
  }
  if (historyDirection.value === "redo") {
    return isHistoryTextDemo.value
      ? "Redo preview。BuildがShipへ変わります。"
      : "Redo preview。CとCへの接続が追加され、AからB、Cへ続きます。";
  }
  return "UndoまたはRedoへフォーカスすると、変更後の状態をプレビューします。";
});
const tooltipBelow = computed(() => tooltipNodeY.value < 66);
const edgeCandidateY = computed(() =>
  Math.abs(edgeEndY.value - 45) <= Math.abs(edgeEndY.value - 110) ? 45 : 110,
);
const fullscreenIconPair = computed(() => {
  if (props.kind === "fullscreen-icon-frame") {
    return { browser: Fullscreen, page: Scan };
  }
  if (props.kind === "fullscreen-icon-focus") {
    return { browser: Maximize2, page: Focus };
  }
  return { browser: Maximize2, page: Minimize2 };
});

onMounted(() => {
  document.addEventListener("fullscreenchange", syncFullscreenState);
});

onBeforeUnmount(() => {
  document.body.classList.remove("spike-expanded");
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  if (guidanceTimer !== undefined) clearTimeout(guidanceTimer);
  if (edgeTransitionTimer !== undefined) clearTimeout(edgeTransitionTimer);
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
  const pointer = toEdgeCoordinates(event, bounds);

  edgeDragging.value =
    endpoint ??
    (distance(pointer.x, pointer.y, edgeStartX.value, edgeStartY.value) <
    distance(pointer.x, pointer.y, edgeEndX.value, edgeEndY.value)
      ? "start"
      : "end");
  if (edgeDragging.value === "end") edgeOriginY.value = edgeEndY.value;
  edgeTransitionActive.value = false;
  if (edgeTransitionTimer !== undefined) clearTimeout(edgeTransitionTimer);
  canvas.value?.setPointerCapture(event.pointerId);
  moveEdge(event);
}

function moveEdge(event: PointerEvent): void {
  if (!edgeDragging.value) return;
  const bounds = canvas.value?.getBoundingClientRect();
  if (!bounds) return;
  const pointer = toEdgeCoordinates(event, bounds);
  if (edgeDragging.value === "start") {
    edgeStartX.value = pointer.x;
    edgeStartY.value = pointer.y;
  } else {
    edgeEndX.value = pointer.x;
    edgeEndY.value = pointer.y;
  }
}

function stopEdge(): void {
  if (!edgeDragging.value) return;
  const x = edgeDragging.value === "start" ? edgeStartX.value : edgeEndX.value;
  const y = edgeDragging.value === "start" ? edgeStartY.value : edgeEndY.value;
  const target = [
    { x: 62, y: 75 },
    { x: 178, y: 45 },
    { x: 178, y: 110 },
  ].reduce((nearest, candidate) =>
    distance(x, y, candidate.x, candidate.y) <
    distance(x, y, nearest.x, nearest.y)
      ? candidate
      : nearest,
  );
  const changedTarget =
    edgeDragging.value === "end" && target.y !== edgeOriginY.value;
  if (edgeDragging.value === "start") {
    edgeStartX.value = target.x;
    edgeStartY.value = target.y;
  } else {
    edgeEndX.value = target.x;
    edgeEndY.value = target.y;
  }
  edgeDragging.value = null;
  if (isEdgeEmphasisDemo.value && changedTarget) {
    edgeTransitionActive.value = true;
    edgeTransitionTimer = setTimeout(() => {
      edgeTransitionActive.value = false;
    }, 900);
  }
}

function edgeNodeClasses(nodeY: 45 | 110): Record<string, boolean> {
  const active =
    isEdgeEmphasisDemo.value &&
    (edgeDragging.value === "end" || edgeTransitionActive.value);
  return {
    "is-losing": active && nodeY === edgeOriginY.value,
    "is-gaining": active && nodeY === edgeCandidateY.value && nodeY !== edgeOriginY.value,
  };
}

function toEdgeCoordinates(
  event: PointerEvent,
  bounds: DOMRect,
): { x: number; y: number } {
  return {
    x: clamp(((event.clientX - bounds.left) / bounds.width) * 240, 20, 220),
    y: clamp(((event.clientY - bounds.top) / bounds.height) * 150, 20, 130),
  };
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function showGuidanceFromHover(): void {
  if (props.kind !== "guidance-hover" && props.kind !== "guidance-both") return;
  guidanceTimer = setTimeout(() => {
    guidanceVisible.value = true;
  }, 700);
}

function cancelGuidanceHover(): void {
  if (guidanceTimer !== undefined) clearTimeout(guidanceTimer);
  guidanceTimer = undefined;
}

function activateGuidance(): void {
  if (props.kind === "guidance-first-use" || props.kind === "guidance-both") {
    guidanceVisible.value = true;
  }
}

function changeEdgeTarget(event: Event): void {
  const target = event.target as HTMLSelectElement;
  edgeEndX.value = 178;
  edgeEndY.value = target.value === "B" ? 45 : 110;
}

function moveTooltipNode(): void {
  tooltipNodeY.value = tooltipNodeY.value < 66 ? 112 : 42;
}

function resetViewport(): void {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function showHistory(direction: "undo" | "redo"): void {
  historyDirection.value = direction;
}

function hideHistory(direction: "undo" | "redo"): void {
  if (historyDirection.value === direction) historyDirection.value = null;
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
    :data-kind="kind"
    :class="{
      'is-expanded': isExpanded,
      'is-space-ready': isSpacePressed,
      'is-panning': panPointerId !== null,
    }"
    tabindex="0"
    @wheel="handleWheel"
    @pointerdown="startPan"
    @pointermove="movePan($event); moveEdge($event)"
    @pointerup="stopPan($event); stopEdge()"
    @pointercancel="stopPan($event); stopEdge()"
    @keydown="handleKey($event, true)"
    @keyup="handleKey($event, false)"
    @blur="isSpacePressed = false"
  >
    <template v-if="isHistoryDemo">
      <div class="history-toolbar" aria-label="履歴操作">
        <button
          type="button"
          aria-label="元に戻す"
          :aria-describedby="historyStatusId"
          @pointerenter="showHistory('undo')"
          @pointerleave="hideHistory('undo')"
          @focus="showHistory('undo')"
          @blur="hideHistory('undo')"
        >
          <LucideGlyph :icon="Undo2" :size="17" />
        </button>
        <button
          type="button"
          aria-label="やり直す"
          :aria-describedby="historyStatusId"
          @pointerenter="showHistory('redo')"
          @pointerleave="hideHistory('redo')"
          @focus="showHistory('redo')"
          @blur="hideHistory('redo')"
        >
          <LucideGlyph :icon="Redo2" :size="17" />
        </button>
      </div>
      <span :id="historyStatusId" class="history-sr-status" aria-live="polite">
        {{ historyAnnouncement }}
      </span>

      <div class="history-scene">
        <div class="history-node history-node-a">Plan</div>
        <span
          class="history-edge history-edge-first"
          :class="{
            'is-hidden-by-preview': kind === 'history-preview-replace' && historyDirection === 'undo',
            'is-removed': kind === 'history-preview-overlay' && historyDirection === 'undo',
          }"
        >→</span>
        <div
          class="history-node history-node-b"
          :class="{
            'is-hidden-by-preview': kind === 'history-preview-replace' && historyDirection === 'undo',
            'is-removed': kind === 'history-preview-overlay' && historyDirection === 'undo',
          }"
        >
          <template v-if="isHistoryTextDemo && historyDirection">
            <template v-if="kind === 'history-text-above'">
              <span class="history-old-text">Build</span>
            </template>
            <template v-else-if="kind === 'history-text-inline'">
              <span class="history-inline-old">Build</span>
              <span class="history-inline-arrow">→</span>
              <span class="history-inline-new">{{ historyDirection === "undo" ? "Draft" : "Ship" }}</span>
            </template>
            <template v-else>
              {{ historyDirection === "undo" ? "Draft" : "Ship" }}
              <small class="history-changed-badge">Changed</small>
            </template>
          </template>
          <template v-else>Build</template>
        </div>
        <template v-if="!isHistoryTextDemo">
          <span
            v-if="historyDirection === 'redo' && kind !== 'history-preview-miniature'"
            class="history-edge history-edge-second"
            :class="{ 'is-added': kind === 'history-preview-overlay' }"
          >→</span>
          <div
            v-if="historyDirection === 'redo' && kind !== 'history-preview-miniature'"
            class="history-node history-node-c"
            :class="{ 'is-added': kind === 'history-preview-overlay' }"
          >Review</div>
        </template>
      </div>
      <span
        v-if="kind === 'history-text-above' && historyDirection"
        class="history-new-text"
      >{{ historyDirection === "undo" ? "Draft" : "Ship" }}</span>

      <div
        v-if="kind === 'history-preview-miniature' && historyDirection"
        class="history-miniature"
      >
        <strong>{{ historyDirection === "undo" ? "Undo" : "Redo" }} preview</strong>
        <div>
          <span>Plan</span>
          <b v-if="historyDirection === 'redo'">→</b>
          <span v-if="historyDirection === 'redo'">Build</span>
          <b v-if="historyDirection === 'redo'">→</b>
          <span v-if="historyDirection === 'redo'">Review</span>
        </div>
      </div>
      <div
        v-if="kind === 'history-preview-replace' && historyDirection"
        class="history-replace-label"
      >{{ historyDirection === "undo" ? "Undo後の完成形" : "Redo後の完成形" }}</div>
      <div
        v-if="kind === 'history-preview-overlay' && historyDirection"
        class="history-overlay-legend"
        :class="historyDirection === 'undo' ? 'is-removal' : 'is-addition'"
      ><span>{{ historyDirection === "undo" ? "削除" : "追加" }}</span>される部分</div>

      <p class="prototype-hint">Undo / RedoへHoverまたはFocusしてPreview</p>
    </template>

    <template v-else-if="isFullscreenIconDemo">
      <div class="prototype-fullscreen-content">
        <span class="prototype-node">Idea</span>
        <span class="prototype-arrow">→</span>
        <span class="prototype-node">Share</span>
      </div>
      <div class="fullscreen-icon-stage">
        <button
          type="button"
          class="fullscreen-icon-button"
          :class="{ 'is-page': fullscreenMode === 'page' }"
          :aria-label="`${fullscreenMode === 'browser' ? 'Browser' : 'Page'} fullscreen mode`"
          @click="fullscreenMode = fullscreenMode === 'browser' ? 'page' : 'browser'"
        >
          <LucideGlyph
            :icon="fullscreenMode === 'browser' ? fullscreenIconPair.browser : fullscreenIconPair.page"
            :size="21"
          />
        </button>
        <span class="fullscreen-icon-caption">
          {{ fullscreenMode === "browser" ? "Browser fullscreen" : "Page fullscreen" }}
        </span>
      </div>
      <p class="prototype-hint">
        Iconを押してmodeを切替。Shapeだけでも現在のmodeを区別
      </p>
    </template>

    <template v-else-if="isFullscreenButtonDemo">
      <div class="prototype-fullscreen-content">
        <span class="prototype-node">Idea</span>
        <span class="prototype-arrow">→</span>
        <span class="prototype-node">Share</span>
      </div>

      <div v-if="kind === 'fullscreen-button-stateful'" class="fullscreen-button-stage">
        <button
          type="button"
          class="fullscreen-stateful-button"
          :data-mode="fullscreenMode"
          @click="fullscreenMode = fullscreenMode === 'browser' ? 'page' : 'browser'"
        >
          <span
            class="fullscreen-mode-icon"
            :class="fullscreenMode === 'browser' ? 'is-browser' : 'is-page'"
            aria-hidden="true"
          />
          {{ fullscreenMode === "browser" ? "Browser" : "Page" }}
        </button>
      </div>

      <div v-else-if="kind === 'fullscreen-button-dual'" class="fullscreen-button-stage">
        <div class="fullscreen-segmented">
          <button
            type="button"
            :class="{ 'is-active': fullscreenMode === 'browser' }"
            @click="fullscreenMode = 'browser'"
          >
            <span class="fullscreen-mode-icon is-browser" aria-hidden="true" />
            Browser
          </button>
          <button
            type="button"
            :class="{ 'is-active': fullscreenMode === 'page' }"
            @click="fullscreenMode = 'page'"
          >
            <span class="fullscreen-mode-icon is-page" aria-hidden="true" />
            Page
          </button>
        </div>
      </div>

      <div v-else class="fullscreen-button-stage">
        <div class="fullscreen-menu-button">
          <button type="button" @click="fullscreenMode = 'browser'">
            <span class="fullscreen-mode-icon is-browser" aria-hidden="true" />
            Fullscreen
          </button>
          <button
            type="button"
            aria-label="Fullscreenの種類"
            @click="modeMenuOpen = !modeMenuOpen"
          >
            ⋯
          </button>
          <div v-if="modeMenuOpen" class="fullscreen-mode-menu">
            <button type="button" @click="fullscreenMode = 'browser'; modeMenuOpen = false">
              Browser fullscreen
            </button>
            <button type="button" @click="fullscreenMode = 'page'; modeMenuOpen = false">
              Page fullscreen
            </button>
          </div>
        </div>
      </div>
      <p class="prototype-hint">現在の選択：{{ fullscreenMode }}</p>
    </template>

    <template v-else-if="isGuidanceDemo">
      <div class="prototype-fullscreen-content">
        <span class="prototype-node">Idea</span>
        <span class="prototype-arrow">→</span>
        <span class="prototype-node">Share</span>
      </div>
      <button
        type="button"
        class="guidance-fullscreen-button"
        @pointerenter="showGuidanceFromHover"
        @pointerleave="cancelGuidanceHover"
        @click="activateGuidance"
      >
        <span class="fullscreen-mode-icon is-browser" aria-hidden="true" />
      </button>

      <div
        v-if="kind === 'guidance-anchored' || (guidanceVisible && kind.startsWith('guidance-'))"
        class="guidance-message"
        :class="{
          'is-top': kind === 'guidance-top',
          'is-bottom': kind === 'guidance-bottom',
          'is-anchored': kind === 'guidance-anchored' || kind === 'guidance-hover' || kind === 'guidance-first-use' || kind === 'guidance-both',
        }"
      >
        <strong>Browser fullscreenで開きます</strong>
        <span>Page内拡大はButton menuから選べます。</span>
        <button type="button" @click="guidanceVisible = false">OK</button>
      </div>

      <p class="prototype-hint">
        <template v-if="kind === 'guidance-hover'">700ms Hoverで案内</template>
        <template v-else-if="kind === 'guidance-first-use'">初回Clickで案内</template>
        <template v-else-if="kind === 'guidance-both'">Hoverと初回Clickの両方</template>
        <template v-else-if="kind === 'guidance-anchored'">Button直下のPopover</template>
        <template v-else-if="kind === 'guidance-top'">上部のSafe banner</template>
        <template v-else>画面下部のToast</template>
      </p>
    </template>

    <template v-else-if="kind.startsWith('fullscreen-')">
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
      >
        <rect x="20" y="55" width="42" height="40" rx="11" />
        <rect
          x="178"
          y="25"
          width="42"
          height="40"
          rx="11"
          :class="edgeNodeClasses(45)"
        />
        <rect
          x="178"
          y="90"
          width="42"
          height="40"
          rx="11"
          :class="edgeNodeClasses(110)"
        />
        <text x="41" y="80">A</text>
        <text x="199" y="50">B</text>
        <text x="199" y="115">C</text>
        <line
          :x1="edgeStartX"
          :y1="edgeStartY"
          :x2="edgeEndX"
          :y2="edgeEndY"
          class="prototype-edge"
        />
        <line
          v-if="kind === 'edge-nearest'"
          :x1="edgeStartX"
          :y1="edgeStartY"
          :x2="edgeEndX"
          :y2="edgeEndY"
          class="prototype-edge-hit"
          @pointerdown.stop="startEdgeDrag($event)"
        />
        <template v-else>
          <circle
            :cx="edgeStartX"
            :cy="edgeStartY"
            r="10"
            class="prototype-edge-handle"
            @pointerdown.stop="startEdgeDrag($event, 'start')"
          />
          <circle
            :cx="edgeEndX"
            :cy="edgeEndY"
            r="10"
            class="prototype-edge-handle"
            @pointerdown.stop="startEdgeDrag($event, 'end')"
          />
        </template>
      </svg>
      <p class="prototype-hint">
        {{
          isEdgeEmphasisDemo
            ? "EndpointをCへDragして、接続を失うBと新しく接続するCを比較"
            : kind === "edge-nearest"
            ? "線を掴み、BまたはCへDrag"
            : kind === "edge-handle-toolbar"
              ? "HandleでDrag。下のSelectでも変更"
              : "変更する端のHandleをBまたはCへDrag"
        }}
      </p>
      <div v-if="kind === 'edge-handle-toolbar'" class="edge-fallback-toolbar">
        <label>
          接続先
          <select
            :value="edgeEndY === 45 ? 'B' : 'C'"
            @change="changeEdgeTarget"
          >
            <option>B</option>
            <option>C</option>
          </select>
        </label>
      </div>
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

.history-toolbar {
  position: absolute;
  z-index: 8;
  top: 0.65rem;
  left: 0.65rem;
  display: flex;
  gap: 0.2rem;
  padding: 0.2rem;
  border: 1px solid rgb(118 118 128 / 16%);
  border-radius: 0.65rem;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 5px 16px rgb(0 0 0 / 8%);
}

.history-toolbar button {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 0;
  border-radius: 0.48rem;
  background: transparent;
  color: #3a3a3c;
  cursor: pointer;
}

.history-toolbar button:hover,
.history-toolbar button:focus-visible {
  background: rgb(0 122 255 / 11%);
  color: #007aff;
  outline: none;
}

.history-sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.history-scene {
  position: absolute;
  top: 54%;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transform: translate(-50%, -50%);
}

.history-node {
  position: relative;
  display: grid;
  min-width: 3.7rem;
  min-height: 2.35rem;
  place-items: center;
  padding: 0 0.35rem;
  border: 1px solid rgb(0 122 255 / 28%);
  border-radius: 0.65rem;
  background: white;
  color: #1d1d1f;
  box-shadow: 0 4px 12px rgb(0 0 0 / 7%);
  font-size: 0.67rem;
  font-weight: 650;
  white-space: nowrap;
}

.history-edge {
  color: #8e8e93;
}

.history-scene .is-hidden-by-preview {
  display: none;
}

[data-kind="history-preview-overlay"] .history-node-b.is-removed {
  border: 2px dashed #ff453a;
  background: rgb(255 69 58 / 8%);
  color: #c9342c;
  opacity: 0.72;
}

[data-kind="history-preview-overlay"] .history-node-c.is-added {
  border: 2px solid #34c759;
  background: rgb(52 199 89 / 10%);
  color: #208a3c;
}

[data-kind="history-preview-overlay"] .history-edge.is-added {
  color: #34c759;
}

[data-kind="history-preview-overlay"] .history-edge.is-removed {
  color: #ff453a;
  opacity: 0.72;
}

.history-miniature {
  position: absolute;
  z-index: 9;
  top: 3.25rem;
  left: 0.65rem;
  display: grid;
  gap: 0.35rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.65rem;
  background: rgb(29 29 31 / 92%);
  color: white;
  box-shadow: 0 8px 22px rgb(0 0 0 / 18%);
  font-size: 0.55rem;
}

.history-miniature div {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.history-miniature span {
  padding: 0.22rem 0.3rem;
  border: 1px solid rgb(255 255 255 / 38%);
  border-radius: 0.25rem;
}

.history-replace-label,
.history-overlay-legend {
  position: absolute;
  top: 0.8rem;
  right: 0.7rem;
  color: #636366;
  font-size: 0.58rem;
  font-weight: 650;
}

.history-overlay-legend span {
  color: inherit;
}

.history-overlay-legend.is-removal {
  color: #ff453a;
}

.history-overlay-legend.is-addition {
  color: #208a3c;
}

.history-old-text,
.history-inline-old {
  color: #8e8e93;
  text-decoration: line-through;
}

.history-new-text {
  position: absolute;
  z-index: 6;
  top: 0.8rem;
  left: 50%;
  padding: 0.25rem 0.42rem;
  border-radius: 0.4rem;
  background: #007aff;
  color: white;
  transform: translateX(-50%);
}

.history-inline-arrow {
  padding: 0 0.18rem;
  color: #8e8e93;
}

.history-inline-new {
  color: #007aff;
}

.history-changed-badge {
  position: absolute;
  top: calc(100% + 0.3rem);
  left: 50%;
  padding: 0.14rem 0.28rem;
  border-radius: 999px;
  background: rgb(0 122 255 / 11%);
  color: #007aff;
  font-size: 0.46rem;
  transform: translateX(-50%);
}

.fullscreen-button-stage {
  position: absolute;
  z-index: 6;
  top: 0.7rem;
  right: 0.7rem;
}

.fullscreen-icon-stage {
  position: absolute;
  z-index: 6;
  top: 0.7rem;
  right: 0.7rem;
  display: grid;
  justify-items: end;
  gap: 0.35rem;
}

.fullscreen-icon-button {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 90%);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 84%);
  color: #007aff;
  box-shadow: 0 5px 16px rgb(0 0 0 / 9%);
  cursor: pointer;
  transition:
    color 180ms ease,
    background 180ms ease,
    transform 180ms ease;
  backdrop-filter: blur(16px);
}

.fullscreen-icon-button.is-page {
  background: rgb(175 82 222 / 11%);
  color: #9843c4;
}

.fullscreen-icon-button:active {
  transform: scale(0.92);
  transition-duration: 80ms;
}

.fullscreen-icon-caption {
  padding: 0.25rem 0.42rem;
  border-radius: 0.42rem;
  background: rgb(29 29 31 / 82%);
  color: white;
  font-size: 0.5625rem;
  font-weight: 650;
  opacity: 0;
  transform: translateY(-0.2rem);
  transition:
    opacity 140ms ease,
    transform 180ms ease;
}

.fullscreen-icon-stage:hover .fullscreen-icon-caption,
.fullscreen-icon-stage:focus-within .fullscreen-icon-caption {
  opacity: 1;
  transform: translateY(0);
}

.fullscreen-stateful-button,
.fullscreen-segmented,
.fullscreen-menu-button {
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 0.7rem;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 5px 16px rgb(0 0 0 / 9%);
  backdrop-filter: blur(16px);
}

.fullscreen-stateful-button {
  display: flex;
  min-width: 6.2rem;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.5rem 0.65rem;
  border: 0;
  color: #007aff;
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 700;
}

.fullscreen-stateful-button[data-mode="page"] {
  color: #af52de;
}

.fullscreen-mode-icon {
  position: relative;
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  flex: none;
}

.fullscreen-mode-icon.is-browser {
  border: 1.5px solid currentcolor;
  border-radius: 0.12rem;
}

.fullscreen-mode-icon.is-browser::after {
  position: absolute;
  inset: 0.16rem;
  border: 1px solid currentcolor;
  border-radius: 0.05rem;
  content: "";
}

.fullscreen-mode-icon.is-page::before,
.fullscreen-mode-icon.is-page::after {
  position: absolute;
  width: 0.55rem;
  height: 0.42rem;
  border: 1.5px solid currentcolor;
  border-radius: 0.1rem;
  content: "";
}

.fullscreen-mode-icon.is-page::before {
  top: 0;
  left: 0;
}

.fullscreen-mode-icon.is-page::after {
  right: 0;
  bottom: 0;
}

.fullscreen-segmented {
  display: flex;
  padding: 0.2rem;
}

.fullscreen-segmented button,
.fullscreen-menu-button > button {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.38rem 0.52rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: #636366;
  cursor: pointer;
  font-size: 0.625rem;
  font-weight: 650;
}

.fullscreen-segmented button.is-active {
  background: #007aff;
  color: white;
}

.fullscreen-menu-button {
  position: relative;
  display: flex;
  padding: 0.2rem;
}

.fullscreen-menu-button > button:first-child {
  color: #007aff;
}

.fullscreen-mode-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  display: grid;
  width: 9.5rem;
  padding: 0.25rem;
  border: 1px solid rgb(118 118 128 / 16%);
  border-radius: 0.65rem;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}

.fullscreen-mode-menu button {
  padding: 0.45rem 0.55rem;
  border: 0;
  border-radius: 0.45rem;
  background: transparent;
  color: #1d1d1f;
  cursor: pointer;
  font-size: 0.625rem;
  text-align: left;
}

.fullscreen-mode-menu button:hover {
  background: rgb(0 122 255 / 9%);
}

.guidance-fullscreen-button {
  position: absolute;
  z-index: 8;
  top: 0.7rem;
  right: 0.7rem;
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  cursor: pointer;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 0.68rem;
  background: rgb(255 255 255 / 84%);
  color: #007aff;
  box-shadow: 0 5px 16px rgb(0 0 0 / 9%);
}

.guidance-message {
  position: absolute;
  z-index: 7;
  display: grid;
  gap: 0.18rem;
  width: min(15rem, calc(100% - 1.4rem));
  padding: 0.65rem 2rem 0.65rem 0.75rem;
  border: 1px solid rgb(0 122 255 / 18%);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 94%);
  color: #1d1d1f;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  font-size: 0.625rem;
  line-height: 1.4;
}

.guidance-message span {
  color: #6e6e73;
}

.guidance-message button {
  position: absolute;
  top: 0.45rem;
  right: 0.45rem;
  border: 0;
  background: transparent;
  color: #007aff;
  cursor: pointer;
  font-size: 0.625rem;
}

.guidance-message.is-anchored {
  top: 3.35rem;
  right: 0.7rem;
}

.guidance-message.is-top {
  top: 0.7rem;
  left: 50%;
  transform: translateX(-50%);
}

.guidance-message.is-bottom {
  bottom: 2.2rem;
  left: 50%;
  transform: translateX(-50%);
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
  transform-box: fill-box;
  transform-origin: center;
  transition:
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    fill 180ms ease,
    stroke 180ms ease,
    stroke-width 180ms ease,
    filter 220ms ease;
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

[data-kind="edge-emphasis-scale"] .prototype-edge-svg rect.is-losing,
[data-kind="edge-emphasis-combined"] .prototype-edge-svg rect.is-losing {
  transform: scale(0.86);
}

[data-kind="edge-emphasis-scale"] .prototype-edge-svg rect.is-gaining,
[data-kind="edge-emphasis-combined"] .prototype-edge-svg rect.is-gaining {
  transform: scale(1.13);
}

[data-kind="edge-emphasis-outline"] .prototype-edge-svg rect.is-losing,
[data-kind="edge-emphasis-combined"] .prototype-edge-svg rect.is-losing {
  fill: #fff5f5;
  stroke: #ff453a;
  stroke-dasharray: 4 3;
  stroke-width: 2.5;
}

[data-kind="edge-emphasis-outline"] .prototype-edge-svg rect.is-gaining,
[data-kind="edge-emphasis-combined"] .prototype-edge-svg rect.is-gaining {
  fill: #eef7ff;
  stroke: #007aff;
  stroke-width: 3;
  filter: drop-shadow(0 4px 5px rgb(0 122 255 / 24%));
}

.edge-fallback-toolbar {
  position: absolute;
  right: 0.7rem;
  bottom: 2rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.55rem;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 4px 14px rgb(0 0 0 / 9%);
  color: #636366;
  font-size: 0.625rem;
}

.edge-fallback-toolbar select {
  margin-left: 0.3rem;
  border: 1px solid rgb(118 118 128 / 20%);
  border-radius: 0.35rem;
  background: white;
  color: #1d1d1f;
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
  .prototype-detail-panel,
  .fullscreen-stateful-button,
  .fullscreen-segmented,
  .fullscreen-menu-button,
  .fullscreen-icon-button,
  .fullscreen-mode-menu,
  .guidance-fullscreen-button,
  .guidance-message,
  .edge-fallback-toolbar {
    background: rgb(44 44 46 / 88%);
    color: #f5f5f7;
  }

  .fullscreen-mode-menu button,
  .guidance-message {
    color: #f5f5f7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .prototype-tooltip-node,
  .prototype-edge-svg rect,
  .fullscreen-icon-button,
  .fullscreen-icon-caption {
    transition: none;
  }
}
</style>
