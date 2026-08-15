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
- tsc 类型靠 `src/types/dsh-shim.d.ts` / `dsh-client-shim.d.ts` 宽松 ambient（故意不复述 harness 类型）
- 迭代：改客户端 = tsdown + 刷新（server 每请求读盘）；改宿主 = bundle + **重启 dsh web**；树外客户端不受 `pnpm dev:web` 监听（只 glob packages/*/*/)
- 打包（0.0.1 起）：`files` 白名单 34 文件（lib/src/README/AGENTS/LICENSE/cordis.patch.yml——后两项必须显式列否则被裁）、`prepack` 现场 bundle（fresh clone 不出死包）、`private:true` 防误 publish

## Potential Pitfalls
- vitest 排除 `.agents/**` **和** `.claude/**`（worktree 是整仓副本，陈旧副本会连坐主套件）
- LF 纪律：Python 写文件须 binary + `replace(b'\r\n', b'\n')`，否则千行 diff
- 探针/发布审计结论：tgz 不含 git 元数据；仓库分发则携带 git 作者身份

## Related Docs
全部域的宿主侧：[stats-drawer](../stats-drawer/overview.md)、[write-ops](../write-ops/overview.md)、[worktree-emulation](../worktree-emulation/overview.md)
