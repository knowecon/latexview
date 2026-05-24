# latexview Agent QA 工具规格审计（Round 04）

> 审计对象：`docs/specs/agent-qa-tools-spec.md`（Status: Draft for Auditor loop，2026-05-24）
> 参照基线：`round-01.md`（1×P1 + 5×P2）、`round-02.md`（3×P2 + 4×N）、`round-03.md`（3×P2：P2-J/K/L + 5×N）
> 审计方法：逐节静态阅读修订后规格 + 对照 round-03 逐条核验（P2-J/K/L、N1–N5）+ 针对本轮审计重点（页选择文法、inspect 告警优先级、status/stop 失败契约、contact-sheet 纳入、wrapper 对称性、验收标准）做穷尽式组合推演。
> 可访问性说明：任务清单内全部文件（待审规格、round-01/02/03 审计）均成功读取，无不可访问内容。

---

## 1. 执行结论（Conclusion）

本轮规格**把 round-03 的全部 3 项 P2（P2-J、P2-K、P2-L）与全部 5 项次要提示（N1–N5）逐条收敛完毕**（见 §2 核验表，每条附 file:line 证据）。三项关键修复均到位且自洽：

- **P2-J（capture 侧 `near-blank`/`text-extraction-empty` 重叠）**：通过两处改动彻底消除——`near-blank` 第二分支加上 `0 <` 前缀（spec:346），把「文本为 0 的图片页」排除出该分支；并新增确定式优先级条款（spec:347）。经穷尽推演，三类 blank 相关告警在全部 `(normalizedTextLength, pixelCoverage)` 组合上现已**两两互斥**，单页恒只命中其一。
- **P2-K（页选择文法）**：来源互斥（spec:300）、`--pages` 内嵌区间 + 别名端点（spec:301）、`--range`/`--from-to` 接受别名端点（spec:302-303）、非法输入枚举与「渲染前退出」（spec:309）均已明确；inspect/capture-range/contact-sheet 三处签名已统一为 `|` 互斥标注（spec:292、:391、:429）。
- **P2-L（失败路径契约）**：`stop` 须恰好一个目标、无目标/多目标即 usage 错误并非零退出（spec:254），退出码映射明确（spec:270-273）；`status` 失败 JSON 形状（spec:190-202）与 `registry.found===false` 字段省略（spec:166）补齐。

历史四轮发现（round-01 的 1×P1+5×P2、round-02 的 3×P2+4×N、round-03 的 3×P2+5×N）**至此已全部闭合，无回归**。本轮修订**未引入任何 P0/P1 级矛盾**。

本轮仅发现 **1 项窄面 P2 新矛盾**：`capture-range --all` 缺少大文档保护阈值，与 §3 Non-Goal「No default full-document image generation for large PDFs」（spec:68）相抵触，且与已加保护的 `inspect --all`（spec:306）、有硬上限的 `contact-sheet`（spec:441）形成不对称（P2-M）。另有 3 处纯文案/覆盖性次要项。这些均不影响模块拆分、注册表设计与命令骨架，可直接折叠进 capture-range 实现任务。

结论：**Go（放行）**——规格已达「高度满意、实现就绪」。建议在 capture-range 编码前先行收敛 P2-M（按 inspect 同款加 `--all` 大文档守卫），但不阻断进入实现阶段。

**满意度评分：9 / 10。**
（round-03 的 3×P2 + 5×N 全部闭合、四轮历史发现零残留、inspect 告警语义经穷尽推演确认互斥；扣 1 分仅因 `capture-range --all` 与 Non-Goal 抵触这一处真实但窄面的契约不一致。）

---

## 2. 上一轮（round-03）发现的核验（Verification of Prior Findings）

| round-03 编号 | 主题 | 本轮修订证据（file:line） | 状态 |
|---|---|---|---|
| **P2-J** | 开启 `--capture` 后 `near-blank` 与 `text-extraction-empty` 判定区间重叠 | ①`near-blank` 第二分支改为「`0 < normalizedTextLength < 64` and `pixelCoverage < 0.10`」（spec:346），`0 <` 把文本为 0 的图片页排除出该分支；②新增「Warning priority is deterministic: evaluate `blank` first, then `text-extraction-empty`, then `near-blank`. If `normalizedTextLength === 0` and `pixelCoverage >= 0.02`, emit only `text-extraction-empty` among the three blank-related warnings」（spec:347）；③`inspect.test.js` 增补「`normalizedTextLength === 0` 且 `pixelCoverage ∈ [0.02,0.10)` 仅出 `text-extraction-empty`」边界用例（spec:659）。 | ✅ 已修复 |
| **P2-K** | 页选择多来源互斥/优先级、`--pages` 内嵌区间、`--range` 别名未定义 | 来源互斥「Page source flags are mutually exclusive … Supplying more than one source exits non-zero with a usage error」（spec:300）；`--pages` 接受内嵌区间与别名端点（spec:301）；`--range`「same endpoint grammar as `--pages`」（spec:302）；`--from/--to` 同端点文法（spec:303）；非法输入枚举 + 「exit non-zero before doing any rendering or capture work」（spec:309）；inspect 签名改为 `|` 互斥（spec:292），与 capture-range（spec:391）、contact-sheet（spec:429）对齐；共享归属重申（spec:308）。 | ✅ 已修复 |
| **P2-L** | `stop` 无目标行为、退出码、status/stop 失败 JSON 未定义 | `stop` 须恰好一个目标，无目标/多目标为 usage 错误并非零（spec:254）；退出码映射「Exit 0 当全部 `stopped`/`stale`；Exit 1 当任一 `failed`、无目标命中、或 usage 错误」（spec:270-273）；`status` 新增 Failure JSON 形状 `{ ok:false, url, health:null, registry:{found:false}, error }`（spec:190-202）；`registry.found===false` 时省略 `pid/pdfPath/startedAt`（spec:166）。 | ✅ 已修复 |
| **N1** | contact-sheet 两端对称性的条件说明缺失（旧 Open Q1） | §4.8 明确「Codex MCP and Pi must either both expose it or both omit it; this spec chooses to expose it in both wrappers」（spec:443）；原「Open Questions」节已整体替换为「§12 Settled Decisions」，其中「若实现压力迫使推迟，Codex MCP 与 Pi 必须同步推迟以保持对称」（spec:735）。 | ✅ 已修复 |
| **N2** | `stop` 等待时长无具体值 | 「Stop waits up to 1500 ms after signaling, polling `/health` every 100 ms」（spec:260）；`registry.test.js` 锚定「`failed` status after 1500 ms」（spec:671）。 | ✅ 已修复 |
| **N3** | 默认（非 `--json`）文本格式契约性未声明 | §4 Output mode 新增「Human text output is for people and is not a compatibility contract unless a command section explicitly says otherwise」（spec:73）。 | ✅ 已修复 |
| **N4** | `status` 的 `registry.found===false` 形状未定义 | 「When no registry entry matches the URL, `registry` is `{ "found": false }` and omits `pid`, `pdfPath`, and `startedAt`」（spec:166），失败示例与之一致（spec:197-199）。 | ✅ 已修复 |
| **N5** | 未传 `--jump-if-unique` 时 `jump` 键缺省形状未定义 | 「If `--jump-if-unique` is omitted, `jump` is still present as `{ "attempted": false }`」（spec:494）。 | ✅ 已修复 |

### 2.1 P2-J 互斥性穷尽复核（确认无残留重叠）

设 `t = normalizedTextLength`、`c = pixelCoverage`，在 `--capture` 下逐区间验证：

- `t<16 ∧ c<0.005`：`blank` 命中（spec:345）；`near-blank` 因「not both below the stricter blank thresholds」被排除（spec:346）；`text-extraction-empty` 需 `c≥0.02` 不命中 → **仅 blank**。
- `t=0 ∧ 0.005≤c<0.02`：`blank` 不命中（`c≥0.005`）；`text-extraction-empty` 不命中（`c<0.02`）；`near-blank` 第一分支 `c<0.02` 命中 → **仅 near-blank**（语义合理：极少可见内容）。
- `t=0 ∧ 0.02≤c<0.10`：`text-extraction-empty` 命中（`t=0 ∧ c≥0.02`，spec:338）；`near-blank` 第一分支 `c<0.02` 否、第二分支需 `0<t` 否 → **仅 text-extraction-empty**（spec:347 显式条款亦印证）。
- `t=0 ∧ c≥0.10`：仅 `text-extraction-empty`。
- `0<t<16 ∧ 0.005≤c<0.10`：`blank` 否（`c≥0.005`）；`text-extraction-empty` 否（`t≠0`）；`near-blank` 命中（第一分支或第二分支）→ **仅 near-blank**。

结论：三类 blank 相关告警现已两两互斥，单页恒只命中其一，`inspect.test.js` 可用确定集合断言。P2-J 实质闭合。

---

## 3. 本轮遗留与新增发现（Remaining / New Findings，含 file:line 证据）

> 未发现 P0、P1 级问题。

### P2

**P2-M（新增）　`capture-range --all` 缺大文档守卫，与 Non-Goal「不默认对大文档做全量出图」相抵触，并与 inspect/contact-sheet 不对称**

- 证据：
  - §3 Non-Goals 明确：「No default full-document image generation for large PDFs.」（spec:68）。
  - 同享页选择的 `inspect` 已设守卫：「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages.」（spec:306）。
  - 同享页选择的 `contact-sheet` 设硬上限：「Hard cap default: 24 pages unless `--max-pages` is explicitly raised.」（spec:441）。
  - 但 `capture-range` 的 Rules（spec:397-407）**未定义任何默认上限或 `--all` 守卫**；其签名虽含 `--max-pages`（spec:391），却无任何规则要求 `--all` 时必须给 `--max-pages`，也无默认硬上限。默认 DPI 又高达 216（spec:401）。
  - 文法共享语义模糊：spec:306 的「>50 须给 `--max-pages`」写在 §4.6 Inspect 的「Page selection」子节内，而 spec:308 只声明「Page selection **parsing** is shared」——共享的是解析，而非上限/守卫策略，故无法据此推断该守卫自动适用于 `capture-range`。
- 矛盾点：`latexview capture-range --all <large.pdf>`（如 370 页）将在默认 216 DPI 下对**全文档逐页**调用 `pdftoppm`/`cwebp` 出图、无任何保护——这正是 Non-Goal（spec:68）显式排除的「默认对大文档全量出图」场景；同一份大 PDF 下 `inspect --all` 被拦、`contact-sheet` 被封顶 24，唯独 `capture-range --all` 无保护，命令族行为不对称。
- 影响：§9 `capture-range.test.js`（spec:662-666）无 `--all` 大文档守卫用例，实现者对「`capture-range --all` 是否需要 `--max-pages`、是否有默认上限」无契约可依；agent 误用 `--all` 可致磁盘/时间开销失控，且与规格自述的 Non-Goal 直接冲突。
- 建议（见 §4 E1）：在 §4.7 Rules 中显式声明 `capture-range --all` 的大文档守卫（与 inspect 对齐：「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages」），或给出默认硬上限；并在 §9 增补对应守卫用例。

### 次要提示（Minor，不阻断）

- **N1**：spec:343「`normalizedTextLength < 16` marks the page as a **near-blank** candidate」措辞误标——`16` 实为 `blank` 的文本阈值（spec:345 用 `<16`），而 `near-blank` 的文本阈值为 `64`（spec:346）。该行应表述为「blank candidate」。精确判定规则在 spec:345-347 已给出且自洽，故仅为文案性误导，不影响确定性。建议（E2）把 spec:343 改为「marks the page as a **blank** text candidate」。

- **N2**：`stop` 「no target matches」已定退出码（spec:273 → Exit 1），但**该情形下 `results` 数组的 JSON 表示未定义**——如 `--port 9999`/`--pid <未注册>` 命中空时，`results` 是空数组、还是含某 `status` 的条目？`stale/stopped/failed` 三态（spec:264-268）均不覆盖「注册表内根本无此目标」。建议（E3）补一行：未命中任何注册表项时 `results` 为空数组并退出非零（或定义一个 `not-found` 态）。

- **N3**：§10 验收标准（spec:704-721）覆盖了 info/inspect/capture-range/find/list/stop，但**未为 `status` 与 `contact-sheet` 命令给出任何验收条目**。两者已是首批命令面（spec:589-606、§4.3/§4.8），建议（E4）各补一条验收（如「`latexview status --json <url>` 对运行中/不可达 viewer 返回稳定 `ok` 与失败形状」「`latexview contact-sheet` 在缺 `montage` 时给出清晰安装提示且无堆栈」）。

---

## 4. 具体规格修订建议（Concrete Spec Edits）

- **E1（修 P2-M，最高优先）**：在 §4.7 Capture Range 的 Rules 中新增一条，与 inspect 守卫对齐：
  - 「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages.」（与 spec:306 同款），或给出默认硬上限（如「Hard cap default: N pages unless `--max-pages` is explicitly raised」）。
  - 同步在 §9 `capture-range.test.js` 增补「`--all` over the 50-page guard without `--max-pages` exits non-zero」用例。
  - 可选：在 §4.6/§6 把「>50 须给 `--max-pages`」明确为**共享页选择策略**（而非仅 inspect 本地规则），使 inspect 与 capture-range 守卫天然一致。

- **E2（修 N1）**：将 spec:343 改为「`normalizedTextLength < 16` marks the page as a **blank** text candidate」，消除与 `near-blank`（阈值 64）的措辞混淆。

- **E3（修 N2）**：在 §4.5 Result statuses 或 JSON shape 处补一行：当目标（`--url`/`--port`/`--pid`）在注册表中无任何匹配项时，`results` 为空数组并按 spec:273 退出非零（或引入 `not-found` 状态）。

- **E4（修 N3）**：在 §10 各补一条 `status` 与 `contact-sheet` 验收标准，使首批命令面验收覆盖完整。

---

## 5. 是否实现就绪（Readiness Judgement）

- round-01（1×P1+5×P2）、round-02（3×P2+4×N）、round-03（3×P2+5×N）的**全部历史发现已闭合**：契约稳定性、`/health` 身份字段、inspect 阈值数值化与告警互斥、页选择共享文法、stop/status 失败路径与退出码、默认文本非契约声明、schema 编号独立性、默认 DPI、contact-sheet 对称性条款均已就位。
- 本轮新发现仅 **1 项窄面 P2（capture-range `--all` 守卫缺失，与 Non-Goal 抵触）** 与 3 项文案/覆盖性次要项，均不触及模块拆分、注册表设计、命令骨架与 wrapper 对称性。
- inspect 告警语义经穷尽组合推演确认**两两互斥、可确定断言**，这是本轮三个审计重点中最易再出歧义的一处，现已稳固。
- 据此判断：规格**已达高度满意的实现就绪**。建议把 P2-M 作为 `capture-range` 命令「编码前先定稿」的前置项（一处加守卫即可），其余次要项可在实现期一并落地，无需再走完整审计轮，仅需对 E1 的修订做一次定向复核。

---

## 6. Go / No-Go

**结论：Go（放行）。**

进入实现计划后建议优先完成（不阻断进入计划）：

1. **P2-M（E1）**：为 `capture-range --all` 加大文档守卫（对齐 inspect 的「>50 须给 `--max-pages`」或给默认硬上限），消除与 Non-Goal「不默认对大文档全量出图」（spec:68）的抵触，并补对应单测。
2. **N1（E2）**：修正 spec:343 的 `near-blank`/`blank` 阈值措辞误标。
3. **N2（E3）**：定义 `stop` 目标未命中时 `results` 的 JSON 表示。
4. **N3（E4）**：为 §10 补 `status` 与 `contact-sheet` 验收条目。

四轮历史发现已全部闭合、无 P0/P1 残留、inspect 告警互斥性已穷尽验证，规格可作为实现计划的输入推进；上述 1×P2 + 3×Minor 在实现计划阶段定向收敛即可。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-qa-loop/round-04.md
