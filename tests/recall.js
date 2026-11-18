'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
global.window = global;
var storage = new Map();
global.localStorage = {
  getItem: function (key) { return storage.get(key) || null; },
  setItem: function (key, value) { storage.set(key, value); }
};

require('../src/core/perks.js');
require('../src/core/audio.js');
require('../src/core/recall.js');
require('../src/core/engine.js');
require('../src/theme/index.js');

var E = Corridor.core.engine;
var R = Corridor.core.recall;
var B = Corridor.core.perks.BALANCE.recall;
var corner = 'p_recall_corner';
var distance = 'p_recall_distance';

function tick(input) { return E.update(1 / 60, input || {}); }
function pressing(p, target, aim) {
  var x = target.x - p.x, y = target.y - p.y;
  return {
    left: x < -4, right: x > 4, up: y < -4, down: y > 4,
    fire: !!aim, aimX: aim && aim.x, aimY: aim && aim.y
  };
}
function walk(s, target, aim) {
  for (var i = 0; i < 600; i++) {
    if (Math.hypot(s.player.x - target.x, s.player.y - target.y) <= 6) return;
    assert.notEqual(s.phase, 'dead');
    tick(pressing(s.player, target, aim && aim()));
  }
  assert.fail('无法步行到 (' + target.x + ', ' + target.y + ')，停在 ' + s.player.x + ', ' + s.player.y);
}
function route(s, id, from, aim) {
  var points = R.lanes[id].points;
  if (from === 1) points = points.slice().reverse();
  points.slice(1).forEach(function (p) { walk(s, p, aim); });
}
function until(predicate, frames, input) {
  for (var i = 0; i < frames; i++) {
    if (predicate()) return;
    tick(input && input());
  }
  assert.ok(predicate(), '超过预期帧数');
}
async function begin(variant, perk, onEvent) {
  var s = await E.startRun({ prototype: variant, onEvent: onEvent });
  assert.equal(s.phase, 'perk');
  assert.deepEqual(s.perkPending, [corner, distance]);
  assert.equal(E.choosePerk('p_hp'), false);
  assert.equal(E.choosePerk(perk), true);
  return s;
}
function steadyEnemies(s) {
  s.enemies.forEach(function (e) { e.pattern = 'static'; e.timer = Infinity; });
}

test('折返擦除、重复进出岔口和冲刺过界走同一套规则', async function () {
  var s = await begin('A', corner);
  steadyEnemies(s);
  walk(s, { x: 112, y: 135 });
  assert.equal(R.trace(s.recall).length, 1);
  walk(s, R.hub[0]);
  assert.deepEqual(R.trace(s.recall), []);

  route(s, 'upper', 0);
  assert.equal(s.recall.outbound.id, 'upper');
  walk(s, { x: 790, y: 277 });
  walk(s, { x: 864, y: 257 });
  walk(s, { x: 700, y: 264 });
  walk(s, R.hub[1]);
  assert.equal(s.recall.outbound.id, 'upper');
  route(s, 'upper', 1);
  assert.equal(s.recall.loops, 0);
  assert.deepEqual(R.trace(s.recall), []);

  route(s, 'upper', 0);
  walk(s, { x: 214, y: 264 });
  assert.equal(s.recall.loops, 0);
  E.update(0.05, { left: true, dash: true });
  assert.equal(s.recall.loops, 0);
  E.update(0.05, { left: true });
  assert.equal(s.recall.loops, 1);
  assert.deepEqual(s.recall.wave.routes, ['middle', 'upper']);
  assert.equal(s.recall.wave.damage, B.damage);
  assert.equal(s.recall.wave.parts[0].radius, B.width);
  assert.ok(s.recall.wave.parts.some(function (p) { return p.radius === B.cornerWidth; }));
});

test('反向闭环改变命中先后，回扫每次只命中同一敌人一次', async function () {
  for (var first of ['upper', 'middle']) {
    var s = await begin('B', corner);
    steadyEnemies(s);
    var middle = s.enemies[0], upper = s.enemies[2];
    var second = first === 'upper' ? 'middle' : 'upper';
    route(s, first, 0);
    route(s, second, 1);
    assert.deepEqual(s.recall.wave.routes, [second, first]);
    until(function () { return middle.hp < middle.maxHp || upper.hp < upper.maxHp; }, 120);
    assert.equal(middle.hp < middle.maxHp, second === 'middle');
    assert.equal(upper.hp < upper.maxHp, second === 'upper');
    until(function () { return !s.recall.wave; }, 180);
    assert.equal(middle.maxHp - middle.hp, B.damage);
    assert.equal(upper.maxHp - upper.hp, B.damage);
  }
});

test('短圈不覆盖下廊，长程蓄力走下廊可扫掉炮台', async function () {
  var s = await begin('A', distance);
  steadyEnemies(s);
  var turret = s.enemies[2];
  route(s, 'upper', 0);
  route(s, 'middle', 1);
  assert.equal(s.recall.wave.damage, B.damage);
  until(function () { return !s.recall.wave; }, 180);
  assert.equal(turret.hp, turret.maxHp);
  route(s, 'lower', 0);
  route(s, 'middle', 1);
  assert.equal(s.recall.wave.damage, B.longDamage);
  until(function () { return !s.recall.wave; }, 180);
  assert.equal(turret.dead, true);
});

test('扩散只在折角后补到廊道边缘，回扫经过其他廊道的敌人不受击', function () {
  var edge = { x: 190, y: 166, r: 5 };
  var otherLane = { x: 775, y: 229, r: 15 };
  for (var perk of [corner, distance]) {
    var r = R.create();
    R.record(r, { x: 450, y: 264 }, perk);
    R.record(r, R.hub[1], perk);
    R.record(r, { x: 450, y: 126 }, perk);
    assert.equal(R.record(r, R.hub[0], perk), true);
    var hit = [];
    var step = function (dt) {
      R.advanceWave(r, dt, R.hub[0], [edge, otherLane], function (e) { hit.push(e); });
    };
    var upperLength = R.lanes.upper.length;
    while (r.wave.position + B.speed / 60 < upperLength) step(1 / 60);
    assert.equal(hit.includes(otherLane), false);
    while (r.wave) step(1 / 60);
    assert.equal(hit.includes(edge), perk === corner);
    // 中廊敌人在上廊扫完后才被命中。
    assert.deepEqual(hit, perk === corner ? [edge, otherLane] : [otherLane]);
  }
});

test('两套站位的出生点、每条廊道和首领入口均可通过步行到达', async function () {
  for (var variant of ['A', 'B']) {
    var s = await begin(variant, distance);
    steadyEnemies(s);
    route(s, 'middle', 0);
    route(s, variant === 'A' ? 'lower' : 'upper', 1);
    assert.ok(s.recall.wave);
    until(function () { return !s.recall.wave; }, 180);
    assert.equal(s.enemies.length, variant === 'A' ? 0 : 3);
    if (variant === 'B') {
      route(s, 'upper', 0);
      route(s, 'middle', 1);
      until(function () { return !s.recall.wave; }, 180);
    }
    assert.equal(s.exitActive, true);
    walk(s, R.hub[1]);
    until(function () { return s.phase === 'boss'; }, 90, function () { return { right: true }; });
    assert.deepEqual(s.recall, R.create());
    assert.equal(s.recallPerk, distance);
  }
});

test('首领护盾拦住射击，绕圈打开输出窗口并可打到第二阶段和通关', async function () {
  var phases = [];
  var s = await begin('A', distance, function (type, info) {
    if (type === 'bossPhase') phases.push(info.phase);
  });
  steadyEnemies(s);
  route(s, 'lower', 0);
  route(s, 'middle', 1);
  until(function () { return s.exitActive; }, 180);
  walk(s, R.hub[1]);
  until(function () { return s.phase === 'boss'; }, 90, function () { return { right: true }; });
  var boss = s.enemies[0];
  var aim = function () { return boss; };
  // 单独验证首领机制。受伤和倒地由另一项用例走实际伤害。
  s.player.invuln = Infinity;
  route(s, 'upper', 0, aim);
  assert.equal(boss.hp, boss.maxHp);
  route(s, 'middle', 1, aim);
  assert.ok(s.recall.wave);

  var guardedHit = false, shotDuringWindow = false;
  for (var lap = 0; lap < 12 && s.phase !== 'won'; lap++) {
    var hp = boss.hp;
    while (s.recall.wave && boss.guardOpen <= 0 && s.phase !== 'won') tick();
    if (boss.guardOpen > 0) {
      guardedHit = guardedHit || boss.hp < hp;
      var hpAfterWave = boss.hp;
      while (boss.guardOpen > 0 && s.phase !== 'won') {
        var target = R.chaseTarget(s.player, boss);
        tick(pressing(s.player, target, boss));
      }
      shotDuringWindow = shotDuringWindow || boss.hp < hpAfterWave;
    }
    if (s.phase === 'won') break;
    while (s.recall.wave) tick();
    var start = s.recall.origin == null ? 0 : s.recall.origin;
    var waypoint = R.hub[start];
    until(function () {
      return Math.hypot(s.player.x - waypoint.x, s.player.y - waypoint.y) <= 7;
    }, 700, function () { return pressing(s.player, R.chaseTarget(s.player, waypoint), boss); });
    if (s.recall.outbound) route(s, s.recall.outbound.id, s.recall.atHub, aim);
    route(s, lap % 2 ? 'upper' : 'lower', start, aim);
    route(s, 'middle', 1 - start, aim);
  }

  assert.ok(guardedHit);
  assert.ok(shotDuringWindow);
  assert.deepEqual(phases, [2]);
  assert.equal(s.phase, 'won');
});

test('二阶段在移动前预警，走中廊的频率高于一阶段', function () {
  var orders = [1, 2].map(function (phase) {
    var boss = { x: R.hub[1].x, y: R.hub[1].y, guardOpen: 0,
      patrol: { hub: 1, cursor: 0, phase: 1, route: null, warning: 0 } };
    var order = [];
    for (var i = 0; i < 4; i++) {
      var still = R.advancePatrol(boss, 1 / 60, B.patrolSpeed, phase);
      assert.deepEqual(still, { x: boss.x, y: boss.y });
      assert.ok(boss.patrol.warning > 0);
      order.push(boss.patrol.route.id);
      while (boss.patrol.route) {
        var p = R.advancePatrol(boss, 1 / 60, B.patrolSpeed, phase);
        assert.ok(R.walls.every(function (w) {
          return Math.hypot(
            p.x - Math.max(w.x, Math.min(w.x + w.w, p.x)),
            p.y - Math.max(w.y, Math.min(w.y + w.h, p.y))
          ) >= 28;
        }), '首领巡行侵入墙体');
        boss.x = p.x;
        boss.y = p.y;
      }
      assert.deepEqual({ x: boss.x, y: boss.y }, R.hub[boss.patrol.hub]);
    }
    return order;
  });
  assert.equal(orders[0].filter(function (id) { return id === 'middle'; }).length, 1);
  assert.equal(orders[1][0], 'middle');
  assert.equal(orders[1].filter(function (id) { return id === 'middle'; }).length, 2);
});

test('追兵能经过廊口和折角跨到玩家所在的廊道', async function () {
  var s = await begin('A', corner);
  s.player.invuln = Infinity;
  walk(s, { x: 112, y: 126 });
  walk(s, { x: 458, y: 126 });
  until(function () {
    return s.enemies.slice(0, 2).every(function (e) {
      return Math.hypot(e.x - s.player.x, e.y - s.player.y) < 36;
    });
  }, 1000);
});

test('真实受伤结束试玩，重开清空旧轨迹且原版存档未写入', async function () {
  var saved = JSON.stringify({ gold: 70, runs: 12, clears: 3, unlocked: ['p_hp'] });
  storage.set('corridor.meta.v1', saved);
  var events = [];
  var s = await begin('B', corner, function (type) { events.push(type); });
  assert.equal(s.player.maxHp, 100);
  route(s, 'upper', 0);
  assert.ok(s.recall.outbound);
  until(function () { return s.phase === 'dead'; }, 6500);
  assert.ok(events.includes('runEnd'));
  assert.equal(storage.get('corridor.meta.v1'), saved);
  var fresh = await E.restart({ prototype: 'B' });
  assert.equal(fresh.prototype, 'B');
  assert.equal(fresh.phase, 'perk');
  assert.equal(fresh.player.hp, 100);
  assert.deepEqual(fresh.recall, R.create());
  assert.equal(fresh.recallPerk, undefined);
  assert.equal(storage.get('corridor.meta.v1'), saved);
});
