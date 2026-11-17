/* tests/smoke.js — M1 冒烟测试（Node，零依赖）
 * 运行：node tests/smoke.js
 * 只加载 core / gen / theme 三层，不加载 ui（避免 DOM 依赖）。
 */
'use strict';

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
var passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

var theme = C.theme.get('geometry');
var perkIds = C.core.perks.IDS.slice();
function mkInput(seed, difficulty, lastRun) {
  return {
    seed: seed,
    difficulty: difficulty,
    run_index: 1,
    theme: 'geometry',
    theme_vocab: theme.vocab,
    unlocked: [],
    last_run: lastRun || null,
    perk_pool: perkIds
  };
}

section('1. 三套降级模板 × 5 档难度 × 3 个 seed 全部通过校验');
var total = 0, bad = [];
C.gen.templates.TEMPLATES.forEach(function (tpl, ti) {
  for (var d = 1; d <= 5; d++) {
    ['s-a1', 's-b2', 's-c3'].forEach(function (seed) {
      var input = mkInput(seed, d, null);
      var run = C.gen.templates.reseed(tpl, input);
      var v = C.gen.schema.validate(run, input);
      total++;
      if (!v.ok) bad.push('模板' + ti + ' d' + d + ' ' + seed + ': ' + v.errors.join(' | '));
    });
  }
});
check(total + ' 组关卡全部合法', bad.length === 0, bad.slice(0, 3).join(' ; '));

section('2. 自适应规则：死于前两房降档 / 通关升档');
var nearDeath = mkInput('adaptive-1', 3, { died_at_room: 1, survived_seconds: 8, picked_perks: [], cleared: false });
var cleared = mkInput('adaptive-2', 3, { died_at_room: 4, survived_seconds: 210, picked_perks: [], cleared: true });
var normal = C.gen.templates.reseed(C.gen.templates.TEMPLATES[1], mkInput('adaptive-2', 3, null));
var soft = C.gen.templates.reseed(C.gen.templates.TEMPLATES[1], nearDeath);
var hard = C.gen.templates.reseed(C.gen.templates.TEMPLATES[1], cleared);
check('死于第 1 间 → 首房 threat 下调', soft.rooms[0].threat <= normal.rooms[0].threat);
check('上局通关 → 首房 threat 上调', hard.rooms[0].threat >= normal.rooms[0].threat);
check('调整后 threat 仍单调', hard.rooms.every(function (r, i) { return i === 0 || r.threat >= hard.rooms[i - 1].threat; }));

section('3. buildRun 连开 5 局：房间数 / threat 序列 / 词条组合不重复');
(async function () {
  var sigs = new Set();
  var allOk = true;
  for (var i = 1; i <= 5; i++) {
    var res = await C.gen.buildRun(mkInput('run-seed-' + i, i, null));
    var v = C.gen.schema.validate(res.run, mkInput('run-seed-' + i, i, null));
    if (!v.ok) { allOk = false; console.log('    校验失败: ' + v.errors.join(' | ')); }
    var sig = [
      res.run.rooms.length,
      res.run.rooms.map(function (r) { return r.threat; }).join(''),
      res.run.rooms.map(function (r) { return r.perk_choices.join('+'); }).join('|')
    ].join('/');
    sigs.add(sig);
  }
  check('5 局全部通过校验', allOk);
  check('5 局关卡签名互不重复', sigs.size === 5, '实际 ' + sigs.size + ' 种');

  section('4. 校验器能拒绝故意写错的 JSON');
  var good = C.gen.templates.reseed(C.gen.templates.TEMPLATES[0], mkInput('bad-test', 1, null));
  var c1 = JSON.parse(JSON.stringify(good)); c1.extra_field = 1;
  var c2 = JSON.parse(JSON.stringify(good)); c2.rooms[0].shape = 'hexagon';
  var c3 = JSON.parse(JSON.stringify(good)); c3.rooms[0].enemies[0].type = 'e_hacked';
  var c4 = JSON.parse(JSON.stringify(good)); c4.rooms[0].perk_choices = ['p_dash', 'p_dash'];
  var c5 = JSON.parse(JSON.stringify(good)); c5.rooms[2].threat = 1;
  var c6 = JSON.parse(JSON.stringify(good)); c6.summary = '本次由 AI 生成的关卡';
  var i0 = mkInput('bad-test', 1, null);
  check('多字段被拒', !C.gen.schema.validate(c1, i0).ok);
  check('枚举越界被拒', !C.gen.schema.validate(c2, i0).ok);
  check('自造 id 被拒', !C.gen.schema.validate(c3, i0).ok);
  check('重复词条对被拒', !C.gen.schema.validate(c4, i0).ok);
  check('threat 非单调被拒', !C.gen.schema.validate(c5, i0).ok);
  check('summary 含元信息词被拒', !C.gen.schema.validate(c6, i0).ok);

  section('5. extractJson 对四种返回形态的容错');
  var payload = '{"a":1}';
  check('代码块包裹', C.gen.extractJson('```json\n' + payload + '\n```') === payload);
  check('前后缀说明', C.gen.extractJson('好的，结果如下：' + payload + ' 希望有帮助') === payload);
  check('纯 JSON 原样', C.gen.extractJson(payload) === payload);
  var threw = false;
  try { C.gen.extractJson('抱歉，我无法生成关卡'); } catch (e) { threw = true; }
  check('纯文本抛错并交给降级', threw);

  section('6. 词条查表：效果数值只存在于 perks.js');
  var fakeState = { perks: { p_dash: 2, p_hp: 1, p_crit: 1 }, shieldUsed: false, player: { hp: 100 } };
  var d = C.core.perks.derive(fakeState);
  check('疾步叠 2 层 → 冷却 0.64 倍', Math.abs(d.dashCd - 820 * 0.64) < 0.001);
  check('硬壳 → 最大生命 120', d.maxHp === 120);
  check('锐眼 → 15% 暴击', Math.abs(d.critChance - 0.15) < 0.001);
  check('关卡 JSON 不含效果数值字段', Object.keys(good.rooms[0]).indexOf('effect') === -1);

  console.log('\n──────────────────────────────');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('──────────────────────────────');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('冒烟测试异常:', e);
  process.exit(1);
});
