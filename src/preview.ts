import mermaid from "mermaid";

/**
 * Previewが利用者へ伝える状態です。
 *
 * `ready`は「描画に成功した」場合だけでなく、入力待ちの場合にも使います。
 * 画面に表示する詳しい意味は、同時に渡されるmessageで区別します。
 */
export type PreviewStatus = "ready" | "rendering" | "error";

/**
 * Mermaidの描画結果を画面へ反映した直後に通知する情報です。
 */
export interface PreviewRenderResult {
  /** 描画に使ったMermaid sourceです。 */
  source: string;
  /** Download時に利用できる、annotationを含まないMermaid本来のSVGです。 */
  svg: string;
}

/**
 * Preview controllerが操作するDOMと、Applicationへ返す通知をまとめた設定です。
 *
 * Controllerへ必要な要素だけを明示的に渡すことで、Module内から
 * `document.querySelector`を行わず、どのDOMを変更するかを呼び出し側から
 * 確認できるようにしています。
 */
export interface PreviewControllerOptions {
  /** Mermaid SVGまたはempty stateを表示する領域です。 */
  previewElement: HTMLElement;
  /** Mermaidのparse errorを表示する領域です。 */
  errorElement: HTMLElement;
  /** SVGをまだDownloadできない間、無効化するbuttonです。 */
  downloadButton: HTMLButtonElement;
  /**
   * Statusが変化したときに呼び出されます。
   *
   * Headerのstatus dotやtextなど、Preview外のUI更新をApplication側へ
   * 委譲するためのcallbackです。
   */
  onStatusChange: (state: PreviewStatus, message: string) => void;
  /**
   * 新しいSVGがDOMへ反映された後に呼び出されます。
   *
   * Node selectionやannotationはMermaid SVGが存在してから設定する必要が
   * あるため、このcallbackを起点に初期化します。
   */
  onRendered?: (result: PreviewRenderResult) => void;
  /**
   * 入力が空になったときに呼び出されます。
   *
   * Source range highlightなど、Preview controllerが所有しない状態を
   * 呼び出し側で片付けるために使います。
   */
  onEmpty?: () => void;
  /**
   * 現在有効な描画が失敗したときに呼び出されます。
   *
   * 古い描画処理が後から失敗しても、このcallbackは呼ばれません。
   */
  onError?: (error: unknown) => void;
  /** Key入力後に描画を始めるまでの待ち時間です。既定値は250msです。 */
  renderDelayMs?: number;
}

/**
 * Mermaid Previewを外部から操作するための小さな公開APIです。
 */
export interface PreviewController {
  /**
   * Sourceの描画を予約します。
   *
   * 短時間に繰り返し呼ぶと直前の予約を取り消すため、入力中に毎回重い
   * Mermaid renderが走ることを防げます。`delay`に0を渡すと、初期表示や
   * theme変更時に待たずに描画を開始します。
   */
  schedule(source: string, delay?: number): void;
  /** 最後に描画へ成功したSVGを返します。成功前または空入力時は空文字です。 */
  getLatestSvg(): string;
  /**
   * OSのcolor schemeを読み直してMermaidを再初期化します。
   *
   * 再初期化だけでは既存SVGは変化しないため、この後に`schedule`を呼んで
   * 現在のsourceを再描画してください。
   */
  updateTheme(): void;
  /**
   * Timerを停止し、以後到着する古い非同期結果を無効にします。
   *
   * 将来Componentのunmountや画面遷移を導入したときに、破棄済みDOMが
   * 更新されるのを防ぐためのlifecycle APIです。
   */
  destroy(): void;
}

const DEFAULT_RENDER_DELAY_MS = 250;

/**
 * Mermaidの初期化、描画予約、状態遷移を所有するControllerを作成します。
 *
 * 状態は次の順で遷移します。
 *
 * - 空入力: `ready（入力待ち）`
 * - 描画予約: `rendering`
 * - 描画成功: `ready（保存済み）`
 * - 構文・描画失敗: `error`
 *
 * Mermaidのparse/renderは非同期です。古い処理が新しい処理より遅れて完了
 * する場合があるため、連番（sequence）を発行し、最新の連番と一致する結果
 * だけをDOMへ反映します。この仕組みを一般にstale result protectionと呼びます。
 */
export function createPreviewController(
  options: PreviewControllerOptions,
): PreviewController {
  const {
    previewElement,
    errorElement,
    downloadButton,
    onStatusChange,
    onRendered,
    onEmpty,
    onError,
    renderDelayMs = DEFAULT_RENDER_DELAY_MS,
  } = options;

  let latestSvg = "";
  let renderSequence = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  initializeMermaid();

  function schedule(source: string, delay = renderDelayMs): void {
    if (destroyed) return;
    cancelTimer();

    // 予約済みまたは実行中の描画を、結果が到着する前に無効化します。
    ++renderSequence;

    if (!source.trim()) {
      latestSvg = "";
      downloadButton.disabled = true;
      showEmptyPreview(previewElement);
      hideError(errorElement);
      onEmpty?.();
      onStatusChange("ready", "コードを待っています");
      return;
    }

    onStatusChange("rendering", "描画中…");
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      void render(source);
    }, delay);
  }

  async function render(source: string): Promise<void> {
    const sequence = ++renderSequence;

    try {
      await mermaid.parse(source, { suppressErrors: false });
      const { svg, bindFunctions } = await mermaid.render(`diagram-${sequence}`, source);

      if (destroyed || sequence !== renderSequence) return;

      latestSvg = svg;
      downloadButton.disabled = false;
      previewElement.innerHTML = svg;
      bindFunctions?.(previewElement);
      hideError(errorElement);
      onRendered?.({ source, svg });
      onStatusChange("ready", "保存済み");
    } catch (error: unknown) {
      if (destroyed || sequence !== renderSequence) return;

      showError(errorElement, error);
      onError?.(error);
      onStatusChange("error", "構文を確認してください");
    }
  }

  return {
    schedule,
    getLatestSvg: () => latestSvg,
    updateTheme: initializeMermaid,
    destroy(): void {
      destroyed = true;
      cancelTimer();
      ++renderSequence;
    },
  };

  function cancelTimer(): void {
    if (renderTimer === undefined) return;
    clearTimeout(renderTimer);
    renderTimer = undefined;
  }
}

/**
 * Mermaid全体へ共通する安全性とtheme設定を適用します。
 *
 * `strict`はdiagram内のHTMLやlinkによる意図しないscript実行を制限します。
 * Editorは貼り付けられた未知のsourceを扱うため、この設定を緩めません。
 */
function initializeMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral",
  });
}

function showEmptyPreview(previewElement: HTMLElement): void {
  previewElement.innerHTML = `
    <div class="empty-preview">
      <div class="empty-preview-icon" aria-hidden="true">&lt;/&gt;</div>
      <p>コードを貼ると、ここに図が表示されます</p>
      <span>ChatGPTなどの回答にある <strong>mermaid</strong> のコード部分をコピーしてください</span>
    </div>
  `;
}

function hideError(errorElement: HTMLElement): void {
  errorElement.replaceChildren();
  errorElement.classList.add("hidden");
}

function showError(errorElement: HTMLElement, error: unknown): void {
  errorElement.textContent = readableError(error);
  errorElement.classList.remove("hidden");
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n").slice(0, 3).join(" ");
  }

  return "Mermaid構文を解析できませんでした。";
}
