# 更新日志

本文件记录面向使用者的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.1.2] - 2026-08-17

### 修复

- **抽屉关着时，会话头状态卡的统计不再冻结在挂载时刻**：此前 agent 整轮改文件期间，芯片上的文件数 / 增删行数 / ↑↓ 计数一直停在 turn 开始前的数字，只能点开抽屉强制刷新。现在芯片跟踪 dsh 会话 store 实时镜像的 `running` 信号——turn 一结束（agent 副作用落定的时刻）自动取一次最新统计：不重置抽屉里的树展开状态、不闪加载占位；turn 进行中不刷（数字在结束时一次到位），空闲会话保持零轮询开销。↑/↓ 计数随同一载荷返回，agent 提交完领先数立即对上。编辑器等会话外的改动仍以打开抽屉为准（维持原有设计）。

## [0.1.1] - 2026-08-17

### 修复

- **`worktree_enter` 的名称校验过度限制**：`+` 在 git 分支名与 Windows 目录名里都合法，却被旧的白名单 `[A-Za-z0-9._-]{1,40}` 拒绝——真实名字 `feature+20260810-...` 被静默改写成自动生成的 `wt-<hex>`。字符集改为「git ref 规则 ∩ Windows 目录规则」的交集：`+` 放行；`..`、结尾点、`.lock` 结尾、Windows 保留设备名（CON/NUL/COM1-9/LPT1-9，含点前部分、不区分大小写）与 `head` 拒绝；必须以字母或数字开头；上限放宽到 64 字符。
- **分支名不再强制 `wt/` 前缀**：新建 worktree 的分支就是名字本身；名字缺省或非法时自动生成的回退名也改为 `worktree-<hex>`，任何环节都不再出现强制的 `wt`。
- **「复用」改为 realpath 匹配**：目标目录已是注册 worktree 时（包括其他工具创建的、或 `.agents/worktrees` 是指向 `.claude/worktrees` 的 Junction 而 git 登记的是另一种拼写），直接绑定该 worktree 并**保留它自己的分支**，不再无条件 `git worktree add` 撞路径报错（`fatal: ... already exists`）。
- CI：`pnpm/action-setup` 不再在 workflow 里声明 pnpm 版本，以 `package.json` 的 `packageManager` 为唯一事实源（两处声明会让 action 直接报错）。

### 新增

- 绑定记录新增可选 `branch` 字段：系统提示与状态卡徽标显示绑定 worktree 的真实分支，不再按名字推导；旧记录无此字段完全兼容。
- diff 视图新增 **SQL / XML（含 xsl、xsd、svg）/ INI（含 properties、conf、cfg）/ diff（patch）** 语法高亮。
- README 中文版重写（安装以官方插件命令置顶，一键脚本降为备选）；新增地道英文版 `README_EN.md`；两个 README 顶部嵌入演示视频。

## [0.1.0] - 2026-08-17

首个发布。会话头状态卡（分支 / 领先落后 / 增删计数）+ 工作台面板（变更、历史、对比三页签），逐文件 diff（双列行号、词级高亮、Shiki 语法着色），树上勾选即真实暂存，配提交框与 fetch / pull / push 同步条；七套主题族 × 亮暗、背景图与自定义 CSS（项目 / 全局两作用域）；worktree 仿真（`worktree_enter` / `worktree_exit` / `worktree_status` 三个 agent 工具 + 会话绑定）。详见 [README](./README.md)。
