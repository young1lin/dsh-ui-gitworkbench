# CHANGELOG

## 2026-08-17 [capture]
- **Domains**: stats-drawer
- **Updated docs**:
  - `stats-drawer/overview.md`：新增「关着的芯片在 turn 结束时刷新 stats」规则——`turnSettled`（worktree-view.ts，仅 `prev===true && next!==true`）触发一次受卫 stats 写入（不 bump gen / 不翻 statsLoading，↑↓ 随载荷回来）；空闲关芯片仍是挂载快照；turn 中不刷（升级路径：订阅 live `updatedAt` 做 debounce）；探针 `scripts/verify_turn_refresh.py`。

## 2026-08-16 [sync] 98a525e..bdc8ad5
- **Commits**: bdc8ad5（1 个）——chore(gitstats): 把知识库同步引擎接进 git hooks。引擎/文档/.gitignore/AGENTS.md 记忆块入库；`.git/hooks/` 装 post-merge + pre-push（卸除旧 post-commit）。**无业务源码变更**。
- **Domains**: stats-drawer, worktree-emulation（源自会话摘要的设计意图/坑并入；均经当前源码与测试核实）
- **Updated docs**:
  - `stats-drawer/overview.md`：header 单行（分支胶囊=worktree 选择器本体、设置收进齿轮浮层、图标按钮 chrome）；同步条按钮状态语义（behind→Pull 染 warn 带计数 / ahead→Push 染 add / 无 upstream→Publish；**Fetch 永无变体，`.btnFetch` 被测试禁止**；pull 策略是 Pull 的参数）；`data-quiet` + `quietlyDisabled` 防快速操作眨眼；`showsPending` 防 tick 刷新把数字换成 `—`（400ms 闪烁）；`.elide*` 两段式省略（head 先让、禁 `direction: rtl`、禁 JS `branch.slice`）；调色板 token 完整性（漏一个=静默继承上一主题）；坑：z-index 沿 DOM 序**严格递减**（同值即输）、同优先级修饰类须限定 `.refButton.headerPicker`、源码文本断言三纪律（剥注释/防 vacuous pass/变异验证）。last_verified_commit → bdc8ad5
  - `worktree-emulation/overview.md`：`viewedPath` 推导式 pin（抽屉关=无视 pin，修"一行两主语"卡片与背景图钉住）；`branchOfWorktree` 播种防 `(no branch)` 闪现；`badgeRepeatsBranch`（分支=`wt/<name>` 时徽标省略）；`samePath` 正斜杠归一；选择器行只列分支名、路径退到 title
  - `.sync/SYNC-WORKFLOW.md`：落上本仓库真实的 文件→域 映射表（替换模板行）
  - `index.md`：新增"知识库自维护"小节（hooks 触发、事实源 `.state/complete.jsonl`）；`coverage.md`：来源注记补 sync 记录

## 2026-08-16 [capture]
- **Commits**: 审计基线 3f0d7d2..1dc71bb（capture 自发布前审计会话）
- **Domains**: stats-drawer, write-ops, worktree-emulation, plugin-loading
- **Updated docs**:
  - 四个域 overview.md：初始生成——内容来自对全部 20 个源文件 + README §6 的逐文件审读，符号/规则/坑均经运行时探针交叉验证（probe 24/24、UI 探针 9/9）
  - index.md / coverage.md：初始导航
