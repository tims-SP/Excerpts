# Excerpts · 设计体系与 UI 开发规范

状态：**beta.10 UI v3 延续的视觉原则文档**。具体组件交互与数据语义以 [UI_CONTRACT_V3.md](UI_CONTRACT_V3.md) 为准；本文件关于旧版 Collection / Entry / Extra、Modal 主编辑和来源字段的描述为历史说明，不得用于恢复已移除的结构。

## 一句话定位

**Obsidian 原生设计体系 × flomo 的轻量记录与卡片流 × Apple Human Interface Guidelines 的交互哲学。**

- **Obsidian 决定视觉基底与控件行为**：字体、颜色、间距、圆角、焦点、按钮、菜单、弹窗、主题与平台适配。
- **flomo 决定使用方式**：随手记录、时间线、简洁卡片、标签检索、重新遇见内容；不抄袭其品牌外观。
- **Apple HIG 决定取舍标准**：内容优先、清晰层级、熟悉自然的操作、渐进披露、可恢复性、细节品质、可访问性；不等于把 iOS 控件或 Liquid Glass 搬进 Obsidian。

设计优先级：**内容清晰和数据安全 > 与当前 Obsidian 主题一致 > 交互简便 > 装饰性品牌表达**。

## 核心原则

1. **插件感尽可能弱**：看起来像 Obsidian 自然具备的一种收藏集视图；不得改变任何非授权页面的主题或编辑行为。
2. **内容是最高层级**：摘录正文优先；作者、日期、标签和操作都次要。避免多余标题和大型装饰引号。
3. **先记录，后整理**：输入只强制要求摘录正文；标签、来源、变种和批注均可随后添加。
4. **渐进披露**：卡片默认显示正文与少量元数据。只展示非空的附属分类摘要，空分类从统一的“添加内容”入口进入；展开后才看到复杂编辑。
5. **继承主题而非重绘主题**：不要强行规定插件品牌色、字体、阴影、形态，不需要自己实现一套跨平台操作控件。
6. **Markdown-first**：普通 .md 文件是一张卡片，.excerpts 是首页入口，H2 是通用折叠组；不得恢复 Entry/Extra 数据模型。
7. **可恢复、可退出**：取消编辑、撤销可能的操作、明确删除语义、保持用户输入草稿；无法可靠解析时禁止自动写入。
8. **桌面/移动端原生感**：保持 Obsidian 的导航和输入语境，响应容器宽度，而非只看屏幕宽度。

## 原生组件优先矩阵

| 场景 | 首选实现 | 说明 |
|---|---|---|
| 插件设置、文件夹选择配置 | `PluginSettingTab`、`Setting`、Obsidian 输入控件 | 设置页与原生插件设置样式完全一致；路径验证保留 |
| 重要编辑、确认、复杂详情 | `Modal` | 移动端更易使用，行为由宿主控制 |
| 更多操作菜单 | `Menu` | 使用 Obsidian 上下文菜单，避免密集的小文字按钮 |
| 提醒与保存反馈 | `Notice` | 限制重复弹出；主操作提供明确反馈 |
| 图标 | `setIcon` 与宿主图标体系 | 保持大小与交互语义一致，不直接嵌入其他图标集 |
| 普通按钮/输入 | 已提供的宿主控件和主题默认样式 | 能复用则复用，不额外给每个按钮一套固定 CSS |
| 摘录卡片、时间线、附属展开 | **局部自定义 HTML 布局** + Obsidian CSS 变量 | Obsidian 并没有提供可直接满足此产品的完整卡片流控件；必须定制布局，但不重新定义主题 |
| 富文本 Markdown 阅读 | 优先使用 Obsidian 自身的 Markdown 渲染能力 | 确保安全与链接语义；验证渲染子组件生命周期 |

注意："使用 Obsidian 原生 UI" 不表示所有布局都必须是 `Setting`。仅用 `Setting` 拼卡片会使内容像设置面板，而不是阅读空间。

## 视觉规范：从硬编码转向宿主 tokens

- 颜色优先使用 `--background-primary`、`--background-secondary`、`--text-normal`、`--text-muted`、`--text-faint`、`--interactive-accent`、`--background-modifier-border` 等语义变量。
- 继承 `--font-interface`、`--font-text` 与用户字体配置；主摘录作为阅读内容优先使用正文阅读字体，不额外捆绑字体。
- 间距、边框、圆角优先复用可用的 Obsidian 变量，例如 `--size-4-*`、`--radius-s/m/l` 等；只有阅读排版确有需要才引入少量局部变量。
- 不设固定白底、绿色品牌色、全面毛玻璃或统一大阴影；深色模式和第三方主题都应自然继承。
- **所有选择器以 `.excerpts-root` 为作用域**，不得修改全局 `body`、工作区、文件树、`.markdown-preview-view`、主题变量或其它插件。
- 不使用 `!important` 作为默认修复方式；避免依赖 Obsidian 私有 DOM 结构或未经说明的实验性 CSS。

## 交互蓝图

### A. 首页：像 flomo 一样直接记录

1. 收藏集名称 + 极简工具入口。
2. 首屏可聚焦的输入区：粘贴、输入、保存；其他字段可选。
3. 轻量搜索与标签过滤，不预先展开复杂筛选。
4. 单列、可持续加载的卡片时间线；优先展示最近内容。

### B. 卡片：像阅读摘抄本一样看内容

1. 主体摘录（视觉权重最高）。
2. 可用时显示简短来源、标签、日期等，不显示不可靠的确定性出处。
3. 轻量菜单/收藏操作，避免一排“编辑、复制、分享、删除”按钮常驻。
4. 附属区域只展示已存在的类别数量，如“来源 2 · 变种 3 · 批注 1”。
5. 展开后使用清晰的分组列表展示内容，编辑单个 Extra 不影响其他条目。

### C. 变种：明确真实性

区分**原文异文、译文、个人改写、创作衍生**。来源不明时标为未核验，不得把个人改写展示成作者原文。进一步可实现版本对照视图。

### D. 编辑：原生、稳定、可恢复

快速输入尽量保持原位；复杂来源元数据、删除确认和多条目编辑可以使用宿主 Modal 或局部编辑区。移动端要避免键盘弹起后操作控件不可见；刷新列表不得丢失未保存内容。

## 当前代码偏差与改造顺序

v0.1.0 使用了部分 Obsidian 颜色变量，但标题、按钮和卡片层级仍偏独立工具 UI。**v0.2.0-beta.1 已移除多余英文标题、改为 Obsidian `setIcon` 图标按钮与 `clickable-icon` 操作状态、使用宿主 CTA/菜单/主题变量，并将附属分类组织成简短可展开摘要。**目前通过 jsdom 与 Chromium 主题模拟测试，真实客户端交互与第三方主题仍待验证。

### P0：先统一基线
1. 建立原生控件使用清单，逐一审查设置页、工具栏、菜单、编辑与反馈。
2. 用主题 tokens 替代冗余的硬编码视觉常量；保留必要的正文排版属性。
3. 卡片只显示有内容的附属分组；统一“添加内容”。
4. 保证收藏内容优先，主摘录与附属文本有明确阅读层级。
5. 检查 UI 操作是否会打断正在编辑的草稿，完善反馈与确认。

### P1：flomo 体验
1. 更轻的快速录入与连续录入体验。
2. 搜索、标签筛选、随机回顾和收藏夹浏览。
3. 来源/变种编辑时使用结构化字段及清楚的可信度标签。
4. Mobile-first 的布局与触控/焦点体验；桌面保留快捷键。

### P2：可扩展性
1. 通用展示模板：短句、段落、想法、引用页面。
2. 来源聚合、相关条目、版本对照。
3. 大数据量按需渲染、可重建索引与性能测量。

## 验收矩阵

- Obsidian 默认浅色/深色，至少一个主流社区主题；视觉 token 对齐、对比度足够、无全局泄漏。
- Obsidian Windows/macOS/Linux/Android/iOS 真实客户端逐步验证；浏览器模拟不能替代。
- 320/390/768/1280px 和 **窄 Obsidian 分栏**的容器宽度，测试布局、自适应输入及触控目标。
- 插件没有新增全局导航干扰；普通笔记和其他插件界面保持原样。
- 卡片不因空 Extra 类别拉长；复杂操作隐藏但可发现；键盘/触控/屏幕阅读器能够操作。
- 退出编辑或刷新时不静默丢失草稿；Markdown 结构损坏时保持只读保护。
- Markdown 仍是唯一持久内容源，不引入必须联网的依赖。

## 官方参考

- Obsidian Styling: https://docs.obsidian.md/Reference/CSS%20variables/About%20styling
- Obsidian plugin HTML elements: https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements
- Obsidian CSS semantic color variables: https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors
- Obsidian plugin UI checklist: https://docs.obsidian.md/oo/plugin
- flomo 设计哲学: https://help.flomoapp.com/about-us/about-us/design-concept.html
- Apple HIG design principles: https://developer.apple.com/design/human-interface-guidelines/design-principles/
- Apple HIG layout: https://developer.apple.com/design/human-interface-guidelines/layout

## Screenshot acceptance correction (v0.2.0-beta.2)

User validation on Android revealed that our earlier visual screenshot was a concept rather than the actual Obsidian UI. In Reading mode, the host file title, the generated Markdown H1 and the rendered collection header produced three large headings. The old capture form, always-visible search field and empty tags consumed nearly the full first screen.

Resolution: a configured home file may open a dedicated Obsidian ItemView in that leaf, bypassing the Markdown title layout. This behavior is scoped to the home paths for authorized collections and can be disabled in settings. Existing home files are not rewritten. The collection body uses a compact capture card, optional tag input, collapsible search and a minimal recent-items toolbar. Real Obsidian Android/iOS visual verification remains required; Chromium mocks are only confidence checks.
