# Development workflow

このプロジェクトでは、短いimplementation cycleによる学習を優先します。
Remote CIは常時実行せず、Release候補に対して明示的に利用します。

## Branch

- `main`は唯一のlong-lived Branchとします。
- 作業は`feat/*`、`fix/*`、`docs/*`、`refactor/*`、`ci/*`など、変更の意図を表すBranchで行います。
- Pull Requestは`main`をbaseとし、Squash mergeします。
- 常設の`dev` Branchや`release` Branchは、複数Versionの並行保守やRelease前の長期QAが必要になるまで追加しません。

## Parallel Agent work

このSectionは、Issue #11のPilotを通して検証・改善する暫定baselineです。
実際の並列作業で得た結果はIssueへ記録し、相互干渉や過剰な手順が見つかった場合は更新します。

複数のIssueをLLM Agentが並行して扱う場合は、次の単位を対応させます。

```text
1 Issue = 1 Branch = 1 Worktree = 1 Writer
```

Main AgentはCoordinatorとしてユーザーとの対話、承認、作業の割り当て、統合、cleanupを担当します。
各Workerは割り当てられたIssueのWorktreeだけを編集し、別WorkerのWorktreeや基準となるRepositoryを編集しません。

### Worktree layout

WorktreeはRepository内ではなく、隣接する専用Directoryへ作成します。
次の例ではIssue番号をDirectory名に含め、Branchとの対応を識別できるようにします。

```text
projects/
├── mermaid-editor/                    # main / Coordinator
└── mermaid-editor-worktrees/
    ├── issue-12/                      # feat/12-node-annotation
    └── issue-N/                       # fix/N-independent-fix
```

Main Agentだけが、cleanでremoteと同期済みの`main`からWorktreeとBranchを作成します。

```bash
git status --short
git switch main
git fetch origin
git pull --ff-only
git worktree add ../mermaid-editor-worktrees/issue-12 \
  -b feat/12-node-annotation main
git worktree add ../mermaid-editor-worktrees/issue-N \
  -b fix/N-independent-fix main
```

作成後、Main AgentはWorkerへIssue、Branch、Worktree path、使用Port、編集可能範囲を明示します。
WorkerはCommit、Push、Pull Request、Merge、Worktreeの削除を行いません。

### Process and port ownership

Git WorktreeはFileとGit indexを分離しますが、ProcessやPortは分離しません。
基準となるRepositoryと各Workerへ、重複しないPortを割り当てます。

| Owner | Port |
| --- | ---: |
| Main | `5174` |
| Worker A | `5175` |
| Worker B | `5176` |

Workerは割り当てられたWorktreeでDependencyをinstallし、指定PortでDev Serverを起動します。
`strictPort`が有効なため、Portが重複した場合は別Portへ移動せず起動に失敗します。

```bash
pnpm install
pnpm dev --port 5175
```

### Child Agents

Workerは調査や検証を高速化するためにChild Agentを起動できます。
ただし、WorktreeのWriterは同時に1体だけとします。

- Child Agentをread-onlyの調査や検証に使う場合、Workerは引き続きWriterになれます。
- Child Agentへ編集を委譲する場合、Workerはその間編集せず、Writer ownershipを明示的にhandoffします。
- Child Agentも割り当てられたIssueとWorktreeの外を変更しません。

### Status and integration

Main Agentは次のCommandでWorktreeと変更状態を確認します。

```bash
git worktree list --porcelain
git -C ../mermaid-editor-worktrees/issue-12 status --short --branch
git -C ../mermaid-editor-worktrees/issue-N status --short --branch
```

Workerの完了報告には、変更File、設計上の判断、実行したverification、残っている懸念を含めます。
Main AgentはDiffとverification結果を確認し、ユーザーの承認後に対象WorktreeでCommitし、Push、Pull Request、Mergeを行います。

```bash
git -C ../mermaid-editor-worktrees/issue-12 add <files>
git -C ../mermaid-editor-worktrees/issue-12 commit
```

2つのIssueが同じFileの同じ領域を変更する場合や、一方の変更が他方の前提になる場合は、無理に並行せず統合順を決めて直列化します。

### Safe cleanup

Merge後のcleanupはMain Agentだけが行います。
次の条件をすべて確認するまでWorktreeを削除しません。

- WorkerとChild Agentが停止している
- Dev ServerなどWorktreeを使用するProcessが停止している
- `git status`に未Commitの変更や未追跡Fileがない
- 必要な変更がMerge済み、または不要であることをユーザーが確認している

通常のcleanupでは`--force`を使いません。
未Commitの変更があれば`git worktree remove`が失敗するため、破棄せず状況を確認します。

```bash
git worktree remove ../mermaid-editor-worktrees/issue-12
git worktree prune
```

Squash mergeでは、Feature BranchのCommit自体は`main`のancestorにならないため、`git branch -d`は通常失敗します。
Pull RequestがMerge済みで、Diffが`main`へ反映され、Branchにだけ残すべき変更がないことを確認したうえで、ユーザーの承認後にlocalとremoteのBranchを削除します。
確認または承認が取れない場合は、`-D`へ切り替えずBranchを保持します。

```bash
git branch -D feat/12-node-annotation
git push origin --delete feat/12-node-annotation
```

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
