# 视觉回归与截图验收规范（Excerpts）

## 目标与边界

本仓库的界面回归采用三个相互独立的门槛：

1. **普通单元/DOM 测试**：`npm run verify`；对行为、Markdown 读写、菜单、锁和状态流转负责。
2. **静态 UI 清单**：`tests/fixtures/visual-class-contract.json` 锁定源文件和 CSS 中所有 `ex-` 前缀类名/变量标识符。新增、删除、重命名时，`tests/visual-contract.test.cjs` 会失败；另外，`styles.css` 的 Git blob SHA 已锁定，颜色、间距和圆角等样式代码修改必须先审查截图再显式更新哈希。必须人工检查涉及的 UI 状态后同步更新清单；不能让新 UI 自动绕过截图检查。
3. **Chromium 运行态截图和几何断言**：`scripts/spacing-check.py`、`scripts/visual-check.py`、`scripts/visual-audit.py`。使用编译好的真实 `main.js` 和 `styles.css`，在最小 Obsidian WebView 模拟中运行。断言失败导致 Screenshot QA 工作流失败；无论成功与否尽可能上传截图。

本方案**不修改业务代码迎合截图测试**。有业务功能无法在模拟宿主中可靠验证时，明确列入真实客户端待验收项，不伪造“通过”。

## 截图矩阵

- 主题：浅色、深色。
- 宽度：320、390、768、1280px；高 900px。
- 场景：正常首页、顶部标签选择、输入草稿、无结果搜索、标签筛选、页面菜单、H2 展开、卡片标签编辑、卡片菜单、单条删除弹窗、批量选择、批量删除弹窗、保存筛选弹窗、保存名称校验错误、设置页、索引待刷新、扫描进度、失效页面。
- 单独组件裁剪：页头、扫描状态、摘录输入正文/操作栏/保存/编辑入口、标签面板、列表工具栏、搜索框、筛选条、菜单、日期轨道、卡片正文/章节/标签/底栏/更多、标签编辑器和选项、选择模式工具栏和底栏、两种删除弹窗、筛选保存弹窗、设置。
- 所有图片保存在 `artifacts/visual/`；`manifest.json` 记录每种主题/视口的组件覆盖、布局几何、PNG 尺寸、SHA-256 和场景名称。脚本**重新读取每一张 PNG** 验证文件完整性与尺寸。

完整性门槛：`REQUIRED` 中每个组件必须在全部 8 种主题/宽度组合被成功捕获，否则检查失败。页面横向滚动、正文与操作栏遮挡、卡片底栏越界、主表面内边距/输入边框/胶囊形状的已批准约束发生偏差，同样失败。

## 新增或修改 UI 的操作规程

1. 先修改产品代码，不为使测试通过而改变不相关交互。
2. 如果改动涉及 UI 标识符，审查并更新 `visual-class-contract.json`；评估是否需要在 `scripts/visual-audit.py` 中增加一个必须截图的交互/状态。**不要机械复制新类名来解除失败。**
3. 在 Screenshot QA Actions 中查看检查是否通过；下载 `excerpts-screenshot-qa` 工件，打开 `artifacts/visual/manifest.json`，对照该工件内所有受影响的 PNG（既包括全界面也包括组件裁剪）。优先核对浅色/深色、320/390 手机、768 分栏、1280 桌面。
4. 逐项检查：留白、字间距与行高、圆角、主题颜色、按钮状态、图标、卡片文本与媒体占位、标签折行/溢出、键盘焦点、弹窗遮挡、屏幕边界；有明显偏差则拒绝合入。
5. 对重大设计变更，在 PR 说明中写明原因、改前/改后截图及更新的设计参数。没有人审看截图，不得将截图生成本身宣称为视觉验收完成。

**不得在 CI 中自动接受新截图作为基线。** 当前 PNG 是每次运行的复核工件，`manifest.json` 中的哈希用于追踪和人工对比，**不是预先批准的像素基线**。已有 CSS/几何断言是自动阻断条件；像素级视觉变化仍需人工审批。后续如引入正式像素比对，需要提交经过审查的稳定 golden 文件，并允许显式审批更新，不能自更新来消除失败。

## 命令与证据

```bash
npm run verify
python -m pip install playwright
python -m playwright install chromium
python scripts/spacing-check.py
python scripts/visual-check.py
python scripts/visual-audit.py
```

Actions 名称：**Screenshot QA**。PR 和 main 推送自动运行，无路径跳过。工件保留 30 天。`Build and test` 工作流仍是类型、功能、构建验收；截图工作流是独立的视觉门槛。为了强制阻止不合格提交被合并，仓库管理员还须在 GitHub 分支保护/Ruleset 将 **Screenshot QA / Visual inventory and layout guards** 和 **Build and test / build** 设置为必需通过的状态检查；仅仅存在工作流并不能阻止直接推送未保护的 main。

## 尚需真实 Obsidian 客户端检查

- Android/iOS 软键盘弹出、输入法候选、系统安全区、手势返回。
- 桌面/移动 Obsidian 不同版本的宿主设置、原生菜单、弹窗及第三方主题。
- 图片缩放、音视频实际播放、富 Markdown、交互式嵌入与真实文件 IO。
- 文件夹右键入口与切换分栏、极长正文、万级文档的真实滚动和性能。

**模拟器检查通过不等于以上场景通过。** 如无法运行真机测试，PR 应明确标记这些项为未验证，而不是修改产品功能来迁就模拟器。
