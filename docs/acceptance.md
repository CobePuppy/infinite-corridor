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
- 「当前依据」只记录当前代码快照下自动化测试的客观结果，供总监复跑时比对，**不替代验收结论**。
- 相关资产：`tests/smoke.js`（M1 基线，20/20，禁止改动）、`tests/m2m3.js`（M4 验收资产）、
  `tests/fullsuite.js`（M5 跨层接线 + 节奏量化）、`docs/demo-90s.md`（90 秒高光蒙太奇与记录表）。

### 当前集成快照（供比对，非验收结论）

| 项 | 值 |
|---|---|
| 代码基线 | `845ba76`（M2/M3/M4，已推 `origin/main`）→ 本次 M5「全套」集成提交 |
| 工作区改动 | 11 个源码文件（T24–T27 四方）+ 1 个新增 `tests/fullsuite.js` + 3 份文档；`tests/smoke.js` 与 `core/audio.js` 未改动 |
| `node tests/smoke.js` | **20 passed / 0 failed**（冻结基线未动） |
| `node tests/m2m3.js` | **58 passed / 0 failed / 0 waiting**（含 360/360 组 validate、四类降级均 `source='fallback'`） |
| `node tests/fullsuite.js` | **46 passed / 0 failed**（跨层接线 §A + 节奏量化 §B） |
| 浏览器实拍 | M5 四主题战斗画面一次性无头截图，不起端口 / 不起后台进程，四套色板与背景分化确认 |
| 备注 | 2026-11-17 开发总监已完成集成验收；7 处跨层缺口全部修复（见文末 M5 附录）。单局 240s±30s 属真人手感范畴，理论模型不作为验收结论 |

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
