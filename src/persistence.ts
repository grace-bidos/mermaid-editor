const DOCUMENT_STORAGE_KEY = "mermaid-editor:document:v2";
const SPLIT_STORAGE_KEY = "mermaid-editor:split";

/**
 * Browserに保存する、Mermaid Editorの小さな設定を表します。
 *
 * UI moduleが`localStorage`のkeyを直接知ると、保存方法を変更するたびに
 * 複数のFeatureを修正する必要があります。このinterfaceを境界にすることで、
 * 呼び出し側は「何を保存するか」だけを扱い、「どこへ保存するか」を意識せずに済みます。
 */
export interface EditorPersistence {
  /** 前回編集していたMermaid sourceを返します。未保存の場合は空文字です。 */
  loadDocument(): string;
  /** 現在のMermaid sourceを保存します。 */
  saveDocument(source: string): void;
  /** 保存済みのcode pane比率を返します。不正値や未保存の場合は`null`です。 */
  loadSplitPercent(): number | null;
  /** code pane比率を保存します。 */
  saveSplitPercent(percent: number): void;
}

/**
 * `localStorage`を利用するPersistence adapterを生成します。
 *
 * `Storage`を引数として受け取るため、本番では`window.localStorage`を使いつつ、
 * 将来のunit testではmemory上のStorageへ差し替えられます。
 *
 * @param storage - 読み書きに使用するWeb Storage。通常は`localStorage`です。
 * @returns Documentとsplit比率を読み書きするAPI。
 */
export function createEditorPersistence(storage: Storage): EditorPersistence {
  return {
    loadDocument: () => storage.getItem(DOCUMENT_STORAGE_KEY) ?? "",
    saveDocument: (source) => storage.setItem(DOCUMENT_STORAGE_KEY, source),
    loadSplitPercent: () => {
      const storedValue = storage.getItem(SPLIT_STORAGE_KEY);
      if (storedValue === null) return null;

      const percent = Number(storedValue);
      return Number.isFinite(percent) && percent > 0 ? percent : null;
    },
    saveSplitPercent: (percent) => storage.setItem(SPLIT_STORAGE_KEY, String(percent)),
  };
}
