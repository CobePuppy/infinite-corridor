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
var windowListeners = {};
global.addEventListener = function (type, listener) { windowListeners[type] = listener; };
global.removeEventListener = function () {};
global.devicePixelRatio = 1;

var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (var m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) require(path.join(ROOT, m[1]));

var C = global.Corridor, E = C.core.engine, FW = C.core.freewave;
var Q = C.core.perks.BALANCE.free;
var DT = 1 / 60;

function reset() { for (var k of Object.keys(store)) delete store[k]; }
function blank() { return { up: false, down: false, left: false, right: false, fire: false, dash: false, arm: false, aimX: null, aimY: null }; }
function tick(input) { return E.update(DT, input || blank()); }
function advanceToBladeHit(s) {
  for (var frame = 0; frame < 16 && !s.free.bladeContacts.length; frame++) tick();
  assert.ok(s.free.bladeContacts.some(function (c) { return c.kind !== 'guard'; }), '应在挥击段命中');
}
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

test('试玩金币补发一次，已解锁词条和购买余额可跨加载延续', async function () {
  var metaKey = 'corridor.meta.v1';
  assert.equal(JSON.parse(store[metaKey]).gold, 9999);
  localStorage.setItem(metaKey, JSON.stringify({ gold: 41, unlocked: ['p_hp'], runs: 3, clears: 1, bestSeconds: 180 }));
  E.loadMeta();

  els['btn-unlock-start'].click();
  assert.equal(els['unlock-gold'].textContent, '9999');
  var dashIndex = C.core.perks.IDS.indexOf('p_dash');
  els['unlock-grid'].children[dashIndex].click();
  assert.equal(els['unlock-gold'].textContent, '9939');
  assert.deepEqual(E.loadMeta(), {
    gold: 9939, unlocked: ['p_hp', 'p_dash'], runs: 3, clears: 1, bestSeconds: 180, testGoldGranted: true
  });

  els['unlock-close'].click();
  els['btn-start'].click();
  await new Promise(setImmediate);
  assert.equal(E.getState().perks.p_hp, 1);
  assert.equal(E.getState().perks.p_dash, 1);
  assert.equal(E.getMeta().gold, 9939);
  localStorage.setItem(metaKey, JSON.stringify({ gold: 12000, unlocked: [] }));
  assert.equal(E.loadMeta().gold, 12000);
  C.ui.screens.dismissToast();
  C.ui.screens.show('start');
  reset();
});

test('武器试玩可挥大剑，暂停返回设置后可换手炮', async function () {
  els['btn-trial-setup'].click();
  assert.equal(C.ui.screens.current(), 'trial');
  var weaponSelect = document.getElementById('trial-weapon');
  weaponSelect.value = 'blade';
  document.getElementById('trial-version').value = 'A';
  document.getElementById('trial-preset').value = 'basic';
  els['btn-trial-start'].click();
  await Promise.resolve();
  var blade = E.getState();
  assert.equal(blade.impact.weapon, 'blade');
  tick({ attackPressed: true });
  assert.ok(blade.impact.swing);

  els['btn-pause'].click();
  assert.equal(els['btn-pause-home'].textContent, '更换武器 / 设置');
  els['btn-pause-home'].click();
  assert.equal(C.ui.screens.current(), 'trial');
  weaponSelect.value = 'cannon';
  els['btn-trial-start'].click();
  await Promise.resolve();
  var cannon = E.getState();
  assert.equal(cannon.impact.weapon, 'cannon');
  tick({ attackPressed: true });
  assert.ok(cannon.impact.shot);
  C.ui.screens.show('start');
});

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

test('自由回廊大剑命中只表现敌人后仰，移动、刀路与冷却持续推进', async function () {
  els['btn-loop'].click();
  assert.equal(C.ui.screens.current(), 'free-setup');
  els['btn-free-sweep'].click();
  await Promise.resolve();
  var s = E.getState(), p = s.player;
  assert.equal(s.free.weapon, 'cannon');
  assert.equal(els['hud-weapon'].textContent, '手炮');
  s.free.tiles = [];
  s.walls = [{ x: 230, y: 310, w: 10, h: 55 }];
  p.x = 200; p.y = 300;
  var front = s.enemies[0], behindWall = s.enemies[1];
  s.enemies = [front, behindWall];
  front.x = 245; front.y = 300;
  behindWall.x = 260; behindWall.y = 326;
  tick({ arm: true });
  var path = s.free.path;
  var room = s.room;
  windowListeners.keydown({ key: 'q', repeat: false });
  windowListeners.keydown({ key: 'q', repeat: true });
  assert.equal(s.free.weapon, 'blade');
  assert.equal(els['hud-weapon'].textContent, '大剑');
  assert.equal(E.getState(), s);
  assert.equal(s.room, room);
  assert.equal(s.free.path, path);
  tick({ aimX: 300, aimY: 300, attackPressed: true });
  assert.ok(s.free.swing);
  assert.equal(front.hp, front.maxHp);
  advanceToBladeHit(s);
  assert.ok(front.hp < front.maxHp);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.free.bladeContacts[0].kind, 'hit');
  assert.equal(s.shake, 0, '大剑命中应与通用震动和闪屏解耦');
  assert.equal(front.bladeRecoil.distance, Q.bladeAction.recoil);
  assert.equal(front.maxHp - front.hp, Q.bladeDamage);

  var pose = s.free.swing.progress;
  var elapsed = s.elapsed;
  var playerX = p.x, enemyX = front.x, recoilLife = front.bladeRecoil.life;
  tick({ right: true });
  assert.ok(s.free.swing.progress > pose);
  assert.ok(s.elapsed > elapsed);
  assert.ok(p.x > playerX);
  assert.equal(front.x, enemyX);
  assert.ok(front.bladeRecoil.life < recoilLife, '局部后仰应跟着时间复位');

  var cooldown = p.fireCd;
  var hpAfterSwing = front.hp;
  els['btn-switch-weapon'].click();
  assert.equal(s.free.weapon, 'cannon');
  assert.equal(p.fireCd, cooldown);
  tick({ aimX: 300, aimY: 300, attackPressed: true });
  assert.equal(s.bullets.length, 0);
  for (var frame = 0; frame < 30 && p.fireCd > 0; frame++) tick();
  assert.equal(p.fireCd, 0);
  assert.equal(front.hp, hpAfterSwing);
  assert.equal(behindWall.hp, behindWall.maxHp);
  tick({ aimX: 300, aimY: 300, attackPressed: true });
  for (var flight = 0; flight < 4 && front.hp === hpAfterSwing; flight++) tick();
  assert.ok(front.hp < hpAfterSwing);
  C.ui.screens.dismissToast();
  C.ui.screens.show('start');
});

test('局外购买能在自由回廊改变生命、冲刺、挥击和手炮', async function () {
  var metaKey = 'corridor.meta.v1';
  var upgrades = ['p_hp', 'p_dash', 'p_lifesteal', 'p_frost', 'p_multishot', 'p_pierce', 'p_regen', 'p_satellite'];
  localStorage.setItem(metaKey, JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  E.loadMeta();
  els['btn-unlock-start'].click();
  upgrades.forEach(function (id) {
    els['unlock-grid'].children[C.core.perks.IDS.indexOf(id)].click();
  });
  assert.equal(E.getMeta().gold, 9999 - 60 * upgrades.length);
  els['unlock-close'].click();
  els['btn-loop'].click();
  els['btn-free-sweep'].click();
  await Promise.resolve();
  var s = E.getState(), p = s.player, e = s.enemies[0];
  assert.equal(p.maxHp, 120);
  assert.equal(p.hp, 120);
  upgrades.forEach(function (id) { assert.equal(s.perks[id], 1); });

  s.walls = []; s.free.tiles = [];
  s.enemies = [e];
  p.x = 200; p.y = 300; p.hp = 70;
  e.x = 240; e.y = 300;
  windowListeners.keydown({ key: 'q', repeat: false });
  tick({ aimX: e.x, aimY: e.y, attackPressed: true });
  advanceToBladeHit(s);
  assert.equal(p.hp, 71);
  assert.ok(e.slowTime > 0);
  assert.equal(s.satellites.length, 1);

  els['btn-switch-weapon'].click();
  for (var frame = 0; frame < 24 && s.free.swing; frame++) tick();
  p.fireCd = 0;
  tick({ aimX: 200, aimY: 100, attackPressed: true, dash: true });
  assert.equal(p.dashCd, 0.62 * 0.8);
  assert.equal(s.bullets.length, 2);
  assert.ok(s.bullets.every(function (b) { return b.pierce === 1; }));

  s.enemies.length = 0;
  tick();
  assert.equal(p.hp, 79);
  assert.equal(s.phase, 'perk');
  C.ui.screens.dismissToast();
  C.ui.screens.show('start');
});

test('自由回廊旧续档装入局外词条一次，并记住武器和已消耗的余烬', async function () {
  reset();
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: ['p_hp', 'p_shield'] }));
  localStorage.setItem(FW.SAVE_KEY, JSON.stringify({
    version: 1, seed: 'old-checkpoint', layer: 2, roomInLayer: 1, hp: 40, maxHp: 100,
    gold: 8, perks: { p_loop_mend: 1 }, pickCount: 1, kills: 3, elapsed: 25, theme: 'geometry'
  }));
  var s = await E.startRun({ free: true, continueRun: true });
  assert.equal(s.free.layer, 2);
  assert.equal(s.free.roomInLayer, 1);
  assert.equal(s.free.weapon, 'cannon');
  assert.deepEqual(s.perks, { p_loop_mend: 1, p_hp: 1, p_shield: 1 });
  assert.equal(s.player.hp, 60);
  assert.equal(s.player.maxHp, 120);

  s.shieldUsed = true;
  E.switchFreeWeapon();
  FW.save(s);
  var resumed = await E.startRun({ free: true, continueRun: true });
  assert.equal(resumed.free.weapon, 'blade');
  assert.equal(resumed.player.hp, 60);
  assert.equal(resumed.player.maxHp, 120);
  assert.deepEqual(resumed.perks, s.perks);
  assert.equal(C.core.perks.derive(resumed).shieldReady, false);
  reset();
});

test('自由回廊的爆裂与星爆产生全屏共鸣，贪取作用于结算金币', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999,
    unlocked: ['p_explode', 'p_nova', 'p_greed'], testGoldGranted: true }));
  var s = await E.startRun({ free: true, seed: 'free-meta-synergy' });
  var p = s.player, target = s.enemies[0], distant = s.enemies[1];
  s.walls = []; s.free.tiles = [];
  s.enemies = [target, distant];
  p.x = 200; p.y = 300;
  target.x = 243; target.y = 300; target.hp = 1;
  distant.x = 800; distant.y = 100;
  E.switchFreeWeapon();
  tick({ attackPressed: true, aimX: target.x, aimY: target.y });
  advanceToBladeHit(s);
  assert.equal(s.free.bladeContacts[0].kind, 'heavy');
  assert.equal(s.shake, 0, '大剑击杀和共鸣应保留局部特效');
  assert.equal(target.dead, true);
  assert.equal(distant.hp, distant.maxHp - 12);

  s.gold = 8;
  p.hp = 9; p.invuln = 0;
  distant.x = p.x; distant.y = p.y;
  tick();
  assert.equal(s.phase, 'dead');
  assert.equal(E.getMeta().gold, 10005);
  reset();
});

test('手炮流派开火产生后坐与枪口效果，穿透命中有独立反馈', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  els['btn-loop'].click();
  els['btn-free-cannon'].click();
  await Promise.resolve();
  var s = E.getState(), p = s.player;
  assert.equal(s.free.style, 'cannon');
  assert.equal(els.source.textContent, '手炮流派');
  s.walls = []; s.free.tiles = [];
  p.x = 200; p.y = 300;
  var first = s.enemies[0], second = s.enemies[1];
  s.enemies = [first, second];
  first.hp = 1;
  first.x = 264; second.x = 324;
  first.y = second.y = 300;
  s.enemies.forEach(function (e) { e.pattern = 'charge'; e.mode = 'idle'; e.timer = Infinity; });
  s.perks.p_free_cannon_damage = 1;
  s.perks.p_free_cannon_pierce = 1;
  s.perks.p_free_blade_damage = 3;
  tick({ attackPressed: true, aimX: 400, aimY: 300 });
  assert.equal(s.free.cannonShot.age, 0);
  assert.equal(s.free.cannonContacts.length, 0);
  assert.equal(s.bullets[0].pierce, 1);
  assert.equal(s.bullets[0].damage, 3);
  for (var frame = 0; frame < 14 && second.hp === second.maxHp; frame++) {
    var beforeTick = p.fireCd, firstAlreadyHit = first.dead;
    tick();
    if (firstAlreadyHit) assert.equal(p.fireCd, Math.max(0, beforeTick - DT), '同一发穿透弹只可减一次冷却');
  }
  assert.equal(first.dead, true);
  assert.equal(second.maxHp - second.hp, 3);
  assert.equal(s.free.cannonContacts.length, 2);
  assert.equal(s.free.cannonContacts[0].heavy, true);
  assert.equal(s.free.cannonContacts[1].guard, false);
  assert.equal(s.shake, 0);
  assert.equal(p.x, 200);
  C.ui.screens.dismissToast();
  C.ui.screens.show('start');
});

test('自由回廊枪剑的基础伤害与满伤害词条下的单次伤害', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  for (var [weapon, base, built] of [['blade', 7, 15], ['cannon', 2, 7]]) {
    for (var upgraded of [false, true]) {
      var s = await E.startRun({ free: true, style: weapon, seed: 'weapon-damage' });
      s.free.tiles = [];
      if (upgraded) {
        s.perks['p_free_' + weapon + '_damage'] = 3;
        s.perks.p_overload = 1;
        s.combo = 60;
        s.comboTimer = 1;
      }
      tick({ attackPressed: true, aimX: 750, aimY: 300 });
      var attack = weapon === 'blade' ? s.free.swing : s.bullets[0];
      assert.equal(attack.damage, upgraded ? built : base);
    }
  }
  reset();
});

test('满配手炮的主弹保持瞄准方向，四枚副弹各按半伤害结算', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  var s = await E.startRun({ free: true, style: 'cannon', seed: 'secondary-damage' });
  s.free.tiles = [];
  s.perks = { p_free_cannon_damage: 3, p_free_cannon_spread: 2, p_multishot: 2, p_overload: 1 };
  s.combo = 60; s.comboTimer = 1;
  tick({ attackPressed: true, aimX: 750, aimY: 300 });
  assert.deepEqual(s.bullets.map(function (b) { return b.damage; }), [7, 3, 3, 3, 3]);
  assert.equal(s.bullets[0].secondary, false);
  assert.equal(s.bullets[0].vy, 0);
  assert.ok(s.bullets.slice(1).every(function (b) { return b.secondary && b.vy !== 0; }));
  reset();
});

test('大剑群伤按实际扫到的顺序衰减，护盾不占伤害档，每刀仅播放一次重击声', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  var sounds = [];
  var play = C.core.audio.play;
  C.core.audio.play = function (name) { if (name === 'bladeContact' || name === 'bladeGuard') sounds.push(name); };
  try {
    var s = await E.startRun({ free: true, style: 'blade', seed: 'blade-falloff' });
    s.free.tiles = []; s.walls = [];
    s.player.x = 200; s.player.y = 300;
    s.perks = { p_free_blade_damage: 3, p_overload: 1 };
    s.combo = 60; s.comboTimer = 1;
    var [late, middle, first, guard] = s.enemies;
    [-0.05, 0.025, 0.125, -0.60].forEach(function (angle, i) {
      var enemy = [first, middle, late, guard][i];
      enemy.x = 200 + Math.cos(angle) * 58;
      enemy.y = 300 + Math.sin(angle) * 58;
      enemy.pattern = 'charge'; enemy.mode = 'idle'; enemy.timer = Infinity;
    });
    guard.patrol = {}; guard.guardOpen = 0;
    E.update(0.05, { attackPressed: true, aimX: 380, aimY: 300 });
    for (var frame = 0; frame < 6; frame++) E.update(0.05, {});
    assert.deepEqual([first, middle, late, guard].map(function (e) { return e.maxHp - e.hp; }), [15, 9, 6, 0]);
    assert.deepEqual(sounds, ['bladeGuard', 'bladeContact']);
  } finally {
    C.core.audio.play = play;
    reset();
  }
});

test('手炮流派的远射、稳射与压制改变弹道和主弹命中后的速度', async function () {
  localStorage.setItem('corridor.meta.v1', JSON.stringify({ gold: 9999, unlocked: [], testGoldGranted: true }));
  var s = await E.startRun({ free: true, style: 'cannon', seed: 'cannon-utility' });
  assert.equal(FW.getStyle('cannon').pool.length, 8);
  for (var id of ['p_free_cannon_range', 'p_free_cannon_focus', 'p_free_cannon_suppress']) {
    assert.ok(FW.stylePerk(s, id));
    assert.equal(FW.stylePerk({ free: { style: 'blade' } }, id), null);
    assert.equal(FW.stylePerk({ free: { style: 'sweep' } }, id), null);
  }
  s.free.tiles = []; s.walls = [];
  s.perks = { p_free_cannon_range: 2, p_free_cannon_focus: 1, p_free_cannon_suppress: 2, p_free_cannon_spread: 1 };
  s.player.x = 200; s.player.y = 300;
  var primary = s.enemies[0], side = s.enemies[1];
  s.enemies = [primary, side];
  primary.x = 380; primary.y = 300;
  side.x = 200 + Math.cos(0.128) * 180; side.y = 300 + Math.sin(0.128) * 180;
  s.enemies.forEach(function (e) { e.pattern = 'charge'; e.mode = 'idle'; e.timer = Infinity; });
  tick({ attackPressed: true, aimX: 420, aimY: 300 });
  assert.ok(Math.abs(s.bullets[0].life - (0.55 * 1.4 - DT)) < 1e-9);
  assert.ok(Math.abs(Math.atan2(s.bullets[1].vy, s.bullets[1].vx) - 0.128) < 1e-9);
  for (var frame = 0; frame < 24 && (primary.hp === primary.maxHp || side.hp === side.maxHp); frame++) tick();
  assert.equal(primary.maxHp - primary.hp, 2);
  assert.equal(side.maxHp - side.hp, 1);
  assert.equal(primary.cannonSlow.factor, 0.64);
  assert.ok(!side.cannonSlow);
  primary.pattern = 'chase';
  var x = primary.x;
  tick();
  assert.ok(Math.abs((x - primary.x) - 100 * DT * 0.64) < 1e-9);
  for (var frame = 0; frame < 45; frame++) tick();
  assert.equal(primary.cannonSlow, null);
  reset();
});

test('自由回廊大剑空挥和被护盾挡住时，目标不播放受击后仰', async function () {
  for (var guarded of [false, true]) {
    var s = (await start()).s;
    var e = s.enemies[0], p = s.player;
    s.walls = []; s.free.tiles = []; s.enemies = [e];
    e.x = p.x + (guarded ? 55 : 180); e.y = p.y;
    if (guarded) { e.patrol = {}; e.guardOpen = 0; }
    E.switchFreeWeapon();
    tick({ attackPressed: true, aimX: e.x, aimY: e.y });
    var sawGuard = false, sawSweep = false;
    for (var frame = 0; frame < 24 && s.free.swing; frame++) {
      tick();
      sawSweep = sawSweep || !!(s.free.swing && s.free.swing.progress > 0);
      sawGuard = sawGuard || s.free.bladeContacts.some(function (c) { return c.kind === 'guard'; });
      assert.ok(!e.bladeRecoil);
    }
    assert.equal(s.free.swing, null);
    assert.equal(e.hp, e.maxHp);
    assert.equal(sawSweep, true);
    assert.equal(sawGuard, guarded);
  }
  reset();
});

test('重置局外技能返还已付金币，续档移除旧技能并保留本局卡牌', async function () {
  var key = 'corridor.meta.v1';
  localStorage.setItem(key, JSON.stringify({ gold: 9999, unlocked: [], runs: 5, clears: 2, bestSeconds: 170, testGoldGranted: true }));
  E.unlock('p_hp');
  E.unlock('p_dash');
  var s = await E.startRun({ free: true, style: 'blade', seed: 'reset-meta' });
  s.player.hp = 112;
  s.perks.p_free_blade_speed = 1;
  s.pickCount = 1;
  s.free.roomInLayer = 1;
  FW.save(s);

  els['btn-unlock-start'].click();
  var resetButton = els['unlock-reset'];
  assert.equal(resetButton.disabled, false);
  resetButton.click();
  assert.equal(els['unlock-gold'].textContent, '9879');
  assert.equal(E.getMeta().unlocked.length, 2);
  resetButton.click();
  assert.equal(els['unlock-gold'].textContent, '9999');
  assert.deepEqual(E.loadMeta(), { gold: 9999, unlocked: [], runs: 5, clears: 2, bestSeconds: 170, testGoldGranted: true });
  assert.equal(resetButton.disabled, true);
  assert.equal(E.resetUnlocks(), 0);
  assert.equal(E.unlock('p_dash').ok, true);

  var resumed = await E.startRun({ free: true, continueRun: true });
  assert.equal(resumed.free.style, 'blade');
  assert.equal(resumed.free.roomInLayer, 1);
  assert.deepEqual(resumed.perks, { p_free_blade_speed: 1, p_dash: 1 });
  assert.equal(resumed.player.maxHp, 100);
  assert.equal(resumed.player.hp, 100);
  C.ui.screens.dismissToast();
  C.ui.screens.show('start');
  reset();
});
