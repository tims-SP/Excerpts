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

## 后续 G3 工作

1. 比较三个规模的扫描、冷/热搜索耗时、实际重读量、内存表现。
2. 若发现可复现退化，先定位瓶颈及设定合理资源约束，再讨论是否收束功能或最小修复。
3. 对真实 Obsidian Vault 的索引构建、原生 MarkdownRenderer、图片/视频和移动端进行独立验收；没有证据时继续标记未验证。
