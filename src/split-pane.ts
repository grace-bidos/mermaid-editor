/** 初回表示とdouble-click resetで使用するcode paneの比率です。 */
export const DEFAULT_SPLIT_PERCENT = 32;
/** previewが狭くなりすぎないようにするcode pane比率の下限です。 */
export const MIN_SPLIT_PERCENT = 18;
/** code paneがpreviewを押し出さないようにする比率の上限です。 */
export const MAX_SPLIT_PERCENT = 68;

/**
 * Split paneを初期化するときに必要なDOMと外部への通知をまとめます。
 *
 * `SplitPaneOptions`がDOM queryや保存処理を受け取ることで、このmoduleは
 * Application全体を知らずにresizeという一つの責務へ集中できます。
 */
export interface SplitPaneOptions {
  /** CSS custom property `--editor-height`を設定するworkspace要素。 */
  workspace: HTMLElement;
  /** Pointerとkeyboard操作を受け取る`role="separator"`要素。 */
  splitter: HTMLElement;
  /** 起動時に復元する比率。省略時はdefault値を使用します。 */
  initialPercent?: number | null;
  /** 比率が変化したときに呼ばれます。Persistenceへの保存などに利用します。 */
  onPercentChange?: (percent: number) => void;
}

/**
 * 上下paneのresize interactionを有効にします。
 *
 * Pointer操作に加え、Arrow key、Home、End、double-clickを提供します。
 * StateはCSS custom propertyとseparatorの`aria-valuenow`へ同期されるため、
 * 見た目とaccessibility treeが同じ値を参照できます。
 *
 * @param options - Split paneが操作する要素、初期値、変更通知。
 * @returns Listenerを解除するcleanup関数。画面を破棄するときに呼び出します。
 */
export function createSplitPane(options: SplitPaneOptions): () => void {
  const { workspace, splitter, onPercentChange } = options;

  const setPercent = (percent: number): void => {
    const clamped = Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, percent));
    workspace.style.setProperty("--editor-height", `${clamped}%`);
    splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
    onPercentChange?.(clamped);
  };

  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");

    const updateFromPointer = (moveEvent: PointerEvent): void => {
      const bounds = workspace.getBoundingClientRect();
      const percent = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      setPercent(percent);
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
  };

  const resizeWithKeyboard = (event: KeyboardEvent): void => {
    const current = Number(splitter.getAttribute("aria-valuenow")) || DEFAULT_SPLIT_PERCENT;
    const step = event.shiftKey ? 10 : 2;
    let next = current;

    if (event.key === "ArrowUp") next -= step;
    else if (event.key === "ArrowDown") next += step;
    else if (event.key === "Home") next = MIN_SPLIT_PERCENT;
    else if (event.key === "End") next = MAX_SPLIT_PERCENT;
    else return;

    event.preventDefault();
    setPercent(next);
  };

  const reset = (): void => setPercent(DEFAULT_SPLIT_PERCENT);

  splitter.addEventListener("pointerdown", startResize);
  splitter.addEventListener("keydown", resizeWithKeyboard);
  splitter.addEventListener("dblclick", reset);
  setPercent(options.initialPercent ?? DEFAULT_SPLIT_PERCENT);

  return () => {
    document.body.classList.remove("is-resizing");
    splitter.removeEventListener("pointerdown", startResize);
    splitter.removeEventListener("keydown", resizeWithKeyboard);
    splitter.removeEventListener("dblclick", reset);
  };
}
