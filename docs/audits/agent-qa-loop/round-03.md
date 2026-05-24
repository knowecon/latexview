# latexview Agent QA 工具规格审计（Round 03）

> 审计对象：`docs/specs/agent-qa-tools-spec.md`（Status: Draft for Auditor loop，2026-05-24）
> 参照基线：`docs/audits/agent-qa-loop/round-01.md`（1×P1 + 5×P2）、`docs/audits/agent-qa-loop/round-02.md`（新增 P2-G/P2-H/P2-I + N1–N4）
> 审计方法：逐文件静态阅读修订后规格 + 对照 round-02 逐条核验 + 抽样比对现有实现（`src/server.js`、`src/args.js`）。
> 审计重点：命令契约、页选择文法、JSON 形状、生命周期安全、inspect 告警语义、capture 默认值、wrapper/tool 对称性。
> 可访问性说明：本次任务清单内的全部文件（待审规格、round-01/02 审计、相关源码）均成功读取，无不可访问内容。

---

## 1. 执行结论（Conclusion）

本轮规格**把 round-02 的全部 7 项发现（P2-G、P2-H、P2-I 与 N1–N4）逐条收敛完毕**（详见 §2 核验表，每条均附 file:line 证据）。其中最关键的 P2-G（无 `--capture` 时告警语义自相矛盾）已被一条明确的「无 capture 规则」彻底消除：spec:310 现规定「Without `--capture`, do not emit `blank`/`near-blank`/`text-extraction-empty`; set `pixelCoverage` to `null`」，三类像素相关告警全部要求 capture 证据，单测在无 capture 路径上已可稳定断言。stop 结果枚举、`--all` 与 Open Question 的张力、find 抓图 DPI、默认 DPI、schema 编号、`--from/--to` 解析归属也均已闭合。修订**未引入任何 P0/P1 级新矛盾**。

在本轮三个审计重点（inspect 告警语义、页选择文法、生命周期/JSON 失败契约）上仍发现 **3 项 P2 级实现可决性缺口**：
- 开启 `--capture` 后 `near-blank` 与 `text-extraction-empty` 的判定区间**重叠未消歧**（P2-J）——这是 round-02 P2-G 修好「无 capture」一侧后，遗留在「有 capture」一侧的孪生问题，直接影响「stable warnings」验收与 `inspect.test.js` 阈值边界断言。
- 多个页选择来源（`--pages`/`--range`/`--from-to`/`--all`）的**互斥与优先级、`--pages` 内嵌区间、`--range` 是否接受别名**未定义（P2-K）——共享模块 `page-selection.js` 的文法契约不完整。
- `stop` **无目标参数时行为、退出码语义、status/stop 失败时的 JSON 形状**未定义（P2-L）——影响 agent 程序化消费失败路径。

这三项均为**窄面 P2**，不影响整体骨架，可直接折叠进实现计划首批任务，无需再走完整审计轮。

结论：**Go（放行）**——规格已达到「实现就绪」。建议在实现计划第一批任务中先行收敛 P2-J/P2-K/P2-L 再编码相关命令，但不阻断进入实现计划阶段。

**满意度评分：9 / 10。**
（六项历史发现全部闭合、三项 round-02 新发现 + 四项 N 全部修复；扣分集中于 capture 侧告警重叠、页选择文法边界、失败路径契约这三处窄面 P2。）

---

## 2. 上一轮发现的核验（Verification of Prior Findings）

| round-02 编号 | 主题 | 本轮修订证据（file:line） | 状态 |
|---|---|---|---|
| **P2-G** | 无 `--capture` 时告警语义自相矛盾（`text-extraction-empty` 不可执行、`near-blank` 仅凭文本触发） | Blank-page policy 首条改为「Without `--capture`, do not emit `blank`, `near-blank`, or `text-extraction-empty`; set `pixelCoverage` to `null` and treat textless pages as inconclusive rather than faulty」（spec:310）；`near-blank` 阈值显式加上「requires capture evidence」（spec:320）；`text-extraction-empty` 改为确定式 `normalizedTextLength === 0` 且 `pixelCoverage >= 0.02`（spec:312）。无 capture 路径上不再触发任何像素相关告警，单测可稳定断言。 | ✅ 已修复 |
| **P2-H** | `--all` 正文规则与 Open Question 自相张力；oversize-page 全量扫描成本未声明 | Open Questions 现仅剩 2 条（contact-sheet 是否首批 PR、registry 是否在 `/health` 暴露 `pdfPath`），原「inspect --all 是否放宽」开放问题已删除（spec:702、:705），与正文 spec:281 一致；oversize-page 明确「enabled by default … computes full-document median dimensions from pdf.js page metadata only, without rendering. This metadata pass is allowed even when the inspected page set is small」（spec:324），成本边界与默认行为已声明。 | ✅ 已修复 |
| **P2-I** | `stop` 结果 `status` 枚举缺「停止失败」态 | 新增「Result statuses」小节，明确 `stopped`（被信号且变为不可达）、`stale`（已死/非 latexview，已剪枝）、`failed`（停止尝试后仍 `health.app === "latexview"`）三态（spec:246-250）。 | ✅ 已修复 |
| **N1** | `find --capture` 抓图无 DPI 控制 | 签名补入 `[--dpi <dpi>]`（spec:421），并写明「Candidate capture default DPI is 216 unless the caller passes `--dpi`」（spec:441）。 | ✅ 已修复 |
| **N2** | capture-range / contact-sheet 默认 DPI 未给 | capture-range「Default DPI is 216 unless the caller passes `--dpi`」（spec:374）；contact-sheet「Default `--thumb-dpi` is 72」（spec:413）。 | ✅ 已修复 |
| **N3** | registry `schemaVersion` 与 health `schemaVersion` 两数字并列易误读 | §5 新增「The registry entry `schemaVersion` and the health response `schemaVersion` are independent schema numbers. They may differ and must be interpreted in their own namespaces」（spec:496），并在 §4 顶部通则区分 `schemaVersion` vs `version`（spec:77）。 | ✅ 已修复 |
| **N4** | capture-range 独有 `--from/--to` 未纳入共享 page-selection 职责 | §6 `src/page-selection.js` 职责改为「parse `--pages`, aliases, `--range`, `--from`/`--to`, duplicate removal, bounds checks」（spec:527），明确归属。 | ✅ 已修复 |

> 实现侧复核（确认本轮修订仍为加法、向后兼容）：
> - `src/server.js:145` 现仍返回 `{ ok: true, version, pdfName }`，spec:512 新增的 `app: "latexview"` 与 `schemaVersion: 2` 为加法字段，向后兼容，不破坏现有热重载与 SSE。
> - `src/args.js:179` 单页 capture 仍产出 `${stem}-page-${page}.webp`（不补零），spec:376 已显式保留此向后兼容默认，range 类命令另行补零（spec:375/288），两者并存无冲突。
>
> 小结：round-02 的 **3×P2 + 4×N 全部闭合**，且修复方向与现有实现可对接。round-01 的 1×P1 + 5×P2 已在 round-02 全部确认闭合，本轮无回归。

---

## 3. 本轮遗留与新增发现（Remaining / New Findings，含 file:line 证据）

> 未发现 P0、P1 级问题。以下均为 P2 / 次要级。

### P2

**P2-J（新增）　开启 `--capture` 后 `near-blank` 与 `text-extraction-empty` 判定区间重叠，告警语义未消歧**

- 证据：
  - `text-extraction-empty`（有 capture）判据：`normalizedTextLength === 0` 且 `pixelCoverage >= 0.02`（spec:312）。
  - `near-blank` 判据：「requires capture evidence and means either `pixelCoverage < 0.02`, or `normalizedTextLength < 64` and `pixelCoverage < 0.10`, **but not both below the stricter `blank` thresholds**」（spec:320）。
  - 该「but not both below」排除子句**只排除与 `blank` 的重叠**，未排除与 `text-extraction-empty` 的重叠。
- 矛盾点：对一张纯图片页（`normalizedTextLength = 0`）且 `0.02 <= pixelCoverage < 0.10`（例如 0.05）的页面：
  - `text-extraction-empty` 命中（0===0 且 0.05>=0.02）；
  - `near-blank` 第二分支同时命中（`normalizedTextLength 0 < 64` 且 `pixelCoverage 0.05 < 0.10`，且未「两项皆低于 blank 阈值」）。
  - 即同一页**同时**被标 `text-extraction-empty`（语义：有可见内容、为图片/扫描页）与 `near-blank`（语义：可见内容极少），两类告警语义直接冲突。
- 影响：§9 `inspect.test.js` 要求验证「threshold boundary behavior for `blank`, `near-blank`, and `text-extraction-empty`」（spec:617 附近），但在 `[0.02, 0.10)` 覆盖区间，规格未定义两类告警是否互斥/谁优先，实现者只能各自猜测（出一个？出两个？谁压制谁），单测无法以确定集合断言 `warnings`；同时违背验收标准「never calls a textless image page blank unless capture/pixel evidence supports it」（spec 验收节）的语义精神——纯图页被附加误导性的 `near-blank`。
- 建议（见 §4 E1）：定义优先级/互斥——当 `normalizedTextLength === 0` 且 `pixelCoverage >= 0.02` 时只出 `text-extraction-empty` 并抑制 `near-blank`；或把 `near-blank` 第二分支约束为 `normalizedTextLength > 0`，使「文本为 0 的图片页」只走 `text-extraction-empty`。

**P2-K（新增）　多页选择来源的互斥/优先级、`--pages` 内嵌区间、`--range` 别名支持未定义，共享文法契约不完整**

- 证据：
  - inspect 签名把 `[--pages <spec>] [--range <from-to>] [--all]` 列为**相互独立的可选项**（spec:269），未用 `|` 标注互斥；而 capture-range（spec:364）与 contact-sheet（spec:402）用 `|` 标注互斥。三处对「来源组合」的态度不一致，且**均未说明同时传入多个来源时的报错/优先级**。
  - `--pages` 定义为「comma-separated page numbers and aliases: `first`, `last`, `middle`」（spec:277），**未说明是否允许内嵌区间**（如 `1-5,10`、`first,3-7`）。
  - `--range` 定义为「accepts `a-b`」（spec:278），**未说明 `a/b` 是否接受别名**（如 `first-last`、`middle-last`）。
  - 页选择解析为三命令共享模块（spec:283、:527），故文法必须在规格层面唯一确定，否则三处行为可能分叉。
- 影响：§9 要求 `args.test.js` 验证「invalid page specs and ranges」与 `page-selection.test.js` 验证「aliases, ranges, duplicates, bounds」（spec:603 附近），但「多来源组合是否报错」「`--pages` 是否吃区间」「`--range` 是否吃别名」未定 → 解析器实现与单测断言无所适从；inspect 与 capture-range 因签名标注不同可能产出不一致的解析行为。
- 建议（见 §4 E2）：在 §4.6 页选择小节（或 §6 page-selection 职责处）统一声明：来源互斥规则（多个同时给出时报错或定义优先级）、`--pages` 是否支持内嵌区间、`--range` 是否接受别名、越界/0/负数/`--from` 缺 `--to` 等非法输入的统一错误语义；并把 inspect 签名的 `--pages/--range` 标注与 capture-range 对齐。

**P2-L（新增）　`stop` 无目标参数行为、退出码语义与 status/stop 失败 JSON 形状未定义**

- 证据：
  - `stop` 签名将 `--url | --port | --pid | --all` 全部置于可选（spec:231），**未定义裸 `latexview stop`（无任何目标）的行为**（报使用错误？空操作？默认对单一已知 server？）。
  - `status` 规定「Return non-zero if the viewer is unreachable or `health.app !== "latexview"`」（spec:164），但 JSON 形状只给出成功态（spec:168-186），**失败/不可达时的 JSON 形状未定义**（是否 `ok: false`、`health: null`、是否仍含 `registry` 块）。
  - `stop` 给出了 `stopped/stale/failed` 三态（spec:246-250），但**未定义退出码映射**（`failed` 是否非零？`--all` 混合结果时整体退出码如何取？）。
- 影响：封装层一律以 `--json` 消费这些命令（spec:76），失败路径的 JSON 形状与退出码不稳定将使 MCP/Pi 包装与 `cli.test.js`/`registry.test.js`（spec:623 附近）无法对失败态做稳定断言；agent 在「停止失败/查询不可达」时拿到不可预测的结构化结果。
- 建议（见 §4 E3）：规定 `stop` 至少需一个目标，否则返回带 usage 的错误（非零）；定义退出码映射（如全部 `stopped/stale` → 0，出现 `failed` → 非零；`status` 不可达/非 latexview → 非零并输出 `{ ok: false, url, health: null, registry: {...} }`）；为 `status` 失败态补一段 JSON 形状示例。

### 次要提示（Minor，不阻断）

- **N1**：§7 把 `latexview_contact_sheet` 列为两端「must expose the same primary tools」之一（spec:585 附近），但 §12 Open Question 1 仍把「contact-sheet 是否纳入首批 PR」留为未决（spec:702）。若推迟到二期，需明确两端**同步省略**该工具以维持对称（验收「expose the same primary tools」仍成立），建议在 §7 加一句条件说明或先关闭 Open Q1。
- **N2**：`stop` 的「waits briefly」（spec:242）等待时长未给具体值，`registry.test.js` 对停止时序的断言会缺少锚点，建议给一个确定的等待/超时常量。
- **N3**：仅 `info` 给出了人类文本输出样例（spec:137-143），`status/list/stop/inspect/capture-range/find` 的**默认（非 `--json`）人类文本格式未规定**；虽封装层一律走 `--json`、影响有限，但若 §9 的 CLI 单测覆盖默认文本输出会缺锚点。建议至少声明「非 json 文本格式不做契约保证、仅 `--json` 为稳定契约」。
- **N4**：`status` 的 `registry` 块只给出 `found: true` 形状（spec:179-184），`found: false`（未命中注册表）时 `pid/pdfPath/startedAt` 是否省略未定义；建议补一行说明。
- **N5**：find JSON 中 `jump` 对象仅在 `--jump-if-unique` 场景给出示例（spec:458-462），未说明未传该标志时 `jump` 键是否存在（缺省省略 / 还是 `{ attempted: false }`）。建议明确缺省形状，便于消费者判空。

---

## 4. 具体规格修订建议（Concrete Spec Edits）

- **E1（修 P2-J，最高优先）**：在 §4.6「Thresholds」中为 `near-blank` 与 `text-extraction-empty` 增加互斥/优先级条款，例如：
  - 「当 `normalizedTextLength === 0` 且 `pixelCoverage >= 0.02` 时，仅输出 `text-extraction-empty`，不再输出 `near-blank`（图片/扫描页应被视为有内容而非接近空白）。」
  - 或把 `near-blank` 第二分支收紧为「`0 < normalizedTextLength < 64` 且 `pixelCoverage < 0.10`」，使文本为 0 的页只走 `blank` / `text-extraction-empty` 两条互斥分支。
  - 同步在 §9 `inspect.test.js` 列一条「`textLength=0`、`pixelCoverage∈[0.02,0.10)` 仅出 `text-extraction-empty`」的边界用例。

- **E2（修 P2-K）**：在 §4.6 页选择小节新增「Source precedence & grammar」条目并统一三命令：
  - 声明 `--pages`、`--range`、`--from/--to`、`--all` 互斥（同时给出多个则报错并退出非零），或给出确定优先级；
  - 明确 `--pages` 是否允许内嵌区间（建议允许 `1-5,10,first,last` 统一文法）；
  - 明确 `--range`/`--from-to` 的端点是否接受别名（建议接受 `first/last/middle`）；
  - 明确越界/0/负数/`--from` 缺 `--to` 的统一错误语义；
  - 把 inspect 签名（spec:269）的 `--pages/--range` 标注与 capture-range 的 `|` 对齐。

- **E3（修 P2-L）**：
  - §4.5 增加「`stop` 必须至少指定一个目标（`--url`/`--port`/`--pid`/`--all`），否则输出 usage 错误并退出非零」。
  - §4.5 增加退出码映射：全部 `stopped`/`stale` → 0；任一 `failed` → 非零。
  - §4.3 在成功 JSON 后补一段失败 JSON 形状（`{ ok: false, url, health: null, registry: { found: ... } }`）并声明退出非零。

- **E4（N1/N5）**：§7 为 `latexview_contact_sheet` 加条件说明「若 contact-sheet 推迟二期，则 Codex 与 Pi 同步省略以维持对称」；§4.9 明确未传 `--jump-if-unique` 时 `jump` 键的缺省形状（建议省略或 `{ attempted: false }`）。

- **E5（N2/N3/N4）**：§4.5 为 `stop` 给出确定的等待/超时常量；§4 顶部 Output mode 声明「仅 `--json` 为稳定契约，默认文本格式不做兼容性保证」；§4.3 为 `registry.found === false` 补一行字段省略说明。

---

## 5. 是否实现就绪（Readiness Judgement）

- round-01（1×P1 + 5×P2）与 round-02（3×P2 + 4×N）的**全部历史发现已闭合**，契约稳定性、生命周期安全身份字段、inspect 阈值数值化、输出模式通则、stop 结果枚举、默认 DPI、schema 编号独立性均已就位。
- 本轮新发现**全为 P2/次要级**，且集中在三处窄面：capture 侧 `near-blank`/`text-extraction-empty` 重叠（P2-J）、页选择多来源文法（P2-K）、失败路径契约与退出码（P2-L）。三者均不影响整体模块拆分、注册表设计与命令骨架，可直接折叠进实现计划首批任务。
- 据此判断：规格**已达到实现就绪**。建议在实现计划中把 P2-J/P2-K/P2-L 作为对应命令（`inspect`、`page-selection`、`stop`/`status`）的「编码前先定稿」前置项，且仅需对这三处修订做一次定向复核，无需再走完整审计轮。

---

## 6. Go / No-Go

**结论：Go（放行）。**

进入实现计划后建议优先完成（不阻断进入计划）：

1. **P2-J（E1）**：定义 capture 启用时 `near-blank` 与 `text-extraction-empty` 的互斥/优先级，保证 inspect 告警集合可确定断言并不再对纯图页误报。
2. **P2-K（E2）**：统一 `--pages/--range/--from-to/--all` 的互斥优先级、`--pages` 内嵌区间、`--range` 别名与非法输入语义，闭合共享 `page-selection.js` 的文法契约。
3. **P2-L（E3）**：定义 `stop` 无目标行为、退出码映射与 `status`/`stop` 失败 JSON 形状。
4. **N1–N5（E4、E5）**：contact-sheet 对称性条件、`jump` 缺省形状、stop 等待常量、默认文本契约声明、registry `found:false` 形状，建议实现期一并落地。

六项历史发现已全部闭合、无 P0/P1 残留，规格可作为实现计划的输入推进；上述 P2 项在实现计划阶段定向收敛即可。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-qa-loop/round-03.md
