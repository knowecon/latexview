# latexview Agent QA 工具规格审计（Round 02）

> 审计对象：`docs/specs/agent-qa-tools-spec.md`（Status: Draft for Auditor loop，2026-05-24）
> 参照基线：`docs/audits/agent-qa-loop/round-01.md`（上一轮 1 项 P1 + 5 项 P2）
> 审计方法：逐文件静态阅读修订后规格 + 对照 round-01 逐条核验 + 抽样比对现有实现（`src/server.js`、`src/args.js`）。
> 可访问性说明：本次任务清单内的全部文件（待审规格、round-01 审计、相关源码）均成功读取，无不可访问内容。

---

## 1. 执行结论（Conclusion）

本轮修订**对 round-01 的全部发现做出了实质性、可落地的收敛**：P1-A 与 P2-B ~ P2-F 六项发现**均已在规格层面修复**（详见 §2 核验表，每条均有 file:line 证据）。新增的「Output mode 通则」「Thresholds 数值小节」「Summary semantics」「Health endpoint 身份字段」「registry 自清理 + 跨平台 kill」等内容，把上一轮指出的「JSON 契约不稳定 / 生命周期安全无判定字段 / inspect 判定不确定」三大门槛基本补齐。修订**未引入 P0/P1 级新矛盾**。

但在审计重点中的「inspect 阈值的确定性」上，新写入的具体阈值与「blank-page policy」之间产生了一处**新的内部矛盾**（无 `--capture` 时 `text-extraction-empty` 不可能成立，而 `near-blank` 却会仅凭文本长度触发，违背「不要仅凭文本判定空白」的本意）。此外 stop 结果枚举、inspect `--all` 与 Open Question 的张力、find 抓图缺 DPI 等属于 P2/次要级，需在实现前做小幅收敛，但不阻断放行。

结论：**Go（有条件放行）**——规格已基本达到「实现就绪」。进入实现前需修订 1 项新发现 P2-G（无 capture 的告警语义矛盾）与 2 项次要 P2（stop 状态枚举、`--all` 与开放问题一致性），其余为可在实现期收口的提示。

**满意度评分：8 / 10。**
（六项历史发现全部闭合、契约稳定性显著提升；扣分集中于新出现的无-capture 告警语义矛盾，以及若干默认值/枚举的收尾未尽。）

---

## 2. 上一轮发现的核验（Verification of Prior Findings）

| 上轮编号 | 主题 | 本轮修订证据（file:line） | 状态 |
|---|---|---|---|
| **P1-A** | `/health` 缺稳定身份字段，`version` 语义自相矛盾，削弱 stop/status 安全前提 | §5 Health：`/health` 返回 `{ ok, app: "latexview", schemaVersion: 2, version, pdfName }`，并区分 `app`=身份、`schemaVersion`=协议、`version`=文档 mtime 版本（spec:499-502）；§4 顶部通则明确 `schemaVersion` vs `version` 语义（spec:77）；status/list 示例把旧 `"version": 2` 改为 `app`+`schemaVersion`+真实 mtime 版本（spec:174-176、:219-221）；status 非零判据改为 `health.app !== "latexview"`（spec:164）；stop 校验改为 `health.app === "latexview"`（spec:239）。对照实现 `src/server.js:145` 现仍为 `{ ok, version, pdfName }`，新增字段为加法、向后兼容。 | ✅ 已修复 |
| **P2-B** | 跨命令产物命名/默认目录不统一，与现有 capture 不一致 | 统一为 `<pdf-stem>-page-<NNN>.webp`、按 `numPages` 宽度补零：inspect（spec:282）、capture-range（spec:366）、find「同 capture-range 命名规则」（spec:430）；默认目录逐命令写明：inspect `<stem>-inspect`（spec:281）、capture-range `<stem>-captures`（spec:365）、find `<stem>-find-captures`（spec:429）；并显式保留单页 `capture` 旧默认 `<stem>-page-<page>.webp`（spec:367，对应实现 `src/args.js:179`）；示例路径与规则一致（spec:338、:382、:444）。 | ✅ 已修复 |
| **P2-C** | inspect 阈值与 `oversize-page` 判定未定义，不可确定/不可稳定测试 | 新增「Thresholds」小节给出数值常量：`normalizedTextLength < 16`、`pixelCoverage < 0.005`、`blank` = 两者皆满足、`near-blank` 的 `<64`/`<0.02`、`64x64` 采样网格、alpha<=16 忽略、RGB 全 >=245 视为白、默认 DPI 72（spec:308-315）；`middle = Math.floor((numPages+1)/2)`（spec:274）；`oversize-page` 明确为宽/高分别比中位数、任一偏离 >20% 触发，中位数由 pdf.js 元数据计算、不渲染（spec:316-317）。 | ✅ 已修复（残留语义矛盾见 §3 P2-G） |
| **P2-D** | agent-facing 子命令默认输出模式未定义（旧 Open Q4） | §4「Output mode」通则：CLI 默认人类文本、结构化命令支持 `--json`、封装层对有结构化输出的命令一律传 `--json`（spec:72-77）；旧 Open Question「JSON 是否默认」已删除（现 Open Questions 仅剩 3 条，spec:691-693）。 | ✅ 已修复 |
| **P2-E** | inspect summary 语义、server 优雅退出自清理、跨平台 kill 缺失 | summary 三字段定义清晰：`checked`=有效页数、`warningCount`=有告警的页数、`warnings`仅含非空类目（spec:321-323）；serve 在 `SIGINT/SIGTERM` 优雅退出时移除自身注册表项（spec:93）；stop 增补 Windows `process.kill` + 复探 `/health` 的成功判定（spec:243）。 | ✅ 已修复 |
| **P2-F** | contact-sheet 签名缺 `--max-pages`，与规则不自洽 | 签名补入 `[--max-pages <n>]`（spec:394），与规则「Hard cap default: 24 pages unless `--max-pages` is explicitly raised」（spec:404）一致。 | ✅ 已修复 |

> 小结：round-01 的 **1 项 P1 + 5 项 P2 全部闭合**，且修复方向与现有实现可对接（health 字段为加法、单页 capture 命名保留兼容）。

---

## 3. 本轮遗留与新增发现（Remaining / New Findings，含 file:line 证据）

> 未发现 P0、P1 级问题。以下均为 P2 / 次要级。

### P2-G（新增矛盾）　无 `--capture` 时的告警语义自相矛盾

- 证据：
  - `text-extraction-empty` 的定义需要像素证据：「no text but **pixel coverage** suggests visible content」（spec:297）。
  - 但 blank-page policy 要求：「Without `--capture`, do not claim a page is blank solely from text length. **Use `text-extraction-empty` instead.**」（spec:304）。
  - 而像素覆盖率仅在开启 capture 时才有：「Optional pixel coverage **if capture is enabled**」（spec:290）。
  - 同时 `near-blank` 阈值为「either `normalizedTextLength < 64` or `pixelCoverage < 0.02`」（spec:313）——在无 capture 时 `pixelCoverage` 缺失，该条退化为「仅凭 `normalizedTextLength < 64`」即可触发 `near-blank`。
- 矛盾点：
  1. spec:304 推荐的替代类目 `text-extraction-empty` 在**无 capture 时根本无法成立**（没有像素覆盖率可“suggest visible content”），即该建议不可执行。
  2. 无 capture 时 `near-blank` 会**仅凭文本长度**对一张纯图片页（文本=0）告警，这恰恰违反了「不要仅凭文本长度判定空白类问题」的本意，也与验收标准「never calls a textless image page blank unless capture/pixel evidence supports it」（spec:668）的精神相冲突（虽 `near-blank ≠ blank`，但对纯图页仍是误导性告警）。
- 影响：`inspect.test.js` 要被要求验证「text-only warning behavior / threshold boundary」（spec:613-615），但无-capture 路径下究竟出哪个告警（`near-blank`？`text-extraction-empty`？还是不出）规格自相矛盾，单测无法稳定断言。
- 建议（见 §4 E1）：显式定义「无 `--capture` 时的告警规则」。

### P2-H　inspect `--all` 规则与 Open Question 自相张力；oversize-page 的全量扫描成本未声明默认行为

- 证据：
  - 规格正文已给出确定规则：「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages」（spec:275）。
  - 但 Open Questions 又把它当未决：「Should `inspect --all` be allowed for very large PDFs if `--capture` is absent, or should it always require an explicit `--max-pages` over 50 pages?」（spec:693）。正文已定、开放问题再提，给实现者“此规则是否最终”的歧义。
  - `oversize-page` 是**默认告警类目**（spec:298），其中位数需读取**全部页**的 pdf.js 元数据（spec:317）。规格说中位数「may be computed … without rendering」（措辞为可选），但既然 oversize-page 默认开启，则即便只检 `first,middle,last` 三页也会隐式触发一次全文档元数据扫描——对 370 页 PDF 的「轻量 QA」目标存在成本张力，规格未声明这是否默认发生、可否关闭。
- 影响：实现者无法确定 `--all` 的最终契约，以及 oversize-page 是否应在未显式要求时跳过全量扫描。
- 建议（见 §4 E2）：删除/收敛 Open Question 3 使之与 spec:275 一致；为 oversize-page 声明「默认即计算（元数据级、可接受）」或「仅在页集 >N 或显式开启时计算，否则跳过」。

### P2-I　`stop` 结果 `status` 枚举不完整，缺「停止失败」态

- 证据：
  - stop 在发 `SIGTERM` 后「removes the registry entry **if the process exits or the health check fails afterward**」（spec:242），并对 stale 项报 `stale` 而非 `stopped`（spec:244）。
  - JSON 示例仅给出 `"status": "stopped"`（spec:254）。
  - 但「进程未退出且 `/health` 仍为 latexview」（即停止失败）这一态没有对应的 `status` 取值，跨平台说明（spec:243）也只定义“成功=不可达”，未定义失败时返回什么。
- 影响：封装层与 `registry.test.js`（spec:623-626）无法对“停止失败”做稳定断言；agent 拿到的结构化结果存在未覆盖状态。
- 建议（见 §4 E3）：明确 `status ∈ { stopped, stale, failed }`（或类似），并定义 failed 的判定（SIGTERM 后复探 `/health` 仍为 latexview）。

### 次要提示（Minor，不阻断）

- **N1**：`find` 的 `--capture` 抓图无 DPI 控制——签名只有 `--capture/--out-dir/--max-captures`（spec:410-411），而 inspect、capture-range 均有 `--dpi`。候选页抓图用何 DPI 未定义。建议补 `--dpi` 或声明沿用某默认值。
- **N2**：capture-range 与 contact-sheet 的默认 DPI 未给出（仅 inspect 写明默认 72，spec:315）。建议为 capture-range/`--thumb-dpi` 写明默认值，便于单测稳定。
- **N3**：registry 实体 `schemaVersion: 1`（spec:473）与 health `schemaVersion: 2`（spec:499）为两套不同 schema 的版本号，规格通则已说明 `schemaVersion` 可指“response 或 registry schema”（spec:77），逻辑自洽，但两数字并列易被误读。建议加一句「registry schema 与 health response schema 独立编号」。
- **N4**：capture-range 独有 `--from <n> --to <n>`（spec:356）未纳入共享 page-selection 解析职责描述（spec:513-514 仅列 pages/aliases/ranges）。建议在 §6 注明 `--from/--to` 的解析归属，避免 args 单测分歧。

---

## 4. 具体规格修订建议（Concrete Spec Edits）

- **E1（修 P2-G，最高优先）**：在 §4.6「Blank-page policy」补一条无-capture 规则，例如：
  - 「无 `--capture` 时：不输出 `blank`、`near-blank` 与 `text-extraction-empty`（三者均依赖像素证据）；对文本极少的页仅输出信息性提示（或不输出告警），并在 JSON 中标注 `pixelCoverage: null`。`near-blank` 与 `text-extraction-empty` 仅在 `--capture` 启用时可触发。」
  - 同步把 spec:304 改为「Without `--capture`, emit no blank/near-blank判定；textless 页不视为质量问题，需开 `--capture` 才能进一步判别」，消除“用 text-extraction-empty 替代”的不可执行表述。

- **E2（修 P2-H）**：删除或改写 Open Question 3（spec:693），使其与正文 spec:275 一致（例如保留正文规则、把开放问题降级为“未来是否放宽”的备注）；并在 §4.6 Thresholds 末尾声明 oversize-page 中位数的默认计算策略与成本边界。

- **E3（修 P2-I）**：在 §4.5 JSON shape 上方明确 `status` 枚举：`stopped | stale | failed`，并定义 failed = 「SIGTERM 后等待 + 复探 `/health` 仍 `app === "latexview"`」。

- **E4（N1/N2）**：为 `find --capture` 增加 `--dpi`（或声明默认 DPI）；为 capture-range / contact-sheet 写明默认 DPI 数值。

- **E5（N3/N4）**：§5 加一句区分 registry schema 与 health response schema 的独立编号；§6 `src/page-selection.js` 职责处注明是否覆盖 `--from/--to`。

---

## 5. 是否实现就绪（Readiness Judgement）

- 历史发现（1×P1 + 5×P2）**全部闭合**，契约稳定性、生命周期安全判定字段、inspect 阈值数值化、输出模式通则均已就位。
- 现存问题**全为 P2/次要级**，且集中在 inspect 无-capture 告警语义（P2-G）这一处真正会影响实现/单测确定性的矛盾，以及两处收尾性枚举/一致性问题（P2-H、P2-I）。
- 据此判断：规格**接近实现就绪**，但尚需一轮小幅收敛（E1 必修，E2/E3 应修，E4/E5 建议），以保证 `inspect.test.js`、`registry.test.js` 等能以确定值稳定断言。

---

## 6. Go / No-Go

**结论：Go（有条件放行）。**

进入实现前必须完成：

1. **P2-G 必修（E1）**：定义无 `--capture` 时的告警语义，消除 `text-extraction-empty` 不可执行与 `near-blank` 仅凭文本触发的矛盾。这是 inspect 输出契约与单测可断言性的前提。
2. **P2-H / P2-I 应修（E2、E3）**：收敛 `--all` 正文与 Open Question 的一致性、补全 stop 结果 `status` 枚举与 failed 判定。
3. **N1–N4（E4、E5）建议在实现期一并落地**，确保默认 DPI、schema 编号、`--from/--to` 解析归属无歧义。

满足以上（尤其 E1）后，本规格即可作为实现计划的输入推进，无需再走完整审计轮，仅需对 E1 的修订做一次定向复核。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-qa-loop/round-02.md
