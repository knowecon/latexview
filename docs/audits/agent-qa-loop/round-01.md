# latexview Agent QA 工具规格审计（Round 01）

> 审计对象：`docs/specs/agent-qa-tools-spec.md`（Status: Draft for Auditor loop，2026-05-24）
> 参照基线：`docs/audits/agent-tooling-audit.md`（上一轮 P1/P2 发现）
> 审计方法：逐文件静态阅读规格 + 比对现有实现（`src/`、`public/`、`codex/`、`pi/`、`tests/`、`scripts/`）。
> 可访问性说明：本次任务清单内的全部文件均成功读取，无不可访问内容。

---

## 1. 执行结论（Conclusion）

该规格整体方向正确、结构清晰，**在设计层面已逐条覆盖上一轮审计的全部 P1/P2 发现**（serve 端口回退、Pi 信号生命周期、生命周期管理、find 的 url/大小写/断字、Pi 死委托别名、Pi 运行时测试与技能文档同步）。命令面、模块拆分、注册表设计、回退顺序与验收标准都给出了可落地的骨架，没有发现 P0 级（数据丢失/安全/崩溃）设计缺陷。

但在「JSON 契约稳定性」「生命周期安全的可实现性」「inspect 判定的确定性」三个审计重点上，规格仍存在**会直接影响实现与测试**的歧义与自相矛盾，必须在进入实现计划前收敛：

- `/health` 没有稳定的 latexview 身份标识字段，且 `status/list` 的 JSON 示例把 `version` 当成「协议版本 2」，与现有实现中 `version` = PDF mtime 文档版本的语义**直接冲突**；这同时削弱了 `stop`「先校验再发信号」的安全前提（P1）。
- 多个产物命名/默认目录/阈值/默认输出模式未定义或互相矛盾，会导致 agent 取图不稳定、单测易脆（P2）。

结论：**Go（有条件放行）**——必须先修订下述 1 项 P1 与 5 项 P2，再进入实现计划阶段。

**满意度评分：7 / 10。**
（覆盖度优秀、骨架可用，但契约稳定性与判定确定性尚未达到「agent 可程序化消费 + 测试不脆」的门槛。）

---

## 2. 上一轮发现的处置情况（Resolved Issues）

| 上轮编号 | 主题 | 规格处置 | 状态 |
|---|---|---|---|
| P1-1 | 封装层 serve 始终下发 `--port`，废掉端口回退 | §4.1「Wrapper rule：仅当调用方显式提供 port 时才传 `--port`」（spec:138-139） | ✅ 已覆盖 |
| P1-2 | Pi serve 把 detached 服务绑到 agent 中止信号 | §4.1「Pi serve must not pass the tool-call abort signal」（spec:140） | ✅ 已覆盖 |
| P1-3 | 无生命周期管理，易留孤儿进程 | §4.3/4.4/4.5 `status/list/stop` + §5 注册表设计 | ✅ 已覆盖 |
| P2-1 | `find --json` 丢 url、snippet 被强制小写 | §4.9「count、每条 match 带 url、保留原始大小写」（spec:378-386） | ✅ 已覆盖 |
| P2-2 | Pi `latexview_capture_page` 死委托 + 两端不对称 | §7「别名须经共享本地函数委托，不得用 `pi.getAllTools()`」 | ✅ 已覆盖 |
| P2-3 | 换行连字符/跨行短语召回缺口 | §4.9「soft hyphen `\u00ad` + line-end hyphenation + NFKC」 | ✅ 已覆盖 |
| P2-4 | Pi 无运行时测试、技能文档两端不同步 | §9「Pi extension runtime test」+ §8「两端相同 workflow」 | ✅ 已覆盖 |
| P2-5 | 每次 find 整本重载 pdfjs | §6「pdf-info.js 共享 pdfjs 加载助手 + inspect 单 document」 | ⚠️ 部分覆盖（inspect 已复用；find 未显式声明复用，但 find 为单遍扫描，可接受） |

> 现有代码侧证据复核（确认上轮发现仍然存在、规格的修复目标对得上）：
> - `pi/extensions/latexview.js:43-49` 仍把 `signal` 传给 detached `spawn`；`:319-320` 仍是 `pi.getAllTools()?.find(...).execute` 死委托。
> - `codex/.../latexview-mcp.js:59-61` 与 `pi/extensions/latexview.js:33-35` 仍无条件 `push('--port', ...)`。
> - `src/cli.js:84-91` find 的 json 分支仍只输出 `{ query, matches }`，不传 `baseUrl`；`src/pdf-search.js:4-9` 仍 `toLowerCase()`。
> - 全仓仍无 `info/status/list/stop`（`src/args.js`、`src/cli.js`）。

---

## 3. 遗留问题（Remaining Findings，含 file:line 证据）

> 未发现 P0 级问题。

### P1

**P1-A　`/health` 缺少稳定身份字段，且 `version` 语义在规格内自相矛盾，削弱 stop/status 安全前提**

- 证据：
  - 规格 §3.3/§4.4 的 JSON 示例：`docs/specs/agent-qa-tools-spec.md:166`（`"version": 2`）与 `:209`（`"version": 2`），把 `version` 当作「协议/schema 版本号 2」。
  - 但规格 §5 明确要求保留现状：`/health must continue to return { ok, version, pdfName }`（spec:469-470）。
  - 现有实现里 `version` 是**文档 mtime 版本号**（用于热重载），不是协议号：`src/server.js:145`（`{ ok: true, version, pdfName }`）+ `src/server.js:100-103`（`version = Math.max(1, Math.trunc(pdfStat.mtimeMs))`，是一个大整数，且每次改 PDF 都会变）。
  - 同时 §4.3 要求 status「does not look like latexview」时返回非零（spec:156），§4.5 要求 stop「validate each target through the registry and /health before sending a signal」（spec:226），但 `/health` 里**没有任何可据以判断「这是 latexview」的稳定字段**——`ok/version/pdfName` 任何普通服务都能伪造，`version` 还会随时间漂移。
- 影响：
  - JSON 契约对 agent 不稳定：`version` 在示例中被当常量 2，实际是会变的 mtime，agent 若据此做相等判断会误判。
  - 生命周期安全：stop/status 的「确认是 latexview 再操作」无可落地的判定字段，只能退化为「端口在注册表里就信」，与规格自述的安全目标不符。
- 建议（见 §4「具体修订」E1）：在 `/health` 增加稳定标识（如 `app: "latexview"` 与独立的 `schemaVersion`），并把所有示例中的 `"version": 2` 改为 `app/schemaVersion`，明确「version=文档版本、schemaVersion=协议版本」二者分离；status/stop 的身份校验改为比对 `app` 字段。

### P2

**P2-B　跨命令的产物命名/默认目录不统一，且与现有 capture 不一致**

- 证据：
  - 现有单页 capture：`<stem>-page-<page>.webp`，**不补零**（`src/args.js:177-179`、`:213`）。
  - capture-range：`<pdf-stem>-page-001.webp`，**补零到页数宽度**，默认目录 `<pdf-stem>-captures`（spec:326-327、:341）。
  - inspect 的 `capturePath` 示例：`/tmp/main-page-370.webp`，**未补零**（spec:299），且 inspect 的 `--out-dir` 默认值未定义（spec:250）。
  - find 的 `capturePath` 示例：`/abs/find-captures/main-page-070.webp`，**补零到 3 位**且目录名是 `find-captures`（spec:400），但 §4.9 正文未定义该默认目录（spec:370）。
- 影响：同一份 PDF 经 `capture` / `capture-range` / `inspect --capture` / `find --capture` 产出的文件名规则各不相同（补零/不补零、目录名不同），agent 跨命令收集/引用图片路径时无法预测文件名，易产生「找不到上一步产物」的脆弱链路。
- 建议：统一一套命名（推荐 `<stem>-page-<NNN>.webp`，按文档总页数宽度补零）与默认目录约定（每个 capture 类命令显式写出默认 `--out-dir`），并在规格里声明「这会改变现有 `capture` 的默认文件名」或为旧命令保留兼容。

**P2-C　inspect 的告警阈值与 `oversize-page` 判定未定义，导致不可确定/不可稳定测试**

- 证据：
  - `blank: pixel coverage below threshold`、`near-blank: very low text length or very low pixel coverage`——阈值全是「below threshold / very low」等定性描述（spec:273-274），无数值。
  - `oversize-page: page dimensions differ from the document median by more than 20%`（spec:276）——未说明是按**宽/高分别**还是**面积**比较；且「文档中位数」需读取**全部页**尺寸，而 inspect 默认只查 `first,middle,last`（spec:259），对 370 页 PDF 会触发一次隐藏的全量页扫描，与「轻量 QA」目标冲突，规格未说明此成本与边界。
  - 像素采样「downsampled grid」的网格尺寸/DPI 默认/非白阈值均未定义（spec:280-281）。
  - 页选择别名 `middle` 在偶数页时的取整规则未定义（spec:257、:259）。
- 影响：§9 要求 `inspect.test.js` 验证「text-only / capture-enabled blank / page-out-of-range」（spec:585-588），§10 要求「returns stable warnings」（spec:618），但阈值不定 → 告警不确定 → 单测要么写死魔法值（脆）、要么无法断言。
- 建议：给出确定的数值常量（文本长度阈值、非白像素覆盖率阈值、采样网格、默认 DPI、`middle=floor/ceil` 规则），并明确 `oversize-page` 的度量维度；若需全量中位数，声明「仅在 `--all` 或显式开启时计算，否则跳过 oversize-page」。

**P2-D　agent 向子命令的默认输出模式未定义（Open Q4 未决）**

- 证据：`info` 同时给了 JSON 与文本两种输出（spec:88-128），但 `status/list/stop/inspect/capture-range` 的**默认**输出是 JSON 还是文本未定义；Open Questions 仍把它列为未决：「Should JSON be default for agent-facing subcommands…」（spec:644）。
- 影响：封装层目前对 find 默认 `--json`（`codex/.../latexview-mcp.js:160`、`pi/extensions/latexview.js:171`），但新命令的默认模式不定会让 CLI 单测（spec:592-597）与封装解析逻辑无所适从。
- 建议：在进入实现前关闭 Open Q4，明确「agent-facing 子命令在 `--json` 缺省时仍输出人类文本；封装层一律显式传 `--json`」或「这些子命令默认 JSON」，二选一并写入规格正文。

**P2-E　inspect summary 语义与 stop/注册表的若干生命周期细节不完整**

- 证据：
  - `summary.warningCount: 1`（spec:306）未定义是「有告警的页数」还是「告警总条数」；`summary.warnings` 是否包含空类目也未定义。
  - §11 回退顺序/§4.1 只说「serve 成功后写注册表」（spec:130），但未规定**前台 server 在 SIGINT/SIGTERM 优雅退出时应自删注册表项**（现 `src/cli.js:131-141` 的 shutdown 只 close，不会清理注册表），只能依赖后续 health 探活剪枝，易堆积 stale 项。
  - `stop` 仅写 `SIGTERM`（spec:229），未提及 Windows 的跨平台 kill 行为（上一轮 §7-1 曾点名「跨平台 kill」）。
- 影响：summary 字段歧义影响 agent 程序化判断；注册表自清理缺失会让 `list` 长期残留 stale；Windows 下 SIGTERM 语义不同可能使 stop 不可靠。
- 建议：定义 `warningCount` = 触发告警的页数，`summary.warnings` 仅含非空类目；新增「server 优雅退出时移除自身注册表项」一条；为 stop 增加跨平台说明（或在 Non-Goals 显式声明仅支持 POSIX）。

**P2-F　contact-sheet 命令签名与规则不自洽**

- 证据：contact-sheet 命令签名（spec:352-354）只列了 `--pages/--range/--out/--thumb-dpi/--columns/--json`，**没有 `--max-pages`**；但其规则却写「Hard cap default: 24 pages unless `--max-pages` is explicitly raised」（spec:363）。
- 影响：实现者无法从签名得知 `--max-pages` 是否属于 contact-sheet，args 解析与单测会产生分歧。
- 建议：把 `--max-pages <n>` 补进 contact-sheet 签名，或改写规则文案使其与签名一致。

---

## 4. 具体规格修订建议（Concrete Spec Edits）

- **E1（修 P1-A，最高优先）**：
  - §5「Health endpoint」补充：`/health` 返回 `{ ok, app: "latexview", schemaVersion: 2, version, pdfName }`，其中 `version` 仍为文档 mtime 版本、`schemaVersion` 为协议版本、`app` 为身份判定字段。
  - 把 §4.3（spec:166）与 §4.4（spec:209）示例中的 `"version": 2` 改为 `"app": "latexview", "schemaVersion": 2`（并保留真实文档 `version` 字段，注明其会变化）。
  - §4.3/§4.5 的「does not look like latexview / validate through /health」明确为「`health.app === "latexview"` 方可视为目标」。

- **E2（修 P2-B）**：在 §4.6/§4.7/§4.9 各加一行「文件名规则与默认目录」并统一：`<stem>-page-<NNN>.webp`（按总页数补零），inspect 默认 `--out-dir = <stem>-inspect`、find 默认 `--out-dir = <stem>-find-captures`、capture-range 默认 `<stem>-captures`；在 §4.7 注明「将与现有单页 `capture` 命名对齐/或保留旧默认」。

- **E3（修 P2-C）**：在 §4.6「Blank-page policy」下新增「Thresholds」小节，给出确定数值：例如 `normalizedTextLength < 16` 记 `near-blank` 候选；`pixelCoverage < 0.005` 视为低覆盖；采样网格 `64x64`、默认 `--dpi 72`；`middle = floor((n+1)/2)`；`oversize-page` 按「宽或高任一相对全文档中位数偏离 > 20%」，并声明全文档中位数仅在 `--all` 时计算。

- **E4（修 P2-D）**：删除 Open Q4（spec:644），在 §4 顶部加「Output mode」通则：所有 agent-facing 子命令默认输出人类文本，`--json` 显式开启；封装层一律传 `--json`。

- **E5（修 P2-E）**：
  - §4.6 JSON 说明处定义 `warningCount = 触发告警的页数`，`summary.warnings` 仅含非空类目。
  - §4.1 增加「serve 进程在收到 SIGINT/SIGTERM 优雅退出时移除自身注册表项」。
  - §4.5 增加跨平台 kill 说明，或在 §3 Non-Goals 写明仅支持 POSIX 信号语义。

- **E6（修 P2-F）**：把 `[--max-pages <n>]` 补入 §4.8 contact-sheet 命令签名（spec:353）。

- **E7（建议）**：§4.9 find 增强中显式声明「单次调用复用同一 pdfjs document」以闭合上轮 P2-5；§9 在 `inspect.test.js/capture-range.test.js` 增加「文件名补零」「阈值边界」用例，确保与 E2/E3 的确定值对齐而非写死任意魔法数。

---

## 5. Go / No-Go

**结论：Go（有条件放行）。**

进入实现计划前必须完成：

1. **P1-A 必修**（E1）：`/health` 增加 `app`/`schemaVersion` 身份字段，修正 `version` 语义矛盾，落实 status/stop 的身份校验。这是 JSON 契约稳定性与生命周期安全的前提。
2. **P2-B ~ P2-F 必修**（E2–E6）：统一产物命名与默认目录、定义 inspect 阈值与 `oversize-page` 度量、关闭默认输出模式 Open Q4、补全 summary/注册表自清理/跨平台说明、修正 contact-sheet 签名。
3. 其余（E7）建议在实现期一并落地，确保单测以确定值断言、不脆。

满足以上条件后，本规格即可作为实现计划的输入推进。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-qa-loop/round-01.md
