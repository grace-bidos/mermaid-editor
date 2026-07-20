# Development workflow

このプロジェクトでは、短いimplementation cycleによる学習を優先します。
Remote CIは常時実行せず、Release候補に対して明示的に利用します。

## Branch

- `main`は唯一のlong-lived Branchとします。
- 作業は`feat/*`、`fix/*`、`docs/*`、`refactor/*`、`ci/*`など、変更の意図を表すBranchで行います。
- Pull Requestは`main`をbaseとし、Squash mergeします。
- 常設の`dev` Branchや`release` Branchは、複数Versionの並行保守やRelease前の長期QAが必要になるまで追加しません。

## Local verification

Pull RequestをReadyにする前に、次のverificationをlocalで実行します。

```bash
pnpm typecheck
pnpm build
```

## CI and release

通常のPull Requestや`main`へのpushでは、remote CIを実行しません。

CIは次の場合に実行します。

- GitHub Actionsの`Run workflow`から手動実行する
- `v0.1.0`のような`v*` Tagをpushする

CIが成功したCommitをGitHub Releaseの対象にします。
