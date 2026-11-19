# ∞ 回廊 · §8 联调验收核对表

> 维护：qa-release（QA / 发布工程师，T5）｜硬截止：**2026/11/30 18:00**（Qoder 高校创造力大赛）
> 依据：《AI竞赛-回廊开发提示词.md》「## 8. 联调验收清单」

## 使用说明与状态约定

- 下表把提示词 §8 的 **8 条清单逐项抄录**，每条标注「验证方式 / 命令 / 负责人 / 状态 / 当前依据」。
- **状态初始为「待集成」**：qa-release 的职责是准备验收资产，**不自行宣告通过**。gen-dev(M2)、
  theme-dev(M3) 曾与本文档并行改动代码，最终集成验收由**开发总监在三方汇合后亲自复跑**。
- **2026-11-17 复跑结论（开发总监）**：`node tests/smoke.js` = 20/20、`node tests/m2m3.js` = 58/0/0，
  四条降级、**360 组模板×主题校验（M5 后由 180 组升级）**、三套新词表、geometry 零回归全部通过；核实 `C.theme.active()`
  返回 id 字符串、`C.theme.get(opts.theme)` 链路可正确命中，四主题切换不会静默回落。
  **§8 第 1–5 条（自动化可覆盖）转为「通过」；第 6–8 条仍需人工试玩 / 录制 90 秒视频 / 大赛提交，保持待办。**
- **2026-11-17 浏览器实拍验证（开发总监）**：用 Edge 无头 + CDP 真实点击「进入回廊」与主题按钮，
  确认四主题选择器生效、开局成功、换主题后房间 / boss 命名与 HUD 标签同步、零 JS 异常；
  详见文末「附录：浏览器实拍验证」。这是第 6 条的**自动化部分**证据，不替代人工计时与手感试玩。
- **2026-11-17 M5「全套」集成验收结论（开发总监）**：T24–T28 五个并行会话汇合后，
  总监亲自修复 7 处跨层缺口并复跑三条命令：`smoke.js` 20/20、`m2m3.js` 58/0/0、
  新增 `tests/fullsuite.js` **46/46**；四套主题经不占端口的一次性无头截图确认视觉分化。
  §8 第 1–5 条维持「通过」，第 6–8 条仍为人工项（真人计时 / 90 秒视频 / 大赛提交）。
  详见文末「附录：M5 全套集成验收」。
- **2026-11-18《项目修改需求整理》B 板块修复（开发总监）**：用户提供的需求文档存在 6 处术语错位
  （「四地图 / 3 层关卡 / 局外科技树 / 奖励箱」等均不在当前代码库），总监逐条核到真实代码后，
  按用户选定范围「先修确证的 Bug」落地 B1–B9 共 8 条低风险修复（B2 与 B3 同源合并）。
  复跑 `smoke 20/20`、`m2m3 58/0/0`、新增 §A7 后 `fullsuite 63/63`；四张一次性无头实拍确认 HUD /
  暂停面板 / 词条卡 / 解锁页视觉正常，**零端口占用、零后台进程**。逐条对照见
  `docs/requirements-2026-11-18.md`，修复明细见文末「附录：B 板块修复」。
- **2026-11-19 版本对齐与二次验收（开发总监）**：队友在 `Luciandeng` 分支提交 2 个新提交
  （`14e2514` / `dc98810`，共 53 文件 +2470/−1181），新增单房 A/B 试玩、廊道回扫、击飞接力、
  走位提示与新版界面，并补齐 B1 的**可达区域**缺陷（本轮 B1 只排除了墙重叠，封闭墙圈内部仍会
  刷怪死档）。总监不采信自报数字：自行实现 20px 网格 BFS 抽样 **320 局 / 861 个敌人**，
  墙内 / 不可达 / 中心 / 贴脸 / 敌间重叠五类缺陷全部为 0 → PASS。实跑新基线
  `smoke 20/20`、`m2m3 58/0/0`、`fullsuite 78/78`、`impact 21/21`、`recall 9/9`、
  `combat-guide 5/5`、`enemy-trial 25/25`。详见文末「附录：2026-11-19 版本对齐」。
- **2026-11-19 回廊长局本体改造（开发总监）**：用户明确要求不再停留在 Plan / 文档 / 验收包，
  直接做游戏本体玩法优化，并授权大改玩法与底层引擎。本轮新增 `src/core/loop.js` 规则层，
  泛化 `recall.js`，在 `engine.js` 接入长局状态机，把「绕一圈，从另一侧回击」从单房原型
  升级为**主模式「回廊长局」**（三层 × 三间 + 层末巡廊首领、路线词条、长短圈 / 折角分流、
  连扫蓄势、射击退为牵制、层末存档续玩），并接线首页 / HUD / 词条页 / 渲染 / 主循环。
  新增 `tests/loop.js` **16/16**，八套基线全绿；验证全程纯 Node + DOM stub，
  **零端口、零后台进程、零浏览器操作**。详见文末「附录：回廊长局本体改造验收」。
- **2026-11-19 M8 整体美术风格大改（开发总监）**：用户选定「整体美术风格都需要大改」，
  本轮直接改渲染层与界面，不产出 Plan / 验收包。诊断出 `VISUALS` 里 `bgStyle` / `postFx`
  等参数**从未接进渲染**，四套主题实际只差网格间距；CSS 是「荧光绿控制台」、Canvas 是
  「夜光制图」、另有米黄套印版，三套语言打架。本轮统一为「深蓝测绘图」：
  `src/theme/index.js` 色板/材质层、`src/ui/render.js` 与 `src/ui/style.css` 全量重写，
  四套主题真正换材质与后处理，界面经 `#app[data-theme]` 同步换色。
  八套基线全绿 + 工作区一次性渲染探针 **13 场景 PASS**（四主题首页最小差异 78 个色值、
  长局 121），验证全程纯 Node / DOM stub，**零端口、零后台进程、零浏览器操作**。
  详见文末「附录：M8 整体美术风格大改验收」。
- 「当前依据」只记录当前代码快照下自动化测试的客观结果，供总监复跑时比对，**不替代验收结论**。
- 相关资产：`tests/smoke.js`（M1 基线，20/20，禁止改动）、`tests/m2m3.js`（M4 验收资产）、
  `tests/fullsuite.js`（M5 跨层接线 + 节奏量化 + 2026-11-18 §A7 B 板块回归 + 队友 B1 固定用例）、
  `tests/recall.js` / `tests/impact.js` / `tests/enemy-trial.js` / `tests/combat-guide.js` /
  `tests/loop.js`（M7 回廊长局 16 项端到端回归）、工作区一次性 `probe-visual.cjs`
  （M8 渲染层真实调用探针，未入仓库、可复跑）、
  `docs/demo-90s.md`（90 秒高光蒙太奇与记录表）、`docs/requirements-2026-11-18.md`（需求台账，
  含 2026-11-19 版本对齐章节）、`docs/参赛改进与美术方向.md`（玩法重设计与验收口径）、
  `docs/盲玩验收包.md` + `盲玩交接卡.html` + `盲玩记录表.csv`（2026-11-19 新增真人盲玩验收三件套，
  **只提供工具与阈值，不产出验收结论**）。

### 当前集成快照（供比对，非验收结论）

| 项 | 值 |
|---|---|
| 代码基线 | `origin/main` = `c1d81e7`（Merge PR #1）；当前工作分支 `Luciandeng` = `dc98810`，比 `origin/main` 多 2 个未合并提交 |
| 新增模块 / 资产 | `src/core/recall.js` / `impact.js` / `enemy-trial.js` / **`loop.js`**、`src/ui/combat-guide.js`；5 套新测试；4 份设计资料与 `ab-evidence` / `ui-evidence` 证据截图 |
| `node tests/smoke.js` | **20 passed / 0 failed**（冻结基线未动） |
| `node tests/m2m3.js` | **58 passed / 0 failed / 0 waiting**（含 360/360 组 validate、四类降级均 `source='fallback'`） |
| `node tests/fullsuite.js` | **78 passed / 0 failed**（原 63 项 + 队友新增的 B1 封闭墙圈固定用例等） |
| `node --test tests/impact.js` | **21/21**（近远程击飞、一次加点、墙角与重开） |
| `node --test tests/recall.js` | **9/9**（廊道回扫、站位 A/B、首领和重开） |
| `node --test tests/combat-guide.js` | **5/5**（走位提示、出手条件及清除时机） |
| `node --test tests/enemy-trial.js` | **25/25**（单房 A/B、预警、恢复和两种预设） |
| `node --test tests/loop.js` | **16/16**（M7：廊道几何 / 三层编排 / 闭环与波 / 存档 / 端到端 / UI 接线） |
| 渲染层真实调用探针 | **13 场景 PASS**：四套主题 × 首页 / 长局，加经典 / 回扫原型 / 击飞 / 单房 / print 方向；四主题首页最小差异 78 个色值、长局 121，证明材质配置确实进入画面 |
| 浏览器实拍 | M5 四主题战斗画面 + 2026-11-18 `hud / pause / perk / unlock` 四张一次性无头截图 + 队友 `ui-evidence` 两种视口 8/8；不起端口 / 不起后台进程 |
| 备注 | 2026-11-17 完成 M5 集成验收；2026-11-18 完成 B 板块 8 条修复；2026-11-19 队友补齐 B1 可达区域缺陷、总监独立复核 320 局 PASS；**同日完成 M7 回廊长局本体改造（`loop 16/16`）与 M8 整体美术风格大改（渲染探针 13 场景 PASS）**。单局 240s±30s 属真人手感范畴，理论模型与 Node 端到端均不作为手感 / 观感验收结论；**真人盲玩（6–8 人）、扩首层真人复核、90 秒分镜按新玩法重剪、真人观感确认、Qoder Sites 提交仍待办** |

---

## §8 清单逐项核对

### 第 1 条

> 校验器能拒绝一段故意写错的 JSON（多字段 / 枚举越界 / 自造 id）

| 项 | 内容 |
|---|---|
| 验证方式 | 构造多字段 / 枚举越界 / 自造 id / 重复词条对 / threat 非单调 / summary 含元信息词的关卡 JSON，逐一断言 `schema.validate()` 返回 `ok:false` |
| 命令 | `node tests/smoke.js`（第 4 节）、`node tests/m2m3.js`（② schema 校验失败降级） |
| 负责人 | qa-release（资产）、gen-dev（校验器实现）；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `smoke.js` §4 六个拒绝用例全过；`m2m3.js` ② 注入非法关卡后稳定降级为 `source='fallback'` |

### 第 2 条

> 断网、超时、返回纯文本、返回被代码块包裹的 JSON，四种情况都能降级

| 项 | 内容 |
|---|---|
| 验证方式 | ① `m2m3.js` ② 覆盖任务 T5 口径的四类：未配置 / 超时 / 返回非法或纯文本 JSON / schema 校验失败，均断言 `source='fallback'` 且降级关卡通过 `validate`；② `smoke.js` §5 覆盖 `extractJson` 对代码块包裹 / 前后缀说明 / 纯 JSON / 纯文本四种返回形态；③ 手动 DevTools 断网、改 endpoint 制造超时 |
| 命令 | `node tests/m2m3.js`（② 四类降级，超时场景真实走 8s `AbortController`）、`node tests/smoke.js`（§5） |
| 负责人 | qa-release（资产）、gen-dev（M2 降级链路 / 8s 超时）；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `m2m3.js` ②：未配置（开启但缺 endpoint/apiKey/model，且未发网络请求）、超时（AbortError 触发降级）、非法/纯文本 JSON、schema 失败，四类全部 `source='fallback'` 且关卡合法；§8 原文的「代码块包裹」由 `smoke.js` §5 `extractJson` 覆盖 |
| 口径差异 | 提示词 §8 为「断网/超时/纯文本/代码块包裹」，任务 T5 为「未配置/超时/非法或纯文本 JSON/schema 失败」；两套口径由 `smoke.js` §5 + `m2m3.js` ② 合并覆盖，如实并列，不互相替代 |

### 第 3 条

> 3 套降级模板轮换生效，连续失败三次不会三局一模一样

| 项 | 内容 |
|---|---|
| 验证方式 | **提示词原文为「3 套降级模板」，M5 扩容为 6 套（3–8 房）**，验证口径同步升级：6 模板 × 4 主题 × 5 难度 × 3 seed 共 360 组全部通过 `validate`；手动连续三次制造降级失败，肉眼比对房间数 / threat 序列不雷同。口径差异如实并列，不以扩容后的结果冒充原提示词的 3 套 |
| 命令 | `node tests/smoke.js`（§1）、`node tests/m2m3.js`（③ 360 组） |
| 负责人 | qa-release（资产）、gen-dev（模板轮换与按主题重映射）、theme-dev（词表）；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `smoke.js` §1 全过；`m2m3.js` ③ **6 模板 × 4 主题 × 5 难度 × 3 seed = 360/360**；`fullsuite.js` §B1 另采样 96 局，房间数分布覆盖 3–8 房且 6/7/8 房长局均出现 |

### 第 4 条

> 连开 5 局：房间数、threat 序列、perk_choices 组合不重复

| 项 | 内容 |
|---|---|
| 验证方式 | 连开 5 局，按「房间数 / threat 序列 / perk_choices 组合」拼签名，断言 5 个签名互不相同且每局通过 `validate`；另手动试玩连开 5 局核对体感 |
| 命令 | `node tests/smoke.js`（§3） |
| 负责人 | qa-release（资产）、全队试玩；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `smoke.js` §3 两断言（5 局全过校验、5 个签名互不重复）全过 |

### 第 5 条

> 词条效果全部走 id 查表，关卡 JSON 里没有硬编码效果数值

| 项 | 内容 |
|---|---|
| 验证方式 | `core/perks.js` 的 `derive()` 派生值与词条表一致；关卡 JSON 任一房间对象不含 `effect` 等数值字段；人工审阅 `src/core/perks.js` 与 `src/gen/schema.js` 白名单 |
| 命令 | `node tests/smoke.js`（§6 词条查表）＋人工代码审阅 |
| 负责人 | qa-release（资产）、gen-dev（schema 白名单 / 查表）；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `smoke.js` §6 四个断言（疾步 0.64 / 硬壳 120 / 锐眼 0.15 / 关卡 JSON 不含 effect 字段）全过 |

### 第 6 条

> 单局 3–5 分钟，死亡后一键重开，localStorage 进度正确

| 项 | 内容 |
|---|---|
| 验证方式 | 人工试玩计时单局时长（**目标口径已由提示词的 3–5 分钟收紧为用户要求的 240s ± 30s**）；死亡后按 `R` / `Enter` 一键重开；DevTools → Application → Local Storage 核对 `corridor.meta.v1` 与 `corridor.theme.v1`、`corridor.llm.v1`；记录表见 `docs/demo-90s.md` §3 |
| 命令 | 手动试玩（自动化无法覆盖手感与时长）；`node tests/fullsuite.js` §B3 间接覆盖状态机可达性 |
| 负责人 | 全队试玩、qa-release（记录表）；复跑：开发总监 |
| 状态 | ⏳ 待办 · 人工试玩（自动化无法覆盖） |
| 当前依据 | 需人工试玩与真机计时，当前未采样，**240s ± 30s 尚未验收**。`fullsuite.js` §B2 给出可复算的理论模型（96 局真实 HP 采样 + 命中率敏感性）：h=0.55 时 6 房约 218s 落入窗口、7 房约 313s、8 房约 376s 偏长；命中率属真人手感范畴，Node 无法测定，**该模型不是验收结论**。§B3 已用真实 `engine.update()` 帧循环验证 6–8 房 + Boss 两阶段 + 结算状态机可达、事件链完整、零异常。浏览器实拍另确认开局成功、四主题选择器生效、切主题后画面与 HUD 同步、零 JS 异常 |

### 第 7 条

> 90 秒演示视频录到两局不同关卡；记录重开率与单局时长

| 项 | 内容 |
|---|---|
| 验证方式 | 按 `docs/demo-90s.md` 分镜录制 90 秒视频，两局须**主题不同**且**房间数 / threat 序列 / perk_choices 组合不同**；用脚本内记录表登记重开率与单局时长 |
| 命令 | 分镜与记录表：`docs/demo-90s.md`；录制前置：开始页主题选择器切换主题（键 `corridor.theme.v1`） |
| 负责人 | qa-release（分镜 / 录制建议）、开发总监（提交视频） |
| 状态 | ⏳ 待办 · 录制 90 秒视频 |
| 当前依据 | `docs/demo-90s.md` 已重构为 **v2 高光蒙太奇**（6 个爆点片段、过程全跳剪、两局差异用 HUD 特写同框），口径改为 240s ± 30s；视频尚未录制。录制前置：四套主题独立色板与重映射均已联调（`m2m3.js` ③ 360/360、`fullsuite.js` 46/46、四主题实拍确认） |

### 第 8 条

> 11/30 18:00 前完成 Qoder 高校创造力大赛提交

| 项 | 内容 |
|---|---|
| 验证方式 | 核对提交物（代码、90 秒视频、README、验收表）齐备，由开发总监统一执行提交并确认回执时间早于硬截止 |
| 命令 | 提交动作（`git add` / `git commit` / `git push`）**由开发总监统一执行**；qa-release **严禁**执行 `git add/commit/push` 及运行 `push-to-github.bat` |
| 负责人 | 开发总监（唯一提交人） |
| 状态 | ⏳ 待办 · 大赛提交（开发总监） |
| 当前依据 | 硬截止 2026/11/30 18:00；代码阶段性进展按约定推 GitHub，大赛作品提交仍需视频等交付物齐备 |

---

## 附录：交付给总监的「待复跑命令清单」

> 三方汇合后，由开发总监在项目根目录 `D:/SrcCode/Competition/corridor` 依次复跑：

```bash
# 1) M1 基线（必须保持 20/20，不得改动 tests/smoke.js）
node tests/smoke.js

# 2) M4 集成验收资产（期望 0 failed / 0 waiting；超时场景会真实等待约 8 秒）
node tests/m2m3.js

# 3) M5「全套」跨层接线 + 节奏量化（期望 0 failed；纯 Node，零端口）
node tests/fullsuite.js

# 4) 人工项（自动化无法覆盖，需真机试玩 / 录制）
#    - 断网 / 超时 / 非法返回：DevTools 手动制造，确认 8 秒内降级、开局不阻塞
#    - 连开 5 局：房间数 / threat 序列 / perk_choices 组合不重复
#    - 单局 240s ± 30s、死亡后 R/Enter 一键重开、localStorage 进度正确
#    - 按 docs/demo-90s.md v2 录制 90 秒高光蒙太奇，填「重开率 / 单局时长」记录表
```

2026-11-17 开发总监复跑完成：第 1–5 条已转「通过」并署名，第 6–8 条如实保留待办。
任一 `FAIL` / `WAIT` 须回到对应负责人修复后重跑，**不得以修改 `src/**` 或 `tests/smoke.js` 的方式让测试变绿**。

---

## 附录：浏览器实拍验证（2026-11-17 · 开发总监）

> 目的：验证 M2/M3 在**真实浏览器链路**（而非仅 Node 单测）下可用。方式为 Edge 无头 + CDP
> 真实点击开始页按钮；验证结束后本地服务与调试端口均已关闭，未留下后台进程。

| 项 | 结果 |
|---|---|
| 页面加载 | `file://` 与内置预览均可正常加载，`window.Corridor` 就绪，`themes = geometry/oldtown/subject/wudang` |
| 主题选择器 | 四枚按钮齐全，默认 `geometry`；点击「旧城」后 `active()` 变为 `oldtown`，按钮高亮同步 |
| 开局（几何） | `phase:playing`、5 房、threat `1,2,3,4,5`、房间「折廊」、boss「闭域」、`source:fallback`、HP 100 |
| 开局（旧城，真实点击流程） | `phase:playing`、`theme:oldtown`、4 房、房间「旧钟楼」、boss「拆墙人」、HUD 主题标签「旧城」、`source:fallback` |
| JS 异常 | `Runtime.exceptionThrown` / console error 均为 **0** |
| 结论 | 主题切换 → `startRun()` → `templates.reseed` 按主题重映射 → `schema.validate` → 渲染 全链路通；命名素材与 HUD 标签随主题正确变化 |

说明：初次曾出现「切到旧城但 HUD 仍显示抽象几何」，经核查为验证脚本直接调用
`C.theme.setActive()` 绕过 UI 点击、未触发 `syncThemeUI()` 所致；按真实点击流程复验后 HUD 正确显示「旧城」，
**非产品缺陷**。（`screens.js` 的 `themeLabel` 为点击时缓存值，将来若从结算页等非开始页入口切换主题，需同步刷新该缓存。）

截图留存：`D:/SrcCode/Competition/shot-start.png`（开始页）、`shot-play.png`（几何战斗）、
`shot-oldtown-real.png`（旧城战斗，真实点击流程）。截图为本地临时产物，未纳入仓库。

---

## 附录：M5「全套」集成验收（2026-11-17 · 开发总监）

> 背景：用户要求「美术大改 / 轮数太少 / 90s 不等于录全程 / 单条命 4 分钟 / 不够爽」，
> 选择「直接上全套」。总监按文件所有权并行拉起 `logic-dev` / `gen-dev` / `visual-dev` / `ui-dev`
> 四个会话（T24–T27），四方自报完成后**不采信自报数字**，先做磁盘级验收再逐项修复。

### 一、四方落盘核对

- `git status --short`：11 个文件修改，全部在各自独占范围内；`tests/smoke.js`、`core/audio.js` 冻结未动。
- 基础复跑：`smoke.js` 20/20、`m2m3.js` 58/0/0、11 个 JS `node --check` 全通过。
- 结论：**代码写了 ≠ 链路通了**。四方报告与静态 grep 共同暴露 5 处跨层缺口，
  加上浏览器实拍发现的 2 处 UI 瑕疵，共 7 处，全部由总监修复。

### 二、7 处跨层缺口与修复（逐项可核对）

| # | 缺口 | 后果 | 修复落点 |
|---|---|---|---|
| 1 | `style.css` 无 `#perk-cards[data-count="3"]` / `.perk-mechanic` / `.perk-synergy` / `.hud-extra` | 三选一变 2+1 畸形布局，新 UI 元素裸奔 | `src/ui/style.css` 追加三列规则与徽标 / 协同 / HUD 样式 |
| 2 | `perks.js` 只有引擎内部 `synergies(state)`，UI 期待 `synergyHint()` / `SYNERGIES` / `TABLE[id].synergy` | **4 个协同词条的「组合质变」玩家完全看不见** | `src/core/perks.js` 表外注入 `SYNERGIES` 关系表 + `MECHANIC` + `synergyHint()`；冻结区字面值一行未动 |
| 3 | 机制层 10 词条无 `mechanic` 字段，`mechanicBadge()` 读不到 | 三层构筑在卡面无区分 | 同上 `MECHANIC` 注入 |
| 4 | `render.js` 的 `ROOM_LABEL` 含 `normal`，而引擎缺省与 Boss 房都设为 `normal` | 普通房 / Boss 房常驻「普通间」徽标，纯噪音 | `src/ui/render.js` 仅保留 `elite/event/rest` |
| 5 | `engine.js` 发 `roomEvent`，`main.js` 无 case 且不识别该关键字 | 休整回血 / 事件给金币**无任何反馈** | `src/ui/main.js` 新增精确 `case 'roomEvent'`；同时 `roomEnter(normal)` / HUD 不再刷「普通房」 |
| 6 | 主题标签 append 进 230px 的 `.hud-stats` | 实拍确认右上角中文折行错乱 | `src/ui/screens.js` 改为独占一行 |
| 7 | HUD 主题标签依赖 `syncThemeUI()` 缓存 | 非开始页 / 程序化切主题时标签停留旧值 | `src/ui/screens.js` 的 `updateHud()` 改为实时读 `C.theme.active()` |

另同步修正 `core/engine.js` 顶部注释：schema 已由 3–5 房扩到 **3–8 房**、6 套模板，
并注明 `tests/fullsuite.js` 的理论模型**不得冒充真人计时结论**。

### 三、新增验收资产 `tests/fullsuite.js`

纯 Node、零依赖、零构建、**不起端口 / 不起后台进程**。用轻量 DOM stub 按 `index.html`
顺序加载全部 11 个脚本，真实调用 `screens` / `main` 的弹窗与事件路径：

- §A（34 项）：24 词条与三层接口、冻结区三个派生值零回归、协同提示非空 /
  无搭档返回空、三选一生成 3 张卡且含机制徽标与协同提示、`roomEvent` /
  `bossPhase` toast、HUD 主题实时同步、CSS 与事件静态契约、6 套模板与 schema 3–8。
- §B1：6 模板 × 4 主题共 **96 局**采样，房间数分布覆盖 3–8 房，房间分型与 Boss 校准确认。
- §B2：按 `calibrate()` 同一公式算整局真实敌人 HP，给出命中率 0.25 / 0.35 / 0.55
  三档可复算时长区间；**明确标注为理论估算，不做达标 PASS/FAIL 判定**。
- §B3：真实 `engine.update()` 帧循环（Boss 房改用真实子弹逐发命中以走 `damageEnemy()`
  的 50% 血判定），验证 6–8 房 + 每房一次选词条 + Boss 两阶段 + `won` 状态机可达、
  事件链完整、C5 字段齐备、零异常。

**结果：46 passed / 0 failed。**

### 四、四主题视觉实拍（不占端口）

方式：一次性 Edge 无头截图，直接 `file://` 打开，**不开 HTTP 服务、不开调试端口、
不起后台进程、跑完即退**；诊断页手动驱动 200 帧使画面真实跑起来（非静态摆拍）。

| 主题 | 实拍画面 |
|---|---|
| geometry 抽象几何 | 纯深色底、灰色方块墙、青绿圆环玩家 |
| oldtown 旧城 | 砖墙网格纹理、暖橙光晕、橙色圆环、柱状墙 |
| subject 学科 | 冷蓝方格纸 + Σ/√/∅/∫ 符号水印、冷蓝血条 |
| wudang 武当 | 山峦曲线留白、灰青主色、波浪地平线 |

结论：**四套主题不再只换文案**，色板、背景构图、造型与后处理均分化；
HUD 右上角「主题 旧城」排版整齐、标签实时同步（修复 #6 / #7 已验证）。
截图为工作区临时产物，未纳入仓库。

### 五、4 分钟目标的如实结论

用户要求单条命通关约 4 分钟。理论模型（h=0.55 均值）：
**6 房约 218s 落在 240s ± 30s 窗口；7 房约 313s、8 房约 376s 偏长。**
命中率属真人手感范畴，Node 无法测定，因此 **240s ± 30s 尚未验收**，
须按 `docs/demo-90s.md` §3.2 记录表人工计时。若实测确认长局偏长，
校准旋钮为 `src/core/perks.js` 的 `BALANCE.hpBase / hpProgress / bossHpMul`。

### 六、仍待办（不因本轮集成而结案）

- §8 第 6–8 条：真人试玩计时 / 重开率 / 90 秒视频 / 大赛提交。
- **提交形态缺口**：官方要求 Qoder Sites 公网地址 + 作品帖五部分介绍 + 截图凭证；
  当前只有 GitHub + `file://`，须用户确认 Qoder 账号与部署路径后推进，总监不擅自公网发布。
- `git add` / `commit` / `push` 由总监统一执行。

---

## 附录：《项目修改需求整理》B 板块修复（2026-11-18）

来源：用户提供的 `C:/Users/Administrator/Downloads/项目修改需求整理.md`（原文注明 11/19 前后作者还会追加）。
**完整逐条对照、术语错位说明与 M/N 排期见 `docs/requirements-2026-11-18.md`。**

### 一、范围决策

用户选定「先修确证的 Bug」：只做 B 板块低风险修复，不碰数值与架构，一次提交；
M2 的「长局 + 存档」作为**已定方向**写进台账排下一轮，本轮不改任何数值常量。

### 二、8 条修复落点

| # | 修复 | 文件 |
|---|---|---|
| B1 | `spawnValid()` 统一校验出生点（边界 / 墙体 / 中心 120px 禁区 / 玩家 170px 安全距离）+ 固定候选点扫描 + 网格兜底 | `src/core/engine.js` |
| B2 | 定格期间照常递减 `invuln / fireCd / dashCd` | `src/core/engine.js` |
| B3 | 普通命中不再定格、震屏 3.5→1.6；定格只留给暴击 / 击杀并封顶 0.05 / 0.06 | `src/core/engine.js` |
| B4 | `static` 敌人改为固定炮台，每 1.5–2.3s 向玩家发弹 | `src/core/engine.js` |
| B5 | HUD 紧凑化 + 半透明渐变 + `pointer-events:none`（交互控件放行） | `src/ui/style.css` |
| B6 | 解锁页头部 `#unlock-close`（×），与底部返回共用 `backFromUnlock()` | `index.html` / `src/ui/screens.js` / `src/ui/style.css` |
| B7 | Esc 按 `screens.current()` 分流，弹窗内不叠加暂停；主循环在暂停 / 弹窗期间只重绘不推进 | `src/ui/screens.js` / `src/ui/main.js` |
| B8 | 词条卡移除英文函数 id `<div class="perk-id">` 及对应 CSS | `src/ui/screens.js` / `src/ui/style.css` |
| B9 | 新增 `#screen-pause`（继续 / 重开本局 / 返回开始页）；`begin()` 完成后强制 `paused=false` | `index.html` / `src/ui/main.js` / `src/ui/screens.js` / `src/ui/style.css` |

### 三、验收结果

- `node --check`（全部 `src/**` + `tests/**`）通过。
- `node tests/smoke.js` **20/20**；`node tests/m2m3.js` **58/0/0**；`node tests/fullsuite.js` **63/63**。
- `tests/fullsuite.js` 新增 §A7（17 项）：B1 用 36 局真实 `startRun()` 采样 99 个出生点复刻圆-矩判定；
  B2/B3/B4 用真实 `engine.update()` 帧推进；B6 用 DOM stub 真实 `click()`；B7/B8/B9 兼用行为与静态契约。
- 一次性 Edge 无头 `file://` 实拍 4 张（`hud / pause / perk / unlock`）：HUD 紧凑半透明不挡视野、
  暂停面板三按钮齐备无重叠、词条卡三列且无 `p_xxx`、解锁页顶部 × 可见。
  **零端口占用、零后台进程、跑完即退**（已核实无残留 `msedge` 进程、无本地监听端口）。

### 四、不变量与未动区域

- `tests/smoke.js` 20/20 冻结基线未改；`core/perks.js` 前 10 个词条派生数值逐字未动。
- `BULLET_DMG / FIRE_CD / SPEED / DASH_* / HURT_INVULN` 等基础手感常量全部保持 v1。
- `BALANCE.hpBase / hpProgress / bossHpMul` 未动 —— 4 分钟节奏校准旋钮留待真人计时后再调。
- M1–M6 / N1 全部存档，未新建科技树 / 存档 / 掉落物 / 商店 / 可破坏墙体等系统。

---

## 附录：2026-11-19 版本对齐与二次验收

### 一、查到什么

- 用户提供的《项目修改需求整理.md》（Downloads）**未追加**：仍是 2026-11-18 09:11 的 4770 字节版本，
  B9 / M6 / N1 条数不变。桌面与文档目录也未找到 v2 或 docx。
- **但仓库大更新**：队友在 `Luciandeng` 分支推了 `14e2514`、`dc98810` 两个提交（相对 `origin/main`
  共 53 文件 +2470/−1181），`origin/main` 另有 `c1d81e7` Merge PR #1；另有 `whitebarium` /
  `yizhitao0512` 两条队友分支。
- 追加内容以**仓库内 4 份设计资料**的形式到达：`参赛改进与美术方向.md`、`玩法融合探索.md`、
  `单房自测记录.md`、`UI验收记录.md`，并附 `界面对照.html` 与 35 张以上证据截图。
  其中《参赛改进与美术方向.md》把 B1–B9 / M1–M6 / N1 逐条给了新的建议与验收口径。

### 二、B1 二次修复（补上本轮遗留）

本轮 B1 只做到「排除与墙重叠的坐标」。队友指出并修复了残留缺陷：`chamber` 房是**四面墙围成的
无入口封闭圈**，圈内坐标不与墙重叠、也过了中心禁区，旧校验会放行；怪刷进去玩家永远走不到，
清不掉场即死档（队友抽样 320 局，53 局首房为 `chamber`，其中 4 局命中）。

当前实现：`roomNavigation()` 24px 网格 + `clearPath()` 连线校验 + 从玩家格 BFS 求 `depth`；
`spawnValid()` 要求 `nearestNavCell(nav, x, y, radius + 2, true) >= 0` 且不与既有敌人重叠；
`spawnPoint()` 兜底从 `depth >= 0` 的格点取。`tests/fullsuite.js` §A7 增加强制抽到封闭内角
`(581, 393)` 的固定用例。

### 三、总监独立复核（不采信自报数字）

一次性脚本自行实现 20px 网格 BFS（与引擎实现独立），抽样 **320 局 / 861 个敌人**：

| 缺陷类型 | 数量 |
|---|---:|
| 刷在墙内 | 0 |
| 落在玩家不可达区域 | **0** |
| 违反中心 120px 禁区 | 0 |
| 与玩家贴脸（<170px） | 0 |
| 敌间重叠 | 0 |

首房 shape 分布 `chamber 55 / arena 169 / corridor 96`，封闭墙圈确有覆盖 → **PASS**。
脚本为工作区一次性产物，未纳入仓库；结论可复跑。

### 四、新测试基线（实跑）

`smoke 20/20`、`m2m3 58/0/0`、`fullsuite 78/78`、`impact 21/21`、`recall 9/9`、
`combat-guide 5/5`、`enemy-trial 25/25`，零异常。全部为纯 Node / 零端口。

### 五、方向变化与待办

- 核心玩法改为 **「绕一圈，从另一侧回击」（廊道回扫）**，已做单房 A/B 原型；队友文档结尾仍标注
  「玩法设计与验收方案，原型手感仍待实测」。
- **M2「长局 + 存档」与队友方向汇合**：其设计文档明确「长局沿用三层、层末存档续玩」，并给出
  「先验证一间普通房 + 一场首领战，再试调一层约 4–5 分钟」的次序。
- 下一轮待办（按依赖）：① 6–8 名初次玩家盲玩（四条验收标准）→ ② 依结果决定是否扩成首层
  → ③ M2 长局 + 存档实施（架构级，单独一轮）→ ④ Qoder Sites 公网地址 + 作品帖
  （硬截止 2026/11/30 18:00）→ ⑤ 分支治理（`Luciandeng` 2 个提交未并入 main，另有两条平行历史，
  须用户或队友确认，总监不擅自合并 / 强推）。
- **GitHub 同步 ≠ 大赛提交**；`§8` 第 6–8 条（真人计时 / 90 秒视频 / 大赛提交）仍为待办。

---

## 附录：回廊长局本体改造验收（2026-11-19 · 开发总监）

### 一、触发与范围

用户明确指出上一轮（盲玩验收包）**仍是 Plan / 文档 / 验收工具，不是游戏本体优化**，
并要求「往这个方向接着做，可以大改玩法甚至底层引擎都是可以的」。因此本轮不做新排期、
不做验收包，直接改玩法本体：把队友《参赛改进与美术方向.md》里只在 prototype 按钮里的
「绕一圈，从另一侧回击」升级为**首页第一入口的主模式「回廊长局」**。原射击长局保留为
「经典射击」，单房 A/B、击飞接力、回扫原型全部保留在「试玩」区，互不回归。

### 二、落盘清单（逐文件可核对）

| 文件 | 改动 |
|---|---|
| `src/core/loop.js` | **新建**规则层：`SAVE_KEY`、固定墙骨架、4 套参数化廊型（`fork` / `switchback` / `deepwell` / `twinbend`）、`makeLayout()` / `validate()` 几何自检、`plan()` 三层九间编排、`waveRules()`、`offer()` 路线词条候选、`loopRewards()`、`save()` / `load()` / `hasSave()` / `clearSave()` / `saveLabel()` |
| `src/core/recall.js` | 泛化为可接收任意 loop 布局：`DEFAULT` 保底、`create(layout)`、`clearLine(layout,…)`、`record(r,p,rulesOrPerk)` 兼容旧词条 id 与新规则对象、`chaseTarget` / `advancePatrol` 使用对应 layout。**旧 prototype 接口零改动**，`tests/recall.js` 9/9 原样通过 |
| `src/core/perks.js` | 新增独立 `LOOP` 路线词条池（8 条，不污染冻结的 `TABLE` / `IDS` 与局外解锁）与 `BALANCE.loop` 数值段；`derive()` 前 10 项表达式逐字未改 |
| `src/core/engine.js` | 接入 `startLoop()` / `setupLoopRoom()` / `setupLoopBoss()` / `onLoopClosed()` / `advanceLoopLayer()`；`startRun({loop:true})` 分流；`update()` 计算 `loopRules` 与连扫窗口；闭环触发回扫奖励；子弹在长局按 `bulletMul=0.34` 降级；回扫对首领 1.5 倍并破盾；清 Boss 换层；`choosePerk()` 走 `LOOP` 池；`finishRun()` 清档；受伤清空连扫 |
| `index.html` | 首页主入口改「回廊长局」featured，新增「继续回廊」，原长局改称「经典射击」；`src/core/loop.js` 插入脚本顺序（`recall.js` 之后、`enemy-trial.js` 之前） |
| `src/ui/screens.js` | `perkDefinition()` 识别 `LOOP` 池；`refreshLoopContinue()`；词条页「下一圈怎么走」文案；HUD 层级前缀 / 连扫 / 护盾提示；结算页显示抵达层数；`init()` 接 `onLoop` / `onLoopContinue` |
| `src/ui/main.js` | `runStart` / `loopClosed` / `loopLayer` 事件 toast；`perkOffer` 传 `loop`；`restart()` 重开长局 |
| `src/ui/render.js` | `drawLoopLanes()` 把三条廊道画成可见的「未走地面状态」；出口、廊口光环、首领预警改用 `s.recall.layout` |
| `src/ui/style.css` | 补 `.mode-entry.continue` 续玩按钮配色 |
| `tests/loop.js` | **新建** 16 项回归（§A 几何 / §B 编排与词条 / §C 闭环与波 / §D 存档 / §E 帧循环端到端 + UI 接线） |

### 三、玩法规则（与设计文档逐条对齐）

- **三层 × 三间 + 层末巡廊首领**：`plan()` 每层洗牌 4 套廊型取 3 间，层末 `setupLoopBoss()`。
- **闭环即攻击**：`recall.record()` 在玩家从一条廊去、另一条廊回、跨越原点时触发 `startWave()`，
  回扫沿**去程路线逆向**传播；`validate()` 保证每条 lane 不与墙相交。
- **折角断射线 / 廊口选路**：`switchback` / `twinbend` 有额外折角，`clearLine()` 按当前 layout 判定；
  上廊短、下廊长，`longDistance` / `shortDistance` 分流长圈与短圈伤害。
- **路线词条**：`LOOP` 池的折角扩散 / 长程蓄力 / 短圈聚锋 / 归廊 / 贪金 / 迅扫等改变**走法收益**，
  不是单纯加数值；词条页标题改为「下一圈怎么走」。
- **连续闭环蓄势**：26 秒窗口内累积，最高 ×3，受伤立即清零（早期设 7 秒短于一圈，
  连扫永远停在 ×1，等于机制不存在，已修正）。
- **射击退为牵制**：长局普通子弹伤害 ×0.34；只有巡廊首领护盾被回扫打开时才全额生效，
  迫使玩家用闭环而非站桩输出。
- **存档续玩**：`corridor.loop.save.v1` 存层 / 房 / HP / 金币 / 词条 / 时间 / 主题，
  换房与换层自动写；首页「继续回廊」恢复；通关或死亡清档。

### 四、验收结果（实跑，不采信自报）

| 项 | 结果 |
|---|---|
| `node --check`（全部 `src/**/*.js`） | 通过 |
| `node tests/smoke.js` | **20/20**（M1 冻结基线未动） |
| `node tests/m2m3.js` | **58/0/0**（360/360 组校验） |
| `node tests/fullsuite.js` | **78/78**（按新 `index.html` 脚本顺序加载 `loop.js` 后仍全绿） |
| `node --test tests/recall.js` | **9/9**（泛化后旧接口零回归） |
| `node --test tests/impact.js` | **21/21** |
| `node --test tests/combat-guide.js` | **5/5** |
| `node --test tests/enemy-trial.js` | **25/25** |
| `node --test tests/loop.js` | **16/16** |
| 端到端链路 | 开局 → 绕圈清房 → 选词条 → 换房换廊型 → 首领破盾 → 换层 → 存档 → 续玩，全链路真实 `engine.update()` 跑通（探针先跑通后固化为 `tests/loop.js`，探针为工作区一次性产物，未入仓库） |

**验证方式约束**：全程纯 Node + 轻量 DOM stub，按 `index.html` 的 `<script src>` 顺序加载源码，
真实调用 `E.startRun()` / `E.update()` / `E.choosePerk()`。**不起 HTTP 服务、不开 CDP 端口、
不留后台进程、不读浏览器配置 / 历史 / 进程 / 端口**，符合用户对「不要做风险操作」的要求。

### 五、如实标注（本附录不宣称的部分）

- `tests/loop.js` 证明的是**状态机、几何、词条、存档、续玩与 UI 接线成立**，
  **不是「玩法爽」「单局 4 分钟」的结论**；后者属真人手感与计时范畴，仍需 6–8 人盲玩。
- `docs/demo-90s.md` 的 90 秒分镜按「经典射击」撰写，主模式改版后**需重剪**，本轮未改。
- 上一轮 `docs/盲玩验收包.md` 的 S1–S4 四条标准仍适用于新主模式，但**尚未执行**，
  工具产出不等于验收通过。
- 队友在途的 `AI竞赛-回廊开发提示词.md` → `docs/` 文件移动，总监**未提交、未丢弃**，
  保持原状；`Luciandeng` 与 `origin/main` 的分支差异也**未擅自合并或强推**。
- §8 第 6–8 条（真人计时 / 90 秒视频 / Qoder Sites 大赛提交）仍为待办，
  **GitHub 同步 ≠ 大赛提交**。

---

## 附录：M8 整体美术风格大改验收（2026-11-19 · 开发总监）

### 一、触发与诊断

用户在 M7 完成后明确「接着做②，我觉得整体美术风格都需要大改」。本轮不再产出
Plan / 文档 / 验收包，直接改渲染层与界面；同时继续遵守「不做风险操作」的约束
（不读浏览器配置 / 历史 / 进程 / 端口，不启服务、不留后台进程）。

**先核到三个真实问题，不是凭感觉改**：

| # | 诊断 | 证据 |
|---|---|---|
| 1 | `VISUALS` 的 `bgStyle` / `postFx`（bloom / aberration / grain / halo / vignette / shock）**从未被 render.js 读取**；`ground`、`frame`、`glow` 等字段根本不存在 | 旧 `render.js` 只用了 `particleStyle` / `enemyStyle`；`drawBackground` 仅按 `CUR.id` 改网格间距 |
| 2 | 主题色板被硬编码常量覆盖 | 旧 `buildCur()` 以 `NIGHT` 为底，非 geometry 主题只把 `bg` 混一点 `ink`，随后又把 `pp.teal = col.guide` 等写回，四套画面几乎一样 |
| 3 | 三套视觉语言互相打架 | CSS 荧光绿控制台（`--accent: #ddfa73`）+ Canvas 夜光制图（黄绿玩家）+ `direction='print'` 米黄套印版；`#app[data-theme]` 在 CSS 里没有任何分支，切主题只影响 Canvas |

### 二、新方向：「深蓝测绘图 / 夜航档案」

把「**脚下走过的回廊，就是这一击的攻击路线**」做成视觉母题：极深墨蓝底、
细密坐标网与图廓刻度、**唯一高亮琥珀金**（玩家 / 闭环 / 主按钮 / 读数），
路径雾青、危险朱红、次级藕紫。四套主题共享同一套骨架，只换材质与后处理强度，
保证「同一台仪器、四种纸」。

### 三、落盘清单（逐文件可核对）

| 文件 | 改动 |
|---|---|
| `src/theme/index.js` | 重做 `PALETTES` 四套色板；`VISUALS` 新增 `ground`（step / major / motif / line）、`frame`（编号与题名）、`glow`、重定 `postFx`，并全部接线。保留 `THEMES` / vocab 与全部旧接口不变（m2m3 同构性校验不受影响） |
| `src/ui/render.js` | 全量重写。`buildCur()` 改由主题色板 `nightFrom()` 推导整幅语义色；新增 `drawMotif()` 四套底纹、`drawPostFx()`（真正实现 halo / vignette / 低血红晕 / grain / shock / bloom）、`drawFrame()`（四角刻度 / 编号 / 层级读数 / 中心准星）、`layeredStroke()` 多层发光；重做 `drawBackground` / `drawWalls`（体积感）/ `drawLoopLanes`（可见通道 + 折角节点）/ `drawRecallPaths`（逆行回扫光带 + 头部光点）/ `drawRecallHubs` / `drawBullets` / `enemyGlyph` / `drawEnemy` / `playerGlyph` / `drawPlayer` / `drawIdle`（闭环回廊动态取景）/ `drawDamagePops` / `drawBossPhase` |
| `src/ui/style.css` | 全量重写。新变量组 + 四套 `#app[data-theme]` 覆盖；`body` 细网格 + 角光；首页改档案卡（编号、细分隔、mono 小标）；HUD 左侧强调线；面板顶线与角标；词条卡左色条与 hover；按钮、toast、响应式断点全部保留 |
| `index.html` | 首页副标题改「绕一圈 · 从另一侧回击」；**所有 id / class / script 顺序不变** |

**接口不变量**：`C.ui.render.draw(ctx, s, t, direction, cue)` 签名、`W/H`、`direction='print'`
套印版、engine→render 的全部数据契约（`s.walls / enemies / bullets / particles / trail /
damagePops / bossPhase / loop / recall / impact / shake / transition`）均未改变；
四个试玩原型（单房 A/B、击飞接力、回扫、走位提示）的绘制函数原样保留，
颜色自动继承新色板。`tests/fullsuite.js` §A6 要求的 CSS 选择器
（`#perk-cards[data-count="3"]` / `.perk-synergy` / `.perk-mechanic` / `.hud-extra`）全部保留。

### 四、验证（实跑，不采信自报）

| 项 | 结果 |
|---|---|
| `node --check`（全部 `src/**/*.js`） | 通过 |
| 八套回归基线 | `smoke 20/20`、`m2m3 58/0/0`、`fullsuite 78/78`、`recall 9/9`、`impact 21/21`、`combat-guide 5/5`、`enemy-trial 25/25`、`loop 16/16` |
| 渲染层真实调用探针 | 工作区一次性 `probe-visual.cjs`（未入仓库、可复跑）：完整 mock 2D 上下文按 `index.html` 顺序加载源码，**真实调用** `C.ui.render.draw()`，覆盖四套主题 × 首页 / 长局，以及经典 / 回扫原型 / 击飞 / 单房 / `print` 方向，**13 场景全 PASS、零异常** |
| 主题分流定量核对 | 拦截 `fillStyle` / `strokeStyle` / `shadowColor` / `addColorStop` 收集实际用过的色值：四套主题首页两两最小差异 **78** 个色值、长局 **121** 个 → 材质与色板配置确实进入画面，不是空转 |
| 约束 | 全程纯 Node + DOM stub，**不起 HTTP 服务、不开 CDP 端口、不留后台进程、不读浏览器配置 / 历史 / 进程 / 端口** |

探针过程中出现一次 `ctx.bezierCurveTo is not a function`，定位为**探针 mock 缺失该 API**
（武当墨晕山形用了合法 Canvas 2D 方法），补齐 mock 后复跑全绿；产品代码未因探针报错而放宽。

### 五、如实标注（本附录不宣称的部分）

- 自动化能证明**链路不抛异常、主题确实分流、基线未回归**，
  **不能证明「好看 / 有氛围 / 不刺眼」**；真人观感仍需用户与盲玩者确认。
- `docs/demo-90s.md` 的 90 秒分镜仍按旧玩法 / 旧美术撰写，主模式与新视觉下**需重剪**（本轮未改）。
- 真人盲玩（6–8 人）、4 分钟真人计时、重开率仍未做；
  §8 第 6–8 条（真人计时 / 90 秒视频 / Qoder Sites 大赛提交）仍为待办。
- 队友在途的提示词 md 文件移动，总监**未提交、未丢弃**；`Luciandeng` 与 `origin/main`
  的分支差异**未擅自合并或强推**。**GitHub 同步 ≠ 大赛提交**。

---

## 附录：M9 多相位破盾玩法扩展验收（2026-11-19 · 开发总监）

### 一、触发与诊断

用户原话：「回扫这个机制非常有意思，不过 boss 破盾与否没有视觉上展示，你往下继续
Plan，扩展这个玩法」。按用户一贯要求，本轮**不另写方案文档**，把 Plan 压成设计结论后
直接落到游戏本体；继续遵守「不做风险操作」（不读浏览器配置 / 历史 / 进程 / 端口，
不启服务、不留后台进程）。

代码复核确认了用户指出的空白，且不止一处：

| # | 诊断 | 证据 |
|---|---|---|
| 1 | 破盾 / 未破盾几乎没有视觉差别 | `render.js` 的 `drawEnemy()` 里只有一圈 `e.patrol` 虚线，按 `guardOpen` 换颜色与 `[6,5]` / `[13,6]` 虚线密度；没有护盾壳、没有蓄势进度、没有崩解爆发、没有重构动画 |
| 2 | `loopShieldOpen` 事件发了从来没人接 | `engine.js` 波命中首领时 `emit(s,'loopShieldOpen',...)`，但 `main.js` 的 `onEvent()` 无此 case，玩家收不到任何破盾反馈 |
| 3 | 首领只有一个相位、破盾门槛恒定 | 旧逻辑「回扫命中 → `guardOpen=3.3s` → 补枪」，窗口结束护盾直接复原，没有相位推进、没有重构、没有门槛变化 |
| 4 | 「短圈」是空机制（顺带发现） | `BALANCE.loop.shortDistance=1250`，但最短闭环（直上廊 1000 + 中廊 724）≈1724，`p_loop_focus` / `shortDamage` 从未生效 |

### 二、设计结论：把破盾做成回扫玩法的节奏核心

四拍循环，挂在 boss 实例上（`closed → exposed → reforming → closed(下一相位)`）：

1. **闭合**：首领巡廊，普通子弹被压到 `bulletMul` 且对首领完全弹开；回扫命中**只削护盾蓄势、不磨血**，逼玩家绕圈。护盾壳上直接画出「还差几圈」的进度弧与「需 XX 圈」标签。
2. **崩解**：蓄势满 → 全屏爆发信号（冲击环 + 放射线 +「护盾崩解 / SHIELD BREAK」大字）、外壳碎裂飞散、震屏与双色粒子，并发 `bossShieldBreak`。
3. **暴露窗口**：`guardOpen>0`，子弹**全额**生效，首领停火且停止巡逻让出输出空间；窗口内继续绕圈，回扫吃 `exposedWaveMul`（2.2×）加成，鼓励边跑边打；倒计时环与 HUD 条同步读数。
4. **重构**：窗口结束护盾逐边重建（约 1.15s，期间免伤），完成后 `breaks+1`，**下一相位要求换一种圈型**（任意 → 折角 → 长圈 → 短圈循环）、所需闭环数、巡逻速度与窗口长度都随之变化；发 `bossShieldReform` 明确告知新要求。

圈型不符**不扣分也不卡死**：按 `weakCharge=0.34` 折算蓄势（约三圈顶一圈），
并 toast「圈型不符 · 本相位需折角圈」。破盾本身也进入构筑：新增 4 条 LOOP 词条
（破阵 / 延窗 / 裂锋 / 过载回扫）。

### 三、落盘清单（逐文件可核对）

| 文件 | 改动 |
|---|---|
| `src/core/perks.js` | `BALANCE.loop.shield` 新增相位表 / 门槛 / 窗口 / 重构 / 提速 / 折角阈值；`LOOP` 池加 4 条破盾词条；`shortDistance` 1250→1800（修好空转的短圈）；冻结 `TABLE` / `IDS` / `derive()` 前 10 项逐字未动 |
| `src/core/loop.js` | 新增纯规则 `shieldSpec(breaks,perks)` / `waveTags(wave,layout)` / `matchesShield(tags,required)` / `SHIELD_LABEL`；`waveTags` 只从 `recall.js` 已产出的 `wave.routes` / `wave.length` 与廊道折点数读客观几何，**recall.js 一行未改** |
| `src/core/engine.js` | `setupLoopBoss()` 初始化 `boss.shield`；新增 `loopBoss()` / `breakShield()` / `onWaveHitLoopBoss()` / `updateLoopShield()`；波命中分流长局首领；巡逻按相位提速、窗口与重构期间停火；`s.breakFlash` 全屏信号；`s.loop.shieldBreaks` 计入结算；长局屏蔽旧「50% 血切 P2」避免两个阶段概念打架；`startLoop` 初始化新字段 |
| `src/ui/render.js` | 新增 `waveColor()`（回扫波随护盾三态变青/金/藕紫）、`shieldHex()`、`drawBossShield()`（双层六边形壳 + 相位刻线 + 蓄势弧 / 碎裂碎片 + 倒计时环 + 准星 / 逐边重建 + 相位标签）、`drawBreakBurst()`（全屏爆发）；`drawFrame()` 加 `SHIELD Pn/圈型[状态]` 读数；旧原型那圈虚线原样保留 |
| `index.html` / `src/ui/style.css` | HUD 新增 `#shield-bar` 三态条（`[data-state=closed/exposed/reforming]` 换色、暴露窗口呼吸动画、小屏降级） |
| `src/ui/screens.js` / `src/ui/main.js` | HUD 三态文案与倒计时、hint 改为相位引导、结算加「护盾崩解」统计；`main.js` 接住 5 个新事件 toast（含 `bossShieldCharge` 的圈型不符提示）与带相位要求的 `bossEnter` 文案 |
| `tests/loop.js` | §E4 通关测试改按新玩法口径（已破盾窗口 + 真实子弹结算，不再靠回扫磨血）；新增 §F1–§F7 共 7 条：相位规则、圈型识别、入场状态、真实帧循环四拍全链路、HUD 三态、渲染三态不抛且画面分流、静态接线契约 |

**接口不变量**：`guardOpen>0` 仍表示「可被伤害」，因此 `damageEnemy()` / 子弹削弱 /
HUD 判定几乎无需改动；旧 prototype 首领**不带 `shield` 字段**，旧的「一刀开窗」逻辑与
`tests/recall.js` 9/9 原样通过；经典射击、单房 A/B、击飞接力、print 套印方向均未改。

### 四、验证（实跑，不采信自报）

| 项 | 结果 |
|---|---|
| `node --check`（全部 `src/**/*.js` / `tests/**/*.js`） | 通过 |
| 八套回归基线 | `smoke 20/20`、`m2m3 58/0/0`、`fullsuite 78/78`、`recall 9/9`、`impact 21/21`、`combat-guide 5/5`、`enemy-trial 25/25`、`loop 23/23`；`node --test` 七套件合计 **85/85，0 fail** |
| §F4 真实帧循环 | 闭合态回扫只削蓄势且 `boss.hp` 不变 → 蓄势满崩解进 `exposed` → 窗口内子弹全额 10 点、回扫加成 > 基准 → 窗口归零进 `reforming` → 重构完成进相位 2（`corner`）且提速 → 直圈折算、折角圈全额，事件链齐全 |
| §F6 渲染三态 | 完整 mock 2D 上下文**真实调用** `C.ui.render.draw()`，closed / exposed / reforming 三态均不抛异常、各产生 >20 个实际色值，三态签名两两不同；`breakFlash=1` 的爆发信号叠加出额外画面 |
| M8 渲染探针复跑 | 工作区 `probe-visual.cjs` 13 场景（四主题 × 首页 / 长局 + 经典 / 回扫 / 击飞 / 单房 / print）**仍全 PASS**；四主题首页最小差异 78 色值、长局 121 色值未被破坏 |
| 约束 | 全程纯 Node + DOM stub，**不起 HTTP 服务、不开 CDP 端口、不留后台进程、不读浏览器配置 / 历史 / 进程 / 端口** |

### 五、如实标注（本附录不宣称的部分）

- 自动化能证明**状态机可达、三态视觉确实分流、八套基线未回归**，
  **不能证明「破盾够爽 / 相位门槛不难不烦 / 一眼就懂」**；真人观感与难度仍需试玩确认。
- §E4 的通关测试改为「已破盾窗口 + 真实子弹」是**玩法口径变化**，不是放宽断言：
  闭合态回扫不磨血是刻意设计，破盾全过程由 §F4 单独端到端验证。
- `docs/demo-90s.md` 的 90 秒分镜仍按旧玩法 / 旧美术撰写，主模式需重剪（本轮未改）。
- 真人盲玩（6–8 人）、4 分钟真人计时、重开率、Qoder Sites 公网地址与作品帖
  （硬截止 2026/11/30 18:00）仍为待办；**GitHub 同步 ≠ 大赛提交**。
- 队友在途的提示词 md 文件移动，总监**未提交、未丢弃**；分支差异未擅自合并或强推。
