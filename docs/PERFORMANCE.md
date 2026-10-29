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
