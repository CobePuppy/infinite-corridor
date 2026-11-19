/* tests/play.js — M12 玩家视角回归（真实输入，不瞬移）
 * 运行：node --test tests/play.js
 *
 * 与 tests/freewave.js 的区别：§H5 的 walkLoop() 直接改 p.x/p.y 瞬移，
 * 只证明「状态机可达」；本文件完全靠 E.update(dt, input) 的 WASD 物理推进，
 * 证明「真人靠按键能玩得下去」。覆盖 M12 两处本体缺陷的回归：
 *   §P1 出生点不嵌墙（普通房 + 首领房），首帧不被 collideWalls 弹开
 *   §P2 真实 WASD 能画出合法闭环并兑现，回扫波结算圈内敌人
 *   §P3 面积不足被拒后自动重设起点，无需重按 E 仍能兑现下一圈
 *   §P4 静态接线契约：修复点不被回退
 *
 * 边界：纯 Node + DOM stub，零端口、零后台进程、零浏览器操作；
 * 不改 src/**，不改 tests/smoke.js；帧数只作上限保护，不代表真人手感或单局时长。
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

var C = global.Corridor, E = C.core.engine, FW = C.core.freewave;
var Q = C.core.perks.BALANCE.free;
var DT = 1 / 60;

function reset() { for (var k of Object.keys(store)) delete store[k]; }
function blank() { return { up: false, down: false, left: false, right: false, fire: false, dash: false, arm: false, aimX: null, aimY: null }; }
function tick(input) { return E.update(DT, input || blank()); }
function start() {
  reset();
  var events = [];
  return E.startRun({ free: true, seed: 'play', theme: 'geometry',
    onEvent: function (t, d) { events.push({ type: t, data: d }); } }).then(function (s) {
    steady(s);
    return { s: s, events: events };
  });
}
/* 只隔离伤害与敌人主动行为，不冻结玩家物理：走位仍完全由 input 驱动。 */
function steady(s) {
  s.player.invuln = Infinity;
  s.enemies.forEach(function (e) { e.vx = 0; e.vy = 0; e.mode = 'idle'; e.timer = Infinity; });
}
function ev(ctx, type) { return ctx.events.filter(function (x) { return x.type === type; }); }
function wallOverlaps(s, p) {
  var r = s.player.r || 14;
  return s.walls.filter(function (w) {
    var nx = Math.max(w.x, Math.min(p.x, w.x + w.w));
    var ny = Math.max(w.y, Math.min(p.y, w.y + w.h));
    return Math.hypot(p.x - nx, p.y - ny) < r;
  });
}
function steer(input, p, target) {
  var dx = target.x - p.x, dy = target.y - p.y;
  input.right = dx > 8; input.left = dx < -8;
  input.down = dy > 8; input.up = dy < -8;
  return Math.hypot(dx, dy);
}
/* 自动驾驶：按 WASD 依次走到各航点；allowArm=false 时全程不按 E。 */
function drive(ctx, waypoints, maxFrames, allowArm) {
  if (allowArm === undefined) allowArm = true;
  var s = ctx.s, input = blank(), wi = 0, frames = 0, armed = !allowArm;
  var log = { framesToClose: 0, maxPath: 0, armSent: 0 };
  while (wi < waypoints.length && frames++ < (maxFrames || 4000)) {
    var d = steer(input, s.player, waypoints[wi]);
    if (d < 22) wi++;
    if (armed === false && wi > 0) { input.arm = true; armed = true; log.armSent++; }
    else input.arm = false;
    tick(input);
    log.maxPath = Math.max(log.maxPath, s.free.path.length);
    if (s.free.closures > 0 && !log.framesToClose) log.framesToClose = frames;
  }
  return log;
}
/* 避开自由房三处掩体的大矩形，面积远大于 minArea。 */
function bigLoop() {
  return [{ x: 100, y: 100 }, { x: 100, y: 100 },
          { x: 860, y: 100 }, { x: 860, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 100 }];
}
function enterBoss() {
  reset();
  localStorage.setItem(FW.SAVE_KEY, JSON.stringify({
    version: 1, seed: 'play-boss', layer: 1, roomInLayer: Q.roomsPerLayer - 1,
    hp: 100, maxHp: 100, gold: 0, perks: {}, pickCount: 0, kills: 0,
    elapsed: 0, theme: 'geometry'
  }));
  return E.startRun({ free: true, continueRun: true, seed: 'play-boss', theme: 'geometry',
    onEvent: function () {} }).then(function (s) {
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

/* ============ §P1 出生点 ============ */
test('§P1 普通房出生点不嵌墙，首帧位移为 0', async function () {
  var ctx = await start(), s = ctx.s;
  var p0 = { x: s.player.x, y: s.player.y };
  assert.equal(wallOverlaps(s, p0).length, 0,
    'M12 前 (480,300) 落在中央掩体内，首帧被弹出 44px');
  tick();
  assert.ok(Math.hypot(s.player.x - p0.x, s.player.y - p0.y) < 0.5,
    '出生点不应被 collideWalls 弹开');
  reset();
});

test('§P1 首领房出生点同样不嵌墙', async function () {
  var s = await enterBoss();
  var p0 = { x: s.player.x, y: s.player.y };
  assert.equal(wallOverlaps(s, p0).length, 0);
  tick();
  assert.ok(Math.hypot(s.player.x - p0.x, s.player.y - p0.y) < 0.5);
  reset();
});

/* ============ §P2 真实输入闭环 ============ */
test('§P2 真实 WASD 可画出合法闭环并兑现，回扫波结算圈内敌人', async function () {
  var ctx = await start(), s = ctx.s;
  var n0 = s.enemies.length, k0 = s.kills;
  var log = drive(ctx, bigLoop(), 5000);
  assert.ok(log.framesToClose > 0 && log.framesToClose < 2000,
    '靠按键应在合理帧数内兑现，而不是靠瞬移');
  assert.equal(s.free.closures, 1);
  var closures = ev(ctx, 'loopClosure');
  assert.equal(closures.length, 1);
  assert.ok(closures[0].data.area >= Q.minArea, '圈面积必须达标');
  assert.ok(closures[0].data.path.length > Q.minPoints, '路径应为真实采样点');
  assert.equal(ev(ctx, 'freeReject').length, 0);
  assert.equal(ev(ctx, 'freeArm').length, 1, 'E 只按一次');
  for (var i = 0; i < 120; i++) tick();
  assert.ok(s.enemies.length < n0 || s.kills > k0,
    '逆行回扫波应结算圈内敌人（实测 4→0 / kills 0→4）');
  reset();
});

/* ============ §P3 拒绝后自动恢复 ============ */
test('§P3 面积不足被拒后自动重设起点，不重按 E 仍能兑现下一圈', async function () {
  var ctx = await start(), s = ctx.s;
  var origin = { x: 120, y: 120 }, ring = [];
  for (var ang = 0; ang < Math.PI * 2; ang += Math.PI / 12) {
    ring.push({ x: origin.x + Math.cos(ang) * 70, y: origin.y + Math.sin(ang) * 70 });
  }
  ring.push(origin);
  drive(ctx, [origin].concat(ring), 3000);
  assert.equal(ev(ctx, 'freeReject').length, 1, '小圈应被拒绝');
  assert.equal(s.free.closures, 0, '拒绝不产出伤害');
  assert.equal(s.free.armed, true, 'M12：拒绝后必须保持可画圈，不能等玩家再按 E');
  assert.ok(s.free.origin, '应立刻以当前位置重设起点');
  var rejOrigin = { x: s.free.origin.x, y: s.free.origin.y };
  /* 全程不发送 input.arm，模拟玩家松开 E 后直接继续绕大圈。 */
  var log = drive(ctx, [{ x: 860, y: 100 }, { x: 860, y: 500 },
                        { x: 100, y: 500 }, rejOrigin], 4000, false);
  assert.equal(log.armSent, 0, '这一圈不得再按 E');
  assert.equal(s.free.closures, 1, 'M12 前此处恒为 0（最大采样点也是 0）');
  reset();
});

/* ============ §P4 静态接线契约 ============ */
test('§P4 两处修复点在源码中留存，toast 文案已改', function () {
  var en = fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
  assert.ok(en.indexOf('s.player.x = 400; s.player.y = 300;') !== -1);
  assert.ok(en.indexOf('FW.reset(f); FW.arm(f, p);') !== -1);
  assert.ok(en.indexOf('area: Math.round(closed.area)') !== -1);
  var mj = fs.readFileSync(path.join(ROOT, 'src/ui/main.js'), 'utf8');
  assert.ok(mj.indexOf('起点已重设，绕大一点再回来') !== -1);
});
