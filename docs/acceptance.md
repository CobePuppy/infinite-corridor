# ∞ 回廊 · §8 联调验收核对表

> 维护：qa-release（QA / 发布工程师，T5）｜硬截止：**2026/11/30 18:00**（Qoder 高校创造力大赛）
> 依据：《AI竞赛-回廊开发提示词.md》「## 8. 联调验收清单」

## 使用说明与状态约定

- 下表把提示词 §8 的 **8 条清单逐项抄录**，每条标注「验证方式 / 命令 / 负责人 / 状态 / 当前依据」。
- **状态初始为「待集成」**：qa-release 的职责是准备验收资产，**不自行宣告通过**。gen-dev(M2)、
  theme-dev(M3) 曾与本文档并行改动代码，最终集成验收由**开发总监在三方汇合后亲自复跑**。
- **2026-11-17 复跑结论（开发总监）**：`node tests/smoke.js` = 20/20、`node tests/m2m3.js` = 58/0/0，
  四条降级、180 组模板×主题校验、三套新词表、geometry 零回归全部通过；核实 `C.theme.active()`
  返回 id 字符串、`C.theme.get(opts.theme)` 链路可正确命中，四主题切换不会静默回落。
  **§8 第 1–5 条（自动化可覆盖）转为「通过」；第 6–8 条仍需人工试玩 / 录制 90 秒视频 / 大赛提交，保持待办。**
- **2026-11-17 浏览器实拍验证（开发总监）**：用 Edge 无头 + CDP 真实点击「进入回廊」与主题按钮，
  确认四主题选择器生效、开局成功、换主题后房间 / boss 命名与 HUD 标签同步、零 JS 异常；
  详见文末「附录：浏览器实拍验证」。这是第 6 条的**自动化部分**证据，不替代人工计时与手感试玩。
- 「当前依据」只记录当前代码快照下自动化测试的客观结果，供总监复跑时比对，**不替代验收结论**。
- 相关资产：`tests/smoke.js`（M1 基线，20/20，禁止改动）、`tests/m2m3.js`（M4 验收资产）、
  `docs/demo-90s.md`（90 秒演示分镜与记录表）。

### 当前集成快照（供比对，非验收结论）

| 项 | 值 |
|---|---|
| git HEAD | `fd62682`（M2/M3 阶段性进展，已推 `origin/main`） |
| 工作区并行改动 | `src/core/engine.js`、`src/gen/index.js`、`src/gen/templates.js`、`src/theme/index.js`、`src/ui/{main,screens}.js`、`src/ui/style.css`（由 gen-dev / theme-dev 落地，**qa-release 未触碰**） |
| `node tests/smoke.js` | 20 passed / 0 failed（基线未动） |
| `node tests/m2m3.js` | 58 passed / 0 failed / 0 waiting（含 180/180 组 validate、四类降级均 `source='fallback'`） |
| 备注 | 2026-11-17 开发总监已在三方汇合后亲自复跑上述两条命令，结果与本表一致；改动文件均在授权边界内，`index.html`、`tests/smoke.js`、`core/perks.js`、`core/audio.js` 未改动，core 层仅 `startRun()` 两行；另完成浏览器实拍验证，见文末附录 |

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
| 验证方式 | 3 套模板 × 5 难度 × 3 seed 全部通过 `validate`；`m2m3.js` ③ 再扩到 4 主题共 180 组；手动连续三次制造降级失败，肉眼比对房间数 / threat 序列不雷同 |
| 命令 | `node tests/smoke.js`（§1 45 组）、`node tests/m2m3.js`（③ 180 组） |
| 负责人 | qa-release（资产）、gen-dev（模板轮换与按主题重映射）、theme-dev（词表）；复跑：开发总监 |
| 状态 | ✅ 通过（自动化复跑 · 开发总监 2026-11-17） |
| 当前依据 | `smoke.js` §1 45/45；`m2m3.js` ③ 3 模板 × 4 主题 × 5 难度 × 3 seed = **180/180**（geometry/oldtown/subject/wudang 各 45/45） |

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
| 验证方式 | 人工试玩计时单局时长；死亡后按 `R` / `Enter` 一键重开；DevTools → Application → Local Storage 核对 `corridor.meta.v1`（gold / unlocked / runs / clears / bestSeconds）与主题键 `corridor.theme.v1`、LLM 配置键 `corridor.llm.v1`；记录表见 `docs/demo-90s.md` |
| 命令 | 手动试玩（自动化无法覆盖手感与时长）；`node tests/smoke.js` 间接覆盖重开链路 |
| 负责人 | 全队试玩、qa-release（记录表）；复跑：开发总监 |
| 状态 | ⏳ 待办 · 人工试玩（自动化无法覆盖） |
| 当前依据 | 需人工试玩与真机计时，当前未采样；`docs/demo-90s.md` 已备「单局时长 / 重开率」记录表。**自动化部分已覆盖**：浏览器实拍确认开局成功（`phase:playing`）、四主题选择器生效、切主题后命名与 HUD 同步、零 JS 异常（见文末附录） |

### 第 7 条

> 90 秒演示视频录到两局不同关卡；记录重开率与单局时长

| 项 | 内容 |
|---|---|
| 验证方式 | 按 `docs/demo-90s.md` 分镜录制 90 秒视频，两局须**主题不同**且**房间数 / threat 序列 / perk_choices 组合不同**；用脚本内记录表登记重开率与单局时长 |
| 命令 | 分镜与记录表：`docs/demo-90s.md`；录制前置：开始页主题选择器切换主题（键 `corridor.theme.v1`） |
| 负责人 | qa-release（分镜 / 录制建议）、开发总监（提交视频） |
| 状态 | ⏳ 待办 · 录制 90 秒视频 |
| 当前依据 | `docs/demo-90s.md` 已备分镜与记录表；视频尚未录制。录制前置：主题切换 + `templates.reseed` 按主题重映射须联调稳定（`m2m3.js` ③ 当前 180/180 已满足），否则切换主题会触发 `buildRun` 抛异常 |

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

# 3) 人工项（自动化无法覆盖，需真机试玩 / 录制）
#    - 断网 / 超时 / 非法返回：DevTools 手动制造，确认 8 秒内降级、开局不阻塞
#    - 连开 5 局：房间数 / threat 序列 / perk_choices 组合不重复
#    - 单局 3–5 分钟、死亡后 R/Enter 一键重开、localStorage 进度正确
#    - 按 docs/demo-90s.md 录制 90 秒视频，填「重开率 / 单局时长」记录表
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
