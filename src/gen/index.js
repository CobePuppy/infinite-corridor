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

  /* M2 接入点：温度 0.7 / max_tokens 1400 / timeout 8000ms */
  function callLLM(opts) {
    return Promise.reject(new Error('LLM 适配器尚未启用（M1 阶段）'));
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
  C.gen.LLM_ENABLED = function () { return LLM_ENABLED; };
  C.gen.telemetry = telemetry;
})(window.Corridor = window.Corridor || {});
