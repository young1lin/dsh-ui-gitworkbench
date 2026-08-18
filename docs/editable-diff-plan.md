# 让 diff 面板可写：分阶段计划

分支 `feat/editable-diff`。目标是把只读的 diff 面板变成能动手的地方——IDEA 的做法——但**分四阶段**，每一阶段自己能发布、自己有测试、自己能回退。

## 为什么不能直接上编辑器

IDEA 里编辑 diff 右侧是安全的，因为除了你没人动那些文件。dsh 不是：**agent 正在写**。抽屉是轮询的（`agentRunning` 时 3 秒，否则 15 秒），那是「看见」的延迟，不是「保护」。

所以整个计划围绕一条主线：**每一次写，都必须能检测到「文件在我读它之后被改过」并拒绝，而不是覆盖**。两种检测手段，按阶段用：

1. `git apply` 的上下文匹配——patch 的上下文对不上就拒绝，这是 git 自带的，白送的；
2. blob hash 校验——读的时候记下 hash，写的时候带回去，host 比对不上就拒绝。

这跟 `discardFile` 的 `expectedEffect` 是同一个思路：**客户端说的不算，host 拿现场重新推导一遍**。

## 阶段 0：能重新发射的 patch 模型（纯函数）

`src/client/patch-model.ts`，无 React 无 CSS，vitest 直接加载。

现有的 `diff-model.ts` 是**给渲染用的**：`parseRows` 把文件头全部丢掉，hunk 头只留下行号。它没法重新拼回一个合法的 unified diff。所以需要一个平行的、**面向 patch** 的模型：

```
parsePatch(text)  -> { header: string[], hunks: Hunk[] }
Hunk = { oldStart, oldCount, newStart, newCount, heading, lines: PatchLine[] }
PatchLine = { kind: 'add' | 'del' | 'context' | 'nonewline', text }

emitPatch(file, selection) -> string
```

`emitPatch` 是这个阶段唯一难的东西，也是整件事的正确性地基：

- **选中整个 hunk**：只发射该 hunk，行号计数直接沿用；
- **选中 hunk 里的部分行**（`git add -p` 的分行规则）：
  - 选中的 `+` 行保留为 `+`；
  - **未选中的 `+` 行整行丢弃**（它不该进这次 apply）；
  - 选中的 `-` 行保留为 `-`；
  - **未选中的 `-` 行降级为 context**（那一行仍然存在于目标里）；
  - `oldCount` / `newCount` 必须按上述结果**重算**，算错就是 `git apply` 报 corrupt patch。
- 多个 hunk 各自独立重算，之后的 hunk **不需要**平移 `newStart`——git apply 按每个 hunk 自己的头定位。

必须覆盖的边界（每一条都写测试）：

| 边界 | 为什么会错 |
| --- | --- |
| 新增文件（`--- /dev/null`） | 没有 old 侧，`oldStart` 应为 0 |
| 删除文件 | 没有 new 侧 |
| `\ No newline at end of file` | 它是 patch 的一部分，丢了就改变文件末尾 |
| CRLF 文件 | `fileDiff` 的实测输出里行尾带 `\r`，必须原样保留 |
| 末尾无换行的 patch 文本 | `git apply` 对结尾敏感 |
| 空 selection | 应当发射空串，调用方跳过，而不是发一个空 patch 让 git 报错 |
| 往返一致性 | 全选后 `emitPatch(parsePatch(x)) === x` |

## 阶段 1：hunk 与行级的暂存 / 取消暂存 / 撤回

### 一个关键约束：patch 的来源不能是抽屉现在那个 diff

`fileDiff` 走的是 `git diff HEAD -- path`,也就是**已暂存 + 未暂存合并**的那份。这对渲染是对的（跟 rollback 的 IDEA 语义一致：不问暂存与否），但对 `git apply --cached` 是错的——文件如果已经部分暂存，索引侧的内容不等于 HEAD，patch 上下文必然对不上。

git 自己的 `add -p` 就不是这么取的。所以 host 要按操作分别取 diff：

| 操作 | patch 来源 | 应用方式 |
| --- | --- | --- |
| 暂存这一块 | `git diff -- path`（工作区 vs 索引） | `git apply --cached` |
| 取消暂存这一块 | `git diff --cached -- path`（索引 vs HEAD） | `git apply --cached --reverse` |
| 撤回这一块 | `git diff -- path` | `git apply --reverse`（只动工作区） |

面板需要一个「按暂存状态分栏」的视图来承载这三种操作，或者至少在 hunk 头上标明这一块当前属于哪一侧。这是阶段 1 里 UI 上最需要想清楚的一件事。

### host RPC

```
@Remote('hunkDiff')    (worktreePath, path, side, signal)     -> { diff }
@Remote('applyPatch')  (worktreePath, patch, mode, signal)    -> GitOpResult
```

`mode` ∈ `stage` | `unstage` | `discard`,分别对应上表。

安全边界，与 `git-ops.ts` 的既有戒律一致：

- **不新增写文件的能力**。写的仍然是 git，patch 从 stdin 喂进去，路径由 git 自己刚产出的 diff 决定,客户端说不出一个 git 没提过的路径；
- 应用前先 `git apply --check`,失败就原样返回 git 的话；
- **并发保护是白送的**:agent 在你选行的这段时间改了文件，上下文不再匹配，`git apply` 直接拒绝。这正是阶段 0 必须把计数算对的原因——算错会让 git 以「patch 损坏」而不是「文件变了」的名义失败，两者对使用者是完全不同的消息。
- `discard` 是不可逆的，沿用 `discard-flow.ts` 那条链：先问后果 → 弹窗说明 → 执行 → 后果不符则拒绝。

### UI

- hunk 头上出现「暂存这块 / 撤回这块」；
- 行号槽出现逐行勾选，选中若干行后按钮改为「暂存选中的 N 行」;
- 勾选就是 git 调用这条既有规矩继续成立：**只对看得见的行动手**（过滤态下尤其重要）。

## 阶段 2：工作区那一侧可以直接改

阶段 1 覆盖的是「删掉 agent 写错的那一段」——那本来就是撤回一个 hunk，不需要打字。阶段 2 才是真的打字。

```
@Remote('readForEdit')   (worktreePath, path, signal)                  -> { text, sha, eol, binary }
@Remote('writeChecked')  (worktreePath, path, text, expectedSha, signal) -> GitOpResult
```

- `sha` 就是 `git hash-object` 的结果，读的时候给出，写的时候带回；
- host 写之前重新算一遍，**对不上就拒绝**，返回「这个文件在你编辑期间被改过」,而不是覆盖；
- `eol` 让客户端知道该用哪种行尾回写——这个仓库自己就吃过 CRLF 的亏，别在新功能里重演；
- 二进制文件直接拒绝编辑；
- 路径校验复用 `fs-remove.ts` 的 `resolveInside`,同一把锁，不再造第二把。

**2a：行内编辑，不引入编辑器。** diff 的 new 侧行改成可编辑，改完那一行进入「待保存」态，保存时把整份文件按行拼回去写。够用于改常量、改错别字、删一行——也就是 review 时八成的诉求。复用现有渲染，零新依赖。

**2b：整文件编辑器。** 只有当 2a 被证明不够用时才做。纯度门禁**不禁**第三方库（`@deepseek-ai/*` 才要求 `import type`,shiki 就是既有的第三方例子），所以这是**体积**问题不是政策问题：客户端已经 2.46 MB，CodeMirror 6 大约再加 200–400 KB。要做就明确记一笔体积预算。

## 阶段 3：WebIDE 的其余部分

只有当 1 和 2 都稳了才谈：

- 从 `repoTree` 打开**任意**文件编辑，而不只是改动过的文件；
- 文件内搜索 / 跳转；
- 新建、重命名、删除文件（每一个都要走确认链）。

这一阶段的每一项都在扩大写入面，逐项评估，不打包上。

## 非目标

- **永远不要**一个不带 sha 校验的 `writeFile(path, content)` RPC；
- 不引入 `git clean`、`reset --hard`、`checkout -f`、`--force`,这条戒律在 `git-ops.ts` 头部，本计划不动它；
- 不做多人协同编辑；agent 是唯一的另一个写入方，用拒绝而不是合并来处理它。

## 执行顺序

```
阶段 0  patch-model.ts + 测试            纯函数，先行，正确性地基
阶段 1  hunkDiff / applyPatch + UI      不新增写能力
阶段 2a 行内编辑 + sha 校验              第一次真正写文件
阶段 2b 编辑器（视需要）                  体积预算
阶段 3  任意文件 / 新建 / 重命名           逐项评估
```

每阶段独立可发布，各自带测试，各自能单独回退。
