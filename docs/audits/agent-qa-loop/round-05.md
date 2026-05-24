# latexview Agent QA 工具规格审计（Round 05 · 实现前最终就绪门）

> 审计对象：`docs/specs/agent-qa-tools-spec.md`（Status: Draft for Auditor loop，2026-05-24）
> 参照基线：`round-01.md`（1×P1 + 5×P2）、`round-02.md`（3×P2 + 4×N）、`round-03.md`（3×P2：P2-J/K/L + 5×N）、`round-04.md`（结论 Go / 9 分；遗留 1×P2-M + N1/N2/N3 三项次要）
> 审计方法：①逐条核验 round-04 的 4 项待办（P2-M、N1、N2、N3）在现版规格中的落地证据（附 file:line）；②对受影响命令族（capture-range / inspect / contact-sheet 的 `--all` 与上限语义、stop 失败契约、验收覆盖）做一致性与对称性穷尽推演；③全文回扫，确认本轮修订未引入新的 P0/P1/P2 矛盾。
> 可访问性说明：任务清单内全部文件（待审规格、round-01/02/03/04 审计）均成功读取，无不可访问内容。

---

## 1. 执行结论（Conclusion）

本轮规格**把 round-04 遗留的全部 4 项（1×P2-M + N1 + N2 + N3）逐条收敛完毕**，且修订之间彼此自洽、未引入任何回归或新矛盾（见 §2 核验表，每条附 file:line 证据）：

- **P2-M（`capture-range --all` 缺大文档守卫）**：§4.7 Rules 新增「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages.」（spec:403），与 `inspect` 守卫（spec:307）逐字对齐；§4.6 Page selection 同步把守卫归属上提为「the `--all` large-document guard is shared by `inspect` and `capture-range`」（spec:309）；§9 增补「`--all` over the 50-page guard without `--max-pages` exits non-zero before rendering」用例（spec:668）；§10 增补验收「`latexview capture-range --all <large.pdf>` exits non-zero unless `--max-pages` is explicit」（spec:719）。与 Non-Goal「No default full-document image generation for large PDFs」（spec:68）的抵触已彻底消除，命令族 `--all` 守卫恢复对称。
- **N1（`16` 阈值措辞误标为 near-blank）**：spec:344 已改为「`normalizedTextLength < 16` marks the page as a **blank** text candidate」，与 `blank` 阈值（spec:346 `<16`）一致；全文已无「near-blank candidate」残留措辞。
- **N2（stop 目标未命中时 `results` 形状未定义）**：§4.5 Safety rules 新增「If the target selector matches no registry entries, return `"results": []` in JSON and exit non-zero.」（spec:259），与退出码映射「no target matches → Exit 1」（spec:274）闭环一致。
- **N3（验收缺 status / contact-sheet 覆盖）**：§10 新增「`latexview status --json <viewer>` returns the stable success shape … and the stable failure shape for an unreachable viewer」（spec:714）与「`latexview contact-sheet --pages first,last <pdf>` writes a WebP overview when `montage` is available and gives a clear no-stack install hint when it is missing」（spec:720），首批命令面验收覆盖补齐。

**历史五轮发现现已全部闭合**：round-01（1×P1+5×P2）、round-02（3×P2+4×N）、round-03（P2-J/K/L+5×N）由 round-04 核验关闭，round-04 自身的 1×P2-M+3×N 由本轮关闭。**本轮全文回扫未发现任何 P0/P1/P2 级矛盾**，亦无新增回归。

仅余 **1 项 N 级非阻断观察**（contact-sheet `--all` 与 24 硬上限交互的「报错 vs 截断」措辞未显式）——属可选命令的窄面边角，可在实现期顺手定稿，不影响模块拆分、注册表设计、命令骨架与 wrapper 对称性。

结论：**规格已达「实现就绪」且我对其质量高度满意**。作为实现前的最终就绪门，规格无需再走完整审计轮即可作为实现计划的直接输入。

**满意度评分：10 / 10。**
（round-04 全部 4 项逐条闭合且自洽、五轮历史发现零残留、inspect 告警互斥与命令族 `--all` 守卫对称性均已稳固、无 P0/P1/P2 残留；唯一 N 级观察为可选命令边角措辞，不构成扣分理由。）

---

## 2. round-04 发现的核验（Verification of Round-04 Findings）

| round-04 编号 | 主题 | 现版规格证据（file:line） | 状态 |
|---|---|---|---|
| **P2-M** | `capture-range --all` 缺大文档守卫，与 Non-Goal（spec:68）抵触、与 inspect/contact-sheet 不对称 | ①§4.7 Rules 新增「`--all` requires an explicit `--max-pages` if the PDF has more than 50 pages.」（spec:403），与 inspect（spec:307）逐字对齐；②§4.6 把守卫归属上提为「the `--all` large-document guard is shared by `inspect` and `capture-range`」（spec:309）；③§9 增补「`--all` over the 50-page guard without `--max-pages` exits non-zero before rendering」（spec:668）；④§10 增补验收（spec:719）。 | ✅ 已修复 |
| **N1** | spec:343 旧措辞把 `<16` 误标为「near-blank candidate」 | spec:344 改为「`normalizedTextLength < 16` marks the page as a **blank** text candidate」；全文 grep 确认无「near-blank candidate」残留，`near-blank` 仅出现于其正式定义（spec:329/347/348）。 | ✅ 已修复 |
| **N2** | stop 目标未命中时 `results` JSON 表示未定义 | §4.5 新增「If the target selector matches no registry entries, return `"results": []` in JSON and exit non-zero.」（spec:259），与退出码「no target matches → Exit 1」（spec:274）一致；与三态 `stopped/stale/failed`（spec:267-269）无冲突（未命中即空数组，而非新增第四态）。 | ✅ 已修复 |
| **N3** | §10 验收缺 `status` 与 `contact-sheet` 条目 | §10 新增 status 验收（spec:714，覆盖成功形状 + 不可达失败形状）与 contact-sheet 验收（spec:720，覆盖 montage 可用时出图 + 缺失时无堆栈安装提示）。 | ✅ 已修复 |

### 2.1 修订自洽性穷尽复核

- **`--all` 守卫对称性**：现状三命令族一致——`inspect`「>50 须给 `--max-pages`」（spec:307）、`capture-range`「>50 须给 `--max-pages`」（spec:403）、`contact-sheet`「硬上限 24 除非显式抬高 `--max-pages`」（spec:443）。spec:309 显式声明共享守卫仅覆盖 inspect 与 capture-range（contact-sheet 走自有硬上限），与三处文本一致，无归属歧义。
- **stop 未命中契约闭环**：「空数组 + 非零退出」（spec:259）↔ 退出码表（spec:273-274）「Exit 0 当全部 stopped/stale；Exit 1 当任一 failed、无目标命中、或 usage 错误」——空 `results`（零目标命中）落入「no target matches → Exit 1」，与「Exit 0 当每个目标 stopped/stale」（空集合不触发 Exit 0）不冲突，逻辑闭合。
- **N1 阈值语义未被措辞改动影响**：spec:344 仅修正描述用词；精确判定仍由 spec:346（blank：`<16` ∧ `<0.005`）、spec:347（near-blank：`<0.02` 或 `0<…<64`∧`<0.10`）、spec:348（确定式优先级）三条承载，round-04 已穷尽验证三类 blank 相关告警两两互斥，本轮措辞修订不改变该结论。

---

## 3. 本轮遗留与新增发现（Remaining / New Findings，含 file:line 证据）

> **未发现任何 P0、P1、P2 级问题。** 本轮全文回扫确认 round-04 的 4 项修订均未引入新的契约矛盾或回归。

### 次要提示（Minor / 非阻断）

- **N1（本轮唯一新观察，非阻断）**：`contact-sheet` 命令面接受 `--all`（spec:431），但其大文档行为由「Hard cap default: 24 pages unless `--max-pages` is explicitly raised」（spec:443）单独承载，且 spec:309 已明确把 `--all` 大文档守卫排除出 contact-sheet（仅 inspect/capture-range 共享）。其结果是：`contact-sheet --all <large.pdf>`（如 100 页）在未抬高 `--max-pages` 时，规格**未显式说明是「报错并非零退出」（同 inspect/capture-range 守卫风格）还是「截断到 24 页」**。
  - 影响评估：contact-sheet 定位为「one compact visual overview for a **small** selected page set」（spec:435），且为可选依赖命令，此为窄面边角；§10 验收（spec:720）与 §9 测试（spec:703 依赖跳过）均未要求该路径，故不构成实现阻断。
  - 建议（E1）：在 §4.8 Rules 补一句明确硬上限触达时的行为，例如「If the resolved page count exceeds the hard cap and `--max-pages` was not raised, exit non-zero with a usage error (do not silently truncate).」——与 inspect/capture-range 的「超限即报错」风格保持一致，消除最后一处语义留白。

---

## 4. 具体规格修订建议（Concrete Spec Edits）

- **E1（修本轮 N1，可选 · 实现期顺手定稿）**：在 §4.8 Contact Sheet 的 Rules 中，紧随 spec:443 硬上限条款补一行，明确 `--all`/页集解析结果超过硬上限且未抬高 `--max-pages` 时的行为（建议「超限即非零退出、不静默截断」），与 inspect/capture-range 的 `--all` 守卫语义对齐；如愿意，也可在 §9 `capture-range.test.js` 邻近增补 contact-sheet 的「超硬上限即非零退出」守卫用例。此项为唯一可选打磨，不阻断实现。

> 说明：round-04 的 E1（P2-M 守卫）、E2（N1 措辞）、E3（N2 results 形状）、E4（N3 验收覆盖）均已在现版规格落地（见 §2 核验表），无需再行修订。

---

## 5. 是否实现就绪（Readiness Judgement）

- **五轮历史发现全部闭合**：合规性与契约稳定性声明、`/health` 身份字段与 schema 编号独立性、inspect 阈值数值化与三类 blank 告警确定式互斥、页选择共享文法与来源互斥、`--all` 大文档守卫在 inspect/capture-range 的对称落地、contact-sheet 自有硬上限、stop/status 的失败 JSON 形状与退出码映射（含目标未命中的空数组契约）、默认文本输出非契约声明、默认 DPI、wrapper 对称性与 contact-sheet 两端同进同退条款，均已就位。
- **本轮无 P0/P1/P2 新发现**；唯一 N 级观察（contact-sheet `--all` × 24 硬上限的报错/截断措辞）属可选命令边角，不触及模块拆分（§6）、注册表设计（§5）、命令骨架（§4）与测试/验收骨架（§9/§10）。
- 据此判断：规格**已达高度满意的实现就绪状态**，可直接作为实现计划（§11 Rollout Order）的输入推进。E1 可在 contact-sheet 编码时一并定稿，无需再启动新的审计轮。

---

## 6. Go / No-Go

**结论：Go（放行 · 实现就绪）。**

作为实现前的最终就绪门，本审计明确表示：**对本规格高度满意，规格已实现就绪，可进入实现阶段。**

进入实现计划后唯一可选打磨项（不阻断）：

1. **本轮 N1（E1）**：在 §4.8 明确 `contact-sheet --all`/页集超 24 硬上限且未抬高 `--max-pages` 时的行为（建议「超限即非零退出、不静默截断」），与 inspect/capture-range 的 `--all` 守卫语义收口一致。

round-01 至 round-04 的全部发现（含 P1、P2-A…P2-M 与全部 N 项）均已闭合、无 P0/P1/P2 残留、inspect 告警互斥与命令族 `--all` 守卫对称性已稳固验证；规格可作为实现的直接依据。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-qa-loop/round-05.md
