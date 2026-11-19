/* core/loop.js — 回廊长局：参数化廊道 / 关卡编排 / 路线词条 / 层末存档
 * 纯规则层：不依赖 DOM、主题、音频。几何与闭环算法复用 core/recall.js，
 * 本模块只负责「这一局走哪些房、每条廊长什么样、敌人站在哪一段、词条怎么改波」。
 *
 * 设计依据：docs/参赛改进与美术方向.md §一「绕一圈，从另一侧回击」与 §三验收。
 * 与旧原型的区别：旧原型只有一张固定三廊图、一间普通房 + 一场首领；
 * 这里是 3 层 × 3 间 + 每层首领，每间廊道折线不同、敌人沿廊布阵、
 * 词条决定偏好短圈还是长圈，并在层末写入 localStorage 供续玩。
 */
(function (C) {
  'use strict';

  var W = 960, H = 600;
  var SAVE_KEY = 'corridor.loop.save.v1';
  var HUB = [{ x: 112, y: 264 }, { x: 836, y: 264 }];

  function pt(x, y) { return { x: x, y: y }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 墙体骨架与旧回扫原型一致（已由 tests/recall.js 9/9 验证可达）。
   * 所有模板共用骨架，只改变廊道折线与敌人布阵 —— 这样 locate() 的分区判定
   * 恒定有效，几何自洽可证，不会出现「圈内刷怪走不进去」的 B1 死档。 */
  var BASE_WALLS = [
    { x: 18, y: 18, w: 924, h: 56 },
    { x: 18, y: 74, w: 42, h: 385 },
    { x: 922, y: 74, w: 20, h: 385 },
    { x: 174, y: 180, w: 612, h: 32 },       // 上分隔墙
    { x: 174, y: 316, w: 612, h: 34 },       // 下分隔墙
    { x: 385, y: 350, w: 190, h: 112 },      // 下廊内障碍
    { x: 18, y: 459, w: 258, h: 123 },
    { x: 684, y: 459, w: 258, h: 123 },
    { x: 276, y: 568, w: 408, h: 14 }
  ];

  var LOWER_BENDS = [pt(112, 404), pt(330, 404), pt(330, 516),
                     pt(630, 516), pt(630, 404), pt(836, 404)];
  var DEEP_BENDS  = [pt(112, 404), pt(320, 404), pt(320, 530),
                     pt(640, 530), pt(640, 404), pt(836, 404)];

  /* 四套廊型。upper 折线在 y∈[100,165] 的安全带内变化（上分隔墙 y=180 起）；
   * lower 折线沿用已验证的 U 形绕开三块下廊障碍。每条廊的两端恒为两个 hub。 */
  var TEMPLATES = [
    {
      id: 'fork', name: '三岔廊', hint: '上廊短、下廊长。先走短圈，再从下廊绕回来把炮台带上。',
      upper: [pt(112, 126), pt(836, 126)], lower: LOWER_BENDS,
      spawns: [
        { lane: 'middle', at: 0.52, pattern: 'chase', hp: 44 },
        { lane: 'upper', at: 0.38, pattern: 'chase', hp: 40 },
        { lane: 'lower', at: 0.68, pattern: 'static', hp: 36 },
        { lane: 'middle', at: 0.84, pattern: 'ranged', hp: 38 }
      ]
    },
    {
      id: 'switchback', name: '折上廊', hint: '上廊多了两道折角。折角扩散在这里比长圈更划算。',
      upper: [pt(112, 104), pt(300, 104), pt(300, 158), pt(660, 158), pt(660, 104), pt(836, 104)],
      lower: LOWER_BENDS,
      spawns: [
        { lane: 'upper', at: 0.30, pattern: 'chase', hp: 44 },
        { lane: 'upper', at: 0.72, pattern: 'static', hp: 36 },
        { lane: 'middle', at: 0.60, pattern: 'chase', hp: 40 },
        { lane: 'lower', at: 0.52, pattern: 'ranged', hp: 38 }
      ]
    },
    {
      id: 'deepwell', name: '深井廊', hint: '下廊比第一间更深。长程蓄力能覆盖整条深井。',
      upper: [pt(112, 126), pt(836, 126)], lower: DEEP_BENDS,
      spawns: [
        { lane: 'lower', at: 0.34, pattern: 'static', hp: 36 },
        { lane: 'lower', at: 0.78, pattern: 'chase', hp: 44 },
        { lane: 'middle', at: 0.46, pattern: 'chase', hp: 40 },
        { lane: 'upper', at: 0.66, pattern: 'ranged', hp: 38 }
      ]
    },
    {
      id: 'twinbend', name: '双折廊', hint: '上廊只折一次。换一条廊回程，波会先打到不同的怪。',
      upper: [pt(112, 110), pt(420, 110), pt(420, 156), pt(836, 156)], lower: LOWER_BENDS,
      spawns: [
        { lane: 'middle', at: 0.40, pattern: 'chase', hp: 44 },
        { lane: 'upper', at: 0.58, pattern: 'chase', hp: 40 },
        { lane: 'lower', at: 0.40, pattern: 'static', hp: 36 },
        { lane: 'lower', at: 0.82, pattern: 'ranged', hp: 38 }
      ]
    }
  ];

  function lane(id, name, bends) {
    var points = [HUB[0]].concat(bends, [HUB[1]]);
    var marks = [0];
    for (var i = 1; i < points.length; i++) marks.push(marks[i - 1] + dist(points[i - 1], points[i]));
    return { id: id, name: name, points: points, marks: marks, length: marks[marks.length - 1] };
  }

  function along(route, d) {
    var i = 1;
    while (i < route.marks.length - 1 && d > route.marks[i]) i++;
    var a = route.points[i - 1], b = route.points[i];
    var span = route.marks[i] - route.marks[i - 1];
    var t = span ? (d - route.marks[i - 1]) / span : 0;
    return pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  function inWall(walls, p, radius) {
    return walls.some(function (q) {
      var nx = clamp(p.x, q.x, q.x + q.w), ny = clamp(p.y, q.y, q.y + q.h);
      return Math.hypot(p.x - nx, p.y - ny) < radius;
    });
  }

  /* 生成一间房的完整 layout，并做几何自检。
   * 自检失败时回落到基础廊型，保证任何种子都不会产出不可走的房间。 */
  function makeLayout(templateIndex, seedOffset) {
    var t = TEMPLATES[((templateIndex % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length];
    var walls = BASE_WALLS.slice();
    var lanes = {
      upper: lane('upper', '上廊', t.upper),
      middle: lane('middle', '中廊', []),
      lower: lane('lower', '下廊', t.lower)
    };
    var L = {
      id: t.id, name: t.name, hint: t.hint,
      walls: walls, hub: HUB, lanes: lanes,
      upperEdge: 212, lowerEdge: 316, leftEdge: 174, rightEdge: 786,
      spawns: t.spawns.map(function (sp, i) {
        /* 站位在模板基础上做小幅、确定性的偏移，让同模板的两次出现也不同 */
        var jitter = ((seedOffset * 7 + i * 13) % 9 - 4) * 0.012;
        return { lane: sp.lane, at: clamp(sp.at + jitter, 0.22, 0.88),
                 pattern: sp.pattern, hp: sp.hp };
      })
    };
    if (!validate(L)) return makeLayoutFallback(seedOffset);
    return L;
  }

  function makeLayoutFallback(seedOffset) {
    var t = TEMPLATES[0];
    var L = {
      id: t.id, name: t.name, hint: t.hint,
      walls: BASE_WALLS.slice(), hub: HUB,
      lanes: { upper: lane('upper', '上廊', t.upper), middle: lane('middle', '中廊', []),
               lower: lane('lower', '下廊', LOWER_BENDS) },
      upperEdge: 212, lowerEdge: 316, leftEdge: 174, rightEdge: 786,
      spawns: t.spawns.map(function (sp) { return { lane: sp.lane, at: sp.at, pattern: sp.pattern, hp: sp.hp }; })
    };
    L.fallback = true;
    return L;
  }

  /* 每条廊按 6px 采样、两 hub、每个敌人出生点都必须可站立；
   * 敌人之间不重叠；至少两条廊可用（否则无法闭环）。 */
  function validate(L) {
    var r = 16;
    var ids = Object.keys(L.lanes);
    if (ids.length < 2) return false;
    for (var k = 0; k < ids.length; k++) {
      var route = L.lanes[ids[k]];
      if (!(route.length > 0)) return false;
      for (var d = 0; d <= route.length; d += 6) {
        if (inWall(L.walls, along(route, Math.min(d, route.length)), r)) return false;
      }
    }
    for (var h = 0; h < L.hub.length; h++) if (inWall(L.walls, L.hub[h], r)) return false;
    var placed = [];
    for (var i = 0; i < L.spawns.length; i++) {
      var sp = L.spawns[i], route2 = L.lanes[sp.lane];
      if (!route2) return false;
      var p = along(route2, sp.at * route2.length);
      if (inWall(L.walls, p, r)) return false;
      for (var j = 0; j < placed.length; j++) if (dist(p, placed[j]) < 36) return false;
      placed.push(p);
    }
    return true;
  }

  /* ---------- 关卡编排：3 层 × 3 间，层内不重样 ---------- */
  function hashSeed(s) {
    var h = 2166136261;
    s = String(s || 'corridor');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = hashSeed(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function plan(seed) {
    var r = rng(seed), rooms = [], layers = 3, perLayer = 3;
    for (var layer = 1; layer <= layers; layer++) {
      var order = [0, 1, 2, 3];
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
      for (var k = 0; k < perLayer; k++) {
        rooms.push({ layer: layer, roomInLayer: k, template: order[k], offset: layer * 10 + k });
      }
    }
    return { seed: seed, rooms: rooms, layers: layers, perLayer: perLayer };
  }
  function roomAt(planData, layer, roomInLayer) {
    var idx = (layer - 1) * planData.perLayer + roomInLayer;
    var spec = planData.rooms[idx];
    if (!spec) return null;
    var L = makeLayout(spec.template, spec.offset);
    return {
      layer: layer, roomInLayer: roomInLayer, index: idx,
      name: L.name, hint: L.hint, layout: L,
      enemies: L.spawns.map(function (sp) {
        var route = L.lanes[sp.lane];
        return { pos: along(route, sp.at * route.length), lane: sp.lane,
                 pattern: sp.pattern, hp: sp.hp, damage: 8 };
      })
    };
  }

  /* ---------- 路线词条：把「走哪条路」变成构筑选择 ---------- */
  function waveRules(s) {
    var B = C.core.perks.BALANCE.loop;
    var p = s.perks || {}, L = s.loop;
    var streak = clamp(L.streak || 1, 1, B.streakCap);
    var scale = 1 + B.streakStep * (streak - 1);
    return {
      width: B.width + (p.p_loop_wide ? B.wideBonus : 0),
      cornerWidth: B.cornerWidth + (p.p_loop_corner ? B.cornerBonus : 0),
      cornerDistance: B.cornerDistance,
      speed: B.speed * (p.p_loop_swift ? B.swiftMul : 1),
      damage: Math.round(B.damage * scale),
      longDistance: B.longDistance,
      longDamage: Math.round(B.longDamage * scale),
      shortDistance: B.shortDistance,
      shortDamage: Math.round(B.shortDamage * scale),
      cornerPerk: !!p.p_loop_corner,
      longPerk: !!p.p_loop_long,
      focusPerk: !!p.p_loop_focus
    };
  }

  function offer(s) {
    var table = C.core.perks.LOOP;
    var ids = Object.keys(table).filter(function (id) {
      return (s.perks[id] || 0) < (table[id].max || 2);
    });
    /* 保证每轮至少出现一条「改变路线偏好」的词条，避免全是数值增强 */
    var routes = ids.filter(function (id) { return table[id].route; });
    var rest = ids.filter(function (id) { return !table[id].route; });
    var pick = [];
    if (routes.length) pick.push(routes[(s.pickCount || 0) % routes.length]);
    var i = (s.pickCount || 0);
    while (pick.length < 3 && rest.length) pick.push(rest[(i++) % rest.length]);
    while (pick.length < 3 && routes.length > pick.length) {
      var next = routes[(i++) % routes.length];
      if (pick.indexOf(next) === -1) pick.push(next);
    }
    return pick.slice(0, 3);
  }

  /* 闭环后的即时收益（回血 / 返还冲刺 / 击杀金币）。由 engine 消费。 */
  function loopRewards(s) {
    var B = C.core.perks.BALANCE.loop;
    var p = s.perks || {};
    return {
      heal: p.p_loop_mend ? B.mendPerLoop * (p.p_loop_mend || 1) : 0,
      dash: !!p.p_loop_dash,
      goldPerKill: p.p_loop_greed ? B.greedPerKill * (p.p_loop_greed || 1) : 0
    };
  }

  /* ---------- 存档：每间房结算写一次快照，刷新可续玩 ---------- */
  function save(s) {
    if (!s || !s.loop) return null;
    var data = {
      version: 1, seed: s.loop.plan.seed,
      layer: s.loop.layer, roomInLayer: s.loop.roomInLayer,
      hp: Math.max(1, Math.round(s.player.hp)), maxHp: s.player.maxHp,
      gold: s.gold, perks: Object.assign({}, s.perks),
      pickCount: s.pickCount || 0, kills: s.kills, elapsed: Math.round(s.elapsed),
      theme: s.run.theme
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { return null; }
    return data;
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.version !== 1 || !d.seed || d.layer < 1 || d.layer > 3 ||
          d.roomInLayer < 0 || d.roomInLayer > 2) return null;
      return d;
    } catch (e) { return null; }
  }
  function hasSave() { return !!load(); }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ } }
  function saveLabel() {
    var d = load();
    return d ? '继续 · 第 ' + d.layer + ' 层 第 ' + (d.roomInLayer + 1) + ' 间' : '';
  }

  C.core = C.core || {};
  C.core.loop = {
    W: W, H: H, HUB: HUB, SAVE_KEY: SAVE_KEY,
    TEMPLATES: TEMPLATES, BASE_WALLS: BASE_WALLS,
    makeLayout: makeLayout, validate: validate, along: along,
    plan: plan, roomAt: roomAt,
    waveRules: waveRules, offer: offer, loopRewards: loopRewards,
    save: save, load: load, hasSave: hasSave, clearSave: clearSave, saveLabel: saveLabel
  };
})(window.Corridor = window.Corridor || {});
