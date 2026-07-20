# Code review

このプロジェクトでは、短いimplementation cycleによる学習を優先します。
LLM code reviewは常時実行せず、必要なPull Requestで明示的に利用します。

## Manual review

- CodeRabbit: Pull Requestに`@coderabbitai review`とcommentする
- Codex Review: Pull Request上でCodexへ明示的にreviewを依頼する

Parser、serialization、データ消失、security、または広範なrefactorを含む変更は、manual reviewの候補です。

## Automatic review

CodeRabbitのautomatic reviewはRepositoryの`.coderabbit.yaml`で無効化します。

Codexのautomatic reviewはRepository内の設定ではありません。
Codexの個人またはWorkspaceのCode review settingsで無効化します。
