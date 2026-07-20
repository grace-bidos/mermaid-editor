<script setup lang="ts">
import { Fullscreen, Scan } from "lucide";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import LucideGlyph from "./LucideGlyph";
import type { PreviewStatus } from "../preview";

defineProps<{
  status: PreviewStatus;
  statusMessage: string;
  canDownload: boolean;
}>();

type FullscreenMode = "browser" | "page";
type GuidancePlacement = "above" | "left" | "right";

const FULLSCREEN_GUIDANCE_KEY = "mermaid-editor.fullscreen-guidance-seen";
const HOVER_GUIDANCE_DELAY = 650;
const TOAST_DURATION = 3200;

const pane = useTemplateRef<HTMLElement>("pane");
const fullscreenButton = useTemplateRef<HTMLButtonElement>("fullscreenButton");
const fullscreenMode = ref<FullscreenMode>("browser");
const isFullscreen = ref(false);
const guidanceVisible = ref(false);
const guidancePlacement = ref<GuidancePlacement>("above");
const toastMessage = ref("");
const hasSeenGuidance = ref(false);
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFirstActivation = false;

const fullscreenIcon = computed(() => fullscreenMode.value === "browser" ? Fullscreen : Scan);
const fullscreenLabel = computed(() => {
  if (isFullscreen.value) return `${fullscreenMode.value === "browser" ? "Browser" : "Page"} fullscreenを終了`;
  return "Browser fullscreenで図を拡大";
});

onMounted(() => {
  try {
    hasSeenGuidance.value = localStorage.getItem(FULLSCREEN_GUIDANCE_KEY) === "true";
  } catch {
    // Storageを禁止した環境でも、Fullscreen操作とevent listenerは利用可能にします。
  }
  document.addEventListener("fullscreenchange", syncBrowserFullscreen);
  document.addEventListener("keydown", handleFullscreenKeydown);
});

onBeforeUnmount(() => {
  clearHoverTimer();
  clearToastTimer();
  document.removeEventListener("fullscreenchange", syncBrowserFullscreen);
  document.removeEventListener("keydown", handleFullscreenKeydown);
});

function clearHoverTimer(): void {
  if (hoverTimer === undefined) return;
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
}

function clearToastTimer(): void {
  if (toastTimer === undefined) return;
  clearTimeout(toastTimer);
  toastTimer = undefined;
}

function scheduleGuidance(): void {
  clearHoverTimer();
  hoverTimer = setTimeout(async () => {
    hoverTimer = undefined;
    guidanceVisible.value = true;
    await nextTick();
    guidancePlacement.value = findGuidancePlacement();
  }, HOVER_GUIDANCE_DELAY);
}

function hideGuidance(): void {
  clearHoverTimer();
  guidanceVisible.value = false;
}

/**
 * Diagram nodeとの重なりを候補ごとに測り、最も空いている側へ案内を置きます。
 * SVGを描画していない場合は、視線移動が小さいButton上部を選びます。
 */
function findGuidancePlacement(): GuidancePlacement {
  const button = fullscreenButton.value;
  const container = pane.value;
  if (!button || !container) return "above";

  const buttonBounds = button.getBoundingClientRect();
  const candidates: Record<GuidancePlacement, DOMRect> = {
    above: new DOMRect(buttonBounds.right - 248, buttonBounds.top - 84, 248, 72),
    left: new DOMRect(buttonBounds.left - 260, buttonBounds.top - 18, 248, 72),
    right: new DOMRect(buttonBounds.right + 12, buttonBounds.top - 18, 248, 72),
  };
  const containerBounds = container.getBoundingClientRect();
  const nodeBounds = [...container.querySelectorAll<SVGGElement>("#preview g.node")]
    .map((node) => node.getBoundingClientRect());

  return (Object.entries(candidates) as Array<[GuidancePlacement, DOMRect]>)
    .filter(([, bounds]) =>
      bounds.left >= containerBounds.left + 8 &&
      bounds.right <= containerBounds.right - 8 &&
      bounds.top >= containerBounds.top + 8)
    .sort(([, first], [, second]) =>
      overlapArea(first, nodeBounds) - overlapArea(second, nodeBounds))[0]?.[0] ?? "above";
}

function overlapArea(candidate: DOMRect, nodes: readonly DOMRect[]): number {
  return nodes.reduce((total, node) => {
    const width = Math.max(0, Math.min(candidate.right, node.right) - Math.max(candidate.left, node.left));
    const height = Math.max(0, Math.min(candidate.bottom, node.bottom) - Math.max(candidate.top, node.top));
    return total + width * height;
  }, 0);
}

async function toggleFullscreen(): Promise<void> {
  hideGuidance();

  if (isFullscreen.value) {
    await exitFullscreen();
    return;
  }

  const target = pane.value;
  if (!target) return;
  pendingFirstActivation = !hasSeenGuidance.value;

  if (document.fullscreenEnabled && target.requestFullscreen) {
    try {
      fullscreenMode.value = "browser";
      await target.requestFullscreen();
      return;
    } catch {
      // Browser policyや埋め込み環境が拒否した場合はPage fullscreenへ継続します。
    }
  }

  fullscreenMode.value = "page";
  isFullscreen.value = true;
  showEntryToast("page");
}

async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  isFullscreen.value = false;
  fullscreenMode.value = "browser";
}

function syncBrowserFullscreen(): void {
  const entered = document.fullscreenElement === pane.value;
  isFullscreen.value = entered;
  fullscreenMode.value = "browser";
  if (entered) showEntryToast("browser");
}

function handleFullscreenKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || fullscreenMode.value !== "page" || !isFullscreen.value) return;
  void exitFullscreen();
}

function markGuidanceSeen(): void {
  if (hasSeenGuidance.value) return;
  hasSeenGuidance.value = true;
  try {
    localStorage.setItem(FULLSCREEN_GUIDANCE_KEY, "true");
  } catch {
    // Persistenceはbest-effort。現在のsessionではrefが重複表示を防ぎます。
  }
}

function showEntryToast(mode: FullscreenMode): void {
  if (pendingFirstActivation) {
    showFullscreenToast(
      mode === "browser"
        ? "Browser fullscreenで開きました · Escで終了できます"
        : "Browser fullscreenを利用できないため、Page fullscreenで開きました · Escで終了できます",
    );
    markGuidanceSeen();
    pendingFirstActivation = false;
    return;
  }

  showFullscreenToast(
    `${mode === "browser" ? "Browser" : "Page"} fullscreenで表示しています · Escで終了`,
  );
}

function showFullscreenToast(message: string): void {
  clearToastTimer();
  toastMessage.value = message;
  toastTimer = setTimeout(() => {
    toastTimer = undefined;
    toastMessage.value = "";
  }, TOAST_DURATION);
}
</script>

<template>
  <article
    ref="pane"
    class="preview-pane chrome relative flex min-h-0 flex-col overflow-hidden rounded-[1.15rem]"
    :class="{ 'is-page-fullscreen': isFullscreen && fullscreenMode === 'page' }"
  >
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
        class="preview flex h-full items-center justify-center overflow-hidden p-5 sm:p-8"
        tabindex="0"
        role="region"
        aria-label="Mermaid図のPreview"
        aria-describedby="viewport-instructions viewport-status"
      />
      <span id="viewport-instructions" class="sr-only">
        矢印キーで図を移動します。プラスとマイナスキーで拡大縮小し、0キーで表示をリセットします。
        Wheelで移動し、ControlまたはCommandキーを押しながらWheelで拡大縮小できます。
      </span>
      <span id="viewport-status" class="sr-only" aria-live="polite">表示倍率 100%</span>
      <div
        id="history-preview-layer"
        class="history-preview-layer"
        aria-hidden="true"
      />
      <span id="history-preview-status" class="sr-only" aria-live="polite" />

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

      <div class="fullscreen-control">
        <div
          v-if="guidanceVisible"
          class="fullscreen-guidance"
          :data-placement="guidancePlacement"
          role="tooltip"
        >
          <strong>{{ hasSeenGuidance ? "図をFullscreenで表示" : "Browser fullscreenで開きます" }}</strong>
          <span>
            {{ hasSeenGuidance
              ? "Browserが利用できない場合はPage内で拡大します。"
              : "初回はBrowser fullscreenを使い、利用できない環境ではPage fullscreenへ切り替えます。" }}
          </span>
        </div>
        <button
          ref="fullscreenButton"
          class="action-button fullscreen-button"
          type="button"
          :aria-label="fullscreenLabel"
          :aria-pressed="isFullscreen"
          @pointerenter="scheduleGuidance"
          @pointerleave="hideGuidance"
          @focus="scheduleGuidance"
          @blur="hideGuidance"
          @click="toggleFullscreen"
        >
          <LucideGlyph :icon="fullscreenIcon" :size="19" :stroke-width="1.8" />
        </button>
      </div>

      <Transition name="fullscreen-toast">
        <div v-if="toastMessage" class="fullscreen-toast" role="status" aria-live="polite">
          {{ toastMessage }}
        </div>
      </Transition>
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

<style scoped>
.preview-pane:fullscreen,
.preview-pane.is-page-fullscreen {
  border-radius: 0;
  background: var(--color-background, #f5f5f7);
}

.preview-pane:fullscreen {
  width: 100%;
  height: 100%;
}

.preview-pane.is-page-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.fullscreen-control {
  position: absolute;
  /* 右端のSVG download actionと同じ高さで、1 control分だけ内側に並べます。 */
  right: 4.15rem;
  bottom: 1rem;
  z-index: 12;
}

.fullscreen-button {
  position: relative;
  right: auto;
  bottom: auto;
}

.fullscreen-guidance {
  position: absolute;
  width: min(15.5rem, calc(100vw - 2rem));
  padding: 0.7rem 0.8rem;
  border: 1px solid rgb(255 255 255 / 52%);
  border-radius: 0.85rem;
  background: rgb(250 250 252 / 88%);
  box-shadow: 0 12px 32px rgb(0 0 0 / 14%);
  color: #3a3a3c;
  backdrop-filter: blur(18px) saturate(150%);
  pointer-events: none;
}

.fullscreen-guidance[data-placement="above"] {
  right: 0;
  bottom: calc(100% + 0.7rem);
}

.fullscreen-guidance[data-placement="left"] {
  right: calc(100% + 0.7rem);
  bottom: -1rem;
}

.fullscreen-guidance[data-placement="right"] {
  left: calc(100% + 0.7rem);
  bottom: -1rem;
}

.fullscreen-guidance strong,
.fullscreen-guidance span {
  display: block;
}

.fullscreen-guidance strong {
  font-size: 0.75rem;
  font-weight: 650;
}

.fullscreen-guidance span {
  margin-top: 0.2rem;
  font-size: 0.6875rem;
  line-height: 1.45;
  color: #6e6e73;
}

.fullscreen-toast {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  z-index: 11;
  max-width: calc(100% - 8rem);
  padding: 0.65rem 0.85rem;
  border: 1px solid rgb(255 255 255 / 40%);
  border-radius: 999px;
  background: rgb(44 44 46 / 88%);
  box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
  color: white;
  font-size: 0.75rem;
  font-weight: 550;
  text-align: center;
  backdrop-filter: blur(16px) saturate(140%);
  transform: translateX(-50%);
}

.fullscreen-toast-enter-active,
.fullscreen-toast-leave-active {
  transition: opacity 180ms ease, transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.fullscreen-toast-enter-from,
.fullscreen-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 0.4rem) scale(0.98);
}

@media (prefers-color-scheme: dark) {
  .preview-pane:fullscreen,
  .preview-pane.is-page-fullscreen {
    background: #1c1c1e;
  }

  .fullscreen-guidance {
    border-color: rgb(255 255 255 / 10%);
    background: rgb(44 44 46 / 90%);
    color: #f2f2f7;
  }

  .fullscreen-guidance span {
    color: #aeaeb2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fullscreen-toast-enter-active,
  .fullscreen-toast-leave-active {
    transition: opacity 120ms linear;
  }

  .fullscreen-toast-enter-from,
  .fullscreen-toast-leave-to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .fullscreen-guidance,
  .fullscreen-toast {
    backdrop-filter: none;
  }

  .fullscreen-guidance {
    background: #fafafc;
  }

  .fullscreen-toast {
    background: #2c2c2e;
  }
}
</style>
