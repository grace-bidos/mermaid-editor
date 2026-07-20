import {
  redo as redoCommand,
  redoDepth,
  undo as undoCommand,
  undoDepth,
} from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  onBeforeUnmount,
  onMounted,
  watch,
  type Ref,
  type ShallowRef,
} from "vue";
import type { SourceRange } from "../flowchart";

/** CodeMirrorからApplicationへ通知するeventです。 */
export interface CodeMirrorCallbacks {
  /** Source documentが編集された直後に呼ばれます。 */
  onSourceChange?: (source: string) => void;
  /** Cursorだけが移動したとき、そのUTF-16 offsetを通知します。 */
  onCaretChange?: (position: number) => void;
  /** Pointer直下のUTF-16 offsetを通知します。Editor外では`null`です。 */
  onSourceHover?: (position: number | null) => void;
}

/**
 * Vue Componentから利用するCodeMirrorの公開APIです。
 *
 * CodeMirrorは通常の`textarea`とは異なり、documentだけでなくselection、
 * undo history、Decorationも独自のStateとして持ちます。このAPIを通すことで、
 * VueがCodeMirrorの内部DOMやStateを直接書き換えることを防ぎます。
 */
export interface CodeMirrorApi {
  /** 現在のMermaid sourceを返します。 */
  getSource(): string;
  /** 現在のmain cursor位置をUTF-16 offsetで返します。 */
  getCaretPosition(): number;
  /**
   * Document全体を一つのtransactionで置き換えます。
   *
   * WYSIWYG操作からsourceを更新するときに使います。一つのtransactionなので、
   * この変更もCodeMirrorのundo historyへ一操作として記録されます。
   */
  replaceSource(source: string): void;
  /** Preview Nodeに対応するsource rangeをDecorationとして表示します。 */
  setSourceHighlights(ranges: readonly SourceRange[]): void;
  /** CodeMirrorのhistoryを使って一操作戻します。 */
  undo(): boolean;
  /** CodeMirrorのhistoryを使って一操作やり直します。 */
  redo(): boolean;
  /**
   * Documentを変更せず、UndoまたはRedo後のsourceを読み取ります。
   *
   * CodeMirrorのhistoryを一度進め、同じtask内で必ず元へ戻すため、画面には
   * 現在のdocumentだけが描画されます。Previewはこの値を予告表示に使います。
   */
  peekHistory(direction: "undo" | "redo"): string | null;
  /** Editorへkeyboard focusを移します。 */
  focus(): void;
}

/** `defineExpose`前など、Editor生成前にも安全に呼べる空のAPIです。 */
const EMPTY_API: CodeMirrorApi = {
  getSource: () => "",
  getCaretPosition: () => 0,
  replaceSource: () => undefined,
  setSourceHighlights: () => undefined,
  undo: () => false,
  redo: () => false,
  peekHistory: () => null,
  focus: () => undefined,
};

const setSourceHighlights = StateEffect.define<readonly SourceRange[]>();

/**
 * Nodeと対応するsource rangeをCodeMirrorのDecorationとして保持します。
 *
 * `transaction.changes`で既存Decorationを移動させるため、その手前に文字が
 * 入力されてもhighlight位置が自動的に追従します。
 */
const sourceHighlightField = StateField.define({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (!effect.is(setSourceHighlights)) continue;
      next = Decoration.set(
        effect.value.map(({ from, to }) =>
          Decoration.mark({ class: "cm-node-source-correspondence" }).range(from, to),
        ),
        true,
      );
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * CodeMirrorのlifecycleとVueの`v-model`同期を管理します。
 *
 * State ownershipの境界は次のとおりです。
 *
 * - Vue: Application全体で共有するMermaid source
 * - CodeMirror: document、selection、history、Decoration
 *
 * Vueからsourceが変更された場合もEditorを作り直さず、一つのtransactionで
 * 既存documentを更新します。これによりcursorやundo historyを維持できます。
 */
export function useCodeMirror(
  host: Readonly<ShallowRef<HTMLDivElement | null>>,
  model: Ref<string>,
  callbacks: CodeMirrorCallbacks = {},
): CodeMirrorApi {
  let view: EditorView | null = null;
  let isPeekingHistory = false;

  onMounted(() => {
    if (!host.value) {
      throw new Error("CodeMirrorをmountする要素が見つかりません。");
    }

    view = new EditorView({
      doc: model.value,
      parent: host.value,
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
          mousemove(event, currentView) {
            callbacks.onSourceHover?.(
              currentView.posAtCoords({ x: event.clientX, y: event.clientY }),
            );
          },
          mouseleave() {
            callbacks.onSourceHover?.(null);
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet && !update.docChanged) {
            callbacks.onCaretChange?.(update.state.selection.main.head);
          }
          if (!update.docChanged) return;
          if (isPeekingHistory) return;

          const source = update.state.doc.toString();
          model.value = source;
          callbacks.onSourceChange?.(source);
        }),
      ],
    });
  });

  /*
   * Visual editorや保存データの復元など、CodeMirror以外からmodelが変わった
   * 場合の同期です。Editor入力に由来する変更は文字列が既に一致するので、
   * 二重transactionにはなりません。
   */
  watch(model, (source) => {
    if (!view || source === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
    });
  });

  onBeforeUnmount(() => {
    view?.destroy();
    view = null;
  });

  return {
    ...EMPTY_API,
    getSource: () => view?.state.doc.toString() ?? model.value,
    getCaretPosition: () => view?.state.selection.main.head ?? 0,
    replaceSource(source) {
      if (!view) {
        model.value = source;
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: 0 },
      });
    },
    setSourceHighlights(ranges) {
      view?.dispatch({ effects: setSourceHighlights.of(ranges) });
    },
    undo: () => (view ? undoCommand(view) : false),
    redo: () => (view ? redoCommand(view) : false),
    peekHistory(direction) {
      if (!view) return null;
      const canMove = direction === "undo" ? undoDepth(view.state) > 0 : redoDepth(view.state) > 0;
      if (!canMove) return null;

      isPeekingHistory = true;
      try {
        const moved = direction === "undo" ? undoCommand(view) : redoCommand(view);
        if (!moved) return null;
        const previewSource = view.state.doc.toString();
        const restored = direction === "undo" ? redoCommand(view) : undoCommand(view);
        return restored ? previewSource : null;
      } finally {
        isPeekingHistory = false;
      }
    },
    focus: () => view?.focus(),
  };
}
