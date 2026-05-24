# latexview 代理工具链审计报告

> 审计范围：`latexview` 的 CLI、HTTP 预览服务、PDF 文本检索、截图、以及 Codex / Pi 两套插件封装与技能文档。
> 审计日期：2026-05-24。
> 审计方法：逐文件静态阅读 + 运行 `npx vitest run`（25 个用例全部通过）+ 校验外部依赖与 Pi 扩展 API 文档。

---

## 1. 执行结论（Executive Conclusion）

当前 `latexview` 的核心实现质量良好：CLI 参数解析、HTTP 服务、热重载、文本检索、WebP 截图都有对应单测且全部通过；Codex（MCP）与 Pi（extension）两套封装结构清晰、可用。代码没有发现 P0 级（数据丢失 / 安全 / 崩溃）缺陷。

但面向「代理 QA 工作流」这一目标，现状存在几个明确的 P1 工程缺陷，且基本与本次提案要解决的方向重合：

- **封装层 serve 始终显式下发 `--port`，导致 CLI 自带的端口回退（EADDRINUSE fallback）被废掉**（提案 #5 的核心动机），第二个预览会直接失败而非顺延端口。
- **Pi 扩展把长生命周期的 detached 预览服务绑定到了 agent 的中止信号（`signal`）上**，当后续回合被中止 / 用户按 Esc 时，预览服务会被误杀。
- **没有任何生命周期管理（info/status/list/stop）**，serve 只返回 pid，跨工具调用无法发现 / 关闭已启动的服务，容易留下孤儿进程（提案 #1 的动机）。

提案的 6 项增强方向整体正确、值得做，但需要在若干设计点上收敛（见第 6、7 节）。结论：**Go（建议推进下一迭代）**，但要求把上述 P1 修复与新功能一起交付，并将 `contact-sheet`（依赖 ImageMagick）降级为可选项。

---

## 2. 已设计良好之处（What Is Already Well-Designed）

- **参数解析与默认值清晰**：`src/args.js` 对 `serve/find/jump/capture` 子命令分别解析，端口、页码用 `readPort`/`readPositiveInteger` 做了边界校验；`requestedPort` 字段（`src/args.js:76`）专门用于区分「用户显式指定端口」与「使用默认端口」，设计意图正确——只是封装层没有用好它（见 4.1）。
- **端口回退逻辑本身是对的**：`src/cli.js:36-61` 的 `startPreview` 在未显式指定端口且遇到 `EADDRINUSE` 时顺延端口，最多 25 次（`fallbackAttempts`），这是合理的本地体验设计。
- **HTTP 服务安全性到位**：`src/server.js` 仅服务单个 PDF；vendor 静态资源经 `safeVendorPath`（`src/server.js:61-67`）拒绝 `..` 与 `/`，避免目录穿越；默认绑定 `127.0.0.1`；支持 Range（`/document.pdf`）与 no-store 缓存头，利于热重载。
- **热重载实现稳健**：`watchFile` + SSE（`/events`）+ 客户端版本号 `?version=`（`public/client.js` 的 `loadDocument`）+ 失败重试（最多 8 次退避），并在重载时保留当前页码。
- **截图错误处理友好**：`src/capture.js:18-26` 对 `ENOENT` 给出「请安装该命令」的可读提示，并用 `mkdtemp`/`finally rm` 保证临时目录清理；输出统一规范化为 `.webp`（`src/args.js:165-172`）。
- **检索做了基本归一化**：`src/pdf-search.js` 同时用「空白归一」与「去全部空白的 compact 比较」两种方式匹配，能容忍复制文本中的空白差异（有对应单测）。
- **封装层启动握手合理**：MCP / Pi 的 serve 都通过解析 stdout 中的 `Viewer:` 行拿到真实 URL，并设 5s 超时与多事件兜底（exit/error），健壮性不错。
- **测试基线扎实**：`tests/` 覆盖 args / server / cli / pdf-search / mcp / package；自带 `tests/pdf-fixture.js` 手写最小 PDF，单测不依赖外部样本；`scripts/smoke.js` 用 Playwright 做端到端验证（缩略图、热重载、jump）。

---

## 3. 已澄清 / 非问题（Resolved / Non-Issues）

- **`scripts/smoke.js` 中的 `#thumbnail-rail` 不是 bug**：该 id 确实存在于 `public/index.html:38`（`<aside class="thumbnail-panel" id="thumbnail-rail">`），smoke 对 `thumbnail-rail` 与 `.thumbnail-card canvas` 的断言是有效的。
- **缩略图 `<= 12` 张的断言与虚拟化一致**：`public/client.js` 的缩略图采用虚拟滚动（`updateVisibleThumbnails` + overscan），只渲染可视区域，smoke 的上界断言成立。
- **`url()` 的回环地址处理正确**：`src/server.js:271-279` 在绑定 `0.0.0.0`/`::` 时回显 `127.0.0.1`，避免给出不可点的 URL。
- **外部依赖在本机可用**：`pdftoppm`、`cwebp`、`montage` 均已安装（`/opt/homebrew/bin/*`），Node 为 v25.9.0；`npx vitest run` 25 用例全绿。
- **Pi 扩展的 import / API 形态正确**：`import { Type } from 'typebox'`、`pi.registerTool({ ..., execute(toolCallId, params, signal, onUpdate, ctx) })`、返回 `{ content, details }` 均与 Pi 扩展文档一致（`docs/extensions.md` Quick Start / Custom Tools）。

---

## 4. 遗留问题（P0 / P1 / P2，含 file:line 证据）

> 未发现 P0 级问题。

### P1

**P1-1　封装层 serve 始终下发 `--port`，废掉端口回退（= 提案 #5）**
- 证据：
  - `codex/plugins/latexview/mcp/latexview-mcp.js:59-61` 与 `pi/extensions/latexview.js:33-35` 都无条件地 `args.push('--port', String(params.port ?? DEFAULT_PORT))`。
  - `src/args.js:74-77`：只要出现 `--port` 就置 `requestedPort = true`。
  - `src/cli.js:53-56`：`if (config.requestedPort || !isAddressInUse(error)) throw error;`——一旦 `requestedPort` 为真，遇到端口占用就直接抛错，不再顺延。
- 影响：用户/代理未显式指定端口时，第二次 `serve` 撞上 4545 会直接失败（封装层会在 5s 超时或子进程 exit 后 reject），而不是像直接用 CLI 那样自动顺延端口。这正是提案 #5 要修的。

**P1-2　Pi 扩展把 detached 长生命周期服务绑定到 agent 中止信号**
- 证据：`pi/extensions/latexview.js:27` 起 `startLatexviewServer(params, cwd, signal)`，在 `spawn('latexview', args, { detached: true, stdio: [...], signal })`（`:43-49`）把 `ctx.signal` 作为子进程的 abort 信号；随后虽 `child.unref()`（`:71`），但 abort 处理器仍然挂着。
- 影响：预览服务本应长期存活，但其生命周期被绑到「启动它的那次工具调用 / 当前回合」的中止信号上。后续用户按 Esc、回合被取消时，Node 会向该 detached 子进程发 SIGTERM，**服务被意外杀掉**。Codex MCP 版本没有把 signal 传给 spawn（`codex/.../latexview-mcp.js:67-71`），不受影响——两套封装行为不一致。
- 备注：`signal` 用于 `runLatexview`（find/jump/capture/help 这类短命令，`pi/extensions/latexview.js:10-14`）是合理的；只有 serve 的 spawn 不该用它。

**P1-3　缺少生命周期管理，serve 易产生孤儿进程（= 提案 #1 动机）**
- 证据：serve 工具仅返回 `{ pid, url }`（`pi/extensions/latexview.js:148-156`、`codex/.../latexview-mcp.js:139-141`）；全仓没有 `info/status/list/stop` 命令（`src/args.js`/`src/cli.js` 仅有 `serve/find/jump/capture/help`）。
- 影响：代理跨多次工具调用无法发现已启动服务、无法优雅停止；detached 进程在 MCP/Pi 退出后仍存活，累积为孤儿。现有 `/health`（`src/server.js:145-148`，返回 `{ ok, version, pdfName }`）是个很好的状态探测基座，但目前无人消费。

### P2

**P2-1　`find --json` 完全忽略 `--url`，JSON 里没有可跳转 URL，且 snippet 被强制小写**
- 证据：`src/cli.js:84-91`——`json` 分支只输出 `{ query, matches }`，根本不传 `baseUrl`；只有非 JSON 的 `formatFindResults` 才用 `baseUrl`。而 `src/pdf-search.js:4-9` 的 `normalizeText` 会 `toLowerCase()`，`makeSnippet`（`:16-26`）基于归一化文本生成片段，导致返回的 snippet 丢失原始大小写。
- 影响：两套封装默认 `json=true` 且会在用户给出 viewerUrl 时 `push('--url', ...)`（`pi/extensions/latexview.js:182-186`、`codex/.../latexview-mcp.js:159-160`），但这些 URL 在 JSON 模式下被**静默丢弃**；代理拿不到 `/?page=N` 跳转链接，snippet 也不利于人类阅读核对。

**P2-2　Pi 扩展 `latexview_capture_page` 的「委托」是死代码**
- 证据：`pi/extensions/latexview.js:319-320`：`const tool = pi.getAllTools?.().find(...); if (tool?.execute) return tool.execute(...)`。但据 `docs/extensions.md`「`pi.getAllTools()` returns `name`, `description`, `parameters`, and `sourceInfo`」——返回的是元数据，**不含 `execute`**。
- 影响：该分支永远命中不了，每次都落到下方内联实现（`:321-326`）。这造成 dpi 默认值、`normalizeWebpPath` 逻辑在多处重复（`:262-274` 与 `:321-326`、`find_text` `:340-346`），存在漂移风险。`latexview_find_text`/`latexview_capture_page` 这两个别名也仅 Pi 侧有、Codex 侧没有，两端不对称。

**P2-3　检索召回的边界：换行连字符与跨行短语**
- 证据：`src/pdf-search.js:53` 用 `content.items.map(i => i.str).join(' ')` 拼接文本，`compactText` 仅去空白（`:12-13`），未处理行尾软连字符（`-\n` / U+00AD）与连字（部分由 NFKC 覆盖）。
- 影响：对「在 PDF 里被断行/断字」的渲染文本，`find` 可能漏匹配。对一个定位为「渲染文本→页码」的工具，这是召回缺口。

**P2-4　Pi 扩展无运行时测试；技能文档两端不同步、缺 QA 工作流**
- 证据：`tests/package.test.js:44-58` 只断言扩展源码里出现工具名字符串，没有真正加载扩展、调用工具的测试（对照 `tests/mcp.test.js` 对 MCP 有真实 JSON-RPC 调用）。`pi/skills/latexview/SKILL.md` 的 workflow 仅 3 步，未覆盖「find→inspect/jump→capture→核对」的代理 QA 闭环（提案 #6 动机），也与更详细的 `codex/plugins/latexview/skills/latexview/SKILL.md` 不一致。

**P2-5　每次 `find` 都用 pdfjs 重新整本加载**
- 证据：`src/pdf-search.js:38-66` 每次调用都 `getDocument` 整本扫描后 `destroy`。
- 影响：单次 find 可接受；但一旦 `inspect`（多页）、`find --capture`（多页截图）落地，重复整本加载会放大开销。建议未来在单次命令内复用同一 document 句柄。

---

## 5. 运行验证记录

- `npx vitest run`：6 个文件 / 25 个用例全部通过（args 8、server 4、cli 5、pdf-search 3、mcp 2、package 3）。
- 外部二进制：`pdftoppm`、`cwebp`、`montage` 均可用；故 `cli.test.js`/`mcp.test.js` 中依赖 `pdftoppm`+`cwebp` 的截图用例可正常跑通。
- 未运行 `scripts/smoke.js`（依赖 Playwright/Chromium 下载，且会真实起服务），其逻辑已通过静态阅读核对，未发现选择器层面的问题（见第 3 节）。

> 无法访问的内容：无。本次审计任务清单中的全部文件均已读取。

---

## 6. 对提案增强的逐项评审（Critique of Proposed Enhancements）

### 提案 #1：`info/status/list/stop`
- 方向正确，直击 P1-3。但 `info` 一词被「服务生命周期」与「PDF 元数据」两件事撑得过重，建议拆分语义：
  - `info <pdf>`：**纯 PDF 元数据**（页数、首页/各页尺寸、标题、文件大小、mtime），不涉及服务。
  - `status [--url]`：探测某个 viewer 的健康（直接复用现成的 `/health`，`src/server.js:145-148`）。
  - `list`：列出本机已知的运行中服务。
  - `stop [--url|--port|--all]`：优雅停止。
- 关键设计约束：`list/stop` 需要一个**服务注册表**，因为服务是 detached 进程，跨调用无法靠内存追踪。仅靠 pid 杀进程有 **pid 复用** 风险——`stop` 前必须先用 `/health` 校验该端口确实是 latexview（比对 `pdfName`/`version`）再发信号，并跨平台处理 kill。

### 提案 #2：`inspect`
- 对代理 QA 很有价值。需要收敛的点：
  - **空白页检测不能只看 text length**：纯图/插图页文本长度为 0 会误报，封面页文本极短也会误报。建议「文本长度阈值 + 渲染像素覆盖率」双信号（像素侧可复用 `capture` 的 pdftoppm 渲染再采样非白像素，思路同 `scripts/smoke.js` 的 nonWhitePixels）。
  - **定义清晰的 warning 分类**：如 `blank`、`near-blank`、`oversize-page`、`text-extraction-empty`，让代理可程序化判断。
  - **页选择必须有界**：`--pages`/`--range`/`--all`，且对 `--all` 设上限或要求显式确认，避免上千页 inspect。
  - **截图必须 opt-in**（`--capture`），并复用单个 pdfjs document（呼应 P2-5）。
  - **输出 JSON 优先**，字段稳定，便于代理消费。

### 提案 #3：`capture-range` 与 / 或 `contact-sheet`
- `capture-range` 推荐作为主力：`pdftoppm` 一次可渲染连续范围（去掉 `-singlefile`，用 `-f a -l b`），再逐张 `cwebp`，返回路径列表；性能优于循环单页。
- `contact-sheet` 引入 **ImageMagick `montage` 新外部依赖**（本机有，但不可假定通用）。建议：作为可选功能，运行前做依赖探测，缺失时给出可执行的安装提示而非崩溃；或用已有工具链合成。对两者都要限制总页数 / 总体积，避免超大产物。

### 提案 #4：更好的 `find`
- `--jump-if-unique`：好。语义须明确——**仅当恰好 1 个匹配且已知 viewer URL 时**才跳转；0 个或多个匹配时安静地不跳并照常返回候选。
- 上下文 snippet：**务必修复 P2-1 的小写问题**，保留原始大小写（用原文 substring 而非归一化文本）。
- 归一化：在现有 NFKC + 空白归一基础上，增加行尾软连字符 / 断字处理（呼应 P2-3）。
- 可选候选截图：opt-in、限量、把路径写进 JSON。
- **顺带修复 JSON 输出**：当提供 `--url` 时，JSON 的每个 match 应带 `url`（`/?page=N`），并加上 `count` 字段。

### 提案 #5：修复封装层 serve 端口回退
- 正确修法：**仅当用户显式传了 port 时才向 CLI 下发 `--port`**；否则省略，让 `requestedPort` 保持 false、回退逻辑生效（`src/cli.js:53-56`）。两套封装（Codex MCP 与 Pi）都要改。
- 一并修 P1-2：Pi 扩展的 serve **不要把 `ctx.signal` 传给 detached spawn**，改由 `stop` 管理生命周期。
- 回显真实端口（已能从 stdout `Viewer:` 解析），并在文档里说明 `--port 0` 可取随机空闲端口。

### 提案 #6：技能文档补充代理 QA 工作流
- 应当做，且两端 SKILL 保持同步。建议明确写出闭环：`find`（长片段）→ `inspect`/`jump` 定位 → `capture`/`capture-range` 取图供视觉核对 → 解读 warning（空白/异常）→ 在回答里回贴页码与图片路径。并说明默认端口与回退行为。

---

## 7. 下一迭代的具体设计建议（Recommended Design）

1. **服务注册表（支撑 list/stop/status）**
   - serve 启动成功后，向状态目录（如 `os.tmpdir()/latexview/servers/<port>.json`）写入 `{ pdfPath, host, port, url, pid, startedAt, version }`。
   - `list`：读取目录，对每条记录打 `/health`，剔除失活项后返回。
   - `status [--url]`：直接打 `/health` 返回 `{ ok, version, pdfName }`。
   - `stop [--url|--port|--all]`：先 `/health` 校验是 latexview（比对 `pdfName`/`version`）再 SIGTERM；跨平台；删注册项。

2. **`info <pdf>`（纯元数据，复用 pdfjs，输出 JSON）**：`numPages`、各页尺寸（pt）、`Title`/元信息、文件大小与 mtime。

3. **`inspect [--pages|--range|--all] [--capture] [--dpi] [--json] <pdf>`**：单次加载 document；逐页给 `width/height`、`textLength`、`blank` 判定（文本阈值 + 可选像素覆盖率）、可选 `capturePath`、`warnings[]`；页数有界；JSON 优先。

4. **`capture-range [--from a --to b] [--dpi] [--out-dir] <pdf>`**：一次 pdftoppm 渲染范围 + 逐张 cwebp；返回路径数组。`contact-sheet` 作为可选项，先探测 `montage` 再执行。

5. **`find` 增强**：保留原始大小写 snippet；soft-hyphen/断行归一；`--jump-if-unique`；`--capture`（限量）；JSON 中补 `url` 与 `count`。

6. **封装层修复（两端对称）**：
   - serve 仅在显式指定时下发 `--port`；
   - Pi serve 的 spawn 去掉 `signal`；
   - 把 `info/status/list/stop/inspect/capture-range` 同时暴露到 Codex MCP 与 Pi；
   - 抽出共享 helper（`normalizeWebpPath`、默认 dpi 等）消除重复与漂移；移除或修正 `latexview_capture_page` 的死委托（P2-2）。

---

## 8. 测试建议（Testing Recommendations）

- **args 单测**：新增 `info/inspect/capture-range/contact-sheet` 解析；`--pages`/`--range`/`--from/--to`/`--jump-if-unique`/`--capture` 的取值与错误分支。
- **pdf-search 单测**：snippet 保留大小写；断行/软连字符场景能命中；`--jump-if-unique` 在 0/1/多匹配下的行为；JSON 含 `url` 与 `count`。
- **cli 单测**：`inspect --json` 的字段形状（用一个「近空白页」fixture 验证 blank 判定）；`capture-range` 生成 N 张 webp；`info` 元数据正确。
- **生命周期单测**：注册表写/读；`status` 对 `/health` 的解析；`stop` 仅在 `/health` 校验通过后才杀进程（用假 pid 验证不会误杀）；失活项剪枝。
- **回归测试（P1-1）**：未显式指定端口时，封装层**不**下发 `--port`；可起两个默认端口服务，断言第二个顺延成功。
- **回归测试（P1-2）**：Pi 扩展 serve 后中止其 `signal`，断言服务仍存活（修复前应失败）。
- **Pi 扩展运行时测试**：当前仅有字符串存在性断言（`tests/package.test.js`），应补一个真正加载扩展并调用工具的用例（对齐 `tests/mcp.test.js` 的覆盖水平）。
- **外部依赖守卫**：依赖 `pdftoppm`/`cwebp`/`montage` 的用例用 `test.skipIf`（命令缺失时跳过），`contact-sheet` 在缺 `montage` 时跳过，避免 CI 抖动。

---

## 9. Go / No-Go

**结论：Go（推进下一迭代）**，附带以下条件：

1. **P1 优先**：与新功能同批交付 #5（两端 serve 端口回退修复）、P1-2（Pi serve 解绑 signal）、以及 #1 的 `stop`（避免孤儿进程）；这些直接影响代理实际可用性。
2. **`inspect` / `capture-range` / `find` 增强**：按第 7 节落地，统一 JSON 优先、页数有界、截图 opt-in。
3. **`contact-sheet` 降级为可选 / 可延后**：必须带 `montage` 依赖探测与优雅降级，不得成为硬依赖。
4. **两端封装与 SKILL 文档保持对称同步**，并补齐 Pi 扩展运行时测试与代理 QA 工作流文档。

满足以上条件即可放行实现。

---

deliverable: /Users/lucas/Developer/latexview/docs/audits/agent-tooling-audit.md
