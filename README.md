# ∞ 回廊 · INFINITE CORRIDOR

> 一局一廊，走廊记得你停在哪。
>
> 浏览器单页 Roguelite，Qoder 高校创造力大赛参赛作品。默认主题「抽象几何」，另备
> 「旧城 / 学科 / 武当」三套主题可在开始页切换：四套各有独立色板、背景构图与造型，
> 全部由程序化绘制生成，**零美术资源、零音频文件、零后端、零账号、零构建**。
>
> 单局 3–8 个房间 + 首领，24 个词条分「数值 / 机制 / 协同」三层，单条命通关目标
> **240s ± 30s（约 4 分钟）**；房间分型、Boss 两阶段与打击反馈让强度有起伏。

## 运行

**直接双击 `index.html` 即可玩**（纯静态、无构建、无依赖、无 ES module，因此 `file://` 下也能打开）。
演示、试玩与自动化验收均**不需要本地服务**；如确有需要请自行选择空闲端口并自行管理，
本项目不会启动或占用任何端口 / 后台进程。
进度（金币、已解锁词条、最佳时长）存 `localStorage`，断网可玩。

开始页的 **试玩廊道回扫** 包含一间普通房和一场首领战。选好词条后，从标记廊口出发，沿一条廊去，
从另一条廊回来。回扫从返程廊道开始，沿刚走过的廊道倒着传播。试玩站位 A 的炮台在下廊，站位 B
在同一张图的上廊。走到清房后的右侧光环进入首领战，用回扫打破巡廊者的护盾。试玩结算独立于原版的
金币和解锁存档。**进入原版长局** 继续使用原有的关卡和词条。

游戏本身不需要 Node；下方的**验收脚本**需要 Node（零依赖，无需 `npm install`，无构建步骤）。

## 操作

| 输入 | 作用 |
|---|---|
| `W A S D` / 方向键 | 移动（带惯性与加减速） |
| 鼠标移动 | 瞄准 |
| 鼠标左键 / 空格 / `J` | 攻击 |
| `Shift` | 冲刺，短暂无敌 |
| `Esc` | 暂停 / 返回：游戏中弹出暂停面板（继续 / 重开本局 / 返回开始页）；解锁页按 Esc 直接返回 |
| `M` | 静音开关 |
| `R` / `Enter` | 结算页一键重开 |

每局 3–8 个房间 + 1 个首领。清空房间后右侧出口开启，走到出口从两个词条里选一个，
每第 3 / 6 / 9 次选择升级为**三选一**（稀有 / 史诗优先）；词条共 24 个，分数值 /
机制 / 协同三层，特定组合会解锁「共鸣」质变并在词条卡上提示。房间分
`普通 / 精英 / 事件 / 休整` 四型，首领半血切第二阶段。死亡或通关后立刻结算，
金币可在「局外解锁」页换取开局自带的初始词条。

**主题切换**：开始页选择器可在 `抽象几何 / 旧城 / 学科 / 武当` 四套主题间切换，
当前主题存 `corridor.theme.v1`，HUD 实时显示主题标签。四套主题不只是换命名与文案：
几何纯色方块、旧城砖墙暖光、学科方格纸数学符号、武当山峦留白，各有独立色板、
背景构图、敌人 / 玩家 / 子弹造型与后处理。规则与数值始终不变。

## 里程碑状态

> 本表由 qa-release 在三方并行开发期间按**当前代码快照**如实标注。
> gen-dev(M2) / theme-dev(M3) 的改动仍可能继续，**以下不代表验收通过**；
> 最终集成验收由**开发总监在三方汇合后亲自复跑** `node tests/smoke.js` 与 `node tests/m2m3.js` 后确认。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | `core/` 规则引擎 + 3 套降级模板 + 完整 UI，能连玩三局、能死、能重开、能选词条 | ✅ 已交付（基线：`tests/smoke.js` 20/20，禁止改动） |
| M2 | `gen/` 接入可配置 LLM：`corridor.llm.v1` / `C.gen.configure()`、`AbortController` 8s 超时、四类失败自动降级 | ✅ 代码已落地（gen-dev）· ✅ 集成复跑通过（smoke 20/20、m2m3 58/0/0） |
| M3 | `theme/` 补齐 oldtown / subject / 武当 三套词表 + 主题切换 UI + 降级模板按主题重映射命名素材 | ✅ 代码已落地（theme-dev）· ✅ 集成复跑通过（M5 扩容后 **360/360** 组校验） |
| M4 | §8 联调验收全过 + 90 秒演示视频 | ⏳ 验收资产已备；2026-11-17 总监复跑并经浏览器实拍（四主题 / 开局 / 零 JS 异常），§8 第 1–5 条通过，第 6–8 条（人工试玩 / 90 秒视频 / 大赛提交）待办 |
| M5 | 「全套」改造：构筑深度 + 反馈节奏 + 6–8 房 / 4 分钟 + 四套独立色板 + 演示重构 | ✅ 代码已集成（T24–T28）；`smoke 20/20`、`m2m3 58/0/0`、`fullsuite 63/63`；四主题无头实拍确认视觉分化；已提交 `7c337b7` 并推送 `origin/main` |
| M6 | 《项目修改需求整理》B 板块修复：刷怪兜底 / 定格同源 / 固定炮台 / HUD 遮挡 / 解锁页关闭 / Esc 语义 / 词条 id / 暂停面板 | ✅ 8 条已落地；`smoke 20/20`、`m2m3 58/0/0`、`fullsuite 63/63`（新增 §A7 17 项回归）；四视图无头实拍确认，零端口占用。逐条对照见 `docs/requirements-2026-11-18.md` |

**不变量**：AI **只在每局开始前最多调用一次**生成关卡 JSON，战斗帧循环绝不调用 LLM；
生成失败 / 超时 / 非法 JSON / schema 校验失败 → 8 秒内自动降级到离线模板，**绝不阻塞开局**；
LLM 默认关闭，未配置时 `buildRun()` 不发起任何网络请求。

## LLM 配置（M2，默认关闭）

生成器**默认关闭**。没有配置、或配置里 `enabled` 不是 `true` 时，全程走离线降级模板，
`file://` 断网可玩的行为与 M1 完全一致（HUD 右上显示「离线模板 #」）。

配置只有一份，存在 `localStorage` 的键 **`corridor.llm.v1`**，值是一个 JSON 字符串：

```json
{ "enabled": true, "endpoint": "https://your-endpoint/v1/chat/completions", "apiKey": "sk-...", "model": "your-model" }
```

### 怎么填

方式一 · DevTools Console（推荐，填完刷新页面）：

```js
localStorage.setItem('corridor.llm.v1', JSON.stringify({
  enabled: true,
  endpoint: 'https://your-endpoint/v1/chat/completions',
  apiKey: 'sk-...',
  model: 'your-model'
}));
```

方式二 · DevTools → Application → Local Storage → 新增键 `corridor.llm.v1`，粘贴上面那行 JSON。

方式三 · 代码内等价接口（写入的是同一份配置）：

```js
C.gen.configure({ enabled: true, endpoint: '...', apiKey: '...', model: '...' });
```

### 恢复默认关闭 / 关闭 LLM

```js
localStorage.removeItem('corridor.llm.v1');   // 或：
C.gen.configure({ enabled: false });
```

### 接口约定与注意

- `endpoint` 需兼容 OpenAI 风格 `POST`：`{ model, messages:[{role,content}], temperature, max_tokens, stream }`；
  响应取 `choices[0].message.content`，若不是该结构则把整段返回文本交给 `extractJson` 处理。
- 请求 `temperature: 0.7` / `max_tokens: 1400` / **超时 8000ms**（`AbortController`）；
  响应经 `extractJson` → `JSON.parse` → `schema.validate` 五条校验，任一不过即降级。
- 四类失败（未配置 / 超时 / 非法或纯文本 JSON / schema 校验失败）一律降级为 `source='fallback'`。
- **安全**：`apiKey` 明文存在本机 `localStorage`，请勿提交进仓库、写进文档或截进演示录屏；
  演示 / 评审建议保持默认关闭，用离线模板保证可复现。

## 目录结构

```
corridor/
├── index.html                 单页入口（script 顺序加载，非 module）
├── README.md
├── AI竞赛-回廊开发提示词.md   原始需求文档（可直接提交仓库）
├── docs/
│   ├── acceptance.md          §8 联调验收核对表（8 条清单逐项标注）
│   ├── demo-90s.md            90 秒演示分镜 + 重开率 / 单局时长记录表
│   └── requirements-2026-11-18.md  需求台账（术语错位 / B1–B9 对照 / M·N 排期）
├── src/
│   ├── core/                  规则层：完全不依赖 AI
│   │   ├── perks.js           词条表 v2（24 条 / 三层）+ BALANCE 数值表 —— 唯一允许写效果数值的地方
│   │   ├── audio.js           WebAudio 程序化音效，零音频资源
│   │   └── engine.js          移动 / 碰撞 / 伤害 / 房间分型 / Boss 两阶段 / 死亡 / 重开
│   ├── gen/                   生成器适配层
│   │   ├── schema.js          输出契约校验器（rooms 3–8、room.type 可选）
│   │   ├── templates.js       6 套降级模板（3–8 房），按 hash(seed) 轮换 + 按主题重映射命名素材
│   │   └── index.js           buildRun / buildRequest / extractJson / SYSTEM_PROMPT / configure / callLLM
│   ├── theme/                 命名素材与视觉配置，不含规则
│   │   └── index.js           四套词表 + 四套独立色板 palette()/visual()；active()/setActive()
│   └── ui/                    渲染与交互
│       ├── render.js          Canvas 2D 程序化绘制：分主题背景 / 造型 / 后处理 / 打击反馈
│       ├── screens.js         开始页 / HUD / 主题选择器 / 2·3 选一词条卡 / 结算页 / 解锁页
│       ├── main.js            主循环、输入与事件编排
│       └── style.css          HUD / 面板 / 四套 [data-theme] 变量
└── tests/
    ├── smoke.js               M1 基线冒烟测试（20/20，禁止改动）
    ├── m2m3.js                M2/M3/M4 集成验收资产（360 组校验，Node 零依赖）
    └── fullsuite.js           M5「全套」跨层接线 + 节奏量化验收资产（Node / 零端口）
```

## 不变量（来自提示词）

- AI **只在每局开始前调用一次**生成关卡 JSON；战斗帧循环绝不调用 LLM。
- 所有关卡数据先过 JSON Schema 校验（`additionalProperties: false`、白名单、单调 threat、
  词条对互异、数值递增）再进渲染层。
- 生成失败 / 超时 / 非法 JSON / id 越界 → 8 秒内自动降级，**绝不阻塞开局**。
- 词条效果全部走 `id` 查表，关卡 JSON 内不得出现任何效果数值。
- 不引入游戏引擎、UI 组件库、后端服务；不做多人联机、账号、支付。

## 验收命令

在项目根目录执行（Node，零依赖、无需 `npm install`）：

```bash
node tests/smoke.js       # M1 基线：必须保持 20/20，严禁改动该文件
node tests/m2m3.js        # M2/M3/M4 验收资产：期望 0 failed / 0 waiting
node tests/fullsuite.js   # M5「全套」跨层接线 + 节奏量化：期望 0 failed
node --test tests/recall.js # 廊道回扫、站位 A/B、首领和重开
```

`tests/m2m3.js` 覆盖：① LLM 默认关闭 / 离线 fallback；② 未配置 / 超时 / 非法或纯文本 JSON /
schema 校验失败四类降级均返回 `source='fallback'`；③ **6 模板 × 4 主题 × 5 难度 × 3 seed = 360 组**
全部通过 `C.gen.schema.validate`；④ 三套新主题 vocab 结构与 geometry 同构、summary_lines 无
AI/生成/模型/LLM/token 禁用词；⑤ geometry 结果不回归。
其中「超时」场景会真实等待约 8 秒以走通 `AbortController` 降级链路，属正常耗时。

`tests/fullsuite.js` 用轻量 DOM stub 按 `index.html` 顺序加载入口脚本，验证
协同提示 / 三选一词条卡 / `roomEvent` / HUD 主题同步等跨层接线（§A），并按
`calibrate()` 同一公式采样 96 局给出**可复算的单局时长模型**、用真实 `engine.update()`
帧循环验证 6–8 房 + Boss 两阶段状态机可达（§B）。全程纯 Node，**不起端口、不起后台进程**。
§B 的时长含明示的命中率假设，**不是真人手感采样**，不能冒充 §8 第 6 条的验收结论。

**当前快照**（2026-11-17 总监集成复跑）：`smoke.js` 20/20；`m2m3.js` 58 passed / 0 failed /
0 waiting（含 360/360）；`fullsuite.js` 46 passed / 0 failed。逐条清单状态见 `docs/acceptance.md`。

---

首个硬性截止：**2026/11/30 18:00**（Qoder 高校创造力大赛提交）。
提交动作（`git add` / `commit` / `push`）由**开发总监统一执行**；qa-release 不执行任何提交。

## 提交形态缺口（截至 2026-11-17，如实上报）

官方天池赛题页要求：**用 Qoder 开发并部署到 Qoder Sites、设为公开访问**，
11/30 18:00 前发帖介绍作品（自我介绍 / 作品是什么 / 为什么做 / 怎么用 / 用 Qoder 做出来的过程），
建议多附截图；FAQ 明确「原则上不接受本地文件、压缩包」。

当前只有 GitHub 仓库 + `file://`，**提交形态不满足**：`git push` 只是代码同步，不等于大赛提交。
90 秒视频是可选社交分享材料，不替代作品帖。Qoder 账号、部署路径、作品帖五部分文案与
截图凭证须由用户确认后推进，开发总监不会擅自把作品发布到公网。
比赛对第三方素材无禁止条款，但「美术 / 音效 / 音乐全部程序化生成、未使用任何第三方素材」
更契合原创叙事与「评委点开就能访问」的体验，故本项目继续守住零美术资源路线。
