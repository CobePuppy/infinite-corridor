/* tests/freewave.js — M11 自由回扫（主模式）回归验收
 * 运行：node --test tests/freewave.js
 *
 * 覆盖：
 *   §H1 区域几何：面积 / 周长 / 折点 / 点在多边形内 / 轮廓距离 / 面积分档
 *   §H2 格子地效：固定布局可复现、正负各半、tileAt / tileBuff 语义
 *   §H3 自由闭环状态机：定起点 / 采样 / 面积与点数拒绝 / 回到起点才兑现
 *   §H4 统一时间轴：影子延迟 / 凝滞只放慢世界 / 完美闪避两档 / 连段等级
 *   §H5 帧循环端到端：真实 startRun → 走一圈 → 兑现事件与演出 → 波结算
 *   §H6 护盾相位：真实首领房的闭合 → 崩解 → 暴露窗口 → 重构 → 下一相位
 *   §H7 渲染：地效 / 路径 / 波 / 凝滞 / 闪避 / 连段 / 兑现 / 三态护盾确有画面
 *   §H8 流派卡池隔离、续档、导引投射物实体、回扫容差
 *   §H9 静态接线与可回退点：经典回廊仍可启动、续玩回落、入口链路完整
 *
 * 边界：纯 Node、零依赖、零端口、零后台进程；不改 src/**、不改 smoke.js。
 * §H5/§H6 用「理想玩家」瞬时走完闭环，只证明状态机可达，不代表真人手感。
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

/* 按 index.html 固定顺序加载，顺带验证 chrono / freewave 确实在入口链路里 */
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (var m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) require(path.join(ROOT, m[1]));

var C = global.Corridor;
var E = C.core.engine, FW = C.core.freewave, CH = C.core.chrono;
var P = C.core.perks, LM = C.core.loop, R = C.ui.render, S = C.ui.screens;
var Q = P.BALANCE.free, QC = P.BALANCE.chrono;

function reset() { for (var k of Object.keys(store)) delete store[k]; }
function tick(input) { return E.update(1 / 60, input || {}); }
function collect(events) { return function (type, data) { events.push({ type: type, data: data }); }; }
function beginFree(opts) {
  return E.startRun(Object.assign({ free: true, seed: 'probe', theme: 'geometry',
    onEvent: (opts && opts.onEvent) || function () {} }, opts || {}));
}
function steady(s) {
  s.player.invuln = Infinity;
  s.enemies.forEach(function (e) { e.vx = 0; e.vy = 0; e.mode = 'idle'; e.timer = Infinity; });
}
function sq(x, y, size) {
  return [{ x: x, y: y }, { x: x + size, y: y }, { x: x + size, y: y + size },
          { x: x, y: y + size }, { x: x, y: y }];
}
/* 沿一块避开所有自由房障碍的大矩形瞬时走完一圈，最后一帧回到原点兑现。 */
function perimeterPath() {
  var pts = [], x, y, x0 = 60, y0 = 60, x1 = 900, y1 = 540, step = 40;
  for (x = x0; x <= x1; x += step) pts.push({ x: x, y: y0 });
  for (y = y0; y <= y1; y += step) pts.push({ x: x1, y: y });
  for (x = x1; x >= x0; x -= step) pts.push({ x: x, y: y1 });
  for (y = y1; y >= y0; y -= step) pts.push({ x: x0, y: y });
  return pts;
}
function walkLoop(s) {
  var pts = perimeterPath(), p = s.player;
  for (var i = 0; i < pts.length; i++) {
    p.x = pts[i].x; p.y = pts[i].y; p.vx = 0; p.vy = 0;
    tick({ arm: i === 0 });
  }
  return s;
}
/* 完整 mock 2D 上下文：真实调用 render.draw，收集实际设置的色值。 */
function mockCtx() {
  var seen = [];
  var grad = { addColorStop: function (c) { seen.push(String(c)); } };
  var base = { canvas: { clientWidth: 960, width: 960, height: 600 } };
  return { seen: seen, ctx: new Proxy(base, {
    get: function (o, k) {
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return function () { return grad; };
      return function () {};
    },
    set: function (o, k, v) {
      if (k === 'fillStyle' || k === 'strokeStyle' || k === 'shadowColor') seen.push(String(v));
      o[k] = v; return true;
    }
  }) };
}
function signature(s, t) {
  var m = mockCtx();
  R.draw(m.ctx, s, t || 1);
  return m.seen.join('|');
}

/* ============ §H1 区域几何 ============ */
test('§H1 多边形面积 / 周长 / 折点 / 内外判定 / 轮廓距离', function () {
  var box = sq(100, 100, 100);
  assert.equal(FW.area(box), 10000);
  assert.equal(FW.perimeter(box), 400);
  assert.equal(FW.bends(box), 3, '正方形应有 3 个中间折点');
  assert.equal(FW.inside(box, { x: 150, y: 150 }), true);
  assert.equal(FW.inside(box, { x: 400, y: 150 }), false);
  assert.equal(FW.distanceToPoly(box, { x: 150, y: 150 }), 50, '中心到轮廓距离 50');
  assert.equal(FW.distanceToPoly(box, { x: 210, y: 150 }), 10, '框外 10px');
  assert.equal(FW.area([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), 50);
});

test('§H1 面积分档决定伤害与圈型，折角独立标注', function () {
  var small = FW.classify(sq(0, 0, 100));        /* 10000 < areaMid */
  var mid = FW.classify(sq(0, 0, 300));          /* 90000 < areaBig */
  var big = FW.classify(sq(0, 0, 400));          /* 160000 >= areaBig */
  assert.equal(small.tag, 'small'); assert.equal(small.damage, Q.damageSmall);
  assert.equal(mid.tag, 'mid');     assert.equal(mid.damage, Q.damage);
  assert.equal(big.tag, 'big');     assert.equal(big.damage, Q.damageBig);
  assert.equal(mid.bent, true, '正方形折点数达到 bendMin');
  assert.ok(mid.label.indexOf('折角') !== -1);
  assert.ok(big.area > mid.area && mid.area > small.area);
});

/* ============ §H2 格子地效 ============ */
test('§H2 地格固定布局可复现、正负各半且全部贴场地', function () {
  var a = FW.tiles('seed-A'), b = FW.tiles('seed-A'), c = FW.tiles('seed-B');
  assert.equal(a.length, Q.tile.count);
  assert.deepEqual(a, b, '同一 seed 必须完全复现');
  assert.notDeepEqual(a, c, '不同 seed 应换布局');
  assert.equal(a.filter(function (t) { return t.kind === 'good'; }).length, Q.tile.count / 2);
  assert.equal(a.filter(function (t) { return t.kind === 'bad'; }).length, Q.tile.count / 2);
  a.forEach(function (t) {
    assert.ok(t.x >= 0 && t.x + t.w <= FW.W && t.y >= 0 && t.y + t.h <= FW.H);
    assert.equal(t.w, Q.gridStep); assert.equal(t.h, Q.gridStep);
    assert.equal(FW.tileAt(a, t.x + 2, t.y + 2), t, 'tileAt 应命中自身');
  });
});

test('§H2 正负地效语义：增幅提伤提速减 CD，滞涩反之且提高承伤', function () {
  var none = FW.tileBuff(null);
  assert.equal(none.damage, 1); assert.equal(none.kind, 'none');
  var tiles = FW.tiles('buff');
  var good = FW.tileBuff(tiles.filter(function (t) { return t.kind === 'good'; })[0]);
  var bad = FW.tileBuff(tiles.filter(function (t) { return t.kind === 'bad'; })[0]);
  assert.equal(good.kind, 'good'); assert.equal(bad.kind, 'bad');
  assert.ok(good.damage > 1 && good.speed > 1 && good.cd < 1);
  assert.ok(bad.damage < 1 && bad.speed < 1 && bad.cd > 1 && bad.hurt > 1);
  assert.equal(good.damage, Q.tile.goodDamage);
  assert.equal(bad.hurt, Q.tile.badHurt);
});

/* ============ §H3 自由闭环状态机 ============ */
test('§H3 定起点 → 按间距采样 → 未回原点不兑现', function () {
  var f = FW.create('h3');
  assert.equal(f.armed, false); assert.equal(f.path.length, 0);
  var p = { x: 100, y: 100 };
  assert.equal(FW.arm(f, p), true);
  assert.equal(f.armed, true);
  assert.deepEqual(f.origin, { x: 100, y: 100 });
  assert.equal(FW.record(f, { x: 105, y: 100 }), false, '小于 sampleGap 不采样');
  assert.equal(FW.record(f, { x: 130, y: 100 }), true);
  assert.equal(f.path.length, 2);
  assert.equal(FW.close(f, { x: 130, y: 100 }), null, '没回到起点绝不结算');
});

test('§H3 面积过小 / 点数不足一律拒绝，不产出任何伤害', function () {
  /* 细长矩形：周长足够长（点数达标）但围出的面积很小，才能精确测到
   * 「面积不足」而不是「点数不足」这条拒绝路径。 */
  var f = FW.create('h3-small'), walk = [], x, y, step = 16;
  for (x = 400; x <= 600; x += step) walk.push({ x: x, y: 300 });
  for (y = 300; y <= 320; y += step) walk.push({ x: 600, y: y });
  for (x = 600; x >= 400; x -= step) walk.push({ x: x, y: 320 });
  for (y = 320; y >= 300; y -= step) walk.push({ x: 400, y: y });
  walk.push({ x: 400, y: 300 });
  FW.arm(f, walk[0]);
  walk.slice(1).forEach(function (p) { FW.record(f, p); });
  assert.ok(f.path.length >= Q.minPoints, '应先满足点数门槛');
  var out = FW.close(f, walk[walk.length - 1]);
  assert.ok(out && out.rejected === 'area', '小圈必须被拒绝');
  assert.ok(out.area < Q.minArea);
});

test('§H3 合法闭环产出报告、连扫倍率与逆行波', function () {
  var pts = perimeterPath(), f = FW.create('h3-ok');
  FW.arm(f, pts[0]);
  pts.slice(1).forEach(function (p) { FW.record(f, p); });
  var out = FW.close(f, pts[pts.length - 1]);
  assert.ok(out && out.type === 'closed');
  assert.ok(out.report.area >= Q.minArea);
  assert.equal(out.report.tag, 'big');
  var rep = FW.report(f, out.report, 3);
  assert.equal(rep.streak, 3);
  assert.ok(Math.abs(rep.damage - Math.round(out.report.damage * (1 + Q.streakStep * 2))) <= 1);
  var w = FW.waveFrom(out.poly, rep);
  assert.deepEqual(w.path[0], out.poly[out.poly.length - 1], '波应沿路径逆行');
  assert.equal(w.damage, rep.damage);
  /* advanceWave 原地推进 w.position / w.life，返回的是 {head, done, total}。 */
  var a0 = FW.advanceWave(w, 0), p0 = w.position;
  var a1 = FW.advanceWave(w, 0.1);
  assert.ok(w.position > p0 && w.life > 0, '波应沿路径向前推进');
  assert.ok(a1.total > 0 && a1.head && typeof a1.head.x === 'number');
  assert.equal(typeof a1.done, 'boolean');
});

/* ============ §H4 统一时间轴 ============ */
test('§H4 影子按真实时间采样，Boss 延迟减半', function () {
  var c = CH.create();
  CH.push(c, 0, { x: 0, y: 0 });
  CH.push(c, 0.5, { x: 50, y: 0 });
  CH.push(c, 1.0, { x: 100, y: 0 });
  assert.equal(CH.sample(c, 1.0, 0.5).x, 50);
  assert.ok(Math.abs(CH.shadow(c, 1.0, false).x - 70) < 0.001, '普通影子 0.30s 前');
  assert.ok(Math.abs(CH.shadow(c, 1.0, true).x - 85) < 0.001, 'Boss 影子 0.15s 前');
});

test('§H4 凝滞只压世界缩放，玩家时间轴不动，到点自动恢复', function () {
  var c = CH.create();
  assert.equal(CH.worldScale(c), 1);
  CH.stall(c);
  assert.equal(CH.worldScale(c), QC.stallScale);
  assert.equal(CH.worldScale(c), 0.30);
  CH.update(c, QC.stallTime + 0.01);
  assert.equal(CH.worldScale(c), 1, '凝滞结束后世界恢复全速');
});

test('§H4 完美闪避给全额 buff，普通闪避半额，连段等级按阈值升', function () {
  var c = CH.create(), perks = { p_loop_dodge: 2 };
  var normal = CH.resolveDodge(c, true, {});
  assert.equal(normal.kind, 'normal');
  assert.equal(normal.damage, QC.normalDamage);
  assert.equal(CH.buffDamage(c), QC.normalDamage);
  CH.armPerfect(c);
  var perfect = CH.resolveDodge(c, true, perks);
  assert.equal(perfect.kind, 'perfect');
  assert.equal(perfect.damage, QC.perfectDamage);
  assert.equal(perfect.cd, QC.perfectCdCut);
  assert.ok(perfect.t > QC.perfectBuffTime, '借势应延长完美闪避窗口');
  assert.equal(CH.buffCd(c), QC.perfectCdCut);
  assert.equal(CH.resolveDodge(c, false, {}), null, '没冲刺不应给 buff');
  assert.equal(CH.tier(0), 0); assert.equal(CH.tier(2), 0);
  assert.equal(CH.tier(3), 1); assert.equal(CH.tier(6), 2); assert.equal(CH.tier(10), 3);
});

/* ============ §H5 帧循环端到端 ============ */
test('§H5 主模式开局：自由状态 / 时间轴 / 地格 / 障碍全部就位', async function () {
  reset();
  var s = await beginFree();
  assert.ok(s.free && !s.loop, '主模式应是自由回扫，不是经典回廊');
  assert.ok(s.chrono, '统一时间轴必须存在');
  assert.equal(s.phase, 'playing');
  assert.equal(s.free.tiles.length, Q.tile.count);
  assert.equal(s.walls.length, 7, '自由房是四周墙 + 3 处掩体');
  assert.equal(s.source, 'free');
  assert.equal(s.enemies.length, 3 + s.free.roomInLayer + s.free.layer);
  tick();
  assert.ok(s.elapsed > 0, '帧循环应推进真实时间');
  reset();
});

test('§H5 真实走一圈 → 闭环兑现事件 / 演出 / 连扫 / 凝滞 / 逆行波', async function () {
  reset();
  var events = [];
  var s = await beginFree({ onEvent: collect(events) });
  steady(s);
  /* 抬高血量让敌人不会被一击清场，否则 phase→perk 会让后续帧提前 return，
   * 兑现演出的逐帧衰减就测不到了。 */
  s.enemies.forEach(function (e) { e.hp = 10000; e.maxHp = 10000; });
  var before = s.enemies.map(function (e) { return e.hp; });
  walkLoop(s);
  var t0 = s.closure ? s.closure.t : 0;   /* 必须在任何后续帧之前取样 */
  assert.ok(t0 > 0);
  assert.equal(s.free.closures, 1, '应恰好兑现一次');
  assert.equal(s.free.streak, 1);
  assert.ok(s.closure && s.closure.t > 0, '应写入兑现演出状态');
  assert.ok(s.closure.report.path.length > 8, '兑现报告应含玩家真实路径');
  assert.ok(s.chrono.stall > 0, '兑现瞬间应触发凝滞');
  assert.ok(s.free.wave, '应生成沿路径逆行的回扫波');
  var closure = events.filter(function (e) { return e.type === 'loopClosure'; })[0];
  assert.ok(closure, 'loopClosure 事件必须发出');
  assert.equal(closure.data.tag, 'big');
  assert.ok(closure.data.area >= Q.minArea);
  assert.equal(closure.data.streak, 1);
  assert.ok(events.some(function (e) { return e.type === 'freeArm'; }), 'E 定起点要有反馈');
  /* 波推进后确实打到圈内敌人；同一批帧也让兑现演出逐帧衰减 */
  for (var i = 0; i < 90; i++) tick();
  var after = s.enemies.map(function (e) { return e.hp; });
  assert.ok(after.some(function (hp, i) { return hp < before[i]; }) ||
    s.enemies.length < before.length, '回扫波应结算圈内敌人');
  assert.ok(s.closure.t < t0, '兑现演出应逐帧衰减');
  for (var k = 0; k < 200; k++) tick();
  assert.equal(s.closure.t, 0, '兑现演出应衰减到 0');
  reset();
});

test('§H5 存档指向下一间，续玩恢复层 / 房 / 词条 / 生命', async function () {
  reset();
  var s = await beginFree();
  steady(s);
  s.perks.p_loop_cd = 1;
  s.player.hp = 63;
  s.enemies.forEach(function (e) { e.dead = true; });
  s.enemies = [];
  tick();
  assert.equal(s.phase, 'perk');
  assert.ok(s.perkPending && s.perkPending.length === 3);
  assert.equal(E.choosePerk(s.perkPending[0]), true);
  assert.equal(s.free.roomInLayer, 1, '选完词条应进入下一间');
  var saved = FW.load();
  assert.ok(saved, '应写入可恢复存档');
  assert.equal(saved.roomInLayer, 1, '存档必须指向下一间，不能重打刚清完的那间');
  assert.equal(saved.hp, 63);
  assert.equal(saved.perks.p_loop_cd, 1);
  var s2 = await beginFree({ continueRun: true });
  assert.equal(s2.free.continued, true);
  assert.equal(s2.free.roomInLayer, 1);
  assert.equal(s2.player.hp, 63);
  assert.equal(s2.perks.p_loop_cd, 1);
  FW.clearSave();
  assert.equal(FW.hasSave(), false);
  reset();
});

test('§H5 三层九间 + 层末首领可完整通关，通关清档并结算', async function () {
  reset();
  var events = [], s = await beginFree({ onEvent: collect(events) });
  steady(s);
  var guard = 0, rooms = 0, bosses = 0;
  while (s.phase !== 'won' && guard++ < 80) {
    if (s.phase === 'perk') {
      assert.equal(E.choosePerk(s.perkPending[0]), true);
      continue;
    }
    if (s.phase === 'transition') { tick(); continue; }
    if (s.phase === 'boss') bosses++;
    rooms++;
    s.enemies.forEach(function (e) { e.dead = true; });
    s.enemies = [];
    tick();
  }
  assert.equal(s.phase, 'won', '理想玩家应能走完三层通关');
  assert.equal(s.free.layer, Q.layers);
  assert.ok(rooms >= Q.layers * Q.roomsPerLayer, '九间普通房都应经过');
  assert.ok(bosses >= Q.layers, '每层应有一次层末首领');
  assert.equal(FW.hasSave(), false, '通关后存档必须清除');
  var end = events.filter(function (e) { return e.type === 'runEnd'; })[0];
  assert.ok(end, '应发出 runEnd 结算事件');
  reset();
});

test('自由回廊九间房逐间增加怪物强度，层末首领的触碰伤害随层数增长', async function () {
  reset();
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], clears: 0, testGoldGranted: true }));
  var s = await beginFree();
  var stats = [], bosses = [];
  for (var layer = 1; layer <= Q.layers; layer++) {
    for (var room = 0; room < Q.roomsPerLayer; room++) {
      assert.equal(s.free.layer, layer);
      assert.equal(s.free.roomInLayer, room);
      var e = s.enemies.find(function (enemy) { return enemy.pattern === 'chase'; });
      s.enemies = [e];
      s.walls = [];
      s.chrono = CH.create();
      e.x = 110; e.y = 120;
      s.player.x = 250; s.player.y = 120;
      tick();
      stats.push({ hp: e.maxHp, damage: e.damage, speed: e.x - 110 });
      s.enemies = [];
      tick();
      assert.equal(E.choosePerk(s.perkPending[0]), true);
    }
    assert.equal(s.phase, 'boss');
    var boss = s.enemies[0], p = s.player;
    bosses.push({ hp: boss.maxHp, damage: boss.damage });
    p.x = boss.x; p.y = boss.y; p.hp = p.maxHp; p.invuln = 0;
    tick();
    assert.equal(p.maxHp - p.hp, boss.damage);
    s.enemies = [];
    tick();
  }
  assert.equal(stats.length, 9);
  assert.equal(stats[0].hp, 40);
  assert.equal(stats[8].hp, 80);
  assert.equal(stats[8].damage, 14);
  for (var i = 1; i < stats.length; i++) {
    assert.ok(stats[i].hp > stats[i - 1].hp);
    assert.ok(stats[i].damage >= stats[i - 1].damage);
    assert.ok(stats[i].speed > stats[i - 1].speed);
  }
  assert.deepEqual(bosses, [{ hp: 190, damage: 8 }, { hp: 247, damage: 10 }, { hp: 304, damage: 12 }]);
  reset();
});

test('自由回廊的过载伤害有上限', function () {
  var combo = { perks: { p_overload: 1 }, combo: 60 };
  var shot = function () { return { damage: 10, range: 100, crit: false }; };
  assert.equal(P.on(combo, 'attack', shot()).damage, 34);
  assert.equal(P.on(Object.assign({ free: {} }, combo), 'attack', shot()).damage, 12);
});

test('§H5 损坏存档被判无效并回落新局', async function () {
  reset();
  localStorage.setItem(FW.SAVE_KEY, '{broken');
  assert.equal(FW.load(), null);
  localStorage.setItem(FW.SAVE_KEY, JSON.stringify({ version: 9, seed: 'x', layer: 1, roomInLayer: 0 }));
  assert.equal(FW.load(), null, '版本不符应拒绝');
  var s = await beginFree({ continueRun: true });
  assert.equal(s.free.layer, 1);
  assert.equal(s.free.continued, false);
  reset();
});

/* ============ §H6 护盾相位（真实首领房） ============ */
function bossRoom(events) {
  reset();
  localStorage.setItem(FW.SAVE_KEY, JSON.stringify({
    version: 1, seed: 'boss', layer: 1, roomInLayer: Q.roomsPerLayer - 1,
    hp: 100, maxHp: 100, gold: 0, perks: {}, pickCount: 0, kills: 0,
    elapsed: 0, theme: 'geometry'
  }));
  return beginFree({ continueRun: true, onEvent: collect(events || []) }).then(function (s) {
    steady(s);
    s.enemies.forEach(function (e) { e.dead = true; });
    s.enemies = [];
    tick();
    assert.equal(s.phase, 'perk');
    assert.equal(E.choosePerk(s.perkPending[0]), true);
    assert.equal(s.phase, 'boss');
    return s;
  });
}

test('§H6 相位要求循环、门槛与窗口随破盾次数变化，圈型判定客观', function () {
  var a = FW.shieldSpec(0, {}), b = FW.shieldSpec(1, {}),
      c = FW.shieldSpec(2, {}), d = FW.shieldSpec(3, {});
  assert.equal(a.required, 'any'); assert.equal(b.required, 'bent');
  assert.equal(c.required, 'big'); assert.equal(d.required, 'small');
  assert.equal(FW.shieldSpec(4, {}).required, 'any', '相位应循环');
  assert.ok(FW.shieldSpec(4, {}).need > a.need, '破盾越多门槛越高');
  assert.ok(c.window < a.window && c.window >= Q.shield.windowMin);
  assert.ok(d.speedMul > a.speedMul && d.speedMul <= Q.shield.speedCap);
  var perk = FW.shieldSpec(2, { p_loop_breach: 1, p_loop_window: 2, p_loop_shard: 2, p_loop_overdrive: 1 });
  assert.ok(perk.need < c.need && perk.window > c.window);
  assert.ok(perk.weakCharge > c.weakCharge && perk.exposedWaveMul > c.exposedWaveMul);
  assert.equal(FW.matchesShield({ tag: 'big', bent: false }, 'big'), true);
  assert.equal(FW.matchesShield({ tag: 'big', bent: false }, 'small'), false);
  assert.equal(FW.matchesShield({ tag: 'mid', bent: true }, 'bent'), true);
  assert.equal(FW.matchesShield({ tag: 'small', bent: false }, 'any'), true);
});

test('§H6 真实帧：闭合 → 崩解 → 暴露窗口 → 重构 → 下一相位', async function () {
  var events = [];
  var s = await bossRoom(events);
  var boss = s.enemies[0], sh = boss.shield;
  assert.ok(boss && sh);
  assert.equal(sh.state, 'closed');
  assert.equal(sh.spec.phase, 1);
  sh.charge = sh.spec.need - 1;   /* 下一次有效闭环即崩解 */
  steady(s);
  walkLoop(s);
  assert.equal(sh.state, 'exposed', '达到门槛应崩解');
  assert.ok(boss.guardOpen > 0, '暴露窗口应开启全额输出');
  assert.ok(events.some(function (e) { return e.type === 'bossShieldBreak'; }));
  for (var i = 0; i < Math.ceil(sh.spec.window * 60) + 6; i++) tick();
  assert.equal(sh.state, 'reforming', '窗口结束应进入重构');
  for (var j = 0; j < Math.ceil(Q.shield.reformTime * 60) + 6; j++) tick();
  assert.equal(sh.state, 'closed', '重构完成应回到闭合');
  assert.equal(sh.breaks, 1);
  assert.equal(sh.spec.phase, 2);
  assert.equal(s.free.shieldBreaks, 1);
  reset();
});

/* ============ §H7 渲染 ============ */
test('§H7 自由回廊各视觉层真实渲染不抛异常，且画面确实分流', async function () {
  reset();
  var s = await beginFree();
  steady(s);
  var base = signature(s, 1);
  assert.ok(base.length > 0, '应产生绘制指令');
  /* 正在走的路径 */
  var pts = perimeterPath();
  s.free.armed = true; s.free.origin = pts[0];
  s.free.path = pts.slice(0, 20).concat([{ x: s.player.x, y: s.player.y }]);
  assert.notEqual(signature(s, 1), base, '路径应叠加额外画面');
  /* 逆行波 */
  s.free.wave = FW.waveFrom(pts, FW.report(s.free, FW.classify(pts), 1));
  assert.notEqual(signature(s, 1), base, '回扫波应叠加额外画面');
  /* 兑现演出 */
  s.free.wave = null; s.free.armed = false;
  s.closure = { t: 1, loops: 1,
    report: Object.assign(FW.classify(pts), { path: pts, lanes: [] }) };
  var withClosure = signature(s, 1);
  assert.notEqual(withClosure, base, '自由闭环兑现应叠加额外画面');
  /* 凝滞 / 完美闪避 / 连段等级 */
  s.closure = null;
  CH.stall(s.chrono); s.dodgeFlash = 1; s.comboTier = 3; s.combo = 11;
  s.chrono.buff = { kind: 'perfect', t: 2, damage: 1.35, cd: 0.45 };
  s.chrono.perfect = { t: QC.perfectWindow };
  assert.notEqual(signature(s, 1), base, '凝滞与闪避/连段应叠加额外画面');
  /* 套印版同帧不崩 */
  var mp = mockCtx();
  R.draw(mp.ctx, s, 1, 'print');
  assert.ok(mp.seen.length > 0);
  reset();
});

test('§H7 护盾三态与破盾爆发渲染签名两两不同', async function () {
  var s = await bossRoom([]);
  var boss = s.enemies[0], sh = boss.shield;
  var seen = [];
  ['closed', 'exposed', 'reforming'].forEach(function (state) {
    sh.state = state;
    seen.push(signature(s, 1));
  });
  assert.notEqual(seen[0], seen[1], '闭合 vs 暴露应可辨');
  assert.notEqual(seen[1], seen[2], '暴露 vs 重构应可辨');
  assert.notEqual(seen[0], seen[2], '闭合 vs 重构应可辨');
  sh.state = 'closed'; s.breakFlash = 0;
  var off = signature(s, 1);
  s.breakFlash = 1;
  assert.notEqual(signature(s, 1), off, '破盾爆发应叠加全屏信号');
  reset();
});

/* ============ §H8 流派与强化 ============ */
test('§H8 三流派的卡池互斥，换武器和续档保留所选流派', async function () {
  reset();
  var seen = new Set();
  for (var style of Object.values(FW.STYLES)) {
    style.pool.forEach(function (id) {
      assert.equal(seen.has(id), false);
      assert.equal(P.IDS.includes(id), false);
      seen.add(id);
    });
    var fake = { free: { style: style.id }, perks: {}, pickCount: 0 };
    for (var n = 0; n < Q.layers * Q.roomsPerLayer; n++) {
      var cards = FW.offer(fake);
      assert.ok(cards.length > 0 && cards.every(function (id) { return style.pool.includes(id); }));
      assert.equal(cards.length, new Set(cards).size);
      fake.perks[cards[0]] = (fake.perks[cards[0]] || 0) + 1;
      fake.pickCount++;
    }
    var s = await beginFree({ style: style.id });
    assert.equal(s.free.weapon, style.id === 'blade' ? 'blade' : 'cannon');
    var before = FW.offer(s);
    assert.equal(E.switchFreeWeapon(), true);
    assert.deepEqual(FW.offer(s), before);
    s.enemies = [];
    tick();
    assert.deepEqual(s.perkPending, before);
    var wrong = style.id === 'sweep' ? 'p_impact_homing' : 'p_loop_cd';
    s.perkPending.push(wrong);
    assert.equal(E.choosePerk(wrong), false);
    assert.equal(E.choosePerk(before[0]), true);
    var resumed = await beginFree({ continueRun: true });
    assert.equal(resumed.free.style, style.id);
    assert.equal(resumed.free.weapon, s.free.weapon);
    assert.equal(resumed.perks[before[0]], 1);
  }
  reset();
});

test('§H8 导引把子弹变成会转向的投射物实体，长锋扩圈容差', async function () {
  reset();
  var s = await beginFree();
  steady(s);
  s.perks.p_impact_homing = 1;
  s.enemies = [s.enemies[0]];
  var e = s.enemies[0];
  e.x = 900; e.y = 80;                /* 又高又远，测转向而不让它提前命中 */
  s.player.x = 200; s.player.y = 300;
  s.player.vx = 0; s.player.vy = 0;
  s.player.angle = 0; s.player.fireCd = 0;
  tick({ fire: true });
  var b = s.bullets[0];
  assert.ok(b, '应生成子弹实体');
  assert.equal(b.homing, true);
  assert.ok(b.life > Q.mod.homingLife - 0.05 && b.life <= Q.mod.homingLife,
    '生成当帧已扣一次 wdt，life 应略小于初值');
  var angles = [Math.atan2(b.vy, b.vx)];
  for (var i = 0; i < 6 && s.bullets.length; i++) {
    tick();
    if (s.bullets[0]) angles.push(Math.atan2(s.bullets[0].vy, s.bullets[0].vx));
  }
  assert.ok(angles.length >= 2, '导引弹应存活并持续飞行');
  assert.ok(angles[angles.length - 1] < angles[0] - 0.03,
    '导引弹应朝上方敌人转向，而不是直线飞');
  assert.ok(typeof FW.distanceToPoly === 'function', '长锋与地效共用轮廓距离工具');
  reset();
});

/* ============ §H9 静态接线与可回退点 ============ */
test('§H9 六层静态接线契约：入口 / 输入 / 引擎 / HUD / 渲染 / 词条', function () {
  var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(idx.indexOf('src/core/chrono.js') !== -1);
  assert.ok(idx.indexOf('src/core/freewave.js') !== -1);
  assert.ok(idx.indexOf('id="btn-loop-classic"') !== -1, '必须保留可回退入口');
  assert.ok(idx.indexOf('id="streak-bar"') !== -1 && idx.indexOf('id="shield-bar"') !== -1);
  assert.ok(idx.indexOf('<kbd>E</kbd>') !== -1);
  var mj = fs.readFileSync(path.join(ROOT, 'src/ui/main.js'), 'utf8');
  assert.ok(mj.indexOf('input.arm = !!held.e;') !== -1);
  assert.ok(mj.indexOf('onFree:') !== -1 && mj.indexOf('onFreeContinue:') !== -1);
  assert.ok(mj.indexOf("case 'freeArm'") !== -1 && mj.indexOf("case 'perfectDodge'") !== -1);
  var en = fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
  assert.ok(en.indexOf('if (opts.free && C.core.freewave) return startFree(opts);') !== -1);
  assert.ok(en.indexOf('if (s && s.free) return updateFree(s, dt, input);') !== -1);
  assert.ok(en.indexOf('function freeCancel(s, weaponHit)') !== -1 && en.indexOf('q.mod.homingTurn') !== -1);
  assert.ok(en.indexOf('FW.distanceToPoly(poly, e)') !== -1);
  var sc = fs.readFileSync(path.join(ROOT, 'src/ui/screens.js'), 'utf8');
  assert.ok(sc.indexOf("show('free-setup')") !== -1 && sc.indexOf('handlers.onFree(id)') !== -1);
  assert.ok(sc.indexOf('C.core.loop.saveLabel()') !== -1, '经典存档必须仍可回落');
  var rd = fs.readFileSync(path.join(ROOT, 'src/ui/render.js'), 'utf8');
  ['drawFreeTiles', 'drawFreePath', 'drawFreeDodge'].forEach(function (fn) {
    assert.ok(rd.indexOf('function ' + fn) !== -1, fn + ' 应存在');
  });
  var pk = fs.readFileSync(path.join(ROOT, 'src/core/perks.js'), 'utf8');
  assert.ok(pk.indexOf('homingTurn:') !== -1 && pk.indexOf('cdCutPerTier:') !== -1);
});

test('§H9 经典回廊仍可独立启动，且续玩按钮能显示经典存档', async function () {
  reset();
  var s = await E.startRun({ loop: true, seed: 'fallback', theme: 'geometry', onEvent: function () {} });
  assert.ok(s.loop && !s.free, '旧路径必须原样保留');
  assert.ok(s.recall && s.recall.layout);
  tick();
  assert.ok(s.elapsed > 0, '经典帧循环仍可用');
  LM.save({ loop: { plan: { seed: 'fallback' }, layer: 2, roomInLayer: 1 },
    player: { hp: 70, maxHp: 100 }, gold: 0, perks: {}, pickCount: 0, kills: 0,
    elapsed: 0, run: { theme: 'geometry' } });
  S.show('start');
  assert.equal(els['btn-loop-continue'].classList.contains('hidden'), false,
    '没有自由存档时应回落显示经典回廊存档');
  assert.ok(els['btn-loop-continue']._text.indexOf('第 2 层') !== -1);
  reset();
});
