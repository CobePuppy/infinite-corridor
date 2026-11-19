/* tests/loopcraft.js — M13 圈型策略回归（换型连扫 / 重复衰减 / 专属效果 / 实时读数）
 * 运行：node --test tests/loopcraft.js
 *
 * 背景：一次性真实 WASD 实跑证明 M11 的收益结构是失衡的 —— 小圈 7.87 伤害/秒 >
 * 中圈 6.16 > 大圈 5.23，且连扫只按次数累加，连刷最小圈能滚到 9.51 伤害/秒。
 * M13 把「换圈型」变成唯一涨倍率的途径并给四种圈各一个效果，本文件把这些
 * 结论固化成断言，同时守住 classify() / report() 的 M11 冻结契约。
 *
 *   §J1 规则层：换型 / 同型衰减 / 效果与折点优先级 / 窗口超时
 *   §J2 实时预估 live()：未定起点、点数不足、合法路径
 *   §J3 真实帧（不瞬移）：换型序列倍率递增、连续同型伤害递减
 *   §J4 四种圈型效果：减 CD / 回血 / 凝滞延长 + 额外蓄势 / 穿透容差
 *   §J5 渲染：LIVE 读数与兑现效果文字确实画出来且状态可辨
 *   §J6 静态接线与 M11 契约未回归
 *
 * 边界：纯 Node + DOM stub，零端口 / 零后台进程 / 零浏览器操作；
 * 不改 src/**，不改 tests/smoke.js。
 */
'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

global.window = global;
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var ctx2d = { setTransform: function () {} };
function makeEl() {
  var cls = {};
  var el = { tagName: 'DIV', id: '', dataset: {}, style: {}, children: [], _html: '', _text: '', _ev: {},
    disabled: false, title: '', scrollTop: 0,
    classList: { add: function (c) { cls[c] = true; }, remove: function (c) { delete cls[c]; },
      toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = true; else delete cls[c]; return !!on; },
      contains: function (c) { return !!cls[c]; } },
    appendChild: function (c) { this.children.push(c); return c; }, insertBefore: function (c) { this.children.unshift(c); return c; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function (t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); },
    setAttribute: function () {}, getBoundingClientRect: function () { return { left: 0, top: 0, width: 960, height: 600 }; },
    getContext: function () { return ctx2d; }, click: function () { (this._ev.click || []).forEach(function (f) { f({ target: el }); }); } };
  Object.defineProperty(el, 'innerHTML', { get: function () { return el._html; }, set: function (v) { el._html = String(v); el.children.length = 0; } });
  Object.defineProperty(el, 'textContent', { get: function () { return el._text; }, set: function (v) { el._text = String(v); } });
  return el;
}
var els = {};
global.document = { readyState: 'complete',
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  createElement: makeEl, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
  addEventListener: function () {} };
global.requestAnimationFrame = function () { return 0; };
global.addEventListener = function () {}; global.removeEventListener = function () {};
global.devicePixelRatio = 1;

var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (var m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) require(path.join(ROOT, m[1]));

var C = global.Corridor, E = C.core.engine, FW = C.core.freewave, R = C.ui.render;
var Q = C.core.perks.BALANCE.free, QC = C.core.perks.BALANCE.chrono;
var DT = 1 / 60;

function reset() { for (var k of Object.keys(store)) delete store[k]; }
function blank() { return { up: false, down: false, left: false, right: false, fire: false, dash: false, arm: false, aimX: null, aimY: null }; }
function tick(input) { return E.update(DT, input || blank()); }
function start() {
  reset();
  var events = [];
  return E.startRun({ free: true, seed: 'loopcraft', theme: 'geometry',
    onEvent: function (t, d) { events.push({ type: t, data: d }); } }).then(function (s) {
    /* 只隔离伤害与清房，保证 phase 一直 playing，连扫序列不被中途打断。 */
    s.player.invuln = Infinity;
    s.enemies.forEach(function (e) {
      e.hp = 10000; e.maxHp = 10000; e.vx = 0; e.vy = 0; e.mode = 'idle'; e.timer = Infinity;
    });
    return { s: s, events: events };
  });
}
function ev(ctx, type) { return ctx.events.filter(function (x) { return x.type === type; }); }
function steer(input, p, target) {
  var dx = target.x - p.x, dy = target.y - p.y;
  input.right = dx > 8; input.left = dx < -8;
  input.down = dy > 8; input.up = dy < -8;
  return Math.hypot(dx, dy);
}
/* 在 origin 定起点，之后完全靠输入走完一圈；返回该圈的真实帧数与兑现数据。 */
function measure(ctx, origin, waypoints) {
  var s = ctx.s, p = s.player, input = blank(), wi = 0, frames = 0;
  p.x = origin.x; p.y = origin.y; p.vx = p.vy = 0;   /* 仅准备阶段定位 */
  var before = s.free.closures;
  tick(Object.assign(blank(), { arm: true }));
  while (wi < waypoints.length && frames++ < 4000) {
    var d = steer(input, p, waypoints[wi]);
    if (d < 20) wi++;
    tick(input);
    if (s.free.closures > before) break;
  }
  var all = ev(ctx, 'loopClosure'), last = all[all.length - 1];
  return { frames: frames, sec: +(frames / 60).toFixed(2),
    tag: last ? last.data.tag : '-', damage: last ? last.data.damage : 0,
    switched: last ? !!last.data.switched : false, mul: last ? last.data.nextMul : 0,
    effect: last ? last.data.effect : '-', pierce: last ? !!last.data.pierce : false,
    streak: last ? last.data.streak : 0 };
}
var SMALL = { o: { x: 80, y: 360 }, wp: [{ x: 280, y: 360 }, { x: 280, y: 510 }, { x: 80, y: 510 }, { x: 80, y: 360 }] };
var MID   = { o: { x: 70, y: 330 }, wp: [{ x: 410, y: 330 }, { x: 410, y: 550 }, { x: 70, y: 550 }, { x: 70, y: 330 }] };
var BIG   = { o: { x: 100, y: 100 }, wp: [{ x: 860, y: 100 }, { x: 860, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 100 }] };
function c(tag, bent) { return { tag: tag, bent: !!bent, label: tag, area: 30000, damage: 24 }; }

/* 完整 mock 2D 上下文：收集色值与 fillText / strokeText 文本，验证画面是否真的写了字。 */
function mockCtx() {
  var seen = [], texts = [];
  var grad = { addColorStop: function (c) { seen.push(String(c)); } };
  var base = { canvas: { clientWidth: 960, width: 960, height: 600 } };
  return { seen: seen, texts: texts, ctx: new Proxy(base, {
    get: function (o, k) {
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return function () { return grad; };
      if (k === 'fillText' || k === 'strokeText') return function (t) { texts.push(String(t)); };
      return function () {};
    },
    set: function (o, k, v) {
      if (k === 'fillStyle' || k === 'strokeStyle' || k === 'shadowColor') seen.push(String(v));
      o[k] = v; return true;
    }
  }) };
}
function texts(s, t) { var m = mockCtx(); R.draw(m.ctx, s, t || 1); return m.texts.join('|'); }

/* ============ §J1 规则层 ============ */
test('§J1 首圈基线、换型涨倍率、重复同型逐次衰减、换型重置衰减', function () {
  var f = FW.create('j1'), q = Q.craft;
  var a = FW.craft(f, c('small'));
  assert.equal(a.first, true); assert.equal(a.switched, false);
  assert.equal(a.streak, 1); assert.equal(a.mul, 1); assert.equal(a.effect, 'quick');

  var b = FW.craft(f, c('small'));
  assert.equal(b.switched, false); assert.equal(b.repeatCount, 1);
  assert.equal(b.mul, +q.repeatDecay.toFixed(3));

  var d = FW.craft(f, c('small'));
  assert.equal(d.repeatCount, 2);
  assert.equal(d.mul, +Math.pow(q.repeatDecay, 2).toFixed(3));

  var e = FW.craft(f, c('mid'));
  assert.equal(e.switched, true); assert.equal(e.streak, 2);
  assert.equal(e.mul, +(1 + q.switchStep).toFixed(3));
  assert.equal(e.effect, 'mend'); assert.equal(e.repeatCount, 0);

  var g = FW.craft(f, c('big'));
  assert.equal(g.streak, 3); assert.equal(g.mul, +(1 + 2 * q.switchStep).toFixed(3));
  assert.equal(g.effect, 'breach');

  var h = FW.craft(f, c('small'));
  assert.equal(h.streak, q.switchCap, '连扫层数应有上限');
  assert.equal(h.switched, true);

  var many = FW.create('j1-floor'), last;
  for (var i = 0; i < 12; i++) last = FW.craft(many, c('small'));
  assert.equal(last.mul, q.repeatFloor, '重复同型衰减应停在地板值，不无限趋零');
  reset();
});

test('§J1 面积档决定主效果，折点只作附加穿透；超时归零重新起算', function () {
  assert.equal(FW.craftEffect({ tag: 'small', bent: true }), 'quick');
  assert.equal(FW.craftEffect({ tag: 'mid', bent: true }), 'mend');
  assert.equal(FW.craftEffect({ tag: 'big', bent: true }), 'breach',
    '矩形大圈天然带折点，不能让「折角」吃掉大圈的破阵效果');
  assert.equal(FW.craftKey({ tag: 'big', bent: true }), 'big+bent');
  assert.equal(FW.craftKey({ tag: 'big', bent: false }), 'big');

  var f = FW.create('j1-decay');
  var cr = FW.craft(f, c('big', true));
  assert.equal(cr.pierce, true);
  assert.equal(f.lastTag, 'big+bent');
  assert.equal(f.craftStreak, 1);
  FW.decayCraft(f);
  assert.equal(f.lastTag, null); assert.equal(f.craftStreak, 0);
  assert.equal(f.repeatCount, 0); assert.equal(f.lastCraft, null);
  assert.equal(FW.craft(f, c('small')).first, true, '超时后应重新算首圈');
  reset();
});

/* ============ §J2 实时预估 ============ */
test('§J2 live() 未定起点 / 点数不足返回 null，合法路径给出圈型与换型预判', function () {
  var f = FW.create('j2');
  assert.equal(FW.live(f), null);
  FW.arm(f, { x: 100, y: 100 });
  assert.equal(FW.live(f), null, '点数不足时不应给出误导性的预估');
  [ { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 } ].forEach(function (p) { FW.record(f, p); });
  var lv = FW.live(f);
  assert.ok(lv, '四条边后应有实时预估');
  assert.equal(lv.tag, 'small');
  assert.ok(lv.area >= Q.minArea);
  assert.equal(lv.switched, false, '没有上一圈时不算换型');
  assert.equal(lv.effect, 'quick');
  f.lastTag = 'mid';
  assert.equal(FW.live(f).switched, true, '与上一圈不同型应预判为换型');
  reset();
});

/* ============ §J3 真实帧收益结构 ============ */
test('§J3 真实 WASD 连续同型伤害递减，换型序列倍率递增且总收益更高', async function () {
  var rep = await start(), same = [];
  for (var i = 0; i < 4; i++) same.push(measure(rep, SMALL.o, SMALL.wp));
  same.forEach(function (r) { assert.equal(r.tag, 'small'); });
  assert.ok(same[0].damage > same[1].damage && same[1].damage > same[2].damage &&
            same[2].damage > same[3].damage,
    '重复同型必须逐次衰减，不能像 M11 那样滚雪球');
  assert.equal(same[0].mul, 1);
  assert.ok(same[3].mul <= Q.craft.repeatDecay);
  assert.ok(ev(rep, 'craftSwitch').length === 0, '连续同型不应发出换型事件');

  var sw = await start(), seq = [];
  for (var spec of [SMALL, MID, BIG, SMALL]) seq.push(measure(sw, spec.o, spec.wp));
  assert.equal(seq[0].switched, false, '首圈不算换型');
  assert.equal(seq[1].switched, true);
  assert.equal(seq[2].switched, true);
  assert.equal(seq[1].mul, +(1 + Q.craft.switchStep).toFixed(3));
  assert.equal(seq[2].mul, +(1 + 2 * Q.craft.switchStep).toFixed(3));
  assert.equal(ev(sw, 'craftSwitch').length, 3);
  assert.deepEqual(seq.map(function (r) { return r.effect; }), ['quick', 'mend', 'breach', 'quick']);

  var dps = function (list) {
    return list.reduce(function (a, r) { return a + r.damage; }, 0) /
           list.reduce(function (a, r) { return a + r.sec; }, 0);
  };
  assert.ok(dps(seq) > dps(same),
    '换型序列的单位时间收益必须高于原地刷同型（实测约 7.98 vs 5.74）');
  reset();
});

/* ============ §J4 四种圈型效果 ============ */
test('§J4 小圈减 CD 并给连段，中圈回血，大圈延长凝滞，折角圈给穿透容差', async function () {
  var s1 = await start();
  s1.s.player.fireCd = 0.5;
  var combo0 = s1.s.combo || 0;
  measure(s1, SMALL.o, SMALL.wp);
  assert.ok(s1.s.player.fireCd < 0.5, '小圈应削减剩余攻击冷却');
  assert.ok((s1.s.combo || 0) > combo0, '小圈应给连段层数');

  var s2 = await start();
  s2.s.player.hp = 50;
  measure(s2, MID.o, MID.wp);
  assert.ok(s2.s.player.hp > 50, '中圈应回血');
  assert.ok(s2.s.player.hp <= 50 + Q.craft.midHeal + 10, '含词条回血也不应溢出');

  var s3 = await start();
  measure(s3, BIG.o, BIG.wp);   /* 大圈兑现后波会命中敌人，延长不该被短凝滞覆盖 */
  assert.ok(s3.s.chrono.stall >= QC.stallTime + Q.craft.bigStall - 1e-6,
    '大圈应把凝滞延长到 stallTime+bigStall，且后续波命中不得覆盖');

  var s4 = await start();
  measure(s4, SMALL.o, SMALL.wp);
  assert.equal(s4.s.free.wave.reach, Q.craft.bentReach,
    '矩形圈自带折点，回扫波应带上圈边穿透容差');
  assert.equal(s4.s.free.lastCraft.pierce, true);
  reset();
});

test('§J4 大圈在真首领房给出额外护盾蓄势', async function () {
  reset();
  localStorage.setItem(FW.SAVE_KEY, JSON.stringify({
    version: 1, seed: 'j4-boss', layer: 1, roomInLayer: Q.roomsPerLayer - 1,
    hp: 100, maxHp: 100, gold: 0, perks: {}, pickCount: 0, kills: 0,
    elapsed: 0, theme: 'geometry'
  }));
  var events = [];
  var s = await E.startRun({ free: true, continueRun: true, seed: 'j4-boss', theme: 'geometry',
    onEvent: function (t, d) { events.push({ type: t, data: d }); } });
  s.player.invuln = Infinity;
  s.enemies.forEach(function (e) { e.dead = true; });
  s.enemies = [];
  tick();
  assert.equal(s.phase, 'perk');
  assert.equal(E.choosePerk(s.perkPending[0]), true);
  assert.equal(s.phase, 'boss');
  var boss = s.enemies[0], sh = boss.shield;
  assert.ok(sh && sh.state === 'closed');
  sh.spec.need = 99;                 /* 抬高门槛，只观察蓄势增量，不触发崩解 */
  var ctx = { s: s, events: events };
  var r = measure(ctx, BIG.o, BIG.wp);   /* 真实 WASD 画一个大圈 */
  assert.equal(r.tag, 'big');
  assert.equal(r.effect, 'breach');
  assert.equal(sh.state, 'closed', '门槛抬高后不应崩解');
  assert.equal(sh.charge, 1 + Q.craft.bigCharge,
    '大圈应在「命中 +1」之外再给 bigCharge 点额外蓄势');
  reset();
});

/* ============ §J5 渲染 ============ */
test('§J5 LIVE 读数与兑现效果文字真实画出来，且换型/同型画面可辨', async function () {
  var ctx = await start(), s = ctx.s;
  var base = texts(s, 1);
  assert.ok(base.length > 0);

  var pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
  s.free.armed = true; s.free.origin = pts[0]; s.free.path = pts;
  s.free.live = FW.live(s.free);
  var withLive = texts(s, 1);
  assert.ok(withLive.indexOf('LIVE') !== -1, '走位过程应画出实时圈型读数');
  assert.notEqual(withLive, base);

  s.free.lastCraft = FW.craft(FW.create('j5'), { tag: 'mid', bent: false });
  s.closure = { t: 1, loops: 1,
    report: { label: '中圈', area: 79219, length: 1000, streak: 2, mul: 1.2,
      switched: true, effectLabel: '续航 · 回复生命', pierce: false,
      path: pts, lanes: [] } };
  var withClosure = texts(s, 1);
  assert.ok(withClosure.indexOf('续航') !== -1, '兑现瞬间应画出圈型效果');
  assert.ok(withClosure.indexOf('换型连扫') !== -1);
  assert.notEqual(withClosure, withLive);

  s.closure.report.switched = false;
  s.closure.report.effectLabel = '迅捷 · 冷却缩减';
  assert.notEqual(texts(s, 1), withClosure, '换型与同型衰减的画面应可辨');

  var mp = mockCtx();
  R.draw(mp.ctx, s, 1, 'print');
  assert.ok(mp.texts.length > 0, '套印版同帧不应崩');
  reset();
});

/* ============ §J6 静态接线与 M11 契约 ============ */
test('§J6 六层接线齐备，且 classify / report 的 M11 冻结契约未被改动', function () {
  var pk = fs.readFileSync(path.join(ROOT, 'src/core/perks.js'), 'utf8');
  var fw = fs.readFileSync(path.join(ROOT, 'src/core/freewave.js'), 'utf8');
  var en = fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
  var rd = fs.readFileSync(path.join(ROOT, 'src/ui/render.js'), 'utf8');
  var sc = fs.readFileSync(path.join(ROOT, 'src/ui/screens.js'), 'utf8');
  var mj = fs.readFileSync(path.join(ROOT, 'src/ui/main.js'), 'utf8');
  assert.ok(pk.indexOf('craft: {') !== -1 && pk.indexOf('repeatDecay:') !== -1);
  assert.ok(fw.indexOf('function craft(f, c)') !== -1 && fw.indexOf('function live(f)') !== -1);
  assert.ok(en.indexOf('var cr = closed.craft || FW.craft(f, closed.report);') !== -1);
  assert.ok(en.indexOf("case 'craftSwitch'") === -1 && mj.indexOf("case 'craftSwitch'") !== -1);
  assert.ok(en.indexOf('f.wave.reach') !== -1 && en.indexOf('FW.decayCraft(f)') !== -1);
  assert.ok(rd.indexOf('LIVE ') !== -1 && rd.indexOf('CRAFT ') !== -1);
  assert.ok(sc.indexOf('换型连扫') !== -1 && sc.indexOf('正在画 ') !== -1);

  /* M11 冻结契约：数值与纯函数返回值一律不变。 */
  assert.equal(Q.damageSmall, 24); assert.equal(Q.damage, 30); assert.equal(Q.damageBig, 52);
  assert.equal(Q.areaMid, 60000); assert.equal(Q.areaBig, 110000);
  assert.equal(Q.minArea, 26000); assert.equal(Q.streakStep, 0.16);
  var box = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
  assert.equal(FW.classify(box).damage, Q.damageSmall);
  assert.equal(FW.classify(box).tag, 'small');
  var f = FW.create('j6');
  assert.ok(Math.abs(FW.report(f, FW.classify(box), 3).damage -
                     Math.round(Q.damageSmall * (1 + Q.streakStep * 2))) <= 1,
    'report() 的旧连扫倍率语义必须原样保留，M13 的倍率走 craft.mul 独立口径');
  reset();
});
