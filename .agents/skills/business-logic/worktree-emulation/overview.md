# worktree-emulation Overview

> last_verified_commit: bdc8ad5
> source_packages:
> - src/worktree.ts、src/atomic-json.ts（+ src/index.ts 的 worktree RPC/工具区）

## Quick Index
- Core entry: RPC `gitWorkbench/worktreeEnter/Exit/Status/sessionWorktree` + agent 工具 `worktree_enter/exit/status`（`defineTool`）
- Core state: `~/.dsh/gitworkbench-worktree-bindings.json`（`{v:1, bindings{sessionId}}`）
- High-risk spots: dangling binding（目录被删 → stats ENOENT → 芯片整体隐藏且无因可见）

## Business Overview
EnterWorktree 式体验但不改 dsh 本体：模型在会话里调工具，在 `<repoRoot>/.agents/worktrees/<name>` 创建真 git worktree（分支 = branchName ?? 名字，两者都不加前缀），会话绑定它；芯片亮树形图标，抽屉头部选择器按分支列出全部 worktree（只切显示、不动绑定；行内只列分支名，完整路径退到 hover 的 `title` 上给长名让位）。

## Core Flow
```mermaid
flowchart TD
  A[worktreeEnter] --> B[rev-parse repoRoot]
  B --> C[worktree prune 先清陈旧注册]
  C --> D{目录已是注册 worktree?}
  D -- 是 --> E[复用，merge-base 补 baseCommit]
  D -- 否 --> F[add -b (branchName ?? name)]
  F -- 失败且 refs/heads/分支 存在 --> G[add <dir> <旧分支> 复用分支]
  G --> H[写绑定: withBindings 临界区]
```

## Business Rules
- **pin 只属于抽屉（推导而非重置）**：`viewedPath(open, sourcePath, sessionPath)`（worktree-view.ts）——抽屉关着就**无视** pin、一切回会话自身。不靠"记得在每个关闭点 setSourcePath(null)"（关闭路径不止一条，那种约定会烂），做成推导后泄漏在结构上不可能。曾因 pin 活过关闭出现"一行两个主语"的卡片：分支/计数来自钉过去的 main 仓库、🌳徽标与 tooltip 却来自 session 绑定的 worktree；背景图/自定义 CSS 也一并钉住不回。代价：关抽屉时若有 pin 会多跑一次 `git status`
- **关着的抽屉靠探针跟绑定，不靠轮询**：`probesClosedBinding(open, agentRunning)` + `bindingChanged(probe, shown)`（worktree-view.ts）。`session.header.cwd` 不可变 ⇒ `worktree_enter` 后 sessions store 纹丝不动，而绑定唯一的读取点 deps 是 `[sessionId, worktreePath, fetchWorktreeStatus, open]`、3/15s 轮询又是 `if (!open) return`——关着时芯片就是挂载时的快照，agent 进了 worktree 还写 `main`。补的是 `sessionWorktree`（只读绑定 JSON、零 git spawn）做**变更探测**，对不上才补一次完整 `worktreeStatus`（徽标和选择器要的 worktree 列表随之一起回来）。开表条件卡成「抽屉关着 且 agent 在跑」：绑定只可能在 turn 里动，而面板挂在每个 session header 上；`agentRunning` 进 deps，turn 结束时兜底再问一次。路径比较必须走 `samePath`，裸比会把一次分隔符差异变成每 3s 一对 `worktree list` + `branch`。取舍：探针经 RPC 改绑定（探针脚本）时 agent 没跑，关着的芯片不跟
- **切换源不闪 `(no branch)`**：`branchOfWorktree(path, worktrees)` 用手头列表立即播种分支——随后的 stats 抓取要跑 `git status` + numstat（大仓库以秒计），占位符绝不能用 `EMPTY_STATS`（branch 为空）。实测 50ms 采样下 header 单次跳变
- **徽标只在能多说什么时出现**：`badgeRepeatsBranch(branch, name)`——分支 === 名字或 `wt/<name>`（dsh 的 `branchFor` 对宿主自建 worktree 恒如此推导）时徽标省略、只留树形图标在分支胶囊上；外部建的 worktree 名字与分支无关，徽标照留。branchName 解耦后分支 ≠ 名字（如 `feature/foo`）更常见，徽标照留——**徽标出现本身**从此表示"这个 worktree 的名字你猜不出来"
- **名称/路径校验**：`sanitizeName` 只收 `[A-Za-z0-9][A-Za-z0-9._+-]{0,63}`（git ref ∩ Windows 目录名的交集；拒 `..`、结尾点、`.lock` 结尾、Windows 保留设备名、`head`、前导非字母数字，非法自动 `worktree-<hex6>`）；分支名走 `resolveEnterBranch(wtName, branchName, existingBranch)`——branchName 按 `isRefName` 校验再加 git 自己也拒的三类（`.lock` 结尾、首尾点、`head` 大小写碰撞），**非法硬拒不代换**（名字可以随机兜底、分支名有语义），允许 `/`（斜杠分支是 branchName 存在的理由：目录名永远拼不出 `/`）；只在全新创建时生效，复用时旁置并回 `branchOverridden` 供 hint 说明
- **退出保守**：`remove:true` 先 `git status --porcelain`，脏树拒绝且绝不 `--force`（丢改动需专门确认设计）；默认保留目录；分支永不删（可能带未合并提交）
- **原子持久化**：`saveJsonAtomic` = tmp + rename，Windows EPERM 退避 [25,50,100,200,400]ms；`withBindings`/`withStyle` promise 队列串行化 load→save 临界区（并发 enter/exit 不互相覆盖）
- **损坏容忍**：`parseBindings` 单条非法整条丢弃（信一半不如不信），坏文件视为无绑定重建
- **agent 工具不收模型传参**：sessionId/cwd 取自 `exec.agent?.session`（模型说自己是别的会话也没用）
- 会话 cwd 不可变（dsh 本体约束）：enter 返回 hint 教模型相对路径用法（file 工具加前缀、shell 传 per-call workdir）
- **会话 id 跨压缩与重启稳定，跨 fork 才换**（2026-09-04 核实，0.1.1-rc.2 与最新源码一致）：dsh 的压缩——手动 `/compact`（`command-compact` → `compactNow`）和自动压力/溢出压缩（`compactIfNeeded`，`compaction-basic`）——都在原 session 内 shadow surface seq，sessionId 不变；进程重启走 resume 也保留 id（磁盘日志中段的 `session/end-seed` 是 resume 重播种的构造器标记，**不是** fork 证据；判别法：fork 子会话 `createdAt` ≫ 首事件时间，resume 的 createdAt ≈ 首事件时间）。换 id 的路径只有三条：UI fork（子 header 落盘 `parentSession`+`seedLength`，客户端 `SessionSummary.parentId` 可见）、subagent 子会话（`origin:'subagent'`+`parentId`）、全新会话（无任何链接）。所以"绑定跟丢"的结构性修复面是 parentId 链，而不是压缩本身——bindings JSON 里的键永远不会自己迁移
- **子代理沿谱系借绑定，不写绑定**（2026-09-04）：子代理会话自己没有绑定，但它的对话在外层的 worktree 里工作——standing prompt、芯片/抽屉、`worktree_status` 全部经 `resolveEffectiveBinding(sessionId, parentOf, bindingOf)`（worktree.ts，环检测+8 跳上限）：自己的绑定优先，miss 则沿 `parentOf` 向上借最近绑定祖先的。`parentOf` 由 `ctx.events.on('agent/session-start')` 从子会话 header 的 `parentSession` 喂（每次发布都发，含 resume）；提示回调里还从活 header 自愈补第一跳（插件重载丢 Map 的兜底）。只读不写：外层 `worktree_exit` 后整棵子树自动"退出"，无悬空；own 优先故子会话自己 `worktree_enter` 会遮蔽继承。`sessionWorktree` 回 `inherited`、`worktreeStatus` 回 `bindingInherited`、`worktree_exit` 对无自有绑定的会话报"绑定属父会话"；客户端零改动（`bindingChanged` 按字段比形状，多余键无害）

## Code Location
`bindingsPath/parseBindings/saveBindings`、`sanitizeName`/`resolveEnterBranch`/`worktreeDir`/`parseWorktreeList`（worktree.ts）、显示推导纯函数 `samePath/viewedPath/branchOfWorktree/badgeRepeatsBranch/splitPath/probesClosedBinding/bindingChanged`（worktree-view.ts，`samePath` 先统一正斜杠再比——`git worktree list` 给正斜杠、session cwd 带平台分隔符，裸比会把每个 Windows worktree 读成另一个目录）、`repoRootOf`（index.ts）、工具注册在 constructor 的 `ctx.tools.register(defineTool(...))`

## Database
`~/.dsh/gitworkbench-worktree-bindings.json`；绑定字段 `repoRoot/worktreePath/name/enteredAt/baseCommit?`（baseCommit 可选：旧绑定无此字段仍有效）

## Potential Pitfalls
- dangling binding：宿主无目录存在性守卫（审计 F8，已知未修）——恢复法见 handoff §4.2：`gitWorkbench/worktreeExit {remove:false}` 清绑定
- `spawn git ENOENT` 在 Node 里也意味着 **cwd 不存在**（不只是 git 缺失）
- 探针驱动绑定时必须选安静会话，绝不绑正在使用的会话

## Related Docs
[stats-drawer](../stats-drawer/overview.md)（绑定图标与选择器的渲染）、[plugin-loading](../plugin-loading/overview.md)（工具 schema 的 oneOf 纪律）
