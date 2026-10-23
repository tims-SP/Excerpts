# 摘录 / Excerpts

Obsidian 本地优先的 Markdown 摘录卡片插件。

## beta.12 — 修复卡片正文与操作按钮重叠

- **首页.excerpts** 是真正的 Obsidian 文件入口，点击文件可直接打开摘录首页（通过 FileView 和 `registerExtensions`）。
- 目录作用域由该文件所在的文件夹决定；不再存在“我的摘录”收藏集名称、ID 或中间选择页面。
- 首页恢复 beta.6 的简洁快速录入、折叠搜索、随机回顾、标签筛选和单列卡片时间线。
- 快速保存直接创建普通 `.md`，支持以 YAML Frontmatter 添加可选标签。
- 每个 `.md` 文件是一张卡片。默认正文、H1 标题和动态 `##` 折叠分组来自原文件内容，同名 H2 独立保留。
- Obsidian `MarkdownRenderer.render()` 负责正文、嵌入和资源显示；卡片只负责布局、标签、章节、收藏和编辑入口。
- 卡片内可原位编辑完整 Markdown 正文（包含 H2 标题），标签使用按需展开的推荐胶囊；正文与 YAML 标签同次保存。更多操作可以打开原 Markdown 文件。仍无专用 Entry/Extra 结构和附件目录。
- 自动或手动刷新，按需渲染和分批全文搜索。

## 安装和使用

将构建产物 `main.js`、`manifest.json`、`styles.css` 放入 Vault 的 `.obsidian/plugins/excerpts/` 并启用插件。

在插件设置里输入一个现有或新文件夹，点击 **创建并打开**。插件创建一个空的 `首页.excerpts`；以后可直接在 Obsidian 文件管理器点击它打开摘录首页。左侧书签图标及命令面板的“打开摘录首页”也可以直接打开最近使用的入口文件。

目录示例：

```text
摘录/
  首页.excerpts
  时间与生活.md
  文学摘录.md
  图片.png
```

首页 `.excerpts` 文件不保存摘录正文，也不进入 `.md` 索引。`.md` 文件与媒体均使用 Obsidian 的常规格式。

## 开发状态

本测试版对 beta.8 是破坏式更新；不提供旧 Entry/Extra 或收藏集配置的迁移兼容。自动化构建不能代替真实 Obsidian 桌面和移动端测试，请先在测试 Vault 中使用。
