/**
 * Dictionaries for this plugin's UI copy, registered into the app's locale
 * runtime under the `gitworkbench` namespace so the panel follows the user's
 * language preference instead of shipping one hardcoded language.
 *
 * The namespace lives outside dsh's `LocaleNamespaceMap` merge table (this is an
 * out-of-tree plugin), so registration uses `ctx.locale.register(ns, locale, dict)`
 * — the single-locale untyped form the runtime provides for exactly that case.
 * Keys ARE compile-time checked — both dictionaries are `Record<WorkbenchKey, string>`,
 * so tsc keeps them in step — but a lookup miss still renders the key itself
 * rather than blank.
 *
 * Values are templates with `{name}` placeholders.
 *
 * English wording follows git's own vocabulary rather than translating the
 * Chinese literally: a change set is `added / modified / deleted`, matching
 * `git status` and the file badges (A / M / D) the tree already renders.
 */

/** Every key this plugin looks up — the two dictionaries below must both cover it. */
export type WorkbenchKey =
  | 'aheadTitle' | 'behindTitle' | 'files'
  | 'filterFiles' | 'filterFilesPlaceholder' | 'filterFilesClear' | 'filesFiltered' | 'filterNoMatch'
  | 'drawerLabel' | 'totalsDim' | 'refresh' | 'close'
  | 'tabsLabel' | 'tabChanges' | 'tabHistory' | 'tabCompare'
  | 'sourceLabel' | 'workingTree'
  | 'loadingCommit' | 'renamedFrom' | 'binaryFile' | 'loadingDiff' | 'noTextDiff'
  | 'noCommits' | 'historyLabel' | 'historyEnd' | 'loading' | 'maximize' | 'restore'
  // side-by-side diff pane: the two layer tabs, and the size-guard notice
  | 'tabUnstaged' | 'tabStaged' | 'diffTooLarge'
  | 'commitAuthor' | 'commitCommitter' | 'commitDate' | 'historyFilterPlaceholder' | 'historyNoMatch'
  | 'filterClearAll' | 'filterBy' | 'filterUsers' | 'filterUserSearch' | 'filterAuthorsMore'
  | 'filterDate' | 'filterToday' | 'filterLast7' | 'filterLast30' | 'filterAfter' | 'filterBefore'
  | 'filterPaths' | 'filterPathsMore' | 'allBranches' | 'filterPathSearch'
  | 'filterCalendarSets' | 'filterSelected' | 'filterLocale'
  | 'compareBase' | 'compareHead' | 'comparePick' | 'compareCommits' | 'loadingCompare' | 'noBranches'
  | 'refSearch' | 'refNone' | 'refCount' | 'refTruncated' | 'refWorktrees' | 'refBranches' | 'historyRefLabel'
  | 'settings' | 'themeMode' | 'themePalette' | 'themeScope' | 'themeBackground' | 'themeCss'
  | 'modeSystem' | 'modeLight' | 'modeDark'
  | 'scopeProject' | 'scopeGlobal' | 'scopeGlobalHint' | 'scopeNoRepo'
  | 'bgNone' | 'bgChoose' | 'bgClear' | 'bgBlur' | 'bgVeil' | 'bgWorking' | 'bgFailed' | 'bgTooBig'
  | 'cssPlaceholder' | 'cssImport' | 'cssApply' | 'cssUnapplied' | 'styleFailed'
  | 'resizeLabel' | 'resizeCommits' | 'resizeTree' | 'resizeSides'
  | 'expandAll' | 'collapseAll' | 'noBranch'
  | 'copyCommit' | 'copiedCommit'
  // write operations
  | 'syncLabel' | 'noUpstream' | 'noUpstreamHint' | 'upToDate' | 'opRunning'
  | 'fetch' | 'pull' | 'push' | 'publish' | 'pushSetUpstream'
  | 'pullModeLabel' | 'pullFf' | 'pullRebase' | 'pullMerge'
  | 'stage' | 'unstage' | 'stageAll' | 'unstageAll' | 'stagedCount'
  | 'commit' | 'amend' | 'commitPlaceholder' | 'commitNeedMessage' | 'commitLead'
  | 'op.ok.stage' | 'op.ok.unstage' | 'op.ok.commit' | 'op.ok.fetch' | 'op.ok.pull' | 'op.ok.push'
  | 'op.ok.discardFile' | 'op.ok.applyBlocks'
  | 'discardAction' | 'discardTitle' | 'discardConfirm' | 'discardCancel'
  | 'discardBodyRestore' | 'discardBodyDelete' | 'discardBodyUnrename'
  // side-by-side block actions: the three buttons and the roll-back confirmation's wording
  | 'blockStage' | 'blockDiscard' | 'blockUnstage' | 'blockDiscardBody' | 'blockDiscardBodyDelete'
  // side-by-side editing: arm the editor, save, revert, the stale/conflict
  // banner, the CRLF refusal notice, and the unsaved-changes prompt that
  // guards every gesture dropping the buffer (tab, file, close)
  | 'editFile' | 'fileSave' | 'fileRevert' | 'editingNotice' | 'crlfNotice' | 'encodingNotice'
  // blame gutter on the working-tree column
  | 'blameToggle' | 'blameHint' | 'blameUncommitted' | 'blameFailed' | 'blameTruncated'
  | 'saveFailed' | 'saveUnavailable' | 'saveRetry'
  | 'staleTitle' | 'staleBody' | 'staleReload' | 'staleOverwrite'
  | 'unsavedTitle' | 'unsavedBody' | 'unsavedLeave' | 'unsavedStay'
  | 'op.fail.auth' | 'op.fail.network' | 'op.fail.no-upstream' | 'op.fail.diverged' | 'op.fail.conflict'
  | 'op.fail.nothing-to-commit' | 'op.fail.dirty' | 'op.fail.stale' | 'op.fail.invalid' | 'op.fail.unknown'

export const zh: Record<WorkbenchKey, string> = {
  aheadTitle: '领先上游 {count} 个提交',
  behindTitle: '落后上游 {count} 个提交',
  files: '{count} 文件',
  drawerLabel: 'git 变更',
  totalsDim: '{added} 新 · {modified} 改 · {deleted} 删',
  refresh: '刷新',
  close: '关闭',
  tabsLabel: '变更视图',
  tabChanges: '变更',
  tabHistory: '历史',
  tabCompare: '对比',
  historyEnd: '已到最早的提交',
  loading: '加载中…',
  maximize: '最大化',
  restore: '还原',
  compareBase: '基准',
  compareHead: '对比',
  comparePick: '选择两个不同的分支进行对比',
  compareCommits: '{count} 个提交（自共同祖先起）',
  loadingCompare: '加载对比…',
  noBranches: '没有可对比的分支',
  refSearch: '筛选分支…',
  refNone: '没有匹配的分支',
  refCount: '{shown} / {total}',
  refTruncated: '仅显示最近的若干分支',
  refWorktrees: '有工作树的分支',
  refBranches: '其他分支',
  historyRefLabel: '分支',
  settings: '设置',
  themeMode: '明暗',
  themePalette: '配色',
  themeScope: '作用范围',
  themeBackground: '背景图',
  themeCss: '自定义 CSS',
  modeSystem: '跟随',
  modeLight: '亮色',
  modeDark: '暗色',
  scopeProject: '本项目',
  scopeGlobal: '全局',
  scopeGlobalHint: '所有项目；本项目单独设置时以本项目为准',
  scopeNoRepo: '当前目录不是 git 仓库，只能设置全局',
  bgNone: '未设置背景图',
  bgChoose: '选择图片…',
  bgClear: '清除',
  bgBlur: '虚化',
  bgVeil: '遮罩',
  bgWorking: '处理中…',
  bgFailed: '这个文件无法作为图片读取',
  bgTooBig: '图片过大，请换一张',
  cssPlaceholder: '例如 [data-gs-part="card"] { --gs-accent: #ff0066; }',
  cssImport: '导入…',
  cssApply: '应用',
  cssUnapplied: '有未应用的修改',
  styleFailed: '保存失败',
  resizeLabel: '拖动调整抽屉宽度',
  resizeCommits: '拖动调整提交列表宽度',
  resizeTree: '拖动调整文件树宽度',
  resizeSides: '拖动调整左右两栏宽度',
  sourceLabel: '统计来源切换',
  workingTree: '工作区',
  loadingCommit: '加载提交…',
  renamedFrom: '重命名自',
  binaryFile: '二进制文件 —— 不显示文本 diff',
  loadingDiff: '加载 diff…',
  noTextDiff: '无文本差异',
  // The side-by-side pane's layer tabs: unstaged is index→worktree, staged is
  // HEAD→index — the two halves of what the old combined view showed at once.
  tabUnstaged: '未暂存',
  tabStaged: '已暂存',
  diffTooLarge: '文件过大（超过 20000 行或 2 MB），已改用普通 diff 视图',
  noCommits: '无提交历史',
  historyLabel: '提交历史',
  commitAuthor: '作者',
  commitCommitter: '提交者',
  commitDate: '提交时间',
  historyFilterPlaceholder: '筛选：user: 名字 / path: 路径 / after: 日期 / 关键词',
  historyNoMatch: '没有匹配的提交',
  filterClearAll: '清除全部',
  filterBy: '筛选条件',
  filterUsers: '用户',
  filterUserSearch: '搜索作者',
  filterAuthorsMore: '仅显示提交最多的 500 位作者',
  filterDate: '日期',
  filterToday: '今天',
  filterLast7: '最近 7 天',
  filterLast30: '最近 30 天',
  filterAfter: '之后',
  filterBefore: '之前',
  filterPaths: '路径',
  filterPathsMore: '文件过多，目录树已截断',
  filterPathSearch: '搜索文件或目录',
  filterCalendarSets: '日历写入',
  filterSelected: '已选 {count} 项',
  // BCP-47 tag for the filter calendar. The month title and the weekday row
  // used to come from `Intl.DateTimeFormat(undefined, …)`, i.e. the BROWSER's
  // language — an English drawer on a zh-CN machine printed "2026年8月" over
  // 一二三四五六日. The dictionary is what knows which language the drawer is
  // speaking, so the tag lives here.
  filterLocale: 'zh-CN',
  allBranches: '全部分支',
  expandAll: '展开全部',
  collapseAll: '收起全部',
  // Filtering the file list. Separate from the funnel above the commit list:
  // that one asks git for a different set of commits, this one only hides rows
  // already on screen.
  filterFiles: '过滤文件',
  filterFilesPlaceholder: '过滤文件，空格分隔多个关键字',
  filterFilesClear: '清除过滤',
  filesFiltered: '{shown} / {count} 文件',
  filterNoMatch: '没有匹配的文件',
  noBranch: '(无分支)',
  copyCommit: '复制提交说明',
  copiedCommit: '已复制',
  syncLabel: '与远端同步',
  noUpstream: '未跟踪远端分支',
  noUpstreamHint: '当前分支没有上游分支，先推送一次即可建立',
  upToDate: '已同步',
  opRunning: '执行中…',
  fetch: '拉取远端信息',
  pull: '拉取',
  push: '推送',
  publish: '发布分支',
  pushSetUpstream: '首次推送，将建立 origin 上的同名分支',
  pullModeLabel: '拉取方式',
  pullFf: '仅快进',
  pullRebase: '变基',
  pullMerge: '合并',
  stage: '暂存',
  unstage: '取消暂存',
  stageAll: '勾选全部',
  unstageAll: '取消全部勾选',
  stagedCount: '已勾选 {count} 个',
  commit: '提交',
  amend: '修改上一条提交',
  commitPlaceholder: '提交说明（Ctrl+Enter 提交）',
  commitNeedMessage: '请先填写提交说明',
  commitLead: '先勾选文件暂存，再提交',
  'op.ok.stage': '已暂存',
  'op.ok.unstage': '已取消暂存',
  'op.ok.commit': '提交成功',
  'op.ok.fetch': '已获取远端信息',
  'op.ok.pull': '拉取完成',
  'op.ok.push': '推送成功',
  'op.ok.discardFile': '已撤回',
  'op.ok.applyBlocks': '已应用',
  // The row action, and the dialog it opens. IDEA calls this Rollback and
  // means "take the file back to its committed state" — not "undo my last
  // edit", which is the editor's job and a different promise.
  discardAction: '撤回改动',
  discardTitle: '撤回改动？',
  discardConfirm: '撤回',
  discardCancel: '取消',
  // One body per consequence. The dialog never says a generic "are you sure":
  // the whole point of it is to name which of these three is about to happen.
  discardBodyRestore: '{path} 将还原成上次提交时的样子。这里的 {added} 行新增、{deleted} 行删除无法找回。',
  discardBodyDelete: '{path} 从未被 git 记录过，删除后无法找回。',
  discardBodyUnrename: '撤销重命名：{path} 改回 {previousPath}，改名期间的内容改动一并丢弃。',
  // One BLOCK, not the whole file: the side pane's roll-back states exactly
  // which lines leave and that the working-tree file is rewritten to do it.
  blockStage: '暂存这块',
  blockDiscard: '撤回这块',
  blockUnstage: '取消暂存这块',
  blockDiscardBody: '{path} 的这一块改动（{added} 行新增、{deleted} 行删除）将被撤回，工作区文件随之改写，无法找回。',
  // The untracked case: the file's whole content is the one block, so rolling
  // the block back reverse-applies the new-file patch and DELETES the file —
  // the same consequence class the file-level delete wording exists to name.
  blockDiscardBodyDelete: '{path} 从未被 git 记录过，这一块就是整个文件，撤回后文件将被删除，无法找回。',
  // The editable right column: editing arms explicitly (never per keystroke —
  // an autosave racing a concurrent agent write is the data-loss case), and
  // every save carries the sha the editor opened with.
  editFile: '编辑',
  fileSave: '保存（Ctrl/Cmd+S）',
  fileRevert: '放弃修改',
  editingNotice: '正在编辑且未保存：保存前区块操作不可用；切走前（换页签、选其他文件、关闭抽屉）会先确认。',
  // Why the edit affordance is withheld on a CRLF file: the editor control
  // itself rewrites \r\n to \n, so any save would change every line ending.
  blameToggle: 'Blame',
  blameHint: '显示每一行最后是被谁、在哪个提交里改的',
  blameUncommitted: '尚未提交',
  blameFailed: '这个文件没有可追溯的历史（可能是未跟踪的新文件）。',
  blameTruncated: '文件过长，追溯信息只显示了前面一部分。',
  crlfNotice: '这个文件的行尾是 CRLF，暂不支持在线编辑（编辑框会把行尾统一成 LF，保存时整份文件都会被改写）；查看和按块暂存/撤回不受影响。',
  encodingNotice: '这个文件不是 UTF-8 编码（可能是 GBK、Shift JIS 之类），暂不支持在线编辑：页面上看到的文字是一次有损解码，保存回去会把文件里每一个非 ASCII 字节都改写掉，包括你没动过的行。查看和按块暂存/撤回不受影响。',
  saveFailed: '保存失败',
  saveUnavailable: '当前宿主还不支持保存（需要重启 dsh web 加载新版宿主端）。',
  saveRetry: '重试保存',
  staleTitle: '这个文件在你编辑期间被修改了',
  staleBody: '磁盘上的内容已不是编辑器打开时的那份（保存时会被拒绝，文件保持原样）。可以放弃你的修改重新加载，也可以用编辑器里的内容覆盖磁盘上的新版本。',
  staleReload: '重新加载（丢弃修改）',
  staleOverwrite: '用编辑器内容覆盖',
  unsavedTitle: '有未保存的修改',
  unsavedBody: '{path} 有未保存的修改，切换后将丢弃这些修改。',
  unsavedLeave: '仍要切换',
  unsavedStay: '继续编辑',
  'op.fail.auth': '认证失败。凭据提示已被禁用，请先在终端里配置好凭据再重试。',
  'op.fail.network': '网络不可达：主机名解析失败或连接不上。检查网络与远程地址后重试。',
  'op.fail.no-upstream': '当前分支没有上游分支。',
  'op.fail.diverged': '远端有本地没有的提交。先拉取再推送——这里不会强制覆盖。',
  'op.fail.conflict': '出现冲突，工作区已被改动。请在编辑器里解决冲突后继续。',
  'op.fail.nothing-to-commit': '暂存区是空的，没有可提交的内容。',
  'op.fail.dirty': '本地改动会被覆盖。先提交或暂存它们。',
  'op.fail.stale': 'diff 已过期。',
  'op.fail.invalid': '无效的操作。',
  'op.fail.unknown': '操作失败。',
}

export const en: Record<WorkbenchKey, string> = {
  aheadTitle: '{count} commits ahead of upstream',
  behindTitle: '{count} commits behind upstream',
  files: '{count} files',
  drawerLabel: 'git changes',
  totalsDim: '{added} added · {modified} modified · {deleted} deleted',
  refresh: 'Refresh',
  close: 'Close',
  tabsLabel: 'Change views',
  tabChanges: 'Changes',
  tabHistory: 'History',
  tabCompare: 'Compare',
  historyEnd: 'Start of history',
  loading: 'Loading…',
  maximize: 'Maximize',
  restore: 'Restore',
  compareBase: 'Base',
  compareHead: 'Compare',
  comparePick: 'Pick two different branches to compare',
  compareCommits: '{count} commits since they diverged',
  loadingCompare: 'Loading comparison…',
  noBranches: 'No branches to compare',
  refSearch: 'Filter branches…',
  refNone: 'No matching branch',
  refCount: '{shown} / {total}',
  refTruncated: 'showing the most recent only',
  refWorktrees: 'With a worktree',
  refBranches: 'Other branches',
  historyRefLabel: 'Branch',
  settings: 'Settings',
  themeMode: 'Mode',
  themePalette: 'Palette',
  themeScope: 'Applies to',
  themeBackground: 'Background',
  themeCss: 'Custom CSS',
  modeSystem: 'Match app',
  modeLight: 'Light',
  modeDark: 'Dark',
  scopeProject: 'This project',
  scopeGlobal: 'Global',
  scopeGlobalHint: 'Every project; a project setting wins over this one',
  scopeNoRepo: 'Not a git repository — global only',
  bgNone: 'No background image',
  bgChoose: 'Choose image…',
  bgClear: 'Clear',
  bgBlur: 'Blur',
  bgVeil: 'Veil',
  bgWorking: 'Working…',
  bgFailed: 'That file could not be read as an image',
  bgTooBig: 'Image too large — pick another',
  cssPlaceholder: 'e.g. [data-gs-part="card"] { --gs-accent: #ff0066; }',
  cssImport: 'Import…',
  cssApply: 'Apply',
  cssUnapplied: 'Unapplied changes',
  styleFailed: 'Could not save',
  resizeLabel: 'Drag to resize the drawer',
  resizeCommits: 'Drag to resize the commit list',
  resizeTree: 'Drag to resize the file tree',
  resizeSides: 'Drag to resize the two columns',
  sourceLabel: 'Switch stats source',
  workingTree: 'Working tree',
  loadingCommit: 'Loading commit…',
  renamedFrom: 'Renamed from',
  binaryFile: 'Binary file — no text diff',
  loadingDiff: 'Loading diff…',
  noTextDiff: 'No text changes',
  tabUnstaged: 'Unstaged',
  tabStaged: 'Staged',
  diffTooLarge: 'File too large (over 20,000 lines or 2 MB) — showing the plain diff view',
  noCommits: 'No commit history',
  historyLabel: 'Commit history',
  commitAuthor: 'Author',
  commitCommitter: 'Committer',
  commitDate: 'Committed',
  historyFilterPlaceholder: 'Filter: user: name / path: dir / after: date / text',
  historyNoMatch: 'No matching commits',
  filterClearAll: 'Clear all',
  filterBy: 'Filter by',
  filterUsers: 'Users',
  filterUserSearch: 'Search authors',
  filterAuthorsMore: 'Showing the 500 busiest authors only',
  filterDate: 'Date',
  filterToday: 'Today',
  filterLast7: 'Last 7 days',
  filterLast30: 'Last 30 days',
  filterAfter: 'After',
  filterBefore: 'Before',
  filterPaths: 'Paths',
  filterPathsMore: 'Too many files — tree truncated',
  filterPathSearch: 'Search files or folders',
  filterCalendarSets: 'Calendar sets',
  filterSelected: '{count} selected',
  filterLocale: 'en-US',
  allBranches: 'All branches',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  filterFiles: 'Filter files',
  filterFilesPlaceholder: 'Filter files; space-separated terms',
  filterFilesClear: 'Clear filter',
  filesFiltered: '{shown} / {count} files',
  filterNoMatch: 'No file matches',
  noBranch: '(no branch)',
  copyCommit: 'Copy message',
  copiedCommit: 'Copied',
  syncLabel: 'Sync with remote',
  noUpstream: 'No upstream branch',
  noUpstreamHint: 'This branch tracks nothing yet; one push establishes it',
  upToDate: 'Up to date',
  opRunning: 'Working…',
  fetch: 'Fetch',
  pull: 'Pull',
  push: 'Push',
  publish: 'Publish branch',
  pushSetUpstream: 'First push — creates the branch on origin',
  pullModeLabel: 'Pull strategy',
  pullFf: 'Fast-forward only',
  pullRebase: 'Rebase',
  pullMerge: 'Merge',
  stage: 'Stage',
  unstage: 'Unstage',
  stageAll: 'Tick all',
  unstageAll: 'Untick all',
  stagedCount: '{count} ticked',
  commit: 'Commit',
  amend: 'Amend last commit',
  commitPlaceholder: 'Commit message (Ctrl+Enter to commit)',
  commitNeedMessage: 'Write a commit message first',
  commitLead: 'Tick to stage, then commit',
  'op.ok.stage': 'Staged',
  'op.ok.unstage': 'Unstaged',
  'op.ok.commit': 'Committed',
  'op.ok.fetch': 'Fetched',
  'op.ok.pull': 'Pulled',
  'op.ok.push': 'Pushed',
  'op.ok.discardFile': 'Rolled back',
  'op.ok.applyBlocks': 'Applied',
  discardAction: 'Roll back changes',
  discardTitle: 'Roll back changes?',
  discardConfirm: 'Roll back',
  discardCancel: 'Cancel',
  discardBodyRestore: '{path} goes back to its committed content. The {added} added and {deleted} deleted lines here cannot be recovered.',
  discardBodyDelete: '{path} was never recorded by git. Deleting it cannot be undone.',
  discardBodyUnrename: 'Undo the rename: {path} goes back to {previousPath}, and content changed along the way is lost.',
  // One BLOCK, not the whole file: the side pane's roll-back states exactly
  // which lines leave and that the working-tree file is rewritten to do it.
  blockStage: 'Stage block',
  blockDiscard: 'Roll back block',
  blockUnstage: 'Unstage block',
  blockDiscardBody: 'This block of {path} ({added} added, {deleted} deleted lines) is rolled back and the working-tree file rewritten to do it. This cannot be undone.',
  // The untracked case: the file's whole content is the one block, so rolling
  // the block back reverse-applies the new-file patch and DELETES the file —
  // the same consequence class the file-level delete wording exists to name.
  blockDiscardBodyDelete: '{path} was never recorded by git, and this block is its whole content — rolling it back deletes the file. This cannot be undone.',
  // The editable right column: editing arms explicitly (never per keystroke —
  // an autosave racing a concurrent agent write is the data-loss case), and
  // every save carries the sha the editor opened with.
  editFile: 'Edit',
  fileSave: 'Save (Ctrl/Cmd+S)',
  fileRevert: 'Discard edits',
  editingNotice: 'Editing with unsaved changes: block actions wait until the file is saved, and leaving first — another tab, another file, closing the drawer — asks.',
  // Why the edit affordance is withheld on a CRLF file: the editor control
  // itself rewrites \r\n to \n, so any save would change every line ending.
  blameToggle: 'Blame',
  blameHint: 'Show which commit last changed each line',
  blameUncommitted: 'Not committed yet',
  blameFailed: 'This file has no history to blame (it may be a new, untracked file).',
  blameTruncated: 'The file is long, so blame is shown for the first part only.',
  crlfNotice: 'This file has CRLF line endings, which the editor does not support yet (the edit box would turn every ending into LF, so a save rewrites the whole file); viewing and block staging/rolling back still work.',
  encodingNotice: 'This file is not UTF-8 (GBK, Shift JIS or similar), so the editor is unavailable: the text shown is a lossy decode of it, and saving that back would rewrite every non-ASCII byte in the file, including lines you never touched. Viewing and block staging/rolling back still work.',
  saveFailed: 'Save failed',
  saveUnavailable: 'This host does not support saving yet — restart dsh web to load the new host half.',
  saveRetry: 'Retry save',
  staleTitle: 'This file changed while you were editing it',
  staleBody: 'What is on disk is no longer what the editor opened (a save is refused and nothing written). Reload and lose your edits, or overwrite the newer file with what the editor holds.',
  staleReload: 'Reload (discard my edits)',
  staleOverwrite: 'Overwrite with my version',
  unsavedTitle: 'Unsaved edits',
  unsavedBody: '{path} has unsaved edits; switching now discards them.',
  unsavedLeave: 'Switch anyway',
  unsavedStay: 'Keep editing',
  'op.fail.auth': 'Authentication failed. Credential prompts are disabled here — set your credentials up in a terminal first.',
  'op.fail.network': 'The network was unreachable — the host could not be resolved or the connection failed. Check connectivity and the remote URL, then retry.',
  'op.fail.no-upstream': 'This branch has no upstream.',
  'op.fail.diverged': 'The remote has commits this branch does not. Pull first — nothing here force-pushes.',
  'op.fail.conflict': 'Conflicts. The working tree has been changed; resolve them in the editor before continuing.',
  'op.fail.nothing-to-commit': 'Nothing staged to commit.',
  'op.fail.dirty': 'Local changes would be overwritten. Commit or stash them first.',
  'op.fail.stale': 'The diff is stale.',
  'op.fail.invalid': 'Invalid operation.',
  'op.fail.unknown': 'The operation failed.',
}
