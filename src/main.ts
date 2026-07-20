import { basicSetup } from "codemirror";
import { redo, undo } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, placeholder } from "@codemirror/view";
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
import {
  type SourceRange,
} from "./flowchart";
import { createNodeInteraction } from "./node-interaction";
import { createEditorPersistence } from "./persistence";
import { createPreviewController, type PreviewStatus } from "./preview";
import {
  createSplitPane,
  DEFAULT_SPLIT_PERCENT,
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
} from "./split-pane";
import "./style.css";

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
const persistence = createEditorPersistence(localStorage);

setButtonIcon(copyButton, Copy);
setButtonIcon(downloadButton, Download);
setButtonIcon(undoButton, Undo2, 17);
setButtonIcon(redoButton, Redo2, 17);
setButtonIcon(addNodeButton, Plus, 17);
setButtonIcon(deleteNodeButton, Trash2, 17);

const setSourceHighlights = StateEffect.define<readonly SourceRange[]>();
const sourceHighlightField = StateField.define({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setSourceHighlights)) {
        next = Decoration.set(
          effect.value.map(({ from, to }) =>
            Decoration.mark({ class: "cm-node-source-correspondence" }).range(from, to),
          ),
          true,
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const initialDocument = persistence.loadDocument();
createSplitPane({
  workspace,
  splitter,
  initialPercent: persistence.loadSplitPercent(),
  onPercentChange: persistence.saveSplitPercent,
});
let editor!: EditorView;
const nodeInteraction = createNodeInteraction({
  elements: {
    preview,
    visualControls,
    nodeToolbar,
    directionSelect,
    shapeSelect,
  },
  editor: {
    getCaretPosition: () => editor.state.selection.main.head,
    replaceSource: (source) => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: source },
        selection: { anchor: 0 },
      });
    },
    setSourceHighlights: (ranges) => {
      editor.dispatch({ effects: setSourceHighlights.of(ranges) });
    },
  },
  setStatus,
});
const previewController = createPreviewController({
  previewElement: preview,
  errorElement: errorPanel,
  downloadButton,
  onStatusChange: setStatus,
  onRendered: ({ source }) => nodeInteraction.configureRendered(source),
  onEmpty: nodeInteraction.clearCorrespondence,
  onError: nodeInteraction.clearCorrespondence,
});

editor = new EditorView({
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
    sourceHighlightField,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        nodeInteraction.updateSourceHover(view.posAtCoords({ x: event.clientX, y: event.clientY }));
      },
      mouseleave() {
        nodeInteraction.updateSourceHover(null);
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet && !update.docChanged) {
        nodeInteraction.updateCaret(update.state.selection.main.head);
      }
      if (!update.docChanged) return;

      const source = update.state.doc.toString();
      nodeInteraction.handleSourceChange();
      persistence.saveDocument(source);
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
directionSelect.addEventListener("change", nodeInteraction.changeDirection);
shapeSelect.addEventListener("change", nodeInteraction.changeSelectedShape);
addNodeButton.addEventListener("click", nodeInteraction.addNodeAfterSelection);
deleteNodeButton.addEventListener("click", nodeInteraction.deleteSelectedNode);
preview.addEventListener("click", nodeInteraction.clearNodeSelection);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  previewController.updateTheme();
  scheduleRender(editor.state.doc.toString(), 0);
});

scheduleRender(initialDocument, 0);

function scheduleRender(source: string, delay?: number): void {
  previewController.schedule(source, delay);
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
  const latestSvg = previewController.getLatestSvg();
  if (!latestSvg) return;

  const blob = new Blob([latestSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "diagram.svg";
  anchor.click();
  URL.revokeObjectURL(url);
}

function setStatus(state: PreviewStatus, message: string): void {
  statusDot.dataset.state = state;
  statusText.textContent = message;
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

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}
