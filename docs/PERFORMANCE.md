# G3 — Repository 文件规模性能基线

状态：诊断性测量，不作为稳定版验收完成证明。

## 本轮测量范围

使用 `scripts/bench-vault.cjs` 在 GitHub Actions Ubuntu / Node 22 上生成
1,000、10,000 和 30,000 份实际写入临时磁盘的 Markdown 文件。
样本固定，包含 YAML 标签、较短文本、双 H2 分组、较长正文，以及图片/视频**链接文本**。
每个规模在**单独的 Node 进程**运行，结束后删除临时文件，不修改用户 Vault。

使用与插件相同的 `EntryRepository` 和 `parseMarkdown` 实现，
并通过模拟 Obsidian 的 `getMarkdownFiles`、`getFileCache`、`getAbstractFileByPath`
为它们提供文件元数据；`cachedRead` 使用真实的 Node `fs.promises.readFile`。

| 测量项 | 实际测量的边界 |
| --- | --- |
| 元数据扫描 | `EntryRepository.scan`，64 文件一批，包含作用域检查、建索引及调度让出；不读取 Markdown 正文 |
| 全文搜索（Repository 冷缓存） | 新 Repository 第一次遍历，查找不存在的词，含真实本地文件读取、解析及缓存尝试 |
| 全文搜索（Repository 热缓存） | 紧接另一未命中关键词，记录耗时和实际文件重读量；缓存上限可能导致重读 |
| 预览源读取 | 64 份均匀抽样文件的强制重新读取与 `parseMarkdown`；**不包含原生 MarkdownRenderer** |
| 内存 | 各阶段结束时 `heapUsed`、`rss` 的瞬时值；并非峰值或 Android/iOS 内存诊断 |

每项同时记录耗时、文件读取次数、读取字节量和模拟 MetadataCache 查询次数。
验证的是基本结果一致性（条目数、未命中结果、扫描零正文读取），**不设置任意毫秒门槛**。

## 明确不能得出的结论

- 不测 Obsidian 原生 Vault 建索引时间、MetadataCache 解析时间与文件事件负载。
- 不测 Obsidian MarkdownRenderer、图片解码、视频播放、第三方主题、WebView 的回收与布局重排。
- “冷缓存”只指插件 Repository，**不保证操作系统文件页缓存也是冷的**。
- CI 虚拟机的 CPU/文件系统性能会波动；单次耗时只能作为诊断基线，不能跨机器作为通过标准。
- 现有 `scripts/list-scale-regression.py` 测量的是 Chromium 模拟环境下的内存索引过滤与虚拟列表，不应与本测量合并为“真实 Obsidian 性能”。
- 在实际 Obsidian 桌面、Android、iOS 使用 100/1k/10k 条数据做设备端内存、媒体及连续帧验收仍是 G4 门槛。

## 使用方式与复现

```sh
npm ci
node --expose-gc scripts/bench-vault.cjs 1000 artifacts/performance/vault-1000.json
node --expose-gc scripts/bench-vault.cjs 10000 artifacts/performance/vault-10000.json
node --expose-gc scripts/bench-vault.cjs 30000 artifacts/performance/vault-30000.json
```

GitHub Actions 工作流 `Repository performance baseline` 有独立的三规模矩阵，
只在相关代码变化的 PR 或手动触发时运行。JSON 测量结果作为 14 天临时 artifact 上传，
工作流日志还会打印 `G3_METRICS` 结构化数据。

## 首轮实测（GitHub Actions / Linux / Node 22）

原始测量：[Repository performance baseline #40968101914](https://github.com/tims-SP/Excerpts/actions/runs/40968101914)。
数据来自该工作流的三个独立进程，各运行一次；`G3_METRICS` 在对应 job 日志中，JSON 作为临时 artifact 提供。时间单位均为毫秒。

| 文件数 | 样本大小 MiB | 扫描 | 冷全文搜索 | 热全文搜索 | 预览源读取（64 份） |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0.67 | 18.26 | 76.26 | 27.75 | 6.37 |
| 10,000 | 6.74 | 201.19 | 1,146.92 | 296.89 | 10.01 |
| 30,000 | 20.36 | 536.61 | 2,084.98 | 905.69 | 5.35 |

| 文件数 | 扫描正文读取数 | 冷搜索读取数 | 热搜索读取数 | 初始 RSS MiB | 热搜索后 RSS MiB |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0 | 1,000 | 0 | 119.39 | 123.77 |
| 10,000 | 0 | 10,000 | 0 | 129.89 | 163.89 |
| 30,000 | 0 | 30,000 | 1,676 | 151.91 | 212.72 |

发现：元数据扫描确实保持零正文读取；冷搜索读取所有文件；30,000 条时热搜索仍重读 1,676 个文件，说明搜索缓存上限开始影响实际命中率。不能仅凭这项数据增加移动端缓存：移动端 RSS、GC、WebView 媒体生命周期尚无证据。

表格数据是**第一组单次测量**，非多轮统计量、性能阈值或设备验收结论。各阶段 RSS 是整个 Node 进程的瞬时驻留量，包含 TypeScript 转译、测试适配器和 MetadataCache 模拟对象，不能据此推算 Obsidian 插件的增量内存。

## 后续 G3 工作

1. 比较三个规模的扫描、冷/热搜索耗时、实际重读量、内存表现。
2. 若发现可复现退化，先定位瓶颈及设定合理资源约束，再讨论是否收束功能或最小修复。
3. 对真实 Obsidian Vault 的索引构建、原生 MarkdownRenderer、图片/视频和移动端进行独立验收；没有证据时继续标记未验证。


## G3 第二轮：真实 Obsidian 客户端只读测量规程

**当前状态：待真实设备执行，没有原生测量结果。** 可用远程电脑离线，不能以 Node 模拟器、Linux CI 或 Chromium 替代官方 Obsidian 客户端验收。

### 桌面端操作步骤

1. 建立独立测试 Vault，安装与待验收提交一致的 Excerpts 构建，确认插件和 Obsidian 初始 Vault/MetadataCache 索引已加载。
2. 在独立测试 Vault 创建 G3-测试 文件夹，分别准备 100、1,000、10,000 份实际 Markdown 笔记。30,000 条需要单独确认。不能默认扫描整个 Vault 或个人日常笔记。
3. 停止标签编辑、选择、删除、扫描、搜索等操作。打开 Obsidian 桌面客户端开发者工具 Console，先输入以下设置：

   ~~~js
   globalThis.__EXCERPTS_NATIVE_PROBE_CONFIG__ = {
     confirm: "READ_ONLY_DIAGNOSTICS",
     folderPath: "G3-测试",
     maxFiles: 1000,
     recursive: true,
     measureSearch: true
   };
   ~~~

   maxFiles 是整个目标目录的文件数量上限，而非抽样大小。只允许 100、1000、10000、30000，超过即拒绝；30,000 条还必须设置 allowLargeScan: true。根目录不允许扫描。
4. 打开仓库文件 scripts/native-vault-probe.cjs，复制完整内容到同一个 Console 执行。成功时打印 EXCERPTS_NATIVE_PROBE 加 JSON，失败打印 EXCERPTS_NATIVE_PROBE_FAILED。只保存汇总 JSON，不复制或分享原始文件名、私人路径或 Markdown 正文。
5. 记录真实设备、OS、Obsidian 版本、插件完整 SHA、主题、文件数量、初始索引状态和运行前是否刚启动。每个规模建议至少三次独立测量，统计中位数和波动范围，不将不同设备耗时硬性排名。

### 诊断的精确测量边界

- 运行真实 app.vault.getMarkdownFiles()，在已指定文件夹内过滤并测量路径列举耗时。
- 运行真实 app.metadataCache.getFileCache()，测量已经建立的元数据缓存读取耗时，**不包含首次建立整个 MetadataCache 的时间**。
- 在插件空闲且目录身份有效的情况下使用现有 EntryRepository.scan 和当前扫描批次；不触发 UI 自动刷新。
- 只有明确设置 measureSearch: true 时才执行两次 EntryRepository.search；返回耗时、匹配个数与可用的 JS 堆快照。不清空插件缓存，因此“first”不代表真正冷的操作系统磁盘，也不保证插件缓存此前未被使用。
- 诊断结果不输出文件名、路径或正文。全文搜索**在本机读取**目录内的笔记正文，并可能填充插件现有的内存搜索缓存。
- 不创建、写入、移动或删除 Vault 文件，也不增加新锁、自动重试或后台任务。任何并发操作或目录身份变化会使诊断中止。应在隔离测试 Vault 中进行。

### 原生 Markdown、媒体、连续帧与内存

此脚本没有主动调用 MarkdownRenderer、解码媒体或播放视频，因此**不用于**宣称 MarkdownRenderer、图片、视频、滚动帧率或内存回收已通过。应在真实 Obsidian 客户端里实际打开摘录视图，借助桌面 DevTools Performance 面板录制列表初次加载、打开 H2、加载图片、视频播放和多次深滚动的操作，再用 Memory 面板比较运行前、操作后、关闭视图后的堆快照，检查残留 DOM/MarkdownRenderChild。需区分 Obsidian 宿主和插件对象；单次快照不是泄漏证明。

Android 与 iOS 仍要使用**官方客户端**和真实设备，记录设备、系统版本、Obsidian 版本、主题、样本规模、操作步骤、帧率及录屏，未获得证据则继续写为**未验证**。

### 安全测试说明

tests/native-vault-probe.test.cjs 在 Node 模拟宿主下验证：未授权/超出样本上限/并发 busy/文件夹被替换时拒绝执行，正常运行不得调用任何 Vault 写入方法。scripts/test.cjs 将其加入 npm run verify。模拟宿主测试通过不代表官方 Obsidian 客户端实测已经完成。


## G5 专项：全文搜索分布与重复查询内存

基于同一批文件驱动 Markdown 样本，脚本增加以下**诊断项**：

| 阶段标识 | 场景 | 正确性条件 |
| --- | --- | --- |
| filename-index-match | 文件名命中全部索引 | 命中全部条目；不读取正文 |
| body-last-file-match | 精确短语只在最后一份正文出现 | 恰好命中最后一份文件 |
| body-many-matches | 常用词在全部文件正文出现 | 命中全部条目 |
| early-cancel | 搜索第 6 次取消检查时停止 | 不把部分匹配当作完整结果；记录已执行工作量 |
| repeated-fulltext-searches | 1k 运行 20 次、10k 运行 10 次、30k 运行 3 次全量未命中搜索 | 每次完成，记录耗时、读取次数、阶段 RSS/Heap |

重复查询在第 1 次、中间和最后一次采样前显式调用 Node `global.gc()`（若可用），降低待回收垃圾对保留对象的干扰。**这不是 Obsidian 生产运行方式，也不是内存泄漏证明。**

仍缺少的证据：Chromium/WKWebView UI 主线程长任务、原生 Vault 文件事件开销、操作系统冷页缓存、实际媒体解码、真实平台内存压力与全程 P95 响应。单次 GitHub Actions 虚拟机数字不是跨设备毫秒门槛。若负载过大，优先提示或拒绝高风险规模，不自动扩大 16 MiB 缓存或引入常驻全文索引。
