# @young1lin/dsh-ui-gitworkbench 知识库导航

> 这是 dsh (DeepSeek Harness) 的**树外 Web UI 插件**：在每个会话头放一枚 git 变更统计芯片，点开是完整抽屉（文件树 / 逐文件 diff / 历史 / 对比 / 暂存提交 / fetch-pull-push 同步）。另含 worktree 仿真（agent 工具）。宿主仓库是本仓库的兄弟目录 `../deepseek-harness`，**绝不可修改**。

## 域导航

| 域 | 回答什么 | 入口 |
|---|---|---|
| [stats-drawer](stats-drawer/overview.md) | 芯片与抽屉：统计轮询、文件树、diff 渲染（词级+语法高亮）、历史/对比、主题与自定义样式 | [overview](stats-drawer/overview.md) |
| [write-ops](write-ops/overview.md) | 勾选=git add、乐观更新队列、提交、fetch/pull/push 的安全设计 | [overview](write-ops/overview.md) |
| [worktree-emulation](worktree-emulation/overview.md) | 会话级 worktree 绑定、enter/exit 生命周期、原子持久化、agent 工具 | [overview](worktree-emulation/overview.md) |
| [plugin-loading](plugin-loading/overview.md) | 两半架构（tsc/tsdown）、@Remote 发现机制、bundle 纯度门、安装与打包 | [overview](plugin-loading/overview.md) |

## 一分钟理解

- **宿主半**（`src/index.ts` 的 `GitWorkbenchService extends TypertRemoteService`）跑 git、存状态，18 个 `@Remote` 端点；
- **客户端半**（`src/client/**`）是 React 面板，注册进 `conversation.session.header.actions` 插槽，经 `connection.rpc` 要数据；
- 勾选是真 git 调用（乐观 + 队列，不丢点击）；worktree 是真 `git worktree`（绑定原子持久化在 `~/.dsh/`）。

深挖前先读 [README §6 踩坑实录](../../../README.md)——那里是真实调试确认过的坑。

## 知识库自维护

本知识库由 git hooks 自动同步（bdc8ad5 接线）：`pre-push` / `post-merge` 后台触发 `.claude/skills/business-logic/.scripts/auto_sync.py`（nohup + uv 优先，无 uv 回落安装时记录的 python）。**"已同步到哪"的唯一事实源是 `.state/complete.jsonl`（末条 head）**，CHANGELOG.md 只是给人看的日志。钩子装在 `.git/hooks/`（post-merge + pre-push；旧版 post-commit 由安装器卸除）。技能内点前缀目录（`.scripts/` `.state/` `.tmp/` `.sync/`）是引擎内部，永不作为文档域。

**Windows 行尾坑（每次 sync 必踩）**：worker 的写工具按文本模式落盘 → 文档被整体重写成 CRLF，`git diff` 全文件变红。仓库纪律是 LF：每次 sync 后、提交前，把改动的 `.md` 归一（读字节、`CRLF→LF`、无 BOM 写回）。本仓库无 remote，`pre-push`/`post-merge` 实际不会触发——日常用 `auto_sync.py manual`（或 `--staged`）手动同步。
