# Mermaid Editor

CodeMirror 6と公式Mermaidライブラリを使った、小さなブラウザエディターです。

## 開発

```bash
corepack enable
pnpm install
pnpm dev
```

## コマンド

- `pnpm dev`: 開発サーバー
- `pnpm build`: 型チェックとプロダクションビルド
- `pnpm typecheck`: TypeScriptの型チェック

入力内容はブラウザの`localStorage`に自動保存されます。

Code reviewの運用は[Code review](docs/code-review.md)を参照してください。
