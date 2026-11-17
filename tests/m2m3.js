/* tests/m2m3.js — M4 集成验收资产（Node，零依赖，零构建）
 * 运行：node tests/m2m3.js
 *
 * 作者：qa-release（QA / 发布工程师）
 * 定位：这是「验收资产」，不是「验收结论」。gen-dev(M2) 与 theme-dev(M3) 正并行改动，
 *       历史：三方汇合前不宣告通过；2026-11-17 已由开发总监完成集成复跑（58/0/0）。
 *
 * 硬性边界（务必遵守）：
 *   - 本文件只 require core / gen / theme 三层，不加载 ui（避免 DOM 依赖）。
 *   - 引导方式与 require 顺序完全仿照 tests/smoke.js（global.window / global.localStorage）。
 *   - 绝不修改 src/** 与 tests/smoke.js；绝不为让测试变绿去改被测代码。
 *   - 不引入 npm 依赖、不引入构建步骤。
 *
 * 覆盖（对应 T5）：
 *   ① LLM 开关默认关闭、离线仍走 fallback；
 *   ② 未配置 / 超时 / 返回非法或纯文本 JSON / schema 校验失败，四类降级均返回 source='fallback'；
 *   ③ 6 套模板 × 4 主题 × 5 难度 × 3 seed = 360 组全部通过 C.gen.schema.validate；
 *   ④ 三套新主题 vocab 结构完整且与 geometry 同构、summary_lines 无 AI/生成/模型/LLM/token 禁用词；
 *   ⑤ geometry（默认主题）结果不回归。
 *
 * 结果分三类计数（如实区分，不粉饰）：
 *   PASS  — 断言真成立（当前代码即可验证）。
 *   FAIL  — 断言不成立（真实逻辑缺陷，集成后仍须修复）。
 *   WAIT  — 因 M2 未落地或三方联调未完成而无法验证 / 未通过，逐条标注真实原因，计入未通过。
 *   退出码：有 FAIL 或 WAIT 即为 1（未全绿）；三方汇合后复跑应为 0。
 *
 * ── M2 契约（与 gen-dev 落地实现对齐）──────────────────────────────────
 *   · 默认关闭：无 corridor.llm.v1 配置或 enabled 非 true 时，buildRun() 直接走降级模板、
 *     不发起任何网络请求（离线可玩）。
 *   · 配置键（localStorage）：corridor.llm.v1 = JSON 对象
 *       { enabled, endpoint, apiKey, model }
 *     或调用 C.gen.configure({ enabled, endpoint, apiKey, model }) 写入同一份配置。
 *   · 调用：fetch(endpoint, { signal }) + AbortController，超时 8000ms 触发 abort；
 *     响应经 extractJson + JSON.parse + schema.validate。
 *   · 四类失败（未配置 / 超时 / 非法或纯文本 JSON / schema 校验失败）一律降级为
 *     { run, source:'fallback' }，且降级关卡必须通过 schema.validate，绝不阻塞开局。
 *   · 测试桩会监听 fetch 的 options.signal 并在 abort 时以 AbortError 拒绝，
 *     以真实走通 8s 超时 → 降级链路（否则超时场景会被误判为失败）。
 *
 * ── M3 契约（与 theme-dev 落地实现对齐）────────────────────────────────
 *   · oldtown / subject / wudang：ready=true，vocab 结构与 geometry 同构
 *     （键集合 = enemy_types / room_names / boss_names / color_tokens / summary_prefix，
 *      四个数组均为非空字符串数组，color_tokens 取值须在 schema.ENUM.color_token 内），
 *     summary_lines 为非空数组，每条 ≤80 字且不含 AI/生成/模型/LLM/token 元信息词。
 *   · gen/templates.js 的 reseed() 按「geometry 索引 → 当前词表同索引项」重映射命名素材，
 *     故 6 模板 × 4 主题 × 5 难度 × 3 seed = 360 组均应通过 schema.validate。
 *   · 主题切换：C.theme.active() / setActive()，键 corridor.theme.v1；HUD 显示当前主题。
 * ────────────────────────────────────────────────────────────────────────
 */
'use strict';

/* ---- 引导：与 tests/smoke.js 完全一致 ---- */
global.window = global;
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

var base = require('path').join(__dirname, '..', 'src');
require(base + '/core/perks.js');
require(base + '/core/audio.js');
require(base + '/core/engine.js');
require(base + '/theme/index.js');
require(base + '/gen/templates.js');
require(base + '/gen/schema.js');
require(base + '/gen/index.js');

var C = global.Corridor;

/* ---- 计数与断言 ---- */
var passed = 0, failed = 0, waiting = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function wait(name, reason) {
  waiting++;
  console.log('  WAIT  ' + name + '  → ' + reason);
}
function section(t) { console.log('\n' + t); }

/* ---- 公共常量与辅助 ---- */
var THEME_IDS = ['geometry', 'oldtown', 'subject', 'wudang'];
var NEW_THEME_IDS = ['oldtown', 'subject', 'wudang'];
var DIFFS = [1, 2, 3, 4, 5];
var SEEDS = ['s-a1', 's-b2', 's-c3'];                 // 与 smoke.js 一致的 3 个 seed
var FORBIDDEN = ['AI', '生成', '模型', 'LLM', 'token']; // 与 schema.js FORBIDDEN_SUMMARY 一致
var LLM_CFG_KEY = 'corridor.llm.v1';   // M2 实际使用的配置键（单个 JSON 对象）
var LLM_ENDPOINT = 'https://llm.invalid/v1/chat/completions';
var LLM_API_KEY = 'qa-placeholder';
var LLM_MODEL = 'qa-model';

function mkInput(seed, difficulty, themeId, lastRun) {
  var t = C.theme.get(themeId);
  return {
    seed: seed,
    difficulty: difficulty,
    run_index: 1,
    theme: themeId,
    theme_vocab: t.vocab,          // 忠实还原 §3 请求模板：当前主题自己的词表
    unlocked: [],
    last_run: lastRun || null,
    perk_pool: C.core.perks.IDS.slice()
  };
}

/* 禁用词：精确匹配 5 个词 + 拉丁词大小写不敏感兜底 */
function hasForbidden(str) {
  if (typeof str !== 'string') return false;
  for (var i = 0; i < FORBIDDEN.length; i++) {
    if (str.indexOf(FORBIDDEN[i]) !== -1) return true;
  }
  return /(ai|llm|token)/i.test(str);
}

/* validate 防御包裹：空壳主题等异常输入不得让脚本整体崩溃 */
function safeValidate(run, input) {
  try { return C.gen.schema.validate(run, input); }
  catch (e) { return { ok: false, errors: ['validate 抛异常: ' + e.message] }; }
}

/* 给可能挂起的 buildRun 加一层测试保护（M2 未实现 8s 超时时不会拖死脚本） */
function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error('测试保护超时 ' + ms + 'ms（疑似未实现 8s 降级超时）'));
    }, ms);
    Promise.resolve(p).then(
      function (v) { clearTimeout(timer); resolve(v); },
      function (e) { clearTimeout(timer); reject(e); }
    );
  });
}

/* ---- LLM 配置 / 网络桩（仅 ①② 使用，用完即恢复，避免污染其它小节）---- */
function clearLLMConfig() {
  localStorage.removeItem(LLM_CFG_KEY);
  if (typeof C.gen.configure === 'function') {
    try { C.gen.configure({ enabled: false }); } catch (e) { /* 契约未落地，忽略 */ }
  }
}
/* 完整配置：同时覆盖「用户手动在 localStorage 填 JSON」与 configure() 两条路径 */
function writeLLMConfig() {
  localStorage.setItem(LLM_CFG_KEY, JSON.stringify({
    enabled: true, endpoint: LLM_ENDPOINT, apiKey: LLM_API_KEY, model: LLM_MODEL
  }));
  if (typeof C.gen.configure === 'function') {
    try {
      C.gen.configure({ enabled: true, endpoint: LLM_ENDPOINT, apiKey: LLM_API_KEY, model: LLM_MODEL });
    } catch (e) { /* 契约未落地，忽略 */ }
  }
}
/* 仅开启开关、故意缺 endpoint/apiKey/model —— 用于「未配置」降级场景 */
function writePartialConfig() {
  localStorage.setItem(LLM_CFG_KEY, JSON.stringify({ enabled: true }));
  if (typeof C.gen.configure === 'function') {
    try { C.gen.configure({ enabled: true }); } catch (e) { /* 契约未落地，忽略 */ }
  }
}
/* 兼容 M2 用 .text() 或 .json() 读取响应 */
function fakeResponse(raw, parseOk) {
  return Promise.resolve({
    ok: true, status: 200,
    text: function () { return Promise.resolve(raw); },
    json: function () {
      if (!parseOk) return Promise.reject(new Error('invalid json'));
      return Promise.resolve(JSON.parse(raw));
    }
  });
}

/* ---- 主流程 ---- */
(async function () {
  try {
    /* ========== ① LLM 开关默认关闭 · 离线仍走 fallback ========== */
    section('1. LLM 开关默认关闭 · 离线仍走 fallback');
    check('C.gen.LLM_ENABLED 存在且为函数', typeof C.gen.LLM_ENABLED === 'function');
    check('默认关闭：LLM_ENABLED() === false',
      typeof C.gen.LLM_ENABLED === 'function' && C.gen.LLM_ENABLED() === false);

    var prevFetch = global.fetch;
    var offlineHits = 0;
    global.fetch = function () {
      offlineHits++;
      return Promise.reject(new Error('offline（离线模拟）'));
    };
    var aInput = mkInput('llm-off-a', 1, 'geometry');
    var aRes = null, aThrew = null;
    try { aRes = await withTimeout(C.gen.buildRun(aInput), 3000); }
    catch (e) { aThrew = e.message; }
    global.fetch = prevFetch;
    clearLLMConfig();

    check('离线/默认关闭下 buildRun 返回 source=fallback',
      !!aRes && aRes.source === 'fallback', aThrew || (aRes ? aRes.source : '无结果'));
    check('离线未发起任何网络请求（fetch 命中 0 次）', offlineHits === 0, '实际 ' + offlineHits + ' 次');
    check('降级关卡通过 schema.validate（开局不被阻塞）',
      !!aRes && safeValidate(aRes.run, aInput).ok);

    /* ========== ② 四类降级均返回 source='fallback' ========== */
    section('2. 四类降级：未配置 / 超时 / 非法或纯文本 JSON / schema 校验失败');

    var badRun = {
      run_id: 'run_x_1', theme: 'geometry', difficulty: 1,
      rooms: [], boss: {}, reward_perk_pool: [], summary: '本次由 AI 生成的关卡'
    };
    var scenarios = [
      {
        key: 'unconfigured',
        label: '未配置（开启 LLM 但缺 endpoint/apiKey/model）',
        expectActivation: true,       // 开关已开，LLM_ENABLED()=true
        expectNoFetch: true,          // 缺配置应在 callLLM 内直接拒绝，不发网络请求
        config: 'partial',
        fetchImpl: function () { return fakeResponse('{"ok":1}', true); }
      },
      {
        key: 'timeout',
        label: '超时（8s 未返回，AbortController 触发）',
        expectActivation: true,
        config: 'full',
        fetchImpl: function () { return new Promise(function () {}); } // 永不 settle，靠 signal.abort 拒绝
      },
      {
        key: 'badjson',
        label: '返回非法 / 纯文本 JSON',
        expectActivation: true,
        config: 'full',
        fetchImpl: function () { return fakeResponse('抱歉，我无法生成关卡', false); }
      },
      {
        key: 'schemainvalid',
        label: 'schema 校验失败（能 parse 但字段非法）',
        expectActivation: true,
        config: 'full',
        fetchImpl: function () { return fakeResponse(JSON.stringify(badRun), true); }
      }
    ];

    for (var si = 0; si < scenarios.length; si++) {
      var sc = scenarios[si];
      clearLLMConfig();
      if (sc.config === 'full') writeLLMConfig();
      else if (sc.config === 'partial') writePartialConfig();

      var savedFetch = global.fetch;
      var hits = 0;
      /* 网络桩：除返回各场景预设结果外，还模拟浏览器原生 fetch 对 AbortSignal 的响应——
       * M2 用 AbortController + 8s timer 实现超时，signal 触发 abort 时必须以 AbortError 拒绝，
       * 否则 buildRun 会永远 pending，超时降级链路无法被真实走通。 */
      global.fetch = function (url, opts) {
        hits++;
        var signal = opts && opts.signal;
        var outcome;
        try { outcome = sc.fetchImpl ? sc.fetchImpl() : Promise.reject(new Error('offline')); }
        catch (e) { outcome = Promise.reject(e); }
        if (!signal) return outcome;
        return new Promise(function (resolve, reject) {
          var settled = false;
          function onAbort() {
            if (settled) return;
            settled = true;
            var err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort);
          Promise.resolve(outcome).then(function (v) {
            if (settled) return;
            settled = true; resolve(v);
          }, function (e) {
            if (settled) return;
            settled = true; reject(e);
          });
        });
      };

      var dInput = mkInput('degrade-' + sc.key, 1, 'geometry');
      var dRes = null, dThrew = null;
      try { dRes = await withTimeout(C.gen.buildRun(dInput), 9500); }
      catch (e) { dThrew = e.message; }

      var enabledNow = false;
      try {
        enabledNow = typeof C.gen.LLM_ENABLED === 'function' && C.gen.LLM_ENABLED() === true;
      } catch (e) { /* 忽略 */ }
      var activated = hits > 0 || enabledNow;

      global.fetch = savedFetch;
      clearLLMConfig();

      if (sc.expectActivation && !activated) {
        wait(sc.label + ' → 真实降级链路（启用 LLM 后注入失败）',
          '待 M2 落地：未检测到 LLM 启用/调用（fetch 命中 ' + hits + '，LLM_ENABLED()=' + enabledNow +
          '）；当前仅能验证默认关闭态兜底，真实降级链路需在 M2 落地后复验');
        console.log('       兜底结果（不构成降级链路验证）：source=' +
          (dRes ? dRes.source : '—') +
          '，关卡合法=' + (dRes ? safeValidate(dRes.run, dInput).ok : '—') +
          (dThrew ? '，异常=' + dThrew : ''));
        continue;
      }

      check(sc.label + ' → 未抛异常', dThrew === null, dThrew || '');
      check(sc.label + ' → source=fallback',
        !!dRes && dRes.source === 'fallback', dRes ? dRes.source : '无结果');
      check(sc.label + ' → 降级关卡通过 schema.validate',
        !!dRes && safeValidate(dRes.run, dInput).ok);
      if (sc.expectNoFetch) {
        check(sc.label + ' → 缺配置时未发起网络请求', hits === 0, '实际 ' + hits + ' 次');
      }
    }

    /* ========== ③ 360 组 schema.validate ========== */
    section('3. 6 套模板 × 4 主题 × 5 难度 × 3 seed = 360 组全部通过 C.gen.schema.validate');
    /* 模板数取运行时真实长度，避免硬编码（模板已扩容为 6 套 / 3–8 房）。 */
    var expectedTotal = C.gen.templates.TEMPLATES.length * THEME_IDS.length * DIFFS.length * SEEDS.length; // 360
    var grandTotal = 0, grandOk = 0;
    var perTheme = {};

    THEME_IDS.forEach(function (tid) {
      var tOk = 0, tN = 0, sampleErr = '';
      C.gen.templates.TEMPLATES.forEach(function (tpl) {
        DIFFS.forEach(function (d) {
          SEEDS.forEach(function (seed) {
            var input = mkInput(seed, d, tid);
            var v;
            try {
              var run = C.gen.templates.reseed(tpl, input);
              v = safeValidate(run, input);
            } catch (e) {
              v = { ok: false, errors: ['reseed/validate 抛异常: ' + e.message] };
            }
            tN++; grandTotal++;
            if (v.ok) { tOk++; grandOk++; }
            else if (!sampleErr) sampleErr = seed + '/d' + d + ': ' + v.errors.slice(0, 2).join(' | ');
          });
        });
      });
      perTheme[tid] = { ok: tOk, n: tN, sampleErr: sampleErr };
    });

    check('组合总数 = ' + expectedTotal, grandTotal === expectedTotal, '实际 ' + grandTotal);
    console.log('       合计通过：' + grandOk + '/' + grandTotal +
      '；按主题：' + THEME_IDS.map(function (t) {
        return t + ' ' + perTheme[t].ok + '/' + perTheme[t].n;
      }).join('，'));

    /* 补充：非 geometry 主题能否真正「降级开局」。
     * 用于捕获「主题切换 UI 已就位、但 gen 层重映射缺失时 buildRun 抛异常」这一阻断性缺口。 */
    var blocked = [];
    for (var bi = 0; bi < NEW_THEME_IDS.length; bi++) {
      var bt = NEW_THEME_IDS[bi];
      var bInput = mkInput('open-' + bt, 1, bt);
      try { await withTimeout(C.gen.buildRun(bInput), 3000); }
      catch (e) { blocked.push(bt + '（' + String(e.message).split(';')[0].slice(0, 26) + '）'); }
    }
    if (blocked.length === 0) {
      check('非 geometry 主题 buildRun 均可正常降级开局', true);
    } else {
      wait('非 geometry 主题 buildRun 均可正常降级开局',
        '待集成（gen 层重映射未联调）：切换主题后 fallback 自身校验失败并抛异常（' +
        blocked.join('、') + '）；当前仅 geometry 可开局');
    }

    THEME_IDS.forEach(function (tid) {
      var p = perTheme[tid];
      if (p.ok === p.n) {
        check('主题 ' + tid + '：' + p.n + ' 组全部通过 validate', true);
      } else if (tid === 'geometry') {
        check('主题 ' + tid + '：' + p.n + ' 组全部通过 validate（基线不回归）',
          false, '通过 ' + p.ok + '/' + p.n + '；' + p.sampleErr);
      } else {
        wait('主题 ' + tid + '：' + p.n + ' 组全部通过 validate',
          '待集成（gen 层重映射未联调）：当前通过 ' + p.ok + '/' + p.n + '（示例：' + p.sampleErr +
          '）；M3 词表已落地，但 templates.reseed 仍写死 geometry 命名素材、未按主题重映射，需 gen 层完成联调');
      }
    });

    /* ========== ④ 三套新主题 vocab 结构 / 同构 / 禁用词 ========== */
    section('4. 三套新主题 vocab 结构完整 / 与 geometry 同构 / summary_lines 无禁用词');
    var geometryVocabKeys = Object.keys(C.theme.get('geometry').vocab).sort();
    var ARRAY_FIELDS = ['enemy_types', 'room_names', 'boss_names', 'color_tokens'];

    NEW_THEME_IDS.forEach(function (id) {
      var t = C.theme.get(id);
      var landed = t.ready === true && t.vocab && typeof t.vocab === 'object' &&
        Array.isArray(t.summary_lines) && t.summary_lines.length > 0;
      if (!landed) {
        wait('主题 ' + id + '：vocab + summary_lines 已落地',
          '待 M3 落地：ready=' + t.ready + '，vocab=' + (t.vocab ? 'obj' : 'null') +
          '，summary_lines=' + (Array.isArray(t.summary_lines) ? t.summary_lines.length : 'n/a') +
          '（词表 / 文案尚未同时就绪）');
        return;
      }
      /* 以下为 M3 落地后的真实断言 */
      var keys = Object.keys(t.vocab).sort();
      check(id + '：vocab 键集合与 geometry 同构',
        JSON.stringify(keys) === JSON.stringify(geometryVocabKeys), keys.join(','));
      ARRAY_FIELDS.forEach(function (k) {
        check(id + '：vocab.' + k + ' 为非空字符串数组',
          Array.isArray(t.vocab[k]) && t.vocab[k].length > 0 &&
          t.vocab[k].every(function (x) { return typeof x === 'string' && x.length > 0; }));
      });
      check(id + '：vocab.summary_prefix 为非空字符串',
        typeof t.vocab.summary_prefix === 'string' && t.vocab.summary_prefix.length > 0);
      check(id + '：vocab.color_tokens 全部为合法 token',
        (t.vocab.color_tokens || []).every(function (tok) {
          return C.gen.schema.ENUM.color_token.indexOf(tok) !== -1;
        }));
      var badLines = t.summary_lines.filter(hasForbidden);
      check(id + '：summary_lines 无 AI/生成/模型/LLM/token 禁用词',
        badLines.length === 0, badLines.join(' | '));
      check(id + '：summary_lines 每条非空且 ≤80 字',
        t.summary_lines.every(function (l) {
          return typeof l === 'string' && l.length > 0 && l.length <= 80;
        }));
    });

    /* ========== ⑤ geometry 结果不回归 ========== */
    section('5. geometry（默认主题）结果不回归');
    var g = C.theme.get('geometry');
    check('geometry.ready === true', g.ready === true);
    check('geometry.vocab 五键齐全',
      JSON.stringify(Object.keys(g.vocab).sort()) ===
      JSON.stringify(['boss_names', 'color_tokens', 'enemy_types', 'room_names', 'summary_prefix']));
    check('geometry 出现在 theme.readyIds()', C.theme.readyIds().indexOf('geometry') !== -1);
    check('降级模板扩容为 6 套（3/4/5/6/7/8 房各一套）', C.gen.templates.TEMPLATES.length === 6);

    var gTotal = 0, gOk = 0;
    C.gen.templates.TEMPLATES.forEach(function (tpl) {
      DIFFS.forEach(function (d) {
        SEEDS.forEach(function (seed) {
          var input = mkInput(seed, d, 'geometry');
          var v;
          try {
            v = safeValidate(C.gen.templates.reseed(tpl, input), input);
          } catch (e) {
            v = { ok: false, errors: ['reseed/validate 抛异常: ' + e.message] };
          }
          gTotal++;
          if (v.ok) gOk++;
        });
      });
    });
    var expectedGeo = C.gen.templates.TEMPLATES.length * DIFFS.length * SEEDS.length; // 90
    check('geometry ' + expectedGeo + ' 组（' + C.gen.templates.TEMPLATES.length + ' 模板 × 5 难度 × 3 seed）reseed+validate 全过',
      gTotal === expectedGeo && gOk === gTotal, gOk + '/' + gTotal);

    var rsBad = [];
    [0, 1, 2, 3, 7, 999, 12345].forEach(function (h) {
      var line = C.theme.randomSummary('geometry', h);
      if (!line || hasForbidden(line) || line.length > 80) rsBad.push(h + ':' + line);
    });
    check('geometry randomSummary 非空 / 无禁用词 / ≤80 字', rsBad.length === 0, rsBad.join(' | '));

    var gi = mkInput('geo-noregress', 3, 'geometry');
    var gRes = null, gThrew = null;
    try { gRes = await withTimeout(C.gen.buildRun(gi), 3000); }
    catch (e) { gThrew = e.message; }
    check('geometry buildRun 返回 source=fallback 且关卡合法',
      !!gRes && gRes.source === 'fallback' && safeValidate(gRes.run, gi).ok,
      gThrew || (gRes ? gRes.source : '无结果'));

    /* ---- 汇总 ---- */
    console.log('\n──────────────────────────────');
    console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + waiting + ' waiting');
    console.log('  说明：WAIT 计入未通过并逐条标注真实原因；FAIL 为真实断言不成立，须修复后复跑。');
    console.log('  集成验收由开发总监复跑（2026-11-17 已通过）；期望 0 failed / 0 waiting。');
    console.log('──────────────────────────────');
    process.exit((failed || waiting) ? 1 : 0);
  } catch (e) {
    console.error('\n  m2m3 验收脚本异常：', (e && e.stack) || e);
    console.log('\n  ' + passed + ' passed, ' + failed + ' failed, ' + waiting + ' waiting（脚本异常中断）');
    process.exit(1);
  }
})();
