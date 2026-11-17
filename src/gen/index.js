/* gen/index.js — 生成器适配层
 * M1：LLM_ENABLED = false，buildRun() 只走 3 套降级模板，全程不发起任何网络请求。
 * M2：把 LLM_ENABLED 打开并实现 callLLM()，其余校验/降级链路无需改动。
 * 不变量：AI 每局最多调用 1 次；战斗帧循环绝不调用；失败必须降级且不阻塞开局。
 */
(function (C) {
  'use strict';

  var LLM_ENABLED = false;

  var SYSTEM_PROMPT = [
    '你是浏览器 Roguelite 游戏「∞ 回廊」(Infinite Corridor) 的关卡生成器。',
    '',
    '【职责边界】你只负责生成一份描述本局关卡的 JSON。渲染、战斗判定、数值结算、UI 排版全部由客户端完成。你不是聊天助手，不要回答、不要解释、不要寒暄。',
    '',
    '【硬性约束】违反任意一条，输出即判无效：',
    '1. 只输出一个 JSON 对象。禁止 markdown 代码块包裹、禁止前后缀说明、禁止注释、禁止尾随逗号。',
    '2. 字段名与结构严格遵循 JSON Schema，additionalProperties 为 false，不得增删字段。',
    '3. 所有枚举值必须取自 Schema 的 enum；所有 id 必须来自 perk_pool 或 theme_vocab，禁止自造 id。',
    '4. rooms 长度 3-5；threat 按房间序号单调不减，且不小于 difficulty 对应的最低值。',
    '5. 每个房间必须写明 path_hint：一条不依赖任何稀有词条也能走通的路线。',
    '6. 每个房间的 perk_choices 恰好 2 个不同 id，且都来自 perk_pool；同一局内组合尽量不要重复。',
    '7. enemy.hp / enemy.damage / boss.hp / boss.damage 必须在范围内，且随房间序号与 difficulty 递增。',
    '8. 不生成美术资源、不生成代码、不调用工具。视觉只用 shape 与 color_token 两个枚举描述。',
    '9. 词条效果由客户端按 id 查表实现。你只选 id，不要发明效果数值。',
    '10. 自适应：若 last_run.died_at_room 不超过 1，本局前两个房间 threat 各下调 1 档（不低于 1）；若 last_run.cleared 为 true，本局所有 threat 上调 1 档（不高于 5）。',
    '11. summary 不超过 80 字，风格跟随 theme，不要出现「AI」「生成」「模型」等元信息词。',
    '',
    '【输出前自检】JSON 可解析、字段无遗漏、所有 id 在白名单内、threat 单调、每房间有 path_hint、perk_choices 两两不同、数值在范围内。确认后才输出。'
  ].join('\n');

  /* §3 请求模板：客户端替换占位符后 JSON.stringify 作为 user 传入 */
  function buildRequest(input) {
    return {
      seed: input.seed,
      difficulty: input.difficulty,
      run_index: input.run_index,
      theme: input.theme,
      theme_vocab: input.theme_vocab,
      unlocked: input.unlocked || [],
      last_run: input.last_run || null,
      perk_pool: input.perk_pool
    };
  }

  /* 容错：剥掉代码块包裹、前后缀说明，只留最外层 JSON */
  function extractJson(raw) {
    var s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a === -1 || b < a) throw new Error('未找到 JSON 对象');
    return s.slice(a, b + 1);
  }

  /* ---------- M2：可配置 LLM 适配器 ----------
   * 配置全部来自 localStorage（键 corridor.llm.v1），由用户自行填写，绝不内置密钥。
   * 只用浏览器原生 fetch + AbortController，不引入任何 npm 依赖 / 后端服务；
   * LLM 关闭时 buildRun 不发起任何网络请求，file:// 离线可玩保持不变。
   */
  var CONFIG_KEY = 'corridor.llm.v1';

  function readConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      return (c && typeof c === 'object' && !Array.isArray(c)) ? c : null;
    } catch (e) { return null; }
  }

  function writeConfig(c) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) { /* 无痕/配额忽略 */ }
  }

  /* isEnabled：读是否尝试 LLM 分支的显式开关（config.enabled === true）。
   * 配置完整度不在本函数判定，而交给 callLLM，使「已开启但 endpoint/apiKey/model 缺失」
   * 也进入 LLM 分支并落到既有 telemetry('run_fallback') + fallback()。
   * 同时把结果同步到闭包变量 LLM_ENABLED，使完全未改动的 buildRun 能感知开关。 */
  function isEnabled() {
    var c = readConfig();
    LLM_ENABLED = !!(c && c.enabled === true);
    return LLM_ENABLED;
  }

  /* 最小公开接口：configure(opts) 合并写入 {endpoint, apiKey, model, enabled}。
   * 开启：C.gen.configure({ endpoint, apiKey, model, enabled: true })
   * 关闭：C.gen.configure({ enabled: false })
   * 返回是否启用。 */
  function configure(opts) {
    opts = opts || {};
    var c = readConfig() || { endpoint: '', apiKey: '', model: '', enabled: false };
    ['endpoint', 'apiKey', 'model'].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(opts, k)) {
        c[k] = String(opts[k] == null ? '' : opts[k]);
      }
    });
    if (Object.prototype.hasOwnProperty.call(opts, 'enabled')) c.enabled = !!opts.enabled;
    writeConfig(c);
    return isEnabled();
  }

  /* M2 接入点：温度 0.7 / max_tokens 1400 / timeout 8000ms 均由 buildRun 传入。
   * 返回模型输出文本，交回 buildRun 既有的 extractJson + JSON.parse + schema.validate。 */
  function callLLM(opts) {
    opts = opts || {};
    var cfg = readConfig();
    if (!cfg || cfg.enabled !== true) {
      return Promise.reject(new Error('LLM 未启用'));
    }
    if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
      return Promise.reject(new Error('LLM 未配置（endpoint / apiKey / model 缺失）'));
    }

    var controller = new AbortController();
    var timeoutMs = opts.timeoutMs || 8000;
    var timer;
    /* 独立超时 promise：即便底层 fetch 未及时响应 signal，也在 timeoutMs 后强制拒绝，
     * 同时 controller.abort() 真正中断请求，硬保证「失败 8 秒内降级、绝不阻塞开局」。 */
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        try { controller.abort(); } catch (e) { /* 忽略 */ }
        reject(new Error('LLM 请求超时（' + timeoutMs + 'ms）'));
      }, timeoutMs);
    });

    var payload = {
      model: cfg.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      temperature: opts.temperature,
      max_tokens: opts.max_tokens,
      stream: false
    };

    var request = fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) throw new Error('LLM HTTP ' + res.status);
      return res.text();
    });

    return Promise.race([request, timeout]).then(function (body) {
      clearTimeout(timer);
      /* 兼容 OpenAI 风格 {choices:[{message:{content}}]}；否则整段文本即模型输出。 */
      try {
        var parsed = JSON.parse(body);
        if (parsed && Array.isArray(parsed.choices) && parsed.choices[0] &&
            parsed.choices[0].message && typeof parsed.choices[0].message.content === 'string') {
          return parsed.choices[0].message.content;
        }
      } catch (e) { /* 非外层 JSON：按纯文本交给 extractJson 处理 */ }
      return body;
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('LLM 请求超时（' + timeoutMs + 'ms）');
      throw err;
    });
  }

  function telemetry(event, payload) {
    try {
      var log = JSON.parse(localStorage.getItem('corridor.telemetry') || '[]');
      log.push({ t: Date.now(), event: event, payload: payload });
      localStorage.setItem('corridor.telemetry', JSON.stringify(log.slice(-30)));
    } catch (e) { /* 遥测失败绝不影响开局 */ }
  }

  function fallback(input, reason) {
    var T = C.gen.templates;
    var idx = T.hash(input.seed) % T.TEMPLATES.length;
    var run = T.reseed(T.TEMPLATES[idx], input);
    var v = C.gen.schema.validate(run, input);
    if (!v.ok) throw new Error('降级模板自身校验失败: ' + v.errors.join('; '));
    return { run: run, source: 'fallback', templateIndex: idx, reason: reason || 'm1_no_llm' };
  }

  async function buildRun(input) {
    if (LLM_ENABLED) {
      try {
        var raw = await callLLM({
          system: SYSTEM_PROMPT,
          user: JSON.stringify(buildRequest(input)),
          temperature: 0.7,
          max_tokens: 1400,
          timeoutMs: 8000
        });
        var run = JSON.parse(extractJson(raw));
        var v = C.gen.schema.validate(run, input);
        if (!v.ok) throw new Error('schema: ' + v.errors.join('; '));
        return { run: run, source: 'llm' };
      } catch (err) {
        telemetry('run_fallback', { reason: err.message, seed: input.seed });
        return fallback(input, err.message);
      }
    }
    return fallback(input, 'm1_no_llm');
  }

  C.gen = C.gen || {};
  C.gen.buildRun = buildRun;
  C.gen.buildRequest = buildRequest;
  C.gen.extractJson = extractJson;
  C.gen.SYSTEM_PROMPT = SYSTEM_PROMPT;
  C.gen.LLM_ENABLED = function () { return isEnabled(); };
  C.gen.telemetry = telemetry;
  C.gen.configure = configure;
  C.gen.isEnabled = isEnabled;

  /* 模块加载时同步一次开关：无配置时保持 false（默认关闭、离线零网络）。 */
  isEnabled();
})(window.Corridor = window.Corridor || {});
