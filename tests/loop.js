/* tests/loop.js — 回廊长局（游戏本体玩法）回归验收
 * 运行：node --test tests/loop.js
 *
 * 覆盖：
 *   §A 廊道几何：4 套模板 / 三层九间的每条廊、两 hub、敌人出生点均可站立，
 *      且敌人互不重叠 —— 守住 B1「刷怪到墙圈里走不进去」的死档底线。
 *   §B 关卡编排与路线词条：seed 可复现、层内不重样、LOOP 池不污染冻结 IDS、
 *      每轮候选至少一条「改变选路」词条、短/长圈与连扫确实改波参数。
 *   §C 闭环与波：单段来回不触发、折返擦除、波只结算经过廊段内的敌人。
 *   §D 层末存档：save/load/clearSave、损坏存档回落、续玩恢复字段。
 *   §E 帧循环端到端：真实 startRun → 绕圈清房 → 换房（廊型确实变化）→
 *      巡廊首领破盾 → 换层 → 三层通关 → 存档清除；以及续玩入口。
 *
 * 边界：纯 Node、零依赖、零端口、零后台进程；不改 src/**、不改 smoke.js。
 * §E 用「理想玩家」瞬时低血压敌人快速推进，只证明状态机可达，
 * 不代表真人手感或单局时长（口径同 tests/fullsuite.js §B）。
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

/* 按 index.html 固定顺序加载，顺带验证新模块确实在入口链路里 */
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (var m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) require(path.join(ROOT, m[1]));

var C = global.Corridor;
var E = C.core.engine, R = C.core.recall, LM = C.core.loop, P = C.core.perks;
var B = P.BALANCE.loop, S = C.ui.screens;

function reset() { for (var k of Object.keys(store)) delete store[k]; }
function tick(input) { return E.update(1 / 60, input || {}); }
function pressing(p, target, aim) {
  var x = target.x - p.x, y = target.y - p.y;
  return { left: x < -4, right: x > 4, up: y < -4, down: y > 4,
    fire: !!aim, aimX: aim && aim.x, aimY: aim && aim.y };
}
function walk(s, target) {
  var startPhase = s.phase;
  for (var i = 0; i < 900; i++) {
    if (Math.hypot(s.player.x - target.x, s.player.y - target.y) <= 6) return true;
    if (s.phase !== startPhase && (s.phase === 'perk' || s.phase === 'won' || s.phase === 'dead')) return true;
    tick(pressing(s.player, target));
  }
  return false;
}
function laneRoute(s, layout, id, from) {
  var pts = layout.lanes[id].points.slice();
  if (from === 1) pts.reverse();
  pts.slice(1).forEach(function (p) { walk(s, p); });
}
function lap(s, outId, backId) {
  var layout = s.recall.layout;
  laneRoute(s, layout, outId, 0);
  laneRoute(s, layout, backId, 1);
}
function drainWave(s, limit) {
  for (var i = 0; i < (limit || 400) && s.recall && s.recall.wave; i++) tick();
}
function steady(s) {
  s.player.invuln = Infinity;
  s.enemies.forEach(function (e) { e.pattern = 'static'; e.timer = Infinity; e.vx = e.vy = 0; });
}

/* ============ §A 廊道几何 ============ */
test('§A1 四套廊型的每条廊、两个廊口、敌人出生点均可站立且互不重叠', function () {
  for (var i = 0; i < LM.TEMPLATES.length; i++) {
    for (var off = 0; off < 6; off++) {
      var L = LM.makeLayout(i, off);
      assert.equal(LM.validate(L), true, '模板 ' + i + ' offset ' + off + ' 几何自检失败');
      assert.equal(L.fallback, undefined, '不应回落到兜底廊型');
      assert.ok(Object.keys(L.lanes).length >= 2);
      Object.keys(L.lanes).forEach(function (id) {
        assert.ok(L.lanes[id].length > 0, id + ' 廊长度为 0');
        assert.deepEqual(L.lanes[id].points[0], L.hub[0]);
        assert.deepEqual(L.lanes[id].points[L.lanes[id].points.length - 1], L.hub[1]);
      });
    }
  }
});

test('§A2 三层九间的编排可复现、层内不重样，且每间都通过几何自检', function () {
  var a = LM.plan('seed-alpha'), b = LM.plan('seed-alpha'), c = LM.plan('seed-beta');
  assert.deepEqual(a.rooms.map(function (r) { return r.template; }),
                   b.rooms.map(function (r) { return r.template; }), '同 seed 必须复现');
  assert.notDeepEqual(a.rooms.map(function (r) { return r.template; }),
                      c.rooms.map(function (r) { return r.template; }), '不同 seed 应产生不同编排');
  assert.equal(a.rooms.length, B.layers * B.roomsPerLayer);
  for (var layer = 1; layer <= B.layers; layer++) {
    var seen = [];
    for (var k = 0; k < B.roomsPerLayer; k++) {
      var room = LM.roomAt(a, layer, k);
      assert.equal(room.layer, layer);
      assert.equal(room.roomInLayer, k);
      assert.equal(LM.validate(room.layout), true, '第 ' + layer + ' 层第 ' + k + ' 间不可走');
      assert.ok(room.enemies.length >= 3);
      seen.push(room.layout.id);
    }
    assert.equal(new Set(seen).size, seen.length, '第 ' + layer + ' 层出现重复廊型');
  }
  assert.equal(LM.roomAt(a, B.layers + 1, 0), null);
});

test('§A3 任意布局的敌人出生点都在玩家可达区域（B1 死档回归）', function () {
  var p = LM.plan('reachability-2026');
  for (var layer = 1; layer <= B.layers; layer++) {
    for (var k = 0; k < B.roomsPerLayer; k++) {
      var room = LM.roomAt(p, layer, k), L = room.layout;
      for (var i = 0; i < room.enemies.length; i++) {
        var q = room.enemies[i].pos;
        var blocked = L.walls.some(function (w) {
          var nx = Math.max(w.x, Math.min(q.x, w.x + w.w)), ny = Math.max(w.y, Math.min(q.y, w.y + w.h));
          return Math.hypot(q.x - nx, q.y - ny) < 15 + 6;
        });
        assert.equal(blocked, false, '第 ' + layer + ' 层第 ' + k + ' 间第 ' + i + ' 只怪刷在墙内');
        for (var j = 0; j < i; j++) {
          assert.ok(Math.hypot(q.x - room.enemies[j].pos.x, q.y - room.enemies[j].pos.y) >= 36,
            '敌人出生点重叠');
        }
      }
    }
  }
});

/* ============ §B 关卡编排与路线词条 ============ */
test('§B1 LOOP 词条独立于冻结 IDS，不进局外解锁池', function () {
  var ids = Object.keys(P.LOOP);
  assert.ok(ids.length >= 8);
  ids.forEach(function (id) {
    assert.equal(P.IDS.indexOf(id), -1, id + ' 不应污染主词条池');
    assert.equal(P.TABLE[id], undefined);
    assert.ok(P.LOOP[id].name && P.LOOP[id].desc && P.LOOP[id].rarity && P.LOOP[id].tag);
  });
  assert.ok(P.IDS.length >= 24, '冻结词条表不得缩减');
});

test('§B2 每轮候选三条且至少含一条「改变选路」词条，叠层不超上限', function () {
  var s = { perks: {}, pickCount: 0 };
  var routeIds = Object.keys(P.LOOP).filter(function (id) { return P.LOOP[id].route; });
  for (var n = 0; n < 12; n++) {
    var offer = LM.offer(s);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3, '候选不得重复');
    assert.ok(offer.some(function (id) { return routeIds.indexOf(id) !== -1; }), '缺少选路词条');
    offer.forEach(function (id) { assert.ok(P.LOOP[id]); });
  }
  s.perks.p_loop_corner = P.LOOP.p_loop_corner.max;
  for (var k = 0; k < 6; k++) assert.equal(LM.offer(s).indexOf('p_loop_corner'), -1);
});

test('§B3 短圈 / 长圈 / 折角 / 疾行 / 宽扫 / 连扫分别改变波参数', function () {
  function rules(perks, streak) {
    return LM.waveRules({ perks: perks || {}, loop: { streak: streak || 1 } });
  }
  var base = rules();
  assert.equal(base.damage, B.damage);
  assert.equal(base.width, B.width);
  assert.equal(base.speed, B.speed);
  assert.equal(rules({ p_loop_wide: 1 }).width, B.width + B.wideBonus);
  assert.equal(rules({ p_loop_corner: 1 }).cornerWidth, B.cornerWidth + B.cornerBonus);
  assert.equal(rules({ p_loop_swift: 1 }).speed, B.speed * B.swiftMul);
  assert.equal(rules({}, 2).damage, Math.round(B.damage * (1 + B.streakStep)));
  assert.equal(rules({}, B.streakCap + 5).damage, Math.round(B.damage * (1 + B.streakStep * (B.streakCap - 1))));
  assert.ok(rules({ p_loop_long: 1 }).longDamage > base.damage);
  assert.ok(rules({ p_loop_focus: 1 }).shortDamage > base.damage);
  assert.ok(B.shortDistance < B.longDistance);
  assert.equal(rules({ p_loop_mend: 1 }).damage, base.damage);
});

test('§B4 词条即时收益随叠层放大，未持有则为零', function () {
  assert.deepEqual(LM.loopRewards({ perks: {} }), { heal: 0, dash: false, goldPerKill: 0 });
  var r = LM.loopRewards({ perks: { p_loop_mend: 2, p_loop_dash: 1, p_loop_greed: 2 } });
  assert.equal(r.heal, B.mendPerLoop * 2);
  assert.equal(r.dash, true);
  assert.equal(r.goldPerKill, B.greedPerKill * 2);
});

/* ============ §C 闭环与波（泛化后的 recall 算法） ============ */
test('§C1 任意布局：单段来回不触发，两条不同廊闭环触发且折返可擦除', function () {
  var L = LM.makeLayout(1, 3);
  var r = R.create(L);
  var hub0 = L.hub[0], hub1 = L.hub[1];
  assert.equal(R.record(r, hub0), false);
  R.record(r, LM.along(L.lanes.upper, L.lanes.upper.length * 0.5));
  assert.equal(R.record(r, hub1), false);
  laneRouteRaw(r, L, 'upper', 1);
  assert.equal(r.loops, 0, '单段来回不应闭环');
  assert.deepEqual(R.trace(r), []);

  laneRouteRaw(r, L, 'upper', 0);
  assert.equal(r.outbound.id, 'upper');
  laneRouteRaw(r, L, 'middle', 1);
  assert.equal(r.loops, 1);
  assert.ok(r.wave);
  assert.deepEqual(r.wave.routes, ['middle', 'upper']);
  assert.equal(r.wave.speed, B.speed);
});

/* 逐段插值回放，模拟真实玩家每帧经过廊道的位置。
 * 中廊只有两个端点，若只喂折点则 r.current 永远为 null，闭环不成立 —— 那是回放缺陷，不是玩法缺陷。 */
function laneRouteRaw(r, L, id, from, rules) {
  var pts = L.lanes[id].points.slice();
  if (from === 1) pts.reverse();
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i];
    var n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20));
    for (var k = 1; k <= n; k++) {
      R.record(r, { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }, rules);
    }
  }
}

test('§C2 波只结算经过廊段内的敌人，同一敌人一次波最多受击一次', function () {
  var L = LM.makeLayout(0, 0), r = R.create(L);
  var onUpper = { x: 450, y: 126, r: 5, dead: false };
  var onLower = { x: 450, y: 516, r: 5, dead: false };
  var rules = LM.waveRules({ perks: {}, loop: { streak: 1 } });
  R.record(r, L.hub[0], rules);
  laneRouteRaw(r, L, 'upper', 0, rules);
  assert.equal(R.record(r, L.hub[1], rules), false);
  laneRouteRaw(r, L, 'middle', 1, rules);
  assert.ok(r.wave, 'upper→middle 应闭环');
  var hits = [];
  while (r.wave) R.advanceWave(r, 1 / 60, L.hub[0], [onUpper, onLower], function (e, d) { hits.push({ e: e, d: d }); });
  assert.ok(hits.length >= 1, '上廊敌人应被扫到');
  assert.equal(hits.filter(function (h) { return h.e === onLower; }).length, 0, '下廊敌人不该被短圈波扫到');
  assert.equal(new Set(hits.map(function (h) { return h.e; })).size, hits.length, '同一敌人不可重复受击');
  assert.equal(hits[0].d, B.damage);
});

test('§C3 旧固定三廊原型的默认接口与数值保持不变', function () {
  var r = R.create();
  assert.equal(r.layout, R.DEFAULT);
  assert.deepEqual(R.hub, [{ x: 112, y: 264 }, { x: 836, y: 264 }]);
  assert.equal(R.DEFAULT.lanes.middle.length, R.lanes.middle.length);
  var old = C.core.perks.BALANCE.recall;
  var rules = LM.waveRules({ perks: {}, loop: { streak: 1 } });
  assert.equal(old.damage, 26);
  assert.equal(old.longDamage, 44);
  assert.ok(rules.damage > old.damage, '长局波伤与旧原型互不干扰');
});

/* ============ §D 层末存档 ============ */
test('§D1 save / load / saveLabel / clearSave 与损坏存档回落', function () {
  reset();
  assert.equal(LM.hasSave(), false);
  assert.equal(LM.load(), null);
  assert.equal(LM.saveLabel(), '');
  var s = { loop: { plan: { seed: 'sv' }, layer: 2, roomInLayer: 1 },
    player: { hp: 47, maxHp: 120 }, gold: 88,
    perks: { p_loop_long: 1 }, pickCount: 3, kills: 12, elapsed: 91.6, run: { theme: 'oldtown' } };
  var data = LM.save(s);
  assert.equal(data.layer, 2);
  assert.equal(data.hp, 47);
  assert.equal(data.elapsed, 92);
  assert.equal(LM.hasSave(), true);
  assert.equal(LM.saveLabel(), '继续 · 第 2 层 第 2 间');
  assert.deepEqual(LM.load(), data);
  LM.clearSave();
  assert.equal(LM.hasSave(), false);

  store[LM.SAVE_KEY] = '{broken';
  assert.equal(LM.load(), null);
  store[LM.SAVE_KEY] = JSON.stringify({ version: 9, seed: 'x', layer: 1, roomInLayer: 0 });
  assert.equal(LM.load(), null, '版本不符应拒绝');
  store[LM.SAVE_KEY] = JSON.stringify({ version: 1, seed: 'x', layer: 9, roomInLayer: 0 });
  assert.equal(LM.load(), null, '层数越界应拒绝');
  store[LM.SAVE_KEY] = JSON.stringify({ version: 1, seed: 'x', layer: 2, roomInLayer: 3 });
  assert.equal(LM.load(), null, '房间序号越界应拒绝');
  reset();
});

/* ============ §E 帧循环端到端 ============ */
async function beginLoop(opts) {
  reset();
  return E.startRun(Object.assign({ loop: true, seed: 'loop-suite', theme: 'geometry' }, opts || {}));
}

test('§E1 开局状态齐备、四条廊道地面状态可用、存档已写', async function () {
  var s = await beginLoop();
  assert.equal(s.phase, 'playing');
  assert.equal(s.loop.layer, 1);
  assert.equal(s.loop.roomInLayer, 0);
  assert.equal(s.loop.continued, false);
  assert.ok(s.recall && s.recall.layout);
  assert.equal(s.recall.layout.walls, s.walls);
  assert.equal(s.enemies.length, 4);
  assert.equal(s.run.rooms.length, B.roomsPerLayer);
  assert.ok(LM.hasSave());
  assert.equal(LM.load().layer, 1);
  assert.equal(s.player.x, s.recall.layout.hub[0].x);
});

test('§E2 真实绕圈清房 → 出口 → 选词条 → 换到不同廊型（第二圈有理由换路）', async function () {
  var s = await beginLoop();
  steady(s);
  var firstLayout = s.recall.layout.id;
  var combos = [['upper', 'middle'], ['lower', 'middle'], ['middle', 'upper'], ['lower', 'upper']];
  for (var i = 0; i < 12 && !s.exitActive; i++) {
    lap(s, combos[i % combos.length][0], combos[i % combos.length][1]);
    drainWave(s);
  }
  assert.equal(s.exitActive, true, '绕圈应能清房');
  assert.ok(s.recall.loops >= 2 && s.recall.loops <= 6, '单房闭环数 ' + s.recall.loops + ' 超出 2–6 圈目标');
  assert.ok(s.loop.streak >= 2, '连续闭环应累积连扫，实得 ' + s.loop.streak);

  walk(s, { x: 886, y: s.recall.layout.hub[1].y });
  assert.equal(s.phase, 'perk');
  assert.equal(s.perkPending.length, 3);
  assert.equal(E.choosePerk('p_hp'), false, '主词条不得混入长局');
  var pick = s.perkPending[0];
  assert.equal(E.choosePerk(pick), true);
  assert.equal(s.perks[pick], 1);
  assert.equal(s.loop.roomInLayer, 1);
  assert.equal(s.phase, 'playing');
  assert.ok(s.recall.layout.lanes.upper.points.length > 0);
  var layouts = new Set([firstLayout, s.recall.layout.id]);
  assert.equal(layouts.size, 2, '连续两间不应是同一张廊道图');
  assert.equal(LM.load().roomInLayer, 1, '换房后存档应更新');
});

test('§E3 射击退为牵制：护盾关闭时子弹伤害显著低于护盾窗口', async function () {
  var s = await beginLoop();
  var e = s.enemies[0];
  e.hp = 200; e.maxHp = 200; e.pattern = 'static'; e.timer = Infinity; e.vx = e.vy = 0;
  s.player.invuln = Infinity;
  var base = 10;
  var before = e.hp;
  /* 直接放一颗子弹到敌人身上，走真实 update 结算 */
  s.bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, damage: base, life: 0.5, crit: false, pierce: 0, hit: [] });
  tick();
  var normal = before - e.hp;
  assert.ok(normal > 0 && normal <= Math.round(base * B.bulletMul) + 1,
    '长局普通命中应被压到 ' + B.bulletMul + '，实得 ' + normal);
});

test('§E4 三层通关、层末换层事件、续玩恢复与通关后清档', async function () {
  var events = [];
  var s = await beginLoop({ onEvent: function (t, p) { events.push(t); } });
  s.player.invuln = Infinity;

  function fastClear() {
    s.enemies.forEach(function (e) { e.hp = 1; e.pattern = 'static'; e.timer = Infinity; e.vx = e.vy = 0; });
    var combos = [['upper', 'middle'], ['lower', 'middle'], ['middle', 'upper'], ['lower', 'upper']];
    for (var i = 0; i < 8 && !s.exitActive; i++) {
      lap(s, combos[i % combos.length][0], combos[i % combos.length][1]);
      drainWave(s);
    }
    return s.exitActive;
  }
  function fastBoss() {
    /* §E4 验证的是「三层可通关」的编排链路；M9 破盾状态机由 §F 专门端到端验证。
     * 这里把首领置于已破盾窗口，用真实子弹结算击杀，避免把通关测试变成
     * 绕圈计时的手感测试（闭合状态下回扫只削护盾、不磨血，是刻意设计）。 */
    var boss = s.enemies[0];
    if (!boss) return;
    boss.guardOpen = 6;
    boss.hp = 1;
    s.bullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0,
      damage: 30, life: 0.5, crit: false, pierce: 0, hit: [] });
    tick();
  }

  for (var guard = 0; guard < 40 && s.phase !== 'won' && s.phase !== 'dead'; guard++) {
    if (s.phase === 'boss') { fastBoss(); continue; }
    if (!fastClear()) { assert.fail('第 ' + guard + ' 轮未能清房'); }
    walk(s, { x: 886, y: s.recall.layout.hub[1].y });
    if (s.phase === 'perk') E.choosePerk(s.perkPending[0]);
  }
  assert.equal(s.phase, 'won', '三层应能通关，实际 ' + s.phase);
  assert.equal(s.loop.layer, B.layers);
  assert.ok(events.filter(function (t) { return t === 'loopLayer'; }).length >= 2, '应发出两次换层事件');
  assert.ok(events.indexOf('loopClosed') >= 0, '应发出闭环事件');
  assert.equal(LM.hasSave(), false, '通关后应清除存档');

  /* 续玩：在一局中途造一个存档，再走 continueRun 入口 */
  var mid = await E.startRun({ loop: true, seed: 'loop-continue', theme: 'geometry', onEvent: function () {} });
  mid.player.hp = 63;
  mid.gold = 77;
  mid.perks.p_loop_long = 2;
  mid.pickCount = 4;
  mid.loop.layer = 2;
  mid.loop.roomInLayer = 1;
  LM.save(mid);
  var cm = LM.load();
  var s2 = await E.startRun({ loop: true, continueRun: true, theme: 'geometry', onEvent: function () {} });
  assert.equal(s2.loop.continued, true);
  assert.equal(s2.loop.plan.seed, cm.seed);
  assert.equal(s2.loop.layer, 2);
  assert.equal(s2.loop.roomInLayer, 1);
  assert.equal(s2.player.hp, 63);
  assert.equal(s2.gold, 77);
  assert.equal(s2.perks.p_loop_long, 2);
  assert.equal(s2.pickCount, 4);
});

test('§E5 UI 接线：首页主入口与续玩按钮可点击，LOOP 词条卡能渲染', async function () {
  var started = 0, continued = 0, picked = null;
  /* index.html 加载 main.js 时已 init 过一次；清掉旧监听再装测试监听，避免重复计数 */
  els['btn-loop']._ev.click = [];
  els['btn-loop-continue']._ev.click = [];
  S.init({ onStart: function () {}, onLoop: function () { started++; },
    onLoopContinue: function () { continued++; }, onPick: function (id) { picked = id; },
    onRecall: function () {}, onImpact: function () {}, onImpactCombinations: function () {},
    onTrial: function () {}, onRestart: function () {}, onUnlock: function () {},
    onToggleMute: function () {}, onPause: function () {}, onResume: function () {}, onHome: function () {} });
  els['btn-loop'].click();
  assert.equal(started, 1, '回廊长局主入口应接入');
  reset();
  LM.save({ loop: { plan: { seed: 'ui' }, layer: 3, roomInLayer: 2 },
    player: { hp: 50, maxHp: 100 }, gold: 0, perks: {}, pickCount: 0, kills: 0, elapsed: 0,
    run: { theme: 'geometry' } });
  S.show('start');
  assert.equal(els['btn-loop-continue'].classList.contains('hidden'), false, '有存档时续玩按钮应出现');
  assert.ok(els['btn-loop-continue']._text.indexOf('第 3 层') !== -1);
  els['btn-loop-continue'].click();
  assert.equal(continued, 1, '续玩入口应接入');

  var s = await E.startRun({ loop: true, seed: 'ui-card', theme: 'geometry', onEvent: function () {} });
  var choices = LM.offer(s).slice();
  S.showPerk(choices, false, false, false, true);
  assert.equal(els['perk-cards'].children.length, choices.length, 'LOOP 词条卡应全部渲染');
  assert.ok(els['perk-cards'].children[0]._html.indexOf(P.LOOP[choices[0]].name) !== -1);
  assert.ok(els['perk-title']._text.indexOf('下一圈怎么走') !== -1);
  reset();
});

/* ============ §F M9 多相位护盾（破盾玩法扩展） ============ */
/* 直接把三间房标为已清，走真实「出口 → 词条 → choosePerk」链路进层末首领。 */
function enterBossRoom(s) {
  for (var n = 0; n < B.roomsPerLayer && s.phase !== 'boss'; n++) {
    s.enemies.forEach(function (e) { e.dead = true; });
    s.enemies = [];
    s.exitActive = true;
    s.phase = 'playing';
    walk(s, { x: 886, y: s.recall.layout.hub[1].y });
    if (s.phase === 'perk') E.choosePerk(s.perkPending[0]);
  }
  return s.phase === 'boss';
}
/* 用 recall 自身的 record() 回放一条真实闭环，产出 wave，再交给 engine.update()
 * 的 advanceWave 回调结算 —— 走的仍是真实引擎路径，只是玩家瞬间走完。 */
function makeWave(s, outId, backId) {
  var L = s.recall.layout, r = s.recall, rules = LM.waveRules(s);
  r.wave = null; r.outbound = null; r.current = null;
  r.origin = 0; r.atHub = 0;
  R.record(r, L.hub[0], rules);
  laneRouteRaw(r, L, outId, 0, rules);
  R.record(r, L.hub[1], rules);
  laneRouteRaw(r, L, backId, 1, rules);
  return r.wave;
}
/* 完整 mock 2D 上下文：真实调用 render.draw，收集实际设置的色值。 */
function mockCtx() {
  var seen = [];
  var grad = { addColorStop: function (c) { seen.push(String(c)); } };
  var base = { canvas: { clientWidth: 960, width: 960, height: 600 } };
  return {
    seen: seen,
    ctx: new Proxy(base, {
      get: function (o, k) {
        if (k in o) return o[k];
        if (k === 'createRadialGradient' || k === 'createLinearGradient') {
          return function () { return grad; };
        }
        return function () {};
      },
      set: function (o, k, v) {
        if (k === 'fillStyle' || k === 'strokeStyle' || k === 'shadowColor') seen.push(String(v));
        o[k] = v; return true;
      }
    })
  };
}

test('§F1 护盾相位要求轮换、门槛与窗口随破盾次数变化，破盾词条生效', function () {
  var S = P.BALANCE.loop.shield;
  var a = LM.shieldSpec(0, {}), b = LM.shieldSpec(1, {}),
      c = LM.shieldSpec(2, {}), d = LM.shieldSpec(3, {});
  assert.equal(a.required, 'any');
  assert.equal(b.required, 'corner');
  assert.equal(c.required, 'long');
  assert.equal(d.required, 'short');
  assert.equal(LM.shieldSpec(4, {}).required, 'any', '相位应循环');
  assert.equal(a.need, S.baseNeed);
  assert.ok(LM.shieldSpec(4, {}).need > a.need, '破盾越多，下一相位门槛越高');
  assert.ok(c.window < a.window && c.window >= S.windowMin);
  assert.ok(d.speedMul > a.speedMul && d.speedMul <= S.speedCap);
  var perk = LM.shieldSpec(2, {
    p_loop_breach: 1, p_loop_window: 2, p_loop_shard: 2, p_loop_overdrive: 1
  });
  assert.equal(perk.need, c.need - 1);
  assert.ok(perk.window > c.window);
  assert.ok(perk.weakCharge > c.weakCharge);
  assert.ok(perk.exposedWaveMul > c.exposedWaveMul);
  assert.equal(LM.SHIELD_LABEL.corner, '折角圈');
  Object.keys(P.LOOP).filter(function (id) { return P.LOOP[id].tag === '破盾'; })
    .forEach(function (id) { assert.ok(P.IDS.indexOf(id) === -1, id + ' 不得污染冻结池'); });
});

test('§F2 waveTags 从波与廊道几何识别短圈 / 长圈 / 折角圈', function () {
  var fork = LM.makeLayout(0, 0);
  var short = LM.waveTags({ length: 1724, routes: ['upper', 'middle'] }, fork);
  assert.equal(short.short, true);
  assert.equal(short.long, false);
  assert.equal(short.corner, false, 'fork 直上廊只有 2 个中间折点，不算折角圈');
  var long = LM.waveTags({ length: 1952, routes: ['lower', 'middle'] }, fork);
  assert.equal(long.long, true);
  assert.equal(long.corner, true);
  var bent = LM.waveTags({ length: 1876, routes: ['upper', 'middle'] }, LM.makeLayout(1, 0));
  assert.equal(bent.corner, true, '折上廊应识别为折角圈');
  assert.equal(LM.matchesShield(short, 'any'), true);
  assert.equal(LM.matchesShield(short, 'short'), true);
  assert.equal(LM.matchesShield(short, 'long'), false);
  assert.equal(LM.matchesShield(short, 'corner'), false);
  assert.equal(LM.matchesShield(long, 'corner'), true);
  assert.equal(LM.matchesShield(long, 'long'), true);
});

test('§F3 首领入场即处于闭合护盾第 1 相位，破盾词条随本局构筑生效', async function () {
  reset();
  var s = await E.startRun({ loop: true, seed: 'shield-init', theme: 'geometry',
    onEvent: function () {} });
  s.player.invuln = Infinity;
  assert.equal(enterBossRoom(s), true, '应能进入层末首领房');
  var boss = s.enemies[0];
  assert.ok(boss && boss.shield, '长局首领应带多相位护盾');
  assert.equal(boss.shield.state, 'closed');
  assert.equal(boss.shield.breaks, 0);
  assert.equal(boss.shield.charge, 0);
  assert.equal(boss.shield.spec.required, 'any');
  assert.equal(boss.shield.spec.need, P.BALANCE.loop.shield.baseNeed);
  assert.equal(boss.guardOpen, 0);
  assert.equal(s.breakFlash, 0);
  assert.equal(s.bossPhase, 1, '长局应屏蔽旧的 50% 血切 P2');
  reset();
});

test('§F4 闭合→崩解→暴露→重构→下一相位：真实帧循环走通且圈型门槛生效', async function () {
  reset();
  var events = [];
  var s = await E.startRun({ loop: true, seed: 'shield-e2e', theme: 'geometry',
    onEvent: function (t, p) { events.push({ t: t, p: p }); } });
  s.player.invuln = Infinity;
  assert.equal(enterBossRoom(s), true);
  var boss = s.enemies[0];
  boss.hp = boss.maxHp = 9999;      // 不让首领在测试中途死亡
  boss.timer = Infinity;            // 停掉弹幕，隔离状态机
  boss.shield.spec.window = 999;    // 窗口不在测试帧内自然归零，便于分阶段断言

  /* ① 闭合：回扫削蓄势，但绝不磨血 */
  var hp0 = boss.hp, c0 = boss.shield.charge;
  assert.ok(makeWave(s, 'upper', 'middle'), '应生成闭环波');
  drainWave(s);
  assert.ok(boss.shield.charge > c0, '回扫应削护盾蓄势');
  assert.equal(boss.hp, hp0, '闭合状态回扫不得磨血');
  assert.ok(events.some(function (e) { return e.t === 'bossShieldCharge'; }));

  /* ② 补到临界，再一圈真实闭环触发破盾 */
  boss.shield.charge = boss.shield.spec.need - 0.2;
  makeWave(s, 'upper', 'middle'); drainWave(s);
  assert.equal(boss.shield.state, 'exposed', '蓄势满应崩解');
  assert.ok(boss.guardOpen > 0, '崩解应打开全额输出窗口');
  assert.equal(s.loop.shieldBreaks, 1);
  assert.ok(events.some(function (e) { return e.t === 'bossShieldBreak'; }));

  /* ③ 暴露窗口：子弹全额生效，窗口内继续绕圈吃到回扫加成 */
  var before = boss.hp;
  s.bullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0,
    damage: 10, life: 0.5, crit: false, pierce: 0, hit: [] });
  tick();
  assert.equal(before - boss.hp, 10, '窗口内子弹应全额生效（不再是 0.34 倍）');
  var before2 = boss.hp;
  makeWave(s, 'upper', 'middle'); drainWave(s);
  assert.ok(before2 - boss.hp > B.damage, '窗口内回扫应吃 exposedWaveMul 加成');

  /* ④ 窗口结束 → 重构 → 下一相位，抬高门槛并换圈型要求 */
  boss.guardOpen = 0.01;
  tick();
  assert.equal(boss.shield.state, 'reforming');
  assert.ok(events.some(function (e) { return e.t === 'bossShieldClose'; }));
  for (var i = 0; i < 120; i++) tick();
  assert.equal(boss.shield.state, 'closed', '重构完成应回到闭合');
  assert.equal(boss.shield.breaks, 1);
  assert.equal(boss.shield.spec.required, 'corner', '第 2 相位应要求折角圈');
  assert.ok(boss.shield.spec.speedMul > 1, '重构后巡逻应提速');
  assert.ok(events.some(function (e) { return e.t === 'bossShieldReform'; }));

  /* ⑤ 相位 2：直上廊短圈不匹配 → 折算蓄势；下廊折角圈匹配 → 全额 */
  var c1 = boss.shield.charge;
  makeWave(s, 'upper', 'middle'); drainWave(s);
  assert.ok(boss.shield.charge - c1 > 0 && boss.shield.charge - c1 < 1,
    '圈型不符应只给折算蓄势');
  assert.ok(events.some(function (e) { return e.t === 'bossShieldCharge' && e.p.matched === false; }));
  var c2 = boss.shield.charge;
  makeWave(s, 'lower', 'middle'); drainWave(s);
  assert.ok(boss.shield.charge - c2 >= 1, '折角圈应全额蓄势');
  assert.ok(events.some(function (e) { return e.t === 'bossShieldCharge' && e.p.matched === true; }));
  reset();
});

test('§F5 HUD 护盾条按三态显示相位、蓄势与窗口倒计时', async function () {
  reset();
  var s = await E.startRun({ loop: true, seed: 'shield-hud', theme: 'geometry',
    onEvent: function () {} });
  s.player.invuln = Infinity;
  assert.equal(enterBossRoom(s), true);
  var boss = s.enemies[0];
  S.updateHud(s);
  assert.equal(els['shield-bar'].classList.contains('hidden'), false);
  assert.equal(els['shield-bar'].dataset.state, 'closed');
  assert.ok(els['shield-state']._text.indexOf('第 1 相位') !== -1);
  assert.ok(els['shield-state']._text.indexOf('任意闭环') !== -1);

  boss.shield.state = 'exposed';
  boss.guardOpen = 2.4;
  boss.shield.spec.window = 3.6;
  S.updateHud(s);
  assert.equal(els['shield-bar'].dataset.state, 'exposed');
  assert.ok(els['shield-timer']._text.indexOf('2.4') !== -1);
  assert.ok(els['shield-state']._text.indexOf('崩解') !== -1);

  boss.shield.state = 'reforming';
  boss.shield.reform = 0.5;
  S.updateHud(s);
  assert.equal(els['shield-bar'].dataset.state, 'reforming');
  assert.ok(els['shield-state']._text.indexOf('重构') !== -1);
  reset();
});

test('§F6 破盾三态与爆发信号真实渲染不抛异常，且画面确实分流', async function () {
  reset();
  var s = await E.startRun({ loop: true, seed: 'shield-render', theme: 'geometry',
    onEvent: function () {} });
  s.player.invuln = Infinity;
  assert.equal(enterBossRoom(s), true);
  var boss = s.enemies[0];
  boss.shield.spec.window = 3.6;
  var sig = [];
  [['closed', 0, 0], ['exposed', 2.4, 0], ['reforming', 0, 0.5]].forEach(function (row) {
    boss.shield.state = row[0];
    boss.guardOpen = row[1];
    boss.shield.reform = row[2];
    s.breakFlash = 0;
    var m = mockCtx();
    assert.doesNotThrow(function () { C.ui.render.draw(m.ctx, s, 0.8, null, null); });
    assert.ok(m.seen.length > 20, row[0] + ' 应产生实际绘制色值');
    sig.push(m.seen.join('|'));
  });
  assert.notEqual(sig[0], sig[1], '闭合 / 暴露画面必须不同');
  assert.notEqual(sig[1], sig[2], '暴露 / 重构画面必须不同');
  /* 全屏破盾爆发信号 */
  s.breakFlash = 1;
  var burstMock = mockCtx();
  assert.doesNotThrow(function () { C.ui.render.draw(burstMock.ctx, s, 0.8, null, null); });
  assert.notEqual(burstMock.seen.join('|'), sig[0], '破盾爆发应叠加额外画面');
  reset();
});

test('§F7 事件、HUD DOM 与 CSS 接线静态契约', function () {
  var mainSrc = fs.readFileSync(path.join(ROOT, 'src/ui/main.js'), 'utf8');
  ['bossShieldBreak', 'bossShieldReform', 'bossShieldCharge', 'bossShieldClose', 'bossShieldHit']
    .forEach(function (ev) {
      assert.ok(mainSrc.indexOf("case '" + ev + "'") !== -1, ev + ' 事件应接上反馈');
    });
  var html2 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ['shield-bar', 'shield-state', 'shield-fill', 'shield-timer'].forEach(function (id) {
    assert.ok(html2.indexOf('id="' + id + '"') !== -1, id + ' 应存在于 HUD');
  });
  var css = fs.readFileSync(path.join(ROOT, 'src/ui/style.css'), 'utf8');
  assert.ok(css.indexOf('.shield-bar') !== -1 && css.indexOf('[data-state="exposed"]') !== -1);
  var renderSrc = fs.readFileSync(path.join(ROOT, 'src/ui/render.js'), 'utf8');
  assert.ok(renderSrc.indexOf('drawBossShield') !== -1 && renderSrc.indexOf('drawBreakBurst') !== -1);
});
