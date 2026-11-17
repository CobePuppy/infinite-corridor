# ∞ 回廊 · INFINITE CORRIDOR

> 一局一廊，走廊记得你停在哪。
>
> 浏览器单页 Roguelite，Qoder 高校创造力大赛参赛作品。默认主题「抽象几何」：
> 只用程序化色块与符号，**零美术资源、零音频文件、零后端、零账号**。

## 运行

**直接双击 `index.html` 即可玩**（纯静态、无构建、无依赖、无 ES module，因此 `file://` 下也能打开）。
如需本地服务：`python -m http.server 8080` 后访问 `http://localhost:8080`。
进度（金币、已解锁词条、最佳时长）存 `localStorage`，断网可玩。

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

## 当前进度：M1 无 AI 可玩骨架

按《AI竞赛-回廊开发提示词》§7 的交付顺序，**先做完全不依赖 AI 的可玩闭环，确认手感后再接生成器**。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | `core/` 规则引擎 + 3 套降级模板 + 完整 UI，能连玩三局、能死、能重开、能选词条 | ✅ 本次交付 |
| M2 | `gen/` 接入 LLM（system prompt 常量、请求拼装、8s 超时、5 条校验、四类降级） | ⏳ 结构已就位，`LLM_ENABLED=false` |
| M3 | `theme/` 补齐 oldtown / subject / 武当 三套主题词表 | ⏳ 空壳接口已留 |
| M4 | §8 联调验收全过 + 90 秒演示视频 | ⏳ |

**M1 里绝不调用 LLM**：`src/gen/index.js` 的 `LLM_ENABLED = false`，`buildRun()` 只走降级模板。
M2 只需打开该开关并实现 `callLLM()`，校验与降级链路无需改动。

## 目录结构

```
corridor/
├── index.html                 单页入口（script 顺序加载，非 module）
├── README.md
├── AI竞赛-回廊开发提示词.md   原始需求文档（可直接提交仓库）
├── src/
│   ├── core/                  规则层：完全不依赖 AI
│   │   ├── perks.js           词条表 v1 —— 唯一允许写效果数值的地方
│   │   ├── audio.js           WebAudio 程序化音效，零音频资源
│   │   └── engine.js          移动 / 碰撞 / 伤害 / 房间 / 死亡 / 重开
│   ├── gen/                   生成器适配层
│   │   ├── schema.js          输出契约校验器（§5 的五条校验）
│   │   ├── templates.js       3 套结构不同的降级模板，按 hash(seed) 轮换
│   │   └── index.js           buildRun / buildRequest / extractJson / SYSTEM_PROMPT
│   ├── theme/                 命名素材与配色，不含规则
│   │   └── index.js           geometry 默认 + 三个空壳接口
│   └── ui/                    渲染与交互
│       ├── render.js          Canvas 2D 程序化绘制
│       ├── screens.js         开始页 / HUD / 词条弹窗 / 结算页 / 解锁页
│       ├── main.js            主循环与输入
│       └── style.css
└── tests/
    └── smoke.js               Node 冒烟测试：校验器、降级、防重复、extractJson
```

## 不变量（来自提示词）

- AI **只在每局开始前调用一次**生成关卡 JSON；战斗帧循环绝不调用 LLM。
- 所有关卡数据先过 JSON Schema 校验（`additionalProperties: false`、白名单、单调 threat、
  词条对互异、数值递增）再进渲染层。
- 生成失败 / 超时 / 非法 JSON / id 越界 → 8 秒内自动降级，**绝不阻塞开局**。
- 词条效果全部走 `id` 查表，关卡 JSON 内不得出现任何效果数值。
- 不引入游戏引擎、UI 组件库、后端服务；不做多人联机、账号、支付。

## 冒烟测试

```bash
node tests/smoke.js
```

覆盖：3 套模板 × 5 档难度全部通过校验、连开 5 局房间组合不重复、
故意写错的 JSON 被拒绝、`extractJson` 对代码块包裹 / 前后缀说明 / 纯文本的容错。

---

首个硬性截止：**2026/11/30 18:00**（Qoder 高校创造力大赛提交）。
