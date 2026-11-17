# plugin-loading Overview

> last_verified_commit: 1dc71bb
> source_packages:
> - package.json、tsconfig*.json、tsdown.config.ts、cordis.patch.yml、src/types/*.d.ts

## Quick Index
- Core entry: `lib/index.js`（宿主，tsc 产物）+ `lib/client.js`（客户端，tsdown closure-factory 产物）
- Install: `dsh plugin --profile web add <目录|tgz>`；宿主 entry 经 `cordis.patch.yml`（`dsh.bundle.patch` 声明自动挂载）
- High-risk spots: 装饰器必须 tsc 转译；`.npmrc auto-install-peers=false`

## Business Overview
树外插件装进 dsh web 的完整机制：宿主半是 cordis 服务（Typert gateway 反射 `@Remote` marker 发现端点，无需 descriptor/monorepo 改动）；客户端半是 `window.__DSH_BOOT__` 清单里的 closure-factory bundle。

## 核心约束（为什么是两套构建）
| 半 | 构建 | 原因 |
|---|---|---|
| 宿主 | tsc | tsdown/rolldown **不转译 stage-3 装饰器** `@Remote`，产物是 Node SyntaxError（README §6.1 实测） |
| 客户端 | tsdown | dsh ClientModuleSystem 要 closure-factory；CSS Modules 由 vendored lightningcss 插件内联 |

## Business Rules
- `@Remote` 方法参数必须**裸标识符、signal 最后**（gateway 读 `Function.prototype.toString`）；返回值 JSON 安全——`undefined` 属性值会失败，省略 key
- 宿主 git 调用一律 `ctx.subprocess.spawn` + `stdout:'pipe'` 手动累积 + stderr 排空——绝不用 `ctx.shell`（PTY scrollback 截断大输出：丢分支头、丢文件，README §6.3）
- bundle 纯度门：客户端 `@deepseek-ai/*` 仅 `import type`（运行时由 profile 提供）；shiki 等第三方库不受此限（这正是 2.3MB 的来源）
- `.npmrc` 必须 `auto-install-peers=false`（部分 @deepseek-ai peer 未公开发布）
- tsc 类型：宿主半对着真实安装的 @deepseek-ai 包（devDependencies 显式钉住，dsh 系 0.2.0-rc.2 / cordis 4.0.4），`dsh-shim.d.ts` 只剩 tsconfig include 占位；`systemPrompt`/`agent` 两个增强靠 `import type {}` 边缘入程序（分别只在 dsh-system-prompt / dsh-agent 声明）；客户端半仍有 `dsh-client-shim.d.ts` 宽松 ambient，另以真实 client 包 `/client` 入口的类型边缘取得 cordis 服务成员
- 迭代须先核对 profile 实际安装位置。只有 profile 链接到 checkout 时，改客户端 = tsdown + 刷新、改宿主 = bundle + **重启 dsh web**。npm / tgz 安装是独立副本，本地构建不会同步进去；须重新打包并用 `dsh plugin --profile web add <tgz>` 替换安装，再重启和刷新。树外客户端不受 `pnpm dev:web` 监听（只 glob packages/*/*/）。
- 打包（0.0.1 起）：`files` 白名单 34 文件（lib/src/README/AGENTS/LICENSE/cordis.patch.yml——后两项必须显式列否则被裁）、`prepack` 现场 bundle（fresh clone 不出死包）、`private:true` 防误 publish

## Potential Pitfalls
- vitest 排除 `.agents/**` **和** `.claude/**`（worktree 是整仓副本，陈旧副本会连坐主套件）
- LF 纪律：Python 写文件须 binary + `replace(b'\r\n', b'\n')`，否则千行 diff
- 探针/发布审计结论：tgz 不含 git 元数据；仓库分发则携带 git 作者身份

## 全局安装核验

2026-11-16 核实：全局 dsh 的 web profile 位于 `%USERPROFILE%/.dsh/profiles/web`。注册到 bundles 的包名不等于源码目录链接；须同时检查 package.json 的 dependency spec、node_modules 包的链接类型、版本，以及 lib/index.js / lib/client.js 的哈希。固定 `0.1.25` 的依赖会让普通 update 遵守旧版本范围，指定新版或使用 --latest 才会升级 npm 安装。

web profile 通过官方 CLI 安装本地构建的 0.1.26 tgz，dependency spec 为 `file:<archive>`。安装包放在 `%USERPROFILE%/.dsh/local-plugins/` 下的独立目录，文件名含 SHA256 前缀以避免同版本重打包的缓存混淆。每次替换前，将旧安装与 profile 配置备份到 `.dsh/backups/` 下对应目录。安装后核对其他插件依赖 spec、bundle 注册数量、宿主与客户端产物哈希，并从实际 boot manifest 取回插件 bundle，确认响应包含完整的本地产物。纯客户端更新且宿主文件哈希不变时，只需浏览器硬刷新；宿主接口有变化时重启 dsh web。该安装是构建快照，后续源码变化仍需重新打包安装。

## Related Docs
全部域的宿主侧：[stats-drawer](../stats-drawer/overview.md)、[write-ops](../write-ops/overview.md)、[worktree-emulation](../worktree-emulation/overview.md)
