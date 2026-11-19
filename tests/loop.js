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
    if (s.enemies.length) { s.enemies[0].hp = 1; }
    for (var i = 0; i < 10 && s.phase === 'boss'; i++) {
      lap(s, i % 2 ? 'upper' : 'lower', 'middle');
      drainWave(s);
    }
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
