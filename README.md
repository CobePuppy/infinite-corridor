# ∞ 回廊 · INFINITE CORRIDOR

> 一局一廊，走廊记得你停在哪。
>
> 浏览器单页 Roguelite，Qoder 高校创造力大赛参赛作品。默认主题「抽象几何」，另备
> 「旧城 / 学科 / 武当」三套主题可在开始页切换：只用程序化色块与符号，
> **零美术资源、零音频文件、零后端、零账号、零构建**。

## 运行

**直接双击 `index.html` 即可玩**（纯静态、无构建、无依赖、无 ES module，因此 `file://` 下也能打开）。
如需本地服务：`python -m http.server 8080` 后访问 `http://localhost:8080`。
进度（金币、已解锁词条、最佳时长）存 `localStorage`，断网可玩。

游戏本身不需要 Node；下方的**验收脚本**需要 Node（零依赖，无需 `npm install`，无构建步骤）。

## 操作

| 输入 | 作用 |
|---|---|
| `W A S D` / 方向键 | 移动（带惯性与加减速） |
| 鼠标移动 | 瞄准 |
| 鼠标左键 / 空格 / `J` | 攻击 |
| `Shift` | 冲刺，短暂无敌 |
| `Esc` | 暂停 |
| `M` | 静音开关 |
| `R` / `Enter` | 结算页一键重开 |

每局 3–5 个房间 + 1 个首领。清空房间后右侧出口开启，走到出口从两个词条里选一个，
死亡或通关后立刻结算，金币可在「局外解锁」页换取开局自带的初始词条。

**主题切换**：开始页「主题」选择器可在 `抽象几何 / 旧城 / 学科 / 武当` 四套主题间切换，
当前主题存 `corridor.theme.v1`，HUD 显示主题标签。切换只换命名素材、文案与配色，规则与数值不变。

## 里程碑状态

> 本表由 qa-release 在三方并行开发期间按**当前代码快照**如实标注。
> gen-dev(M2) / theme-dev(M3) 的改动仍可能继续，**以下不代表验收通过**；
> 最终集成验收由**开发总监在三方汇合后亲自复跑** `node tests/smoke.js` 与 `node tests/m2m3.js` 后确认。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | `core/` 规则引擎 + 3 套降级模板 + 完整 UI，能连玩三局、能死、能重开、能选词条 | ✅ 已交付（基线：`tests/smoke.js` 20/20，禁止改动） |
| M2 | `gen/` 接入可配置 LLM：`corridor.llm.v1` / `C.gen.configure()`、`AbortController` 8s 超时、四类失败自动降级 | ✅ 代码已落地（gen-dev）· ✅ 集成复跑通过（smoke 20/20、m2m3 58/0/0） |
| M3 | `theme/` 补齐 oldtown / subject / 武当 三套词表 + 主题切换 UI + 降级模板按主题重映射命名素材 | ✅ 代码已落地（theme-dev）· ✅ 集成复跑通过（180/180 组校验） |
| M4 | §8 联调验收全过 + 90 秒演示视频 | ⏳ 验收资产已备（`tests/m2m3.js`、`docs/acceptance.md`、`docs/demo-90s.md`）；2026-11-17 开发总监复跑完成，§8 第 1–5 条通过，第 6–8 条（人工试玩 / 90 秒视频 / 大赛提交）待办 |

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
│   └── demo-90s.md            90 秒演示分镜 + 重开率 / 单局时长记录表
├── src/
│   ├── core/                  规则层：完全不依赖 AI
│   │   ├── perks.js           词条表 v1 —— 唯一允许写效果数值的地方
│   │   ├── audio.js           WebAudio 程序化音效，零音频资源
│   │   └── engine.js          移动 / 碰撞 / 伤害 / 房间 / 死亡 / 重开 / 主题注入
│   ├── gen/                   生成器适配层
│   │   ├── schema.js          输出契约校验器（§5 的五条校验）
│   │   ├── templates.js       3 套降级模板，按 hash(seed) 轮换 + 按主题重映射命名素材
│   │   └── index.js           buildRun / buildRequest / extractJson / SYSTEM_PROMPT / configure / callLLM
│   ├── theme/                 命名素材与配色，不含规则
│   │   └── index.js           geometry + oldtown/subject/wudang 四套词表；active()/setActive()
│   └── ui/                    渲染与交互
│       ├── render.js          Canvas 2D 程序化绘制
│       ├── screens.js         开始页 / HUD / 主题选择器 / 词条弹窗 / 结算页 / 解锁页
│       ├── main.js            主循环与输入
│       └── style.css
└── tests/
    ├── smoke.js               M1 基线冒烟测试（20/20，禁止改动）
    └── m2m3.js                M4 集成验收资产（Node，零依赖）
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
node tests/smoke.js     # M1 基线：必须保持 20/20，严禁改动该文件
node tests/m2m3.js      # M4 集成验收资产：期望 0 failed / 0 waiting
```

`tests/m2m3.js` 覆盖：① LLM 默认关闭 / 离线 fallback；② 未配置 / 超时 / 非法或纯文本 JSON /
schema 校验失败四类降级均返回 `source='fallback'`；③ 3 模板 × 4 主题 × 5 难度 × 3 seed = 180 组
全部通过 `C.gen.schema.validate`；④ 三套新主题 vocab 结构与 geometry 同构、summary_lines 无
AI/生成/模型/LLM/token 禁用词；⑤ geometry 结果不回归。
其中「超时」场景会真实等待约 8 秒以走通 `AbortController` 降级链路，属正常耗时。

**当前快照**（并行会话落地后，非验收结论）：`smoke.js` 20/20；`m2m3.js` 58 passed / 0 failed /
0 waiting（含 180/180）。逐条清单状态与「待复跑命令清单」见 `docs/acceptance.md`。

---

首个硬性截止：**2026/11/30 18:00**（Qoder 高校创造力大赛提交）。
提交动作（`git add` / `commit` / `push`）由**开发总监统一执行**；qa-release 不执行任何提交。
