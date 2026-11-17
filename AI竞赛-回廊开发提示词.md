# 回廊 Corridor · 开发提示词 v1

> 整理日期：2026/11/17 ｜ 对应方案：D1「AI 生成关卡的轻量 Roguelite」｜ 首个硬截止：11/30 18:00（Qoder 高校创造力大赛）
>
> 本文件是可直接提交到代码仓库的纯文本版。配套的 HTML 版提供一键复制。

---

## 0. 这一版包含什么

| 段落 | 用途 | 谁用 |
|---|---|---|
| §1 System Prompt | 关卡生成器的系统提示词，直接作为 `system` 传入 | 生成器代码 |
| §2 JSON Schema | 输出契约，`additionalProperties: false` | 校验器 |
| §3 请求模板 | 每局调用的 `user` 消息拼装方式 | 生成器代码 |
| §4 Few-shot 合法输出 | 同时充当下发示例与第 1 套降级模板 | 生成器 + 测试 |
| §5 校验与降级 | 调用、校验、失败兜底的伪代码 | 生成器代码 |
| §6 词条表 v1 | 10 个词条的 id / 效果 / 叠加规则，客户端查表实现 | 规则引擎 |
| §7 开发启动提示词 | 整段贴给编程助手，直接开工 | 队友 / Coding Agent |
| §8 联调验收清单 | 接 AI 前后的自检项 | 全队 |

**设计前提**：AI 只在每局开始前调用一次，生成一份关卡 JSON；战斗循环的每一帧绝不调用 LLM。生成器失败必须降级，绝不阻塞开局。

---

## 1. 关卡生成器 · System Prompt

```text
你是浏览器 Roguelite 游戏「回廊」(Corridor) 的关卡生成器。

【职责边界】
你只负责生成一份描述本局关卡的 JSON。渲染、战斗判定、数值结算、UI 排版全部由客户端完成。你不是聊天助手，不要回答、不要解释、不要寒暄。

【输入】user message 是一个 JSON 对象：
- seed: string，本局随机种子，用于让输出有变化，不要原样回显
- difficulty: integer 1–5，本局难度系数
- run_index: integer，本会话第几局，从 1 开始
- theme: string，主题包 id
- theme_vocab: object，该主题包允许的命名素材，含 enemy_types / room_names / boss_names / color_tokens / summary_prefix
- unlocked: string[]，玩家已解锁的初始词条 id
- last_run: object | null，上一局结算摘要（survived_seconds / died_at_room / picked_perks / cleared），无则 null
- perk_pool: string[]，本局允许使用的词条 id 全集

【硬性约束】违反任意一条，输出即判无效：
1. 只输出一个 JSON 对象。禁止用 markdown 代码块包裹、禁止前后缀说明、禁止注释、禁止尾随逗号。
2. 字段名与结构严格遵循 §2 的 JSON Schema，additionalProperties 为 false，不得增删字段。
3. 所有枚举值必须取自 Schema 的 enum；所有 id 必须来自 perk_pool 或 theme_vocab，禁止自造 id、禁止改写 id 拼写。
4. rooms 长度 3–5；threat 按房间序号单调不减，且不小于 difficulty 对应的最低值。
5. 每个房间必须写明 path_hint：一条不依赖任何稀有词条也能走通的路线。
6. 每个房间的 perk_choices 恰好 2 个不同 id，且都来自 perk_pool；同一局内不同房间的组合尽量不要重复。
7. enemy.hp / enemy.damage / boss.hp / boss.damage 必须在 Schema 范围内，且随房间序号与 difficulty 递增。
8. 不生成美术资源、不生成代码、不调用工具。视觉只用 shape 与 color_token 两个枚举描述。
9. 词条效果由客户端按 id 查表实现。你只选 id，不要发明效果数值，也不要在 JSON 里写效果描述。
10. 自适应：若 last_run.died_at_room 不超过 1，本局前两个房间 threat 各下调 1 档（不低于 1）；若 last_run.cleared 为 true，本局所有 threat 上调 1 档（不高于 5）。
11. summary 不超过 80 字，风格跟随 theme，采用 theme_vocab.summary_prefix 的语气，不要出现「AI」「生成」「模型」等元信息词。

【输出前自检】
在心里逐条确认：JSON 可解析、字段无遗漏、所有 id 在白名单内、threat 单调、每房间有 path_hint、perk_choices 两两不同、数值在范围内。确认后才输出。
```

---

## 2. 输出契约 · JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CorridorRun",
  "type": "object",
  "additionalProperties": false,
  "required": ["run_id", "theme", "difficulty", "rooms", "boss", "reward_perk_pool", "summary"],
  "properties": {
    "run_id": { "type": "string", "description": "本局唯一标识，由 run_ 前缀、seed 前 8 位与 run_index 拼接" },
    "theme": { "type": "string", "enum": ["geometry", "oldtown", "subject", "wudang"] },
    "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
    "rooms": {
      "type": "array", "minItems": 3, "maxItems": 5,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["index", "name", "shape", "color_token", "threat", "enemies", "perk_choices", "path_hint"],
        "properties": {
          "index": { "type": "integer", "minimum": 0 },
          "name": { "type": "string", "maxLength": 16, "description": "房间名，取自 theme_vocab.room_names" },
          "shape": { "type": "string", "enum": ["arena", "corridor", "cross", "chamber"] },
          "color_token": { "type": "string", "enum": ["ink", "amber", "teal", "violet", "rust"] },
          "threat": { "type": "integer", "minimum": 1, "maximum": 5, "description": "本房间威胁等级，不得小于前一房间" },
          "enemies": {
            "type": "array", "minItems": 1, "maxItems": 4,
            "items": {
              "type": "object", "additionalProperties": false,
              "required": ["type", "count", "hp", "damage", "pattern"],
              "properties": {
                "type": { "type": "string", "description": "敌人 id，取自 theme_vocab.enemy_types" },
                "count": { "type": "integer", "minimum": 1, "maximum": 6 },
                "hp": { "type": "integer", "minimum": 10, "maximum": 120 },
                "damage": { "type": "integer", "minimum": 1, "maximum": 20 },
                "pattern": { "type": "string", "enum": ["chase", "orbit", "charge", "ranged", "static"] }
              }
            }
          },
          "perk_choices": {
            "type": "array", "minItems": 2, "maxItems": 2,
            "items": { "type": "string", "description": "词条 id，必须来自输入 perk_pool" },
            "description": "本房间二选一词条，两个 id 不得相同"
          },
          "path_hint": { "type": "string", "maxLength": 60, "description": "不依赖稀有词条的通关提示，用于可解性校验与 UI 提示" }
        }
      }
    },
    "boss": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "hp", "damage", "pattern", "weakness_perk"],
      "properties": {
        "name": { "type": "string", "description": "取自 theme_vocab.boss_names" },
        "hp": { "type": "integer", "minimum": 120, "maximum": 400 },
        "damage": { "type": "integer", "minimum": 8, "maximum": 30 },
        "pattern": { "type": "string", "enum": ["chase", "orbit", "charge", "ranged", "static"] },
        "weakness_perk": { "type": "string", "description": "克制它的词条 id，必须来自 perk_pool" }
      }
    },
    "reward_perk_pool": {
      "type": "array", "minItems": 3, "maxItems": 6,
      "items": { "type": "string", "description": "局外解锁候选，全部来自 perk_pool" }
    },
    "summary": { "type": "string", "maxLength": 80, "description": "一句本局主题文案，用于结算页，风格随 theme" }
  }
}
```

**主题包词表（geometry 默认）**

| 字段 | 取值 |
|---|---|
| `enemy_types` | `e_dot`, `e_orbit`, `e_charge`, `e_ranged`, `e_block` |
| `room_names` | 方庭, 折廊, 交集, 环室, 隙间 |
| `boss_names` | 合点, 重线, 闭域 |
| `color_tokens` | `ink`, `amber`, `teal`, `violet`, `rust` |
| `summary_prefix` | 冷静、几何感、不带情绪的短句 |

---

## 3. 每局请求模板 · user message

客户端先把占位符替换好，再 `JSON.stringify` 作为 `user` 传入：

```json
{
  "seed": "{{UUID}}",
  "difficulty": "{{clamp(1 + floor(run_index / 2), 1, 5)}}",
  "run_index": "{{run_index}}",
  "theme": "{{activeTheme}}",
  "theme_vocab": "{{THEME_VOCAB[activeTheme]}}",
  "unlocked": "{{unlockedPerkIds}}",
  "last_run": "{{lastRunSummary | null}}",
  "perk_pool": "{{PERK_IDS}}"
}
```

**调用参数建议**

| 项 | 值 | 说明 |
|---|---|---|
| `temperature` | 0.7 | 太高会破坏 schema，太低会局局雷同 |
| `max_tokens` | 1400 | 5 房间 + boss 足够 |
| `timeout` | 8000 ms | 超时立即降级，不阻塞开局 |
| `response_format` | 不依赖 | 各家支持不一，自行 `extractJson` |
| 调用次数 | 每局 1 次 | 房间渲染前调用，绝不放在帧循环里 |

---

## 4. Few-shot 合法输出 · 同时作为第 1 套降级模板

```json
{
  "run_id": "run_a1b2c3d4_1",
  "theme": "geometry",
  "difficulty": 1,
  "rooms": [
    {
      "index": 0,
      "name": "方庭",
      "shape": "arena",
      "color_token": "ink",
      "threat": 1,
      "enemies": [
        { "type": "e_dot", "count": 3, "hp": 14, "damage": 2, "pattern": "chase" }
      ],
      "perk_choices": ["p_dash", "p_hp"],
      "path_hint": "沿外圈绕行即可避开追击，不需要任何词条"
    },
    {
      "index": 1,
      "name": "折廊",
      "shape": "corridor",
      "color_token": "teal",
      "threat": 2,
      "enemies": [
        { "type": "e_dot", "count": 4, "hp": 18, "damage": 3, "pattern": "chase" },
        { "type": "e_orbit", "count": 1, "hp": 22, "damage": 4, "pattern": "orbit" }
      ],
      "perk_choices": ["p_thorn", "p_regen"],
      "path_hint": "贴墙推进可绕开环绕型敌人，普通攻击足以清场"
    },
    {
      "index": 2,
      "name": "交集",
      "shape": "cross",
      "color_token": "amber",
      "threat": 3,
      "enemies": [
        { "type": "e_charge", "count": 2, "hp": 26, "damage": 5, "pattern": "charge" },
        { "type": "e_ranged", "count": 2, "hp": 20, "damage": 4, "pattern": "ranged" }
      ],
      "perk_choices": ["p_crit", "p_slow"],
      "path_hint": "等待冲锋落空后从侧口通过，远程敌人可用掩体挡住"
    }
  ],
  "boss": {
    "name": "合点",
    "hp": 140,
    "damage": 9,
    "pattern": "orbit",
    "weakness_perk": "p_range"
  },
  "reward_perk_pool": ["p_chain", "p_shield", "p_greed"],
  "summary": "方与线再次相遇，走廊记住了你上次停下的位置。"
}
```

> 建议内置 3 套结构不同的降级模板（3 / 4 / 5 房间各一套），按 `hash(seed)` 轮换，避免连续失败时三局一模一样。

---

## 5. 校验与降级 · 伪代码

```js
async function buildRun(input) {
  const FALLBACKS = [RUN_TEMPLATE_A, RUN_TEMPLATE_B, RUN_TEMPLATE_C];
  try {
    const raw = await callLLM({
      system: SYSTEM_PROMPT,
      user: JSON.stringify(input),
      temperature: 0.7,
      max_tokens: 1400,
      timeoutMs: 8000
    });
    const run = JSON.parse(extractJson(raw));
    assertSchema(run, SCHEMA);                       // ajv 或手写
    assertWhitelist(run, input.perk_pool, input.theme_vocab);
    assertMonotonicThreat(run.rooms);
    assertDistinctPerkPairs(run.rooms);
    assertNumericRanges(run, SCHEMA);
    return { run, source: "llm" };
  } catch (err) {
    telemetry("run_fallback", { reason: err.message, seed: input.seed });
    const tpl = FALLBACKS[hash(input.seed) % FALLBACKS.length];
    return { run: reseed(tpl, input), source: "fallback" };
  }
}

function extractJson(raw) {
  const s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
}
```

**5 条必须实现的校验**

1. Schema：`additionalProperties: false`、枚举、min/max、数组长度
2. 白名单：所有 `type` / `perk_choices` / `weakness_perk` / `reward_perk_pool` 的 id 都在输入集合内
3. 单调性：`rooms[i].threat` 不小于 `rooms[i-1].threat`
4. 词条对：每个 `perk_choices` 恰好 2 个且互不相同
5. 数值：hp / damage 在范围内，且随房间序号与 difficulty 递增

**四种必须能降级的失败场景**：断网、超时、返回纯文本、返回被代码块包裹的 JSON。

---

## 6. 词条表 v1（客户端查表实现，生成器只选 id）

| id | 名称 | 效果 | 稀有度 | 叠加 |
|---|---|---|---|---|
| `p_dash` | 疾步 | 冲刺冷却 -20% | 普通 | 可，最多 3 层 |
| `p_hp` | 硬壳 | 最大生命 +20 并回复等量 | 普通 | 可 |
| `p_thorn` | 反刺 | 受击时对来源反弹 3 点伤害 | 普通 | 可，每层 +3 |
| `p_regen` | 回响 | 每通过一间房回复 8 生命 | 普通 | 可，每层 +8 |
| `p_range` | 远击 | 攻击距离 +1 格 | 稀有 | 可，最多 2 层 |
| `p_crit` | 锐眼 | 15% 概率造成双倍伤害 | 稀有 | 可，概率叠加 |
| `p_slow` | 凝滞 | 敌人移动速度 -15% | 稀有 | 可，最多 2 层 |
| `p_chain` | 连锁 | 击杀时 30% 概率波及相邻敌人 | 稀有 | 不可 |
| `p_shield` | 余烬 | 每局首次致命伤保留 1 点生命 | 史诗 | 不可 |
| `p_greed` | 贪取 | 结算金币 +50%，但敌人伤害 +2 | 史诗 | 不可 |

**约束**：效果数值只允许写在词条表里。关卡 JSON 里出现任何效果数值都视为生成器越界，校验器应直接判失败。

---

## 7. 开发启动提示词 · 整段贴给编程助手

```text
你要在一个空白目录里从零实现浏览器 Roguelite 游戏「回廊」(Corridor) 的可玩 MVP，13 天内交付，首个硬性截止是 11/30 18:00（Qoder 高校创造力大赛提交）。

【产品】
单页浏览器游戏，打开即玩。每局 AI 生成 3–5 个房间，玩家用键盘或鼠标在俯视角单屏里移动与攻击，每通过一间房从两个词条里选一个，死亡后立刻重开，局外用金币解锁初始词条。单局目标 3–5 分钟。默认主题为「抽象几何」：只用程序化色块与符号，零美术资源。

【技术约束】
- 原生 JavaScript + Canvas 2D，或 Vite 加一个轻量框架；不引入游戏引擎、不引入 UI 组件库
- 无后端、无账号；断网也能玩，进度存 localStorage
- AI 只在每局开始前调用一次，生成关卡 JSON；战斗循环的每一帧绝不调用 LLM
- 必须内置至少 3 套降级关卡模板；生成失败、超时、JSON 非法、id 越界时自动降级，且不能阻塞开局
- 所有关卡数据先过 JSON Schema 校验再进渲染层

【代码分层，按此顺序实现】
1. core/：规则引擎（移动、碰撞、伤害、词条效果、死亡与重开）——先写成完全不依赖 AI 的可玩闭环
2. gen/：生成器适配层（system prompt 常量、请求拼装、extractJson、schema 校验、降级模板）
3. theme/：主题包（geometry 默认，另留 oldtown / subject / wudang 的空壳接口），只放命名素材与配色，不放规则
4. ui/：开始页、房间 HUD、二选一词条弹窗、结算页、局外解锁页

【交付顺序，重要】
先交付第 1 步的「无 AI 可玩骨架」：用预置关卡模板能连玩三局、能死、能重开、能选词条。确认手感后再接第 2 步的生成器。不要一上来就调 LLM。

【验收标准】
- 不联网：预置模板能完整玩三局
- 联网：连开五局，房间组合与词条选择不重复
- 断网 / 超时 / 返回非法 JSON：8 秒内自动降级，游戏继续
- 单局 3–5 分钟，死亡后一键重开
- 90 秒演示视频必须录到两局明显不同的关卡

【明确不做】
不要多人联机、账号体系、后端服务、实时生成美术、每帧调用 LLM、模型微调、支付接入，也不要为某个比赛单独做第二个作品。

【参考】
完整 system prompt、JSON Schema、few-shot 降级模板、词条表见同目录《AI竞赛-回廊开发提示词》；方向背景见《AI竞赛-作品方向规划》；时间与报名见《AI竞赛-一稿多投作战看板》。

现在从第 1 步开始，先给出文件结构与规则引擎的实现，不要一上来写完整游戏。
```

---

## 8. 联调验收清单

- [ ] 校验器能拒绝一段故意写错的 JSON（多字段 / 枚举越界 / 自造 id）
- [ ] 断网、超时、返回纯文本、返回被代码块包裹的 JSON，四种情况都能降级
- [ ] 3 套降级模板轮换生效，连续失败三次不会三局一模一样
- [ ] 连开 5 局：房间数、threat 序列、perk_choices 组合不重复
- [ ] 词条效果全部走 id 查表，关卡 JSON 里没有硬编码效果数值
- [ ] 单局 3–5 分钟，死亡后一键重开，localStorage 进度正确
- [ ] 90 秒演示视频录到两局不同关卡；记录重开率与单局时长
- [ ] 11/30 18:00 前完成 Qoder 高校创造力大赛提交

---

*对应方案与截止时间以《AI 创意类比赛清单》及各官网最新公告为准。提示词版本：v1 / 2026-11-17。*
