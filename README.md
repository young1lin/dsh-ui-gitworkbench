# @young1lin/dsh-ui-gitworkbench

🌏 [中文](./README.md) · [English](./README_EN.md)

[dsh（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 的树外 Web UI 插件：给 dsh 的 Web 界面装一个 Git 工作台，不改动 dsh 本体。

每个会话的头部都有一枚状态卡，显示当前分支、领先/落后和增删计数。点开它，右侧滑出一张工作台面板，当前 worktree 的改动一览无余：

- **变更**：可折叠的文件树，配逐文件 diff——双列行号、词级高亮、Shiki 语法着色；
- **历史**：提交列表 / 文件树 / diff 三栏并排，滚动到底自动翻页；
- **对比**：任选两个分支互相比较；
- **提交与同步**：树上勾选文件就是真实的 `git add` / `git restore --staged`，配合提交框和 fetch / pull / push 同步条，一次提交加推送全程不用离开面板；
- **外观**：七套主题族各带亮暗，默认跟随系统；支持虚化背景图和自定义 CSS，按「项目 / 全局」两个作用域保存，项目优先。

另带 **worktree 仿真**：模型在会话里调用 `worktree_enter` / `worktree_exit` / `worktree_status` 三个工具，即可在 `.agents/worktrees/<name>` 下建立或退出隔离 worktree，并把会话绑定过去。绑定后状态卡点亮绑定标记，面板头部出现 worktree 切换器（按分支列出仓库全部 worktree），统计随之切换。

> 这份 README 同时是**交接文档**：插件是什么、怎么写的、踩过哪些坑、怎么继续改，全部记录在案。接手开发前请先读「§6 踩坑实录」——那里是真实调试换来的关键事实。

## 0. 安装

**前置**：DSH 已装好（`dsh web` 能正常运行），Node.js ≥ 20，pnpm ≥ 10。

**推荐：官方插件通道，一条命令。**

```sh
dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench
```

装完**重启 DSH，再硬刷新浏览器**（Ctrl/Cmd + Shift + R）。包内声明了 `dsh.bundle.patch`，CLI 会自动把宿主半注册进 profile 的 `dsh.profile.bundles`，下次启动即挂载，**不需要**手写任何 `cordis.patch.yml` 挂载行。机器上没有 `dsh` 命令时，用 npx 直接跑：

```sh
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench
```

<details>
<summary><b>备选：一键脚本</b>（同样走官方通道，多处理两件小事）</summary>

```sh
# macOS / Linux（Windows 装了 Git Bash 或 WSL 也可）
curl -fsSL https://raw.githubusercontent.com/young1lin/dsh-ui-gitworkbench/main/scripts/install.sh | bash
```

```powershell
# Windows（PowerShell 5.1+ / pwsh）
irm https://raw.githubusercontent.com/young1lin/dsh-ui-gitworkbench/main/scripts/install.ps1 | iex
```

脚本在安装命令之外多做两件事：预写 pnpm 11 的 `minimumReleaseAgeExclude`，让刚发布不足 24 小时的版本也能立即安装；幂等清理旧版手动挂载行，避免宿主半挂载两次（页面上出现两个状态卡）。支持指定版本、装完 `pm2 restart dsh-web`、`--dry-run` 试跑等参数，见脚本头部注释。

</details>

<details>
<summary><b>从源码开发</b></summary>

`dsh plugin --profile web add <本仓库路径>` 把源码装进 profile；改完客户端半跑 `npx tsdown` 再刷新浏览器即可生效（宿主半改动需重启 dsh web）。详见 §5。从 `link:` 源码依赖切回 npm 版时，记得移除 `cordis.patch.yml` 里的手动挂载行（安装脚本会自动处理）。

</details>

### 发布（维护者）

首次发布与后续发布走不同链路：

- **首次**（包还不存在于 npm，Trusted Publishing 尚无处配置）：本机 `npm login` 后 `npm publish`（scope 包的 `publishConfig.access` 已设 public）。发布后到 npmjs.com → 包 Settings → Trusted publishing 添加 GitHub Actions 发布器：user `young1lin`、repository `dsh-ui-gitworkbench`、workflow 填 `publish.yml`（不带路径前缀）、Environment 留空、勾选允许 `npm publish`。手工发布不经 CI 里那道机器路径门禁（见 publish.yml 的 grep 步骤），发布前可自行扫一眼 `lib/*.js` 确认没有本机绝对路径混入。
- **后续**：`npm version patch`（或 minor/major）→ `git push` → `git push --tags`。tag `vX.Y.Z` 触发 `.github/workflows/publish.yml`：CI 全量检查 → tag 与 package.json 版本一致性校验 → OIDC Trusted Publishing 自动 `npm publish`（provenance 自动生成，全程无 npm token）。不要手动补推已由人工发布过的版本的 tag（如首次的 v0.1.0），registry 会拒绝同版本重发。

**发布产物不带 sourcemap。** `lib/client.js.map` 解包 3.1MB、gzip 416kB，占了整包下载的 46%；排掉后 tarball 从 914.6kB 降到 498.0kB。两处配合才干净：`prepack` 走 `bundle:publish`（`tsdown --no-sourcemap`，连 `//# sourceMappingURL` 注释一并不产出——只删文件不删注释的话，dsh 的 `/plugins/<id>/client.js.map` 路由会给每个使用者一个 404），`files` 里的 `!lib/*.map` 再兜一道，防止上一次 dev 构建遗留的 map 被 `clean: false` 留在 `lib/` 里蹭进包。

**副作用记一笔**：`npm publish` 和 `npm pack`（含 `--dry-run`）都会触发 `prepack`，所以跑完之后本机 `lib/client.js` 是不带 sourcemap 注释的那份，浏览器里断点看到的是打包后的代码。继续开发前跑一次 `pnpm exec tsdown` 就回来了。

---

## 1. 当前状态（已验证）

| 能力 | 状态 | 验证方式 |
|---|---|---|
| 宿主 `gitWorkbench/stats` RPC 返回真实统计 | ✅ | `curl -X POST /api/gitWorkbench/stats` 返回 `{ok:true, value:{branch, files[], diff}}` |
| 客户端 bundle 被 shell 加载（boot 清单） | ✅ | `window.__DSH_BOOT__.entries` 含 `@young1lin/dsh-ui-gitworkbench` |
| 浏览器→宿主 RPC 通 | ✅ | 页面内 `fetch('/api/gitWorkbench/stats', ...)` 返回 200 |
| 面板 diff 完整（不丢文件） | ✅ | 换用 subprocess pipe 后，`diff --git` 计数 = 文件数 |
| 状态卡在 git 仓库会话常驻显示（分支/↑↓/计数），仅非 git 目录或 git 失败时隐藏 | ✅ | 干净树也显示分支名（状态卡即会话的环境信息位）；绑定徽标见 §9 |
| agent 工具 `worktree_enter/exit/status`（模型可调） | ✅ | 真实会话冒烟 `scripts/llm_smoke.py`：模型调 enter → `.agents/worktrees/llm-smoke` 出现；exit(remove) → 消失 |
| 宿主 worktree RPC（enter/exit/status/sessionWorktree）+ 绑定文件 | ✅ | `python scripts/probe_worktree.py`：scratch 仓库断言 + 真仓库冒烟 + 再进入分支复用，ALL PASS |
| 状态卡绑定标记（树形图标；徽标文字与分支重名时省略）+ 头部 worktree 选择器 | ✅ | `python scripts/verify_worktree_ui.py`：6 步 UI 探针（绑定标记、头部路径、选择器切换、折叠/选中回归） |
| 客户端半被类型检查 | ✅ | `tsconfig.client.json` 进了 `bundle`/`typecheck`；曾故意写坏一处，确认报 `TS2322` |
| 主题 7 族 × 亮暗 + 跟随系统明暗 | ✅ | `tests/theme-palettes.test.ts` 把 `themes.ts` 与 `.module.css` 互扣（两个方向都验过会红）；`lib/client.js` 含全部 14 套调色板 |
| 背景图 / 自定义 CSS 的项目+全局存储 | ✅ | 对**构建产物** `lib/index.js` 跑 styleGet/styleSet 全流程（临时 HOME，18/18 PASS）：读写、项目优先、越界钳制、恶意 image 拒绝、清空删记录、非仓库拒绝、两作用域并发写不互相覆盖 |

**已知边界**：状态卡挂在 `conversation.session.header.actions` 插槽，只有**打开了会话（会话头渲染）**时才挂载。无头自动化里若没真正打开会话，状态卡不会出现——这是预期行为，手动在 UI 里开一个会话即可看到。

---

## 2. 架构（一句话 + 详情）

> **宿主半**：一个 `TypertRemoteService`，跑 git 算统计 + worktree 增删与「会话→worktree」绑定，经 Typert gateway 自动发现；同一服务再以 `defineTool` 注册三个 agent 工具。**客户端半**：一个 React 面板，注册进会话头插槽，通过 `connection.rpc` 向宿主要数据（统计 + 会话绑定）。

### 2.1 宿主半（`src/index.ts`）

```ts
class GitWorkbenchService extends TypertRemoteService {
  static inject = ['subprocess']          // 等 subprocess 服务就绪才激活
  constructor(ctx) { super(ctx, 'gitWorkbench') }   // 注册为 ctx.gitWorkbench，命名空间 = 'gitWorkbench'
  @Remote('stats')                        // endpoint = gitWorkbench/stats
  async stats(worktreePath, signal) { ... 用 ctx.subprocess.spawn 跑 git ... }
}
export default GitWorkbenchService
```

- **Typert gateway 通过"源码标记反射"自动发现**这个方法（读 `@Remote` 装饰器在原型上打的 marker）——**不需要生成 descriptor、不需要改 monorepo 任何文件**。这是树外插件最干净的 RPC 暴露方式。
- 浏览器侧调用：`ctx.connection.rpc.call('/api', 'gitWorkbench/stats', { args: { worktreePath } }, signal)` → 返回 `{ok, value} | {ok:false, error}`。
- **取数用 `ctx.subprocess.spawn({argv:['git',...], cwd, stdio:{stdout:'pipe'}})`，自己累加 stdout 流**。见踩坑 §6.3。

### 2.2 客户端半（`src/client/`）

```ts
// src/client/index.ts
export const inject = ['sessions', 'slots', 'connection']
export function apply(ctx) {
  const connection = ctx.connection
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'git-workbench', order: 30,
      inject: () => ({ fetchStats: async (worktreePath, signal) => {
        const r = await connection.rpc.call('/api', 'gitWorkbench/stats', worktreePath ? {args:{worktreePath}} : {args:{}}, signal)
        return r.ok ? r.value : null
      }}) },
    GitWorkbenchPanel,
  ))
}
```

- **插槽系统**：`ctx.slots.inject(key, cb)` 会在 `key` 插槽被声明后执行 `cb`；`cb` 里 `ctx.slots.register({name,id,order,inject}, Component)` 注册组件。可复用已有插槽（如本插件的 `conversation.session.header.actions`），也可用 `declare module '@deepseek-ai/dsh-client-ui-slots'` 声明合并新增插槽。
- **组件 props**：`PropsRuntime<'conversation.session.header.actions'>` 提供 `sessionId`、`useSessions` 等；`inject` 工厂返回的对象（如 `fetchStats`）会作为 props 注入组件。**业务回调从 apply 作用域经 inject 工厂过到组件，绝不用全局 ctx**。
- **拿 worktree 路径**：`useSessions(state => state.byId[sessionId]?.cwd)`——会话摘要自带 `cwd`。
- **数据刷新**：挂载时拉一次 + 面板打开时轮询（空闲 15s、agent 运行中加密到 3s——运行中的会话正在改文件，等满 15s 看到的就是旧闻）+ 手动刷新按钮。**面板关着时另有一条便宜的绑定探针**（见 §6.0d）：只在 agent 运行中开表，走不 spawn git 的 `sessionWorktree`，发现绑定变了才补一次 `worktreeStatus`。

### 2.3 组件与样式（`src/client/GitWorkbenchPanel.tsx` + `.module.css`）

- **外壳**：面板是一张四边留白的卡片（`--gs-inset`，14px 圆角、投影），最大化按钮切到满屏。**三条边可拖**：卡片左缘（`MIN_DRAWER_WIDTH`）、提交列表与文件树之间、文件树与 diff 之间。三处共用 `useHorizontalDrag`（pointer capture + `pointercancel`）。窗格上界由 `applyPane` 现场量出来算：`面板宽 - 邻窗格宽 - MIN_DIFF_WIDTH`，diff 是唯一不能折行的窗格，所以它的下限是硬的。宽度与主题存 localStorage。
- **布局**：变更页 = **文件树 + 逐文件 diff** 两栏；历史页 = **提交列表 + 文件树 + diff** 三栏并列（GitHub Desktop / JetBrains git log 的做法），各自独立滚动，因此没有可折叠的东西要解释。翻页是滚动哨兵（IntersectionObserver），不是按钮。
- diff 渲染：`renderDiff(segment)` 把统一 diff 逐行分类，渲染成 `[老行号][新行号][+/-槽][代码]` 的 flex 行；行号从 `@@ -a,b +c,d @@` 解析并随行递增。
- **配色**：面板自带调色板，不走 dsh 主题 token——diff 需要 增/删/词级/语法 四组颜色，dsh 没有定义。**所有颜色都过 `--gs-*` token**，字面色只出现在 `.overlay[data-gs-theme='<family>-<mode>']` 的调色板块里；换主题＝换一组 token，别的什么都不动。**只有状态卡（在 dsh 原生 chrome 里）保留 `--dsw-*` token**。
  - 主题族与解析逻辑在 `src/client/themes.ts`（不 import CSS/React，因此可被测试直接加载）：GitHub / IntelliJ IDEA / VS Code / One / Solarized / Nord / Cyberpunk，各带亮暗两套。
  - 明暗默认 `system` = 跟随操作系统（`matchMedia('(prefers-color-scheme: dark)')`，挂载期间持续跟随）；显式选亮/暗则完全覆盖。
  - **明暗三个按钮的色块是写死的**白 / 近黑 / 对角各半，不取调色板：那三个按钮命名的就是颜色本身，暗色主题下把「亮色」画成深灰等于告诉用户反话。这是全文件唯一允许出现字面色的第二处。
  - `tests/theme-palettes.test.ts` 把 `themes.ts` 的族列表和 `.module.css` 的调色板选择器互相扣死：少一套调色板会让面板一个 `--gs-*` 都没有、整块退回浏览器默认色而不报错，所以这个不变量必须由测试守。

### 2.3b 自定义样式：背景图 + 自定义 CSS（`src/style-store.ts` + 宿主 `styleGet/styleSet`）

- **两个作用域**：`project`（按仓库根 key）与 `global`。**背景图整条取项目的**——虚化度/遮罩是为某一张图调的，换一张图就不成立，所以不做逐字段合并。**自定义 CSS 两边都生效**，global 在前、project 在后，靠 CSS 层叠顺序让项目覆盖全局；这比"整块覆盖"有用：全局定字号、项目改强调色。解析逻辑在 `themes.ts` 的 `effectiveBackground` / `effectiveCss`，`tests/style-resolve.test.ts` 守着。
- **存在宿主而不是 localStorage**：项目设置该跟着项目走（换浏览器、清 origin 都不该丢），而且一张背景图远超 origin 配额。文件是 `~/.dsh/gitworkbench-style.json`，原子写复用 `src/atomic-json.ts`（tmp+rename + Windows EPERM 退避），两个作用域并发写经 `withStyle` promise 队列串行化。
- **图片先在浏览器里降采样**（`createImageBitmap` → canvas → JPEG，长边 ≤2560，q0.82）再存。手机照片 4-6MB，虚化之后那些细节一点都留不下，没必要每次开面板都拖着走。
- **`image` 只接受 base64 `data:` URL**（`style-store.ts` 的 `IMAGE_PATTERN`）。客户端要把它插进 `url("…")`，而 base64 字母表里没有引号、括号、反斜杠、分号，所以存进去的值不可能闭合函数再追加规则。`https://`、`data:image/svg+xml`、`data:text/html` 一律拒绝，`tests/style-store.test.ts` 逐条验过。
- **背景怎么画**：`.drawer[data-gs-bg]::before` 铺图 + `filter: blur()`（`transform: scale(1.12)` 是因为模糊会采样到盒子外，不放大边缘会透明）。同时 `--gs-surface` / `--gs-surface-2` 从实色切成 `color-mix(… var(--gs-veil), transparent)`，各窗格因此透出底图；**弹出层（主题菜单、分支选择器）故意保持实色**，压在虚化照片上的菜单没法读。没设背景图时这两个 token 就等于 `--gs-bg` / `--gs-panel`，即与之前逐像素一致。
- **用户 CSS 的抓手是 `data-gs-part`**：`overlay` / `card` / `header` / `tabs` / `commits` / `tree` / `diff`。CSS Modules 的类名每次构建都换 hash，从外面根本选不中，所以必须有一组稳定属性。常见写法就是覆盖 token：`[data-gs-part="card"] { --gs-accent: #ff0066; }`。

### 2.4 worktree 仿真（`src/worktree.ts` 纯逻辑 + `src/index.ts` 里的 RPC/工具）

- **宿主 RPC**（同一 `GitWorkbenchService` 上多挂 4 个 `@Remote`，参数照 §6.8 裸标识符、signal 最后）：
  - `worktreeEnter(sessionId, repoPath, name, signal)`——`repoRootOf` 解析仓库根；在 `<repoRoot>/.agents/worktrees/<name>` 创建（或复用）worktree、分支 `wt/<name>`，写绑定；返回 `{ok, worktreePath, branch, hint}`，hint 教模型怎么用相对路径（会话 cwd 不可变）。
  - `worktreeExit(sessionId, remove, signal)`——解绑；`remove:true` 且树干净才 `git worktree remove`，脏树拒绝。
  - `worktreeStatus(sessionId, signal)`——绑定 + 仓库全部 worktree 列表。
  - `sessionWorktree(sessionId, signal)`——`{worktreePath, name}`，未绑定为双 `null`；客户端轮询已改用 `worktreeStatus`（绑定+列表一次拿全），这个 RPC 保留作轻量单查。
- **绑定持久化** `~/.dsh/gitworkbench-worktree-bindings.json`（`{v:1, bindings:{<sessionId>:{repoRoot,worktreePath,name,enteredAt}}}`）。写法是**先写 `.tmp` 再 rename**（崩溃不留半截文件）；Windows 上 rename 可能 EPERM → 25/50/100/200/400ms 退避重试；所有 load→save 段落经 promise 队列互斥（`withBindings`），并发 enter/exit 不会互相覆盖。
- **agent 工具**：同一份逻辑用 `ctx.tools.register(defineTool({...}))` 注册成 `worktree_enter/exit/status`，sessionId/cwd 取自 `exec.agent?.session`（**不接受**模型传参）——注册要点见 §6.10，schema 限制见 §6.11。
- **客户端跟随**：`GitWorkbenchPanel` 每轮拉 stats 的同时拉 `worktreeStatus(sessionId, cwd)`（绑定 + 仓库全部 worktree 一次拿到，agent 在 dsh 外面建的 worktree 也会跟进列表）；有绑定 → 状态卡亮出绑定标记（树形图标；分支与徽标文字重名时省略后者）、stats 改传绑定的 worktree 绝对路径；面板头部的 worktree 选择器按分支列出所有源，**只切显示对象、不动绑定**。树的展开状态跨切换、跨轮询保留；选中在切换源时**有意重置**——旧 worktree 的路径不能漏进新树的选中（§6.0c）。

### 2.5 写操作：暂存 / 提交 / 同步（`src/git-ops.ts` + 宿主 7 个 `@Remote`）

- **勾选就是 git 调用**：勾一个文件＝`git add -- <path>`，取消＝`git restore --staged -- <path>`，立即生效。argv 全部数组构造（无 shell，引号不是攻击面），路径一律放 `--` 之后并拒绝前导 `-`（文件可以合法叫 `-f`，位置参数传进去就成了选项）；全库没有 `--force`/`reset --hard`/`clean` 任何拼写——丢提交类操作需要的是专门的确认设计，不是碰巧排在旁边的按钮。
- **点击即显、不丢点击**：勾选走乐观更新 + 队列（`stage-tree.ts` 的 `nextBatch` 按动作聚批，一次 drain 只发一个 git 调用——宿主一次调用 ~300ms，等它返回再画勾就是用户投诉的「超级卡」），120ms 内连点两下都会入队生效；轮询回包经 `settledTicks` 对账后落定。
- **提交**：`commit(worktreePath, message, amend, signal)`——消息整段作一个 argv 元素传 `-m`（多行 body 是常态，拆分才是风险），绝不 `-a`：面板有自己的暂存区，全量扫进去等于让分区变成摆设。
- **同步**：`syncStatus`（branch/upstream/ahead/behind + hasRemote，读 `git status` 而非 `rev-list --count`——「没配 upstream」和「与 upstream 齐平」的计数都是 0，只有前者决定 push 要不要 `--set-upstream`）、`fetch --prune`（远端删掉的分支别再算作待拉取）、`pull --ff-only/--rebase/--no-rebase`（模式永远显式：按钮写什么就跑什么，不读用户的 pull.rebase 配置）、`push`（绝不 force；无 upstream 时 `--set-upstream origin <branch>`；被拒归类为 `diverged`，答案是先 pull 而不是覆盖别人的工作）。
- **失败要说人话**：`classifyFailure` 把 stderr/exit 归类为 auth / no-upstream / diverged / conflict / nothing-to-commit / dirty，原始文本随行返回——归类是提示，不替代证据。子进程环境关掉全部凭据提示（`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、askpass 置空）：`stdin:'ignore'` 不会把交互提示变成错误，只会变成没人能回答的等待，而那等待挂在宿主进程里——一个过期的 token 就能挂死整个插件 30s。

---

## 3. 文件布局

```
harness-worktree/
  package.json              dsh.client(web) 声明 + exports + peerDeps（@deepseek-ai:* 用 "*"，运行时由 profile 提供）
  .npmrc                    auto-install-peers=false（关键！见 §6.5）
  tsconfig.json             tsc 构建【宿主半】用（含 stage-3 装饰器 + ambient shim）
  tsconfig.client.json      仅类型检查【客户端半】（tsdown 用 dts:false、rolldown 不检查，没有这个 config 就完全没人查 src/client）
  tsdown.config.ts          tsdown 构建【客户端半】用（closure-factory bundle + CSS Modules 插件）
  vitest.config.ts          排除 .agents/**（worktree 是整仓副本，否则同一套测试被收集多遍）
  src/
    index.ts                宿主半：GitWorkbenchService（TypertRemoteService + @Remote：stats/fileDiff/commits/compareRefs/commitStats/worktree*/style*/syncStatus/stage/unstage/commit/fetch/pull/push）+ defineTool 三工具
    atomic-json.ts          崩溃安全的 JSON 写入（tmp+rename + Windows EPERM 退避），绑定文件与样式文件共用
    commit-cache.ts         内容寻址缓存：commit hash 指向不可变内容，只需容量上限、不需失效
    git-ops.ts              写操作的 argv 构造 + stderr 归类（纯函数、不 spawn）——见 §2.5
    git-log.ts              `--pretty` 日志与 porcelain 状态头的解析（纯函数）
    style-store.ts          背景图 + 自定义 CSS 的两作用域存储与校验（~/.dsh/gitworkbench-style.json）
    worktree.ts             worktree 纯逻辑：绑定文件读写（tmp+rename 原子、EPERM 重试）、名称/分支/目录推导、porcelain 解析、`isRefName`
    types/dsh-shim.d.ts     ambient 声明：让 tsc 在没装 @deepseek-ai/* 时也能编译（cordis/subprocess 的宽松类型）
    types/dsh-client-shim.d.ts  同上，客户端侧（CSS Modules + client-runtime/ui-slots）；**故意宽松**，只查本插件自己的代码，不复述 harness 的类型
    client/
      index.ts              客户端半：注册会话头插槽（fetchStats/fetchFileDiff/fetchWorktreeStatus 等 RPC 回调）
      GitWorkbenchPanel.tsx     状态卡（树形图标绑定标记）+ 面板（三栏历史 + diff + 头部 worktree 选择器 + 齿轮挂设置弹层 + 拖拽改宽 + 勾选/提交/同步条）
      GitWorkbenchPanel.module.css  调色板（7 族 × 亮/暗）+ 全部布局
      stage-tree.ts         勾选状态推导 + 乐观勾选的 overlay/对账/聚批（§2.5，纯函数）
      diff-model.ts         统一 diff 行解析 + 词级变更区间（纯函数）
      commit-graph.ts       提交图的泳道分配（纯函数）
      worktree-view.ts      worktree/分支列表的展示推导（纯函数）
      highlight.ts          Shiki 封装：扩展名→语法、主题映射、语法包按需加载
      op-feedback.ts        写操作按钮反馈的时序常量（忙碌提示、过短操作不禁用）
      themes.ts             主题模型：族列表、明暗解析、两作用域样式解析、localStorage 值校验（无 CSS/React 依赖，便于测试）
      locales.ts            zh / en 两份词典
  tests/                    vitest：worktree-bindings（存储/原子写/重试）、worktree-derive（名称/分支/porcelain）、ref-name、git-ops（argv/归类）、git-log、commit-cache、style-store、style-resolve、theme-palettes（族×调色板互扣）、stage-tree（勾选模型）、worktree-view、commit-graph、diff-regression（diff 模型/词级区间/Shiki/CSS 不变量）、drawer-chrome（状态卡与面板的结构性扫描）、op-feedback、status-parse（porcelain/numstat 解析、二进制嗅探、截断与上限——fixture 场景目录 TESTS.md 的单测化）
  scripts/
    probe_worktree.py       宿主 RPC 探针：scratch 仓库全流程 + 真仓库冒烟 + 再进入分支复用
    verify_worktree_ui.py   UI 探针：状态卡标记/头部路径/选择器切换/折叠回归 6 步（经真实页面 RPC 回放）
    llm_smoke.py            真实 LLM 冒烟：让模型在会话里调 worktree_enter/exit，看目录出现/消失
    （三个 .py 探针为本地集成脚本：需连真实 dsh 实例与 scratch 仓库，内嵌本机路径——已 gitignore，不入库、不随包发布）
  cordis.patch.yml          一行 insert，把宿主 entry 挂进 web profile
  README.md                 本文件
  README_EN.md              英文版（面向使用者与维护者；深度细节仍以本文为准）
```

---

## 4. 怎么构建

```bash
cd <仓库根目录>
pnpm install      # 装 tsdown/typescript/react/lightningcss/@types/node；.npmrc 关掉了 peer 自动安装
pnpm bundle       # = tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown
pnpm typecheck    # 同样两个 tsc，不产出
pnpm test         # vitest
```

产物：
- `lib/index.js` —— 宿主半（ESM，`tsc` 产出，装饰器已转译）
- `lib/client.js` —— 客户端半（CJS closure-factory，`tsdown` 产出，CSS 已内联为 `<style>` 注入）

**只改了客户端**时，`pnpm bundle` 重建后**刷新浏览器**即可——web server 每次请求都从磁盘读 `lib/client.js`，不用重启。（别只跑 `pnpm exec tsdown`：rolldown 不做类型检查，会漏掉 `tsconfig.client.json` 才能发现的错误。）改了宿主半必须 `pnpm bundle` + **重启 dsh web**（宿主代码在内存里，不重启不生效）。

---

## 5. 怎么加载 / 迭代

前提：deepseek-harness 仓库已 `pnpm install` + `pnpm run build`，且 `DEEPSEEK_API_KEY` 已设。

```bash
# 一次性：把插件装进 web profile（= 在 ~/.dsh/profiles/web 里 pnpm add 本目录）
dsh plugin --profile web add <仓库根目录>

# 启动（--patch 手工挂载宿主 entry；package.json 的 dsh.bundle.patch 声明已让
# `dsh plugin add` 自动带上补丁，--patch 仅在 profile 于该声明存在之前加入时需要）
dsh web --patch <仓库根目录>/cordis.patch.yml

# 便携交付：tarball 自足——prepack 现场构建 lib/，files 白名单只带 lib/src/文档/补丁
npm pack
dsh plugin --profile web add <tgz 路径>
```

打开 http://127.0.0.1:3080，在**有未提交改动的 git worktree**里开一个会话，会话头出现状态卡。

**迭代循环**：
- 改客户端 → `pnpm exec tsdown` → **浏览器刷新**（host 会 stat-poll 新的 `lib/client.js`，刷新即生效）。
- 改宿主 → `pnpm bundle` → **重启 dsh web**（先杀掉占用 3080 的进程）→ 刷新。

> 树外的客户端插件**不会被 `pnpm dev:web` 监听**（它只 glob `packages/*/*/`）。开发要热更就自己开个 `pnpm watch`（= `tsdown --watch`），host 仍会 stat-poll 并广播 `rebuilt`。

---

## 6. ⚠️ 踩坑实录（接力模型必读）

这些都是花了真实调试才确认的。**别绕弯，直接照做。**

### 6.0 `git diff --no-index /dev/null <f>` 在 Windows 上不可用
git 会把 `/dev/null` 解析成仓库相对路径,报 `error: Could not access '...nul'`。未跟踪文件的内容 diff **不要用 git 合成**,直接在宿主 `fs.readFile` 后自己拼 unified diff 段(`diff --git a/x b/x` + `new file mode` + `@@ -0,0 +1,N @@` + 逐行加 `+`)。顺带行数精确、零 spawn。

### 6.0b `git status --porcelain` 默认折叠未跟踪目录
`?? .agents/` 一行代表整棵子树(曾导致 205 个文件只显示 3 行)。必须加 `--untracked-files=all` 逐文件枚举。

### 6.0c 轮询不得重置 UI 状态
15s 轮询每次返回**新的 `files` 数组引用**(内容相同)。若 `useEffect` 依赖该引用重置树的展开状态、或 bump gen 清按需 diff 缓存,用户就会看到"莫名其妙刷新、展开的目录缩回去"。规则:**树的展开状态提升到会话级组件**(轮询、关开面板都不丢);**gen 只在手动刷新时 bump**。

### 6.0d 关着的面板里，状态卡没有任何刷新路径
dsh 的 `session.header.cwd` 终身不可变，所以 `worktree_enter` 之后 sessions store **一个字段都不动**。绑定只有一处会读——deps 是 `[sessionId, worktreePath, fetchWorktreeStatus, open]`——四个全不变；而 3/15s 轮询第一行就是 `if (!open) return`。合起来：面板关着时状态卡是**挂载那一刻的快照**，agent 进了 worktree 它还写着 `main`，点开面板（唯一能翻 `open` 的动作）才追上。一个指示器最不该有的性质。

补法是一条**探针**而不是一条轮询：`sessionWorktree` 只读绑定 JSON、不 spawn git，安静时每次就是一次文件读；只有它跟状态卡上的绑定对不上（`bindingChanged`，用 `samePath` 比路径——裸比会把一次分隔符差异变成每 3s 一对 `worktree list` + `branch`）才补一次完整 `worktreeStatus`，把徽标和选择器要的 worktree 列表一并带回来。开表窗口卡死（`probesClosedBinding`）：**面板关着 且 agent 在跑**。绑定只可能在一个 turn 里动（enter/exit 是 agent 工具），而这个面板挂在**每一个** session header 上，空闲会话连 timer 都不开；turn 短于一个间隔时，deps 里的 `agentRunning` 在 turn 结束时重跑 effect 兜底问一次。

代价明摆着：**探针不看 agent 之外的改动**。探针经 RPC 直接改绑定（比如 `scripts/probe_worktree.py`）时 agent 没在跑，关着的状态卡就不会跟。这是选定的取舍，不是漏掉的分支。

### 6.1 宿主半必须用 `tsc` 构建，不能用 tsdown
tsdown/rolldown(oxc) **不会转译 stage-3 装饰器** `@Remote`——产物里会留下原始 `@Remote(...)`，Node 加载直接 SyntaxError。monorepo 里是先 `tsc -b` 转好再 tsdown 打包，所以没踩到。**树外必须自己用 tsc 产出 `lib/index.js`**（见 `tsconfig.json` + `package.json` 的 `bundle` 脚本）。

### 6.2 RPC 返回值必须 JSON-safe（`undefined` 会失败）
Typert gateway 对返回值做 `assertJsonValue`，**任何 `undefined` 属性值都会被拒**（报 `business result failed boundary validation`）。所以 `error` 字段在"无错误"时**必须整个键都不带**（声明为 `error?: string`，成功 return 里不写 `error`），不能写 `error: undefined`。

### 6.3 取数用 `ctx.subprocess.spawn`，不要用 `ctx.shell`
`ctx.shell`（bash-local/pwsh-local）在 Windows 上**通过 PTY 捕获输出，大输出会从头部被 scrollback 滚掉**：
- `git status --porcelain --branch` 的 `## branch` 头行丢失 → branch 显示空。
- `git diff HEAD`（几十 KB）的前几个文件整段丢失 → 点那些文件显示"未跟踪"。

**正确做法**：`ctx.subprocess.spawn({argv:['git',...], cwd, stdio:{stdin:'ignore',stdout:'pipe',stderr:'pipe'}, graceMs, signal})`，拿到 `handle.stdout` 这个 Readable，**自己 `for await` 累加所有 chunk**（管道没有 scrollback 上限，一字节不丢）。同时 drain stderr 防止管道死锁，`Promise.all([读stdout, 读stderr, handle.done])`。

### 6.4 客户端 bundle 必须是 closure-factory 形状
dsh 的 `ClientModuleSystem` 强制要求 `lib/client.js` 是这个外壳（**不能用普通 ESM/CJS**）：
```js
window.__ModuleLoader__.load({ id: "@young1lin/dsh-ui-gitworkbench", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  /* ...代码... */
  return module.exports;
} });
```
由 `tsdown.config.ts` 的 `outputOptions.banner/footer/intro` 注入。`react`/`react/jsx-runtime`/`@deepseek-ai/cordis` 等是 **external**（运行时由 loader 的冻结模块表 `require` 提供，**不进 node_modules 解析**）。`@deepseek-ai/*` 的 import 必须是**纯类型**（`import type`，编译时擦除），否则会被 bundle 纯度门拒绝。

### 6.5 `.npmrc` 必须关掉 auto-install-peers
`package.json` 的 `peerDependencies` 写了 `@deepseek-ai/*: "*"`。pnpm 默认会自动装 peer，于是去 npm 拉 `@deepseek-ai/dsh-client-runtime` 及其传递依赖——而有些包**没公开发布**（如 `dsh-compact`）→ 404。`.npmrc` 里 `auto-install-peers=false` + `strict-peer-dependencies=false` 解决。这些包**运行时由 web profile 提供**（`healProfilesModuleFallback` 把所有内置包软链进 `~/.dsh/profiles/node_modules`），本地不需要装。

### 6.6 CSS Modules 要自己 vendor lightningcss 插件
树外的 tsdown 没有 monorepo 那套 CSS Modules 插件。`tsdown.config.ts` 里 vendored 了 `dsh-css-modules-inline` 插件（`resolveId` 拦截 `*.module.css` → `load` 用 `lightningcss` 编译 → 注入 `<style data-plugin="...">` + 导出 class map）。所以需要 `pnpm add -D lightningcss`。组件里 `import css from './X.module.css'`。

### 6.7 ambient shim 让 tsc 在缺包时编译
宿主半 `import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'` 是**值 import**（不是 type-only），但本地没装这个包。`src/types/dsh-shim.d.ts` 用 `declare module` 给 cordis/subprocess/typert-protocol 写**宽松的类型**，让 tsc 能转译。tsconfig 要 `"types": ["node"]`（提供 `process`/`AbortSignal`）、`"experimentalDecorators": false`（stage-3）、`"strict": false`、`"noEmitOnError": false`。

### 6.8 路径参数用纯标识符
`@Remote` 方法在 SRC 发现模式下，gateway **靠 `Function.prototype.toString` 读参数名**。所以参数必须是**裸标识符**（不能解构/默认值/rest），且 `signal`（若要取消）必须放**最后**。`stats(worktreePath, signal)` 是合法的；SRC 下 `worktreePath` 可省略（客户端传 `{args:{}}`）。

### 6.9 端口 3080 被占用 → TaskStop 不够
`dsh web` 后台进程被 TaskStop 后，Windows 上 node 子进程可能还占着 3080，重启报 `EADDRINUSE`。要 `netstat -ano | grep :3080` 找 PID，`taskkill //F //T //PID <pid>`（`//T` 连子进程）杀干净再重启。

### 6.10 defineTool 注册 agent 工具的套路
- 类上要 **`static inject = ['subprocess', 'tools']`**——不加 `'tools'`，`ctx.tools` 不存在，`ctx.tools.register` 直接炸（工具服务要就绪才激活）。
- `description`/参数 `description` **写英文**（模型消费的语料，英文最稳），且把「进入后怎么用」写进去：file 工具加 `.agents/worktrees/<name>/` 前缀、shell 命令传 per-call workdir `.agents/worktrees/<name>`。
- **取会话**：`execute: async (args, exec) => { const session = exec.agent?.session; ... }`——sessionId 用 `session.id`、cwd 用 `session.header.cwd`（注意 `header.`）。**没有会话就拒绝**（返回 `{ok:false, error:'... requires a calling session'}`），别 fallback 到 `process.cwd()`（那会绑到宿主进程目录，语义错误）。
- 完整参照物：`packages/goal/tool-goal/src/index.ts`（本仓库 `src/index.ts` 的 `registerWorktreeTools` 就是照它写的）。

### 6.11 dsh-tools 的 JSON schema 子集：**不支持 type 数组**
- 工具的 parameters/output schema 走 dsh-tools 的受限 JSON-Schema 子集，**`type: ['object','null']` 这种数组会在插件加载时抛错**（整站起不来）。可空对象用 **`oneOf: [{type:'null'},{type:'object',...}]`**。
- 每个 object 节点**显式写 `additionalProperties`**（`false` 或 `true`，不写不行）。
- **输出 schema 必须容纳所有早退返回形状**：`worktree_status` 的无会话早退 `{ok:false, error}` 与正常 `{ok, binding, worktrees}` 共用一个 schema，所以 `ok`/`error` 声明为可选、`binding` 用 oneOf——否则真实调用时校验失败。

### 6.12 worktree 的 Windows 细节
- **`git worktree remove` 保留分支**（exit 从不删 `wt/<name>`——可能有未合并提交）。之后再 enter：`worktree add -b wt/<name> <dir>` 会因分支已存在而失败 → 先 `rev-parse --verify --quiet refs/heads/wt/<name>` 探测，幸存则改用 `worktree add <dir> <branch>` **检出既有分支**（hint 注明 reused，提醒模型里面有旧提交）。
- **绑定文件的 rename 在 Windows 可能 EPERM**：页面 15s 轮询短暂持有读句柄/杀毒扫描，rename 撞上就 EPERM。做法：tmp + rename，EPERM 按 25/50/100/200/400ms 退避重试后再抛（见 `src/worktree.ts` 的 `saveBindings`）。
- **路径一律正斜杠规范化**：`rev-parse --show-toplevel` 的输出、porcelain 的 worktree path 都要做 `.replace(/\\/g,'/')` 再比对——宿主在 Windows 返回反斜杠，两边不统一就匹配不上（复用判定会失灵）。

### 6.13 宿主环境可能没有 git（PATH 缺失）
宿主 RPC 返回 `git status failed (exit N): <stderr>`（本插件的报错都带 exit code + stderr 尾部）时，先看 stderr——常见是宿主进程环境异常/git 不在 PATH，而不是目录真的不是仓库（2026-08-15 实例：目录明明是仓库却报 not a git worktree，重启 dsh web 换个健康环境即愈）。**报错透出 stderr 是定位这类问题的唯一手段**，新加 git 调用时照抄这个格式。

---

## 7. dsh 仓库里的关键参考文件（去哪里抄）

接手改这个插件时，对照这些原文件（路径相对 dsh 仓库根；开发机上它是本仓库的兄弟目录 `../deepseek-harness`）：

| 要做什么 | 看哪里 |
|---|---|
| 抄一个完整客户端插件的套路 | `packages/client/ui-jobs/`（package.json 的 `dsh.client`、`src/client/index.ts` 的插槽注册、`.module.css`） |
| 插槽 API / 组件 props 类型 | `packages/client/ui-slots/src/index.ts`（`SlotMap`、`PropsRuntime`、`register`） |
| 原生 diff 组件（如果想复用） | `packages/client/ui-primitives/src/DiffBlock.tsx`（吃 `{path,oldText,newText}[]`，红删绿增） |
| 主题 token 名 | `packages/client/ui-jobs/src/client/*.module.css`、`ui-primitives/src/DiffBlock.module.css`（`--dsw-alias-*`、`--dsw-alias-state-success/error-primary`） |
| 客户端 bundle 格式 / 纯度门 / CSS 插件 | `packages/client/tsdown.client.ts`（本插件的 tsdown 配置就是从这里 vendored 的） |
| Typert 宿主发布（`@Remote`） | `packages/typert/protocol/src/index.ts`（`TypertRemoteService`、`Remote`、`remoteMethods`）；真实例子 `packages/goal/goal/src/index.ts` |
| 注册 agent 工具（`defineTool`） | `packages/goal/tool-goal/src/index.ts`（`inject` 加 `'tools'`、`exec.agent.session` 取会话、presentCall 卡片）；schema 子集与 `cloneJson` 见 `@deepseek-ai/dsh-tools` / `packages/core/tools` |
| 客户端 RPC 调用形态 | `packages/client/connection/src/client/rpc.ts`（`connection.rpc.call(channel, endpoint, payload, signal)`） |
| `/api` 派发（gateway 拦截器只有一个） | `packages/client/connection/src/rpc-host.ts`；`packages/api/gateway/src/index.ts` |
| subprocess spawn API | `packages/subprocess/subprocess/src/types.ts`（`SubprocessSpawnSpec`、`SubprocessHandle`、`CollectedOutput`） |
| 出树加载（`dsh plugin add` = pnpm 转发） | `apps/cli/src/plugin.ts`；profile 组合 `packages/boot/app-boot/src/profile.ts` |

---

## 8. 可继续做的事（给接力模型的点子）

- **行号单列 / 双列可选**：现在是双列（老/新）。可加开关。
- **会话级基准**：当前基准是"工作区 vs HEAD"。若要"本次会话以来的变更"，需在会话开始时快照 git tree OID 并持久化，再相对它 diff（复杂度高）。
- **更多主题族**：加一族＝ `themes.ts` 加一行 + `.module.css` 加两块调色板，`tests/theme-palettes.test.ts` 会盯着两边对齐。
- **样式作用域再细一层**：现在是「项目 / 全局」两级。若要「按 worktree」再加一层，`style-store.ts` 的 projects 换成两级 key 即可，解析顺序在 `effectiveBackground`/`effectiveCss` 一处改。
- **复用 DiffBlock**：若不需要文件列表/行号，可直接用 `@deepseek-ai/dsh-client-ui-primitives` 的 `DiffBlock`（把统一 diff 解析成 `{path,oldText,newText}[]` 喂给它），更省事但定制性低。

---

## 9. 设计基准

- 「此次变更」= **工作区相对 HEAD 的未提交改动**（`git diff HEAD` + `git status --untracked-files=all`）。行数:tracked 来自 `--numstat`,untracked 来自宿主合成时的精确行数统计。
- 未跟踪文件:宿主 `fs.readFile` 合成 diff 段(见 §6.0),单文件 >1MB 只计数不合 diff;随包总量上限 160KB,超出部分点击时走 `gitWorkbench/fileDiff` RPC **按需加载**(tracked 用 `git diff HEAD -- <path>`)。
- 二进制判定:numstat 的 `-` 计数,或未跟踪文件前 8KB 含 NUL 字节。二进制文件显示占位、不计行数。
- diff 文本总量上限 400 KB（`DIFF_CHAR_CAP`），超出截断。
- 环境**卡**（非状态卡）常驻会话头:branch/detached + ↑↓ ahead-behind + `+N −M 文件数`。
- 左侧为**可折叠文件树**:目录节点带文件数徽章与聚合 +N/−N;>12 文件的目录默认折叠;「展开全部/收起全部」;选中文件自动展开祖先链;展开状态会话级持久(见 §6.0c)。
- 词级高亮 = 相邻 −/+ 行按 token LCS 对齐(`diff-model.ts`),行底色之上叠加强调色;语法着色 = **Shiki**(`highlight.ts`:本地包、JS regex 引擎、语法按需分包加载)——`lib/client.js` 2.3MB 的主因即它。bundle 纯度门禁的是 `@deepseek-ai/*` 的**值导入**(运行时由 profile 提供),不是第三方库;早期「正则单遍扫描」的实现已被替换。
- **状态卡是会话的环境信息位**：git 仓库内常驻显示分支（或 detached sha）+↑↓+计数，**干净树也显示**；仅 `stats.error`（非 git 目录 / git 不可用）时隐藏。绑定标记 = 树形图标：dsh 自建 worktree 的分支必为 `wt/<name>`，徽标印名只会把分支名说两遍，所以只留图标；外部建的 worktree 徽标 = 图标+name——那是唯一点名目录的地方。
- **面板是浮起的卡片**（四边留白 + 圆角 + 投影），左缘可拖拽改宽、有最大化满屏；宽度与外观都存 localStorage，且读回时校验（旧版本写的族名不会漏到 `data-gs-theme` 上）。
- **明暗默认跟随操作系统**（`prefers-color-scheme`），可显式覆盖；主题族 7 套（GitHub / IntelliJ IDEA / VS Code / One / Solarized / Nord / Cyberpunk）各带亮暗。面板内滚动条也按当前调色板重绘——**按类名逐个列举是不行的**：文件树那栏改过名之后就一直漏在外面、保持系统原生的浅色滚动条，所以规则写成 `.drawer *`。
- **背景图与自定义 CSS 按「项目 / 全局」两个作用域存在宿主**（`~/.dsh/gitworkbench-style.json`），项目优先；背景图整条取项目的，自定义 CSS 两边叠加、项目在后。详见 §2.3b。
- **worktree 语义**：
  - 目录 = 仓库根下 `.agents/worktrees/<name>`（仓库内，无沙箱越界）；分支 = `wt/<name>`；name 规则 `[A-Za-z0-9._-]{1,40}`，非法或缺省自动生成 `wt-<hex6>`。
  - **退出默认保留目录**，`remove:true` 才删；删除前 `git status --porcelain` 检查，**脏树拒绝且绝不加 `--force`**（保守，防丢改动）。
  - **会话 cwd 不可变**（dsh 本体约束）：enter 不切 cwd，而是返回 hint 指引模型——file 工具用 `.agents/worktrees/<name>/` 前缀的相对路径，shell 命令传 per-call workdir `.agents/worktrees/<name>`（相对会话 cwd 解析）。
  - **再进入**：目录仍是注册 worktree → 直接复用、只补绑定；目录已删但分支 `wt/<name>` 幸存 → `worktree add <dir> <branch>` 检出旧分支（hint 注明 reused）。
  - **绑定**（per-session）持久化于 `~/.dsh/gitworkbench-worktree-bindings.json`；损坏/缺失视为无绑定并重建。写入原子（tmp+rename）+ 互斥（promise 队列）+ EPERM 退避重试（§6.12）。
  - **状态卡纪律例外**：有绑定时即使 bound worktree 干净也显示状态卡——绑定标记（树形图标）是绑定指示器与面板入口；面板打开期间空视图也保持挂载（可从空源切走）。头部选择器只改显示对象，不动绑定。
