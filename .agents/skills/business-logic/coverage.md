# 覆盖矩阵

| 域 | 文档 | 覆盖源 | 备注 |
|---|---|---|---|
| stats-drawer | overview.md | src/client/** + style-store + commit-cache + git-log | <25 文件，无需子文档 |
| write-ops | overview.md | git-ops + stage-tree + op-feedback | <25 文件 |
| worktree-emulation | overview.md | worktree + atomic-json | <25 文件 |
| plugin-loading | overview.md | 构建配置 + types shim | 配置类 |

> 来源：1dc71bb 上的发布前审计（七路 Agent + 人工通读全部源文件）一次性 capture 生成。
> 2026-08-16 sync（98a525e..bdc8ad5）：bdc8ad5 为同步引擎接线、无业务源码变更；会话摘要把 header 单行 / 按钮状态 / 省略规则 / 栈序等设计意图并入 stats-drawer 与 worktree-emulation（last_verified_commit → bdc8ad5）。
