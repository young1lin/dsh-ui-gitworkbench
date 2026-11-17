# 文件引用与会话草稿

> verification_baseline: b3cbeb0
> verified_at: 2026-11-16
> harness_verified_commit: fcc0ad4621（只读核实，兄弟 checkout 0.2.2-rc.1）
> installed_conversation_types: @deepseek-ai/dsh-client-ui-conversation 0.2.2-rc.1；ui-input-trigger 0.2.2-rc.1
> source_packages: src/client/FileActions.tsx、file-reference.ts、index.ts、GitWorkbenchPanel.tsx；src/file-reference.ts、reference-contract.ts、index.ts

## 文件动作入口

Changes / History / Compare 的选中文件工具栏、Files 查看器工具栏提供「添加到对话」。文件树行支持右键、行尾 ⋯、Shift+F10 / ContextMenu 键，菜单包含添加引用与复制文件名、仓库相对路径、绝对路径。目录不提供文件菜单。菜单用抽屉共享的单个实例，定位限制在视口内；支持方向键、Home / End、Escape 和触发行焦点恢复。复制直接调用 Clipboard API，不触发 RPC、选中文件、暂存或关闭抽屉。文案在 locales.ts 的 en / zh 同时登记。

工具栏入口为常驻的「对话气泡＋」SVG 图标，复用 treeIcon 的 24px 方形按钮尺寸。IconActionButton 也承载暂存、撤销、编辑、保存等紧凑动作。悬停 300ms 或键盘聚焦时显示双语名称与说明；原生 Popover 顶层避免工具栏 overflow 裁切，不支持时回退 CSS。Escape 先收起提示，再次 Escape 不拦截事件。按钮保留 aria-label，aria-describedby 指向说明；右键菜单显示完整文字。计时器和打开期间的滚动、resize 监听随提示释放。

FileActionsProvider 位于共享工作台根内；浮层模式的整个 overlay portal 到 document.body，停靠模式保留在原生 tab 容器内，菜单作为 drawer 的兄弟节点，避开标题区遮罩与 drawer 的 overflow 裁剪。只有菜单打开时才注册外部点击、滚动和 resize 监听，关闭时逐一释放。Context 动作函数保持稳定，菜单与反馈变化不重建文件行。

复制成功反馈在 1.8 秒后自动收起，错误提示持续显示；替换反馈或卸载组件时清理成功反馈的计时器。反馈状态存储文案键，显示时按当前语言翻译。

## 输入事务

Session 标准 props 提供 inputActions；根注入的 referenceBridge 通过公开 sessions.scope(sessionId) 借用已保留上下文，再用 conversation.input.for(scope) 取得 SessionInput。所有客户端 @deepseek-ai/* 导入仍为 import type。

1. 动作捕获所看来源、文件路径、删除 / 改名元数据与加载结果的 Git 版本。历史身份取结果 commits[0]，比较身份取 referenceRange，不取正在切换的输入框 ref。

历史列表与 commitStats 的 hash 可以是短 SHA。resolvedReferenceView 使用 fileReference 返回的完整 change 补全并核对前缀，不用删除文件的父 revision 冒充所选提交。prepareFileInsertion 和短 SHA 的 prepareExcerptInsertion 在解析前捕获草稿事务；代码保留点击时的快照，解析后拒绝已变化的草稿、会话输入实例、取消或重复插入。工作区、完整 SHA 与比较代码引用保持同步插入。
2. inputActions.captureInsertion() 捕获编辑器坐标与 draftRev，然后只请求这一个文件的 fileReference；不读文件全文、不枚举仓库。
3. 解析完成后，由 Drawer.guardLeave 使用最新的编辑器 dirty 状态决定是否询问离开。异步读取发生在确认之前，避免确认后等待期间的新编辑被直接关闭。
4. 确认后同步核对 SessionInput 对象身份、AbortSignal 与原 draftRev，再插入并关闭抽屉，最后 input.focus() 返回草稿。

选区折叠到末端，原选中文字不被替换。已有引用不经过 setDraft；不计算 useInput.draft.length，因为 draft 是剪贴板投影，引用 chip 的编辑器长度与文本长度不同。事务只可提交一次，不调用 submit / conversation.send。草稿变化或输入正忙时显示失败，保留抽屉与草稿；关闭、换 Session / worktree / 版本会让旧实例释放或取消，迟到结果不再插入。

## 路径与版本身份

file.path 为仓库相对路径。会话 cwd 可以处于仓库子目录，抽屉也可以 pin 到其他 worktree；因此绝对路径按所看结果的 repoRoot 组合，不按会话 cwd 组合。宿主重新解析根并核对客户端捕获的 repoRoot，根变化就拒绝。

- 当前文件：确认磁盘存在后，插入 `git-workbench` 来源标签，ref 和 clipboardText 保留自包含引用数据，显示文件名。`inputTriggers.registerSource` 注册 codec，发送时返回完整引用文本；不能只注册消息渲染器而遗漏 codec。
- 提交历史：解析完整 commit SHA，正常文件取该提交，删除文件取第一父提交。revisionPath 保留旧版本路径；不把历史构造成当前 @file。
- 工作树删除：优先记录 HEAD 的旧文件对象；HEAD 不含该文件时冻结 index 对象。两者均没有内容时只标识删除路径，不假装存在当前文件。
- Compare：生成结果时先冻结两端 commit，解析真实 merge base；无共同祖先时取 base tip。referenceRange 随结果返回，作为引用、按需 diff、图片来源及 per-view 缓存身份。删除文件从实际 base 读，其他文件从 head 读。

所有引用序列化为 `git-workbench` fenced JSON，包含 repository、path、absolutePath、ReferenceView 与可用的 Git 对象身份，省略不存在字段。代码另含 displayedSnapshot 和原始 code，JSON 转义保留 CRLF 和代码内反引号。`workbenchReferenceRule` 与 `conversation.user.text.node` 显示业务标签，`ReferenceNavigation` 按会话保留最多 32 个待处理预览；挂载的原编辑器通过 `useReferenceReveal` 注册可释放的定位回调，优先消费同会话、同 worktree / 路径 / 版本 / 暂存层和内容身份的点击请求。`reference-reveal` 只读取引用范围核对实际文本，差异块核对两侧；`cm-reference-reveal` 只修改保留编辑器的选区和滚动，旧侧使用可见删除编辑器，离屏时通过 CodeMirror measure 队列定位，保留草稿、未保存编辑和撤销历史。无法准确回跳时 ReferencePreview 使用独立 Provider 和只读快照，不替换底层编辑器；文件按冻结来源加载，无法解析时明确显示不可用。旧绝对 mention 没有版本信息，只按所属工作树打开。复制路径仍只复制磁盘位置。宿主返回 JSON-safe 数据。

## 兼容性与验证

插入使用 captureInsertion / SessionInput.insertReference / focus，注册输入来源 codec 及消息节点使用 0.2.2-rc.1 的公开接口。较新的 ui-context-menu 不作为依赖：其通用 file target 按 Session cwd 解释路径且不含 Git revision，插件菜单保留自身版本身份。能力不可用或旧宿主未加载新 RPC 时显示可恢复错误，不写入整份草稿。更新宿主半后需要重载：提供 HMR 的运行时，可在 CLI 安装后对已启用的本插件调用公开 pluginManager/setBundleEnabled(name, true) 重新应用包解析，保持启用状态；核对 application 与实际 RPC 返回内容，确认加载新代码。无 HMR 时重启 dsh web，再刷新客户端。客户端包由服务按请求读取。

- tests/file-reference.test.ts：真实临时 Git worktree、删除提交与 index-only 旧版本、merge base / unrelated fallback、路径、原草稿选区、Session 和草稿竞态。
- tests/historical-quote.test.ts：短 SHA 补全、删除父版本区分、代码快照、事务竞态、取消及单次插入。
- tests/file-actions.test.ts：用 react-test-renderer 驱动组件事件，验证 en / zh、三种复制、右键不选中 / 暂存、离开确认、历史引用标签、取消请求与监听器释放。该依赖仅用于开发测试。
- 运行验证核对 web profile 的安装来源和产物哈希，并从已认证的 boot manifest 取回实际插件 bundle；检查 UI 时使用独立验证标签页，避免操作使用者的草稿和 Git 暂存状态。

## 原生停靠栏与代码快照

`index.ts` 通过公开 sidebarRight/sidebarRightTabs 注册带 keepMounted 的工作台类型及 keyed body/title；标题注册与原生 metadata 均读取同一 i18n key。头部入口核对 foreground session 后打开该类型；缺少关闭生命周期接口时沿用浮层。`DockedWorkbench` 将 tab.visible 和每实例关闭绑定传给共享 Panel，原生布局负责停靠、浮动和全屏。隐藏体保留来源 pin 与缓冲，停止重轮询、取消异步插入；WorkbenchVisibility 让确认弹窗卸下全局键盘监听。

WorkbenchCloseGuards 按 session+tab 保存已挂载 Drawer 的关闭检查，解绑时删除；registerCloseHandler 的同步失败保留原生标签，脏关闭先显示同 session 的目标，再由原有 Leave/Stay 确认准入一次关闭。原生 X、菜单和面板内关闭使用相同门禁。

CodeEditor 在捕获时先用 cm-code-selection 核对浏览器选区实际所属的新 / 旧编辑器，通过 CodeMirror posAtDOM 读取对应文档；选区已离开代码区时才使用保留的 CodeMirror 选区。删除子编辑器附自己的旧行偏移及挂载时的来源 stamp，跨新旧编辑器的选区拒绝引用。静态 diff 的 useCodeSelection 同样优先当前 DOM 范围，再使用保留坐标；code-selection-dom 将高亮 token 与 CR 可视标记映射回源偏移，整行端点落在行容器时仅在可见代码单元中解析边界。显式点击 AddExcerptButton 时，code-excerpt 截取所看文本并编码 repoRoot、path、previousPath、deleted、冻结 view 与 displayedSnapshot。统一 diff 的混合选区用 diffLines 保留每行新旧坐标；差异块包含两侧范围与增删文本。工作树层附 layer、diffSha，缓冲附 base blob 与 unsaved。片段不解析为 live @file，也不重新读取磁盘。插入使用同一输入 span CAS，保留原草稿与 chips，不发送；成功后右栏保持打开。

代码选区右键及 Shift+F10 由 useExcerptMenu 接入同一菜单。打开时序列化 excerptText，冻结 provider 的 repoRoot、view 与代码；点击时仍校验活动 Session，使用最新 captureInsertion 并折叠到末端，不复用打开菜单时的草稿坐标。菜单也可复制原始代码，不发 RPC。

左右对照的共享工具栏通过 combineSelections 先读取静态旧侧的实际选区，再检查 CodeEditor，捕获不依赖 React 的 available 通知先后顺序。CodeEditor 捕获的旧快照及 useCodeSelection 的 heldRange 同步保留最近一次有效捕获，焦点移到菜单或草稿时继续使用同一来源；版本 key 变化后保留坐标失效。tests/code-editor-selection.test.ts、use-code-selection.test.ts 与 editor-quote.test.ts 覆盖通知延迟、焦点转移和双列优先级。

## 单列编辑与删除块

停靠 Changes 的 SideBySideView 默认 preferInline，可切换左右对照，右侧 CodeEditor 的 key 保持不变以保留缓冲、光标与撤销。新版自动进入既有缓冲编辑流程，保存仍走原有 baseSha 检查；暂存层及不安全编码只读。光标行通过 inlineBlockAt 二分定位已保存差异块，脏缓冲禁用块操作；点击旧删除块也同步当前块。

inline-diff 仅负责从全上下文 patch 重建旧文本与末尾换行，以及定位已保存块。inline-merge 使用官方 unifiedMergeView 管理 chunks、增量计算和折叠，basis 变化通过公开 originalDocChangeEffect 更新，保留当前文档、选区及撤销。merge-line-endings 仅在比较投影中忽略 CRLF，映射回原始字符偏移；真正的末尾换行变化保留并提示。merge-deletions 通过公开 decorations/widget 接口，仅为可见删除 widget 接入高度有界的只读 CodeMirror；旧内容滚动时按视口渲染。子编辑器由 WeakMap 持有并销毁，live Set 随 destroy 移除。旧选区使用子文档实际文本、全局旧行偏移与冻结 stamp。 删除子编辑器不再叠加行号列；删除 widget 的 max-content 宽度将横向滚动交给主 scroller，开启软换行时恢复完整正文宽度，旧行范围保存在双语 title 与引用坐标中。

主编辑器语法按 cm-visible-lines 合并 visibleRanges，跳过折叠行；按当前不可变 doc 保留一份 lines，滚动不重复拆全文。删除块使用独立 original token key。

diff-context.ts 的 DIFF_CONTEXT_LINES 统一设为 8：inlineMerge 交给官方 collapseUnchanged 保留修改前后上下文，宿主 fileDiff / commitStats / compareRefs 的可读 patch 使用 DIFF_CONTEXT_ARG。fileSides 的完整 patch 与块操作身份不受此阅读参数影响。右键文件与代码菜单共享 ActionGlyph，图标对辅助技术隐藏；工具栏提示只显示标签与可选快捷键，完整说明保留 aria-describedby。tooltip-placement 根据实际文字宽度居中、避开窗口边缘，点击或 Escape 收起，滚动与缩放清理原有浮层监听。

## 侧栏导航与提交区

dock-layout 按四个页签分别保存 commits/files/code 导航位置。Changes 默认代码，History 默认提交，Compare 与 Files 默认文件列表。代码页没有打开文件时回到列表；选提交后进入文件列表，选文件进入代码。返回列表仅改变 CSS 显示，编辑器保持挂载以保留缓冲、选区和撤销；真实切换文件继续走 guardLeave 或 FileBrowser 的 pending 确认。

styles/dock-layout.css 按容器宽度切换：不超过 900px 时列表和代码分别占满区域，更宽时展开列表可并排。WorkbenchChrome 第一行保留来源、Radix 视图菜单、刷新和更多。SourceChip 的 details 展示当前路径、统计与版本；独立 BranchSwitcher 与只读工作树查看列表分区。WorkbenchMore 的显示与同步菜单使用 Radix，SyncMenu 在同一菜单内展开拉取策略，SettingsMenu 受控单独打开。EditorToolbar 第二行合并文件选择、暂存层、块导航、引用和编辑菜单；容器不超过 410px 时换行。DockFileNavigation 保留路径提示和历史版本标记，文件列表负责文件导航。CodeEditor 通过 onSelectionChange 仅发布可用状态与稳定 capture，editorQuote 优先当前文件选区，再选当前块，脏缓冲只禁止块引用；独立预览保留自己的引用按钮。EditorMenu 复用 FileActionMenuItems，完整文件引用也从 provider 的 excerptFile 补齐删除与旧路径身份。ActionMenuContext 将 IconActionButton 渲染为带完整文字的菜单项。Radix 负责键盘、焦点和定位；CSS 使用工作台主题变量。History 固定 stacked；Changes 的 DockCommitPanel 默认折叠并保持 CommitBox 挂载，说明和 amend 由 Panel 保存。

验证入口：tests/workbench-dock.test.ts、editor-quote.test.ts、editor-toolbar.test.ts、code-excerpt.test.ts、code-selection-dom.test.ts、file-actions.test.ts、inline-diff.test.ts、inline-merge.test.ts、cm-visible-lines.test.ts。happy-dom 与 react-test-renderer 均为 devDependencies。

## DSH 原生文件菜单与多条批注

index.ts 对公开 contextMenus 服务做可选注入，native-file-menu.ts 注册 file 贡献和工作台图标。目标由 DSH 在手势时解析为绝对路径，保留 sessionId 和可用行号；没有 Git 版本字段，所以该入口明确显示当前工作树只读变更，不推断历史。nativeFileLocation RPC 经 native-file.ts 仅沿父目录查找存在的目录，再调用 repoRootOf；删除文件或已删除目录同样定位其所属 worktree，不枚举仓库。ReferenceNavigation 的临时 options 保存 changes/line，不写入持久代码引用；预览保留底下的编辑器缓冲与撤销。前台会话变化、后续请求或卸载均取消迟到导航。

FileActionsProvider 在选区菜单和 AddExcerptButton 中加入写批注。captureAnnotation 先克隆选区实际代码与来源，仅缩写提交需要 fileReference RPC 补全 SHA。注释不会重读磁盘。AnnotationStore 按会话保留待加入批注和一条正在编写的批注，独立于 keyed Provider，切换 worktree/版本不丢失。已有未保存批注时要求先保存或取消；不会用新选区覆盖它。上限为 32 个非空会话、每会话 64 条已保存批注、全局 8 MiB 估算文本；容量不足明确提示，不能静默逐出未加入草稿的内容。referenceBytes 弱缓存只计量一次选区正文，输入批注时只更新有界批注条目的大小；size() 返回可验证的会话数、条目数和字节估算。刷新或卸载释放全部暂存状态，DSH 草稿独立保存。

AnnotationsPanel 是按需出现、可折叠的底部面板。用户保存批注后可编辑、删除或回看来源；批注注明旧版/新版、冻结 SHA、删除文件和未保存缓冲。insertAnnotations 通过 captureInsertion 折叠到草稿选区末端，向 git-workbench-annotations 来源插入一个引用，单个 CAS 和撤销步骤承载整组。插入失败不清空批注，成功仅移除那次实际插入的同一条目对象，期间编辑或新加的批注保留。没有 setDraft、submit 或额外插入正文的调用。

annotation-source.ts 注册 fenced JSON codec 和 userText 规则；annotations.ts 校验每条 reference、批注文案及代码快照。草稿组点击通过 ReferenceNavigation options.batch 打开完整批注列表，再点每条来源读取它自己的快照；消息节点 AnnotationBatchNode 显示每条批注和独立来源按钮。外层批注组不退化为原生 @file，也不把多条笔记逐次插入而产生部分成功。文本和标题均在 locales.ts 中同时登记 en/zh。

验证：tests/annotations.test.ts、annotation-ui.test.ts、native-file-menu.test.ts、reference-preview.test.ts、workbench-dock.test.ts；公开入口实机探针保存在本机 gitworkbench-annotations-20261117 工件目录。
