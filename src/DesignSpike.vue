<script setup lang="ts">
import { Check, Clipboard, ExternalLink, createElement } from "lucide";
import { computed, onMounted, reactive, ref } from "vue";
import PrototypeDemo, {
  type PrototypeKind,
} from "./components/PrototypeDemo.vue";
import {
  createDecisionState,
  flattenDecisionTopics,
  serializeDecisionGroups,
  type DecisionGroup,
} from "./spike/decision-spike";

const baselineDecisions = [
  { topic: "fullscreen.default", label: "Browser fullscreen", id: "native-with-fallback" },
  { topic: "zoom", label: "WheelでPan", id: "document-like" },
  { topic: "pan", label: "背景をDrag", id: "background-drag" },
  { topic: "tooltipPlacement", label: "Node近傍へ表示", id: "adaptive-floating" },
] as const;

const groups: readonly DecisionGroup<PrototypeKind>[] = [
  {
    id: "fullscreen.presentation",
    title: "Fullscreenの見分け方",
    summary: "Browser fullscreenをdefaultとし、Page fullscreenとの違いをButtonで伝えます。",
    topics: [
      {
        id: "fullscreen.buttonAppearance",
        title: "Button appearance",
        question: "二つのFullscreen modeをどの見た目で区別するか",
        options: [
          {
            id: "stateful-single",
            label: "状態で変わる単一Button",
            summary: "選択中のModeに合わせてIconとColorを変更",
            prototype: "fullscreen-button-stateful",
          },
          {
            id: "explicit-dual",
            label: "二つを常時表示",
            summary: "BrowserとPageをSegmented controlで並べる",
            prototype: "fullscreen-button-dual",
            recommended: true,
          },
          {
            id: "primary-with-menu",
            label: "Primary + Menu",
            summary: "Browserを主Button、PageをMenu内に配置",
            prototype: "fullscreen-button-menu",
          },
        ],
      },
    ],
  },
  {
    id: "fullscreen.guidance",
    title: "Fullscreenの初回案内",
    summary: "Browserが表示する上部通知の正確な範囲は取得できないため、重なりにくい位置を比較します。",
    topics: [
      {
        id: "fullscreen.guidanceTrigger",
        title: "案内を出すTrigger",
        question: "DefaultがBrowser fullscreenであることを、いつ説明するか",
        options: [
          {
            id: "delayed-hover",
            label: "一定時間Hover",
            summary: "700ms留まった場合だけ表示",
            prototype: "guidance-hover",
          },
          {
            id: "first-activation",
            label: "初回Click",
            summary: "最初にFullscreenを使った瞬間だけ表示",
            prototype: "guidance-first-use",
          },
          {
            id: "hover-and-first-use",
            label: "Hover + 初回Click",
            summary: "事前説明と見逃し防止を両立",
            prototype: "guidance-both",
            recommended: true,
          },
        ],
      },
      {
        id: "fullscreen.guidancePlacement",
        title: "案内を出す場所",
        question: "Browserの上部通知と競合しにくく、視線から外れない場所はどこか",
        options: [
          {
            id: "anchored-popover",
            label: "Button直下",
            summary: "操作元との関係が明確",
            prototype: "guidance-anchored",
          },
          {
            id: "safe-top-banner",
            label: "上部Banner",
            summary: "Browser通知を避ける余白を取って表示",
            prototype: "guidance-top",
          },
          {
            id: "bottom-toast",
            label: "下部Toast",
            summary: "Browser上部通知との重なりを避ける",
            prototype: "guidance-bottom",
            recommended: true,
          },
        ],
      },
    ],
  },
  {
    id: "edge.reconnect",
    title: "Edge reconnectの再比較",
    summary: "BとCの間で接続先が実際に変わるPrototypeへ修正しました。",
    topics: [
      {
        id: "edgeReconnect.behavior",
        title: "Endpointの指定",
        question: "Edgeを掴む操作と正確なFallbackをどう組み合わせるか",
        options: [
          {
            id: "nearest-endpoint",
            label: "線を直接Drag",
            summary: "掴んだ位置に近いEndpointを自動選択",
            prototype: "edge-nearest",
          },
          {
            id: "explicit-handles",
            label: "Endpoint handle",
            summary: "変更する端をHandleで明示",
            prototype: "edge-handles",
          },
          {
            id: "handles-with-toolbar",
            label: "Handle + Toolbar",
            summary: "Dragに加えてSelectでも接続先を変更",
            prototype: "edge-handle-toolbar",
            recommended: true,
          },
        ],
      },
    ],
  },
];

const topics = flattenDecisionTopics(groups);
const initialState = createDecisionState(groups);
const selections = reactive(initialState.selections);
const notes = reactive(initialState.notes);
const copyIcon = ref<HTMLSpanElement | null>(null);
const copied = ref(false);
const copyFailed = ref(false);

const completedCount = computed(
  () => Object.values(selections).filter((selection) => selection !== null).length,
);
const decisionJson = computed(() =>
  JSON.stringify(
    {
      schema: "mermaid-editor.interaction-decisions/v2",
      generatedAt: new Date().toISOString(),
      baselineDecisions,
      decisionGroups: serializeDecisionGroups(groups, { selections, notes }),
    },
    null,
    2,
  ),
);

onMounted(() => setCopyIcon(Clipboard));

async function copyDecisions(): Promise<void> {
  copyFailed.value = false;
  try {
    await writeClipboard(decisionJson.value);
    copied.value = true;
    setCopyIcon(Check);
  } catch {
    copyFailed.value = true;
  }

  window.setTimeout(() => {
    copied.value = false;
    copyFailed.value = false;
    setCopyIcon(Clipboard);
  }, 1400);
}

function chooseRecommended(): void {
  for (const topic of topics) {
    const recommended = topic.options.find((option) => option.recommended);
    if (recommended) selections[topic.id] = recommended.id;
  }
}

function setCopyIcon(icon: Parameters<typeof createElement>[0]): void {
  copyIcon.value?.replaceChildren(
    createElement(icon, {
      width: 18,
      height: 18,
      "stroke-width": 1.9,
      "aria-hidden": "true",
    }),
  );
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissionがない埋め込み環境では、selectionを使うfallbackへ進みます。
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  textarea.remove();
  if (!succeeded) throw new Error("Clipboardへのcopyに失敗しました。");
}
</script>

<template>
  <main class="spike-page">
    <header class="spike-header">
      <div>
        <p class="spike-eyebrow">Interaction Decision Spike</p>
        <h1>FullscreenとEdgeを、もう一段決める</h1>
        <p>前回の決定を固定し、未決の部分だけを階層化して比較します。</p>
      </div>
      <a href="/" class="spike-back">
        Editorへ戻る
        <ExternalLink :size="15" aria-hidden="true" />
      </a>
    </header>

    <div class="spike-progress" aria-live="polite">
      <span>{{ completedCount }} / {{ topics.length }} 選択済み</span>
      <button type="button" @click="chooseRecommended">推奨案をまとめて選択</button>
    </div>

    <section class="spike-baseline" aria-labelledby="baseline-title">
      <div>
        <p class="spike-eyebrow">Accepted baseline</p>
        <h2 id="baseline-title">前回採用した仕様</h2>
      </div>
      <div class="spike-baseline-list">
        <span v-for="decision in baselineDecisions" :key="decision.topic">
          <small>{{ decision.topic }}</small>
          {{ decision.label }}
        </span>
      </div>
    </section>

    <section v-for="(group, groupIndex) in groups" :key="group.id" class="spike-group">
      <div class="spike-group-heading">
        <span>{{ groupIndex + 1 }}</span>
        <div>
          <p class="spike-eyebrow">{{ group.id }}</p>
          <h2>{{ group.title }}</h2>
          <p>{{ group.summary }}</p>
        </div>
      </div>

      <section
        v-for="topic in group.topics"
        :key="topic.id"
        class="spike-topic"
        :aria-labelledby="`${topic.id}-title`"
      >
        <div class="spike-topic-heading">
          <div>
            <h3 :id="`${topic.id}-title`">{{ topic.title }}</h3>
            <p>{{ topic.question }}</p>
          </div>
        </div>

        <div class="spike-options" :style="{ '--option-count': Math.min(topic.options.length, 3) }">
          <article
            v-for="option in topic.options"
            :key="option.id"
            class="spike-option"
            :class="{ 'is-selected': selections[topic.id] === option.id }"
          >
            <label class="spike-option-choice">
              <input
                v-model="selections[topic.id]"
                type="radio"
                :name="topic.id"
                :value="option.id"
              />
              <span class="spike-radio" aria-hidden="true" />
              <span class="spike-option-copy">
                <span>
                  <strong>{{ option.label }}</strong>
                  <small v-if="option.recommended">推奨</small>
                </span>
                <span>{{ option.summary }}</span>
              </span>
            </label>
            <PrototypeDemo :kind="option.prototype" />
          </article>
        </div>

        <label class="spike-note">
          <span>別案、条件、気になったこと</span>
          <textarea
            v-model="notes[topic.id]"
            rows="2"
            placeholder="例：Touchでは別の挙動にしたい"
          />
        </label>
      </section>
    </section>

    <section class="spike-output">
      <div>
        <p class="spike-eyebrow">Decision output</p>
        <h2>Agentへ渡す仕様候補</h2>
        <p>未選択の項目もnullとして残るため、決め忘れをAgent側で確認できます。</p>
      </div>
      <pre>{{ decisionJson }}</pre>
      <button type="button" class="spike-copy" @click="copyDecisions">
        <span ref="copyIcon" aria-hidden="true" />
        <span>{{ copied ? "コピーしました" : copyFailed ? "コピーできませんでした" : "JSONをコピー" }}</span>
      </button>
    </section>
  </main>
</template>

<style scoped>
.spike-page {
  width: min(74rem, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2.5rem 0 5rem;
}

.spike-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  margin-bottom: 1.5rem;
}

.spike-eyebrow {
  margin: 0 0 0.45rem;
  color: #007aff;
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.spike-header h1,
.spike-output h2 {
  margin: 0;
  color: #1d1d1f;
  letter-spacing: -0.035em;
}

.spike-header h1 {
  font-size: clamp(1.75rem, 4vw, 2.6rem);
  line-height: 1.08;
}

.spike-header p:not(.spike-eyebrow),
.spike-output p:not(.spike-eyebrow) {
  margin: 0.65rem 0 0;
  color: #6e6e73;
  font-size: 0.875rem;
  line-height: 1.6;
}

.spike-back,
.spike-progress button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 0;
  background: none;
  color: #007aff;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 650;
  text-decoration: none;
}

.spike-progress {
  position: sticky;
  z-index: 20;
  top: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 0.9rem;
  background: rgb(255 255 255 / 76%);
  box-shadow: 0 7px 24px rgb(0 0 0 / 7%);
  color: #3a3a3c;
  font-size: 0.75rem;
  font-weight: 650;
  backdrop-filter: blur(20px) saturate(180%);
}

.spike-group,
.spike-baseline,
.spike-output {
  margin-top: 1rem;
  padding: 1.15rem;
  border: 1px solid rgb(255 255 255 / 90%);
  border-radius: 1.25rem;
  background: rgb(255 255 255 / 70%);
  box-shadow: 0 10px 34px rgb(0 0 0 / 6%);
  backdrop-filter: blur(22px) saturate(170%);
}

.spike-baseline {
  display: grid;
  gap: 0.85rem;
}

.spike-baseline h2,
.spike-group-heading h2 {
  margin: 0;
  color: #1d1d1f;
  font-size: 1rem;
}

.spike-baseline-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.spike-baseline-list > span {
  display: grid;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgb(36 138 61 / 16%);
  border-radius: 0.65rem;
  background: rgb(236 253 240 / 70%);
  color: #1d1d1f;
  font-size: 0.6875rem;
  font-weight: 650;
}

.spike-baseline-list small {
  color: #248a3d;
  font-size: 0.525rem;
}

.spike-group-heading {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.spike-group-heading > span {
  display: grid;
  width: 1.65rem;
  height: 1.65rem;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: #007aff;
  color: white;
  font-size: 0.6875rem;
  font-weight: 750;
}

.spike-group-heading .spike-eyebrow {
  margin-bottom: 0.2rem;
}

.spike-group-heading p:last-child {
  margin: 0.3rem 0 0;
  color: #6e6e73;
  font-size: 0.75rem;
  line-height: 1.45;
}

.spike-topic {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgb(118 118 128 / 12%);
}

.spike-topic-heading {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.spike-topic-heading h3 {
  margin: 0;
  color: #1d1d1f;
  font-size: 0.875rem;
  letter-spacing: -0.015em;
}

.spike-topic-heading p {
  margin: 0.25rem 0 0;
  color: #6e6e73;
  font-size: 0.75rem;
}

.spike-options {
  --option-count: 2;
  display: grid;
  grid-template-columns: repeat(var(--option-count), minmax(0, 1fr));
  gap: 0.75rem;
}

.spike-option {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid rgb(118 118 128 / 14%);
  border-radius: 1rem;
  background: rgb(255 255 255 / 58%);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.spike-option:hover {
  border-color: rgb(0 122 255 / 28%);
}

.spike-option.is-selected {
  border-color: rgb(0 122 255 / 58%);
  background: rgb(238 246 255 / 82%);
  box-shadow: 0 0 0 3px rgb(0 122 255 / 10%);
}

.spike-option-choice {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.65rem;
  align-items: start;
  cursor: pointer;
}

.spike-option-choice > input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.spike-option:has(input:focus-visible) {
  outline: 3px solid rgb(0 122 255 / 26%);
  outline-offset: 2px;
}

.spike-radio {
  display: block;
  width: 1.1rem;
  height: 1.1rem;
  margin-top: 0.08rem;
  border: 1.5px solid rgb(118 118 128 / 48%);
  border-radius: 999px;
  background: white;
  box-shadow: inset 0 0 0 0.22rem white;
}

.spike-option.is-selected .spike-radio {
  border-color: #007aff;
  background: #007aff;
}

.spike-option-copy {
  display: grid;
  gap: 0.22rem;
  min-height: 3rem;
}

.spike-option-copy > span:first-child {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.spike-option-copy strong {
  color: #1d1d1f;
  font-size: 0.8125rem;
}

.spike-option-copy small {
  padding: 0.15rem 0.38rem;
  border-radius: 999px;
  background: rgb(0 122 255 / 10%);
  color: #007aff;
  font-size: 0.5625rem;
  font-weight: 750;
}

.spike-option-copy > span:last-child {
  color: #6e6e73;
  font-size: 0.6875rem;
  line-height: 1.45;
}

.spike-note {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.8rem;
}

.spike-note > span {
  color: #6e6e73;
  font-size: 0.6875rem;
  font-weight: 650;
}

.spike-note textarea {
  width: 100%;
  resize: vertical;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgb(118 118 128 / 18%);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 72%);
  color: #1d1d1f;
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
}

.spike-note textarea:focus {
  border-color: rgb(0 122 255 / 55%);
  box-shadow: 0 0 0 3px rgb(0 122 255 / 12%);
  outline: none;
}

.spike-output {
  position: relative;
}

.spike-output pre {
  max-height: 24rem;
  overflow: auto;
  margin: 1rem 0 0;
  padding: 1rem;
  border-radius: 0.85rem;
  background: #1d1d1f;
  color: #f5f5f7;
  font: 0.6875rem/1.6 var(--font-code);
}

.spike-copy {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  border: 0;
  border-radius: 0.7rem;
  background: #007aff;
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
}

.spike-copy:active {
  transform: scale(0.97);
}

@media (max-width: 720px) {
  .spike-page {
    width: min(100% - 1rem, 40rem);
    padding-top: 1rem;
  }

  .spike-header {
    display: grid;
  }

  .spike-options {
    grid-template-columns: 1fr;
  }
}

@media (prefers-color-scheme: dark) {
  .spike-header h1,
  .spike-topic-heading h3,
  .spike-group-heading h2,
  .spike-baseline h2,
  .spike-option-copy strong,
  .spike-output h2 {
    color: #f5f5f7;
  }

  .spike-progress,
  .spike-group,
  .spike-baseline,
  .spike-output,
  .spike-option,
  .spike-note textarea {
    border-color: rgb(255 255 255 / 10%);
    background: rgb(28 28 30 / 78%);
    color: #f5f5f7;
  }

  .spike-option.is-selected {
    border-color: rgb(10 132 255 / 65%);
    background: rgb(10 70 125 / 34%);
  }

  .spike-baseline-list > span {
    border-color: rgb(48 209 88 / 20%);
    background: rgb(20 83 45 / 34%);
    color: #f5f5f7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spike-option {
    transition: none;
  }
}
</style>
