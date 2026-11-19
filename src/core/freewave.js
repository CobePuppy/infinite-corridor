/* core/freewave.js — M11 主模式：区域几何 / 格子地效 / 自由回扫 / 护盾相位 / 存档
 * 纯规则层，不依赖 DOM、主题、音频。
 *
 * 取代 M7 的「固定廊道」：路径由玩家真实行走轨迹决定，伤害按闭合多边形
 * 面积分档，仍须回到起点触发；面积过小 / 点数过少一律不触发（防原地转圈）。
 * 地效与自由回扫共用同一套格子 / 多边形工具（用户口径 ⑦）。
 * 护盾 spec 结构与 M9 完全一致，因此 render.js 的三态绘制可以直接复用。
 */
(function (C) {
  'use strict';

  var W = 960, H = 600;
  var SAVE_KEY = 'corridor.free.save.v1';
  function B() { return C.core.perks.BALANCE.free; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pt(x, y) { return { x: x, y: y }; }

  /* ---------- 区域几何（自由回扫与地效共用） ---------- */
  function area(poly) {
    var sum = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return Math.abs(sum) / 2;
  }
  function perimeter(poly) {
    var n = 0;
    for (var i = 1; i < poly.length; i++) n += dist(poly[i - 1], poly[i]);
    if (poly.length > 2) n += dist(poly[poly.length - 1], poly[0]);
    return n;
  }
  /* 折点数：相邻边方向变化超过阈值的中间点。乱画 / 自交时面积会互相抵消，
   * 与 minArea 一起构成「防原地转圈」的几何防线。 */
  function bends(poly) {
    var q = B(), n = 0;
    for (var i = 2; i < poly.length; i++) {
      var a1 = Math.atan2(poly[i - 1].y - poly[i - 2].y, poly[i - 1].x - poly[i - 2].x);
      var a2 = Math.atan2(poly[i].y - poly[i - 1].y, poly[i].x - poly[i - 1].x);
      var d = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
      if (d >= q.bendAngle) n++;
    }
    return n;
  }
  function inside(poly, p) {
    var hit = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  /* 点到多边形轮廓的最短距离：长锋词条借此把「圈内」扩成「圈内或贴边」，
   * 与 inside() 共用同一套顶点，地效与自由回扫共用同一份几何工具。 */
  function distanceToPoly(poly, p) {
    var best = Infinity, i;
    for (i = 1; i < poly.length; i++) {
      var a = poly[i - 1], b = poly[i];
      var vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
      var k = l2 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + vx * k), p.y - (a.y + vy * k)));
    }
    if (poly.length > 2) {
      var c = poly[poly.length - 1], d = poly[0];
      var ex = d.x - c.x, ey = d.y - c.y, e2 = ex * ex + ey * ey;
      var k2 = e2 ? clamp(((p.x - c.x) * ex + (p.y - c.y) * ey) / e2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(p.x - (c.x + ex * k2), p.y - (c.y + ey * k2)));
    }
    return best;
  }
  function classify(poly) {
    var q = B(), a = area(poly), l = perimeter(poly), bd = bends(poly);
    var tag = a >= q.areaBig ? 'big' : a >= q.areaMid ? 'mid' : 'small';
    var bent = bd >= q.bendMin;
    var label = (tag === 'big' ? '大圈' : tag === 'small' ? '小圈' : '中圈') + (bent ? ' · 折角' : '');
    var base = tag === 'big' ? q.damageBig : tag === 'small' ? q.damageSmall : q.damage;
    return { area: Math.round(a), length: Math.round(l), bends: bd,
             tag: tag, bent: bent, label: label, damage: base };
  }

  /* ---------- 格子地效（固定布局，正负各半，贴场地） ---------- */
  function hashSeed(s) {
    var h = 2166136261;
    s = String(s || 'free');
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
  function tiles(seed) {
    var q = B(), step = q.gridStep, r = rng(seed), out = [], used = {};
    var gxMax = Math.floor(W / step) - 1, gyMax = Math.floor(H / step) - 1;
    for (var i = 0; i < q.tile.count; i++) {
      var gx = 0, gy = 0, key = '', guard = 0;
      do {
        gx = 1 + Math.floor(r() * (gxMax - 2));
        gy = 1 + Math.floor(r() * (gyMax - 2));
        key = gx + ':' + gy;
        guard++;
      } while (used[key] && guard < 200);
      used[key] = true;
      var good = i % 2 === 0;
      out.push({ gx: gx, gy: gy, x: gx * step, y: gy * step, w: step, h: step,
                 kind: good ? 'good' : 'bad',
                 label: good ? '增幅格' : '滞涩格' });
    }
    return out;
  }
  function tileAt(list, x, y) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return t;
    }
    return null;
  }
  function tileBuff(tile) {
    var q = B().tile;
    if (!tile) return { damage: 1, speed: 1, cd: 1, hurt: 1, kind: 'none', label: '' };
    return tile.kind === 'good'
      ? { damage: q.goodDamage, speed: q.goodSpeed, cd: q.goodCd, hurt: 1,
          kind: 'good', label: tile.label }
      : { damage: q.badDamage, speed: q.badSpeed, cd: q.badCd, hurt: q.badHurt,
          kind: 'bad', label: tile.label };
  }

  /* ---------- 自由回扫状态机 ---------- */
  function create(seed) {
    return {
      armed: false, origin: null, path: [], wave: null,
      streak: 0, streakTimer: 0, closures: 0, shieldBreaks: 0,
      /* M13 圈型策略状态：跨圈保留（reset 不清），26 秒窗口超时才归一。 */
      lastTag: null, craftStreak: 0, repeatCount: 0, lastCraft: null, live: null,
      layer: 1, roomInLayer: 0, continued: false, seed: seed || 'free',
      tiles: tiles(seed || 'free'), tileBuff: null, boss: false
    };
  }
  function arm(f, p) {
    f.armed = true;
    f.origin = pt(p.x, p.y);
    f.path = [pt(p.x, p.y)];
    return true;
  }
  function reset(f) { f.armed = false; f.origin = null; f.path = []; f.live = null; }
  function record(f, p) {
    if (!f.armed || !f.path.length) return false;
    if (dist(f.path[f.path.length - 1], p) < B().sampleGap) return false;
    f.path.push(pt(p.x, p.y));
    return true;
  }
  /* 回到起点才允许结算；面积 / 点数不足直接拒绝，不产出任何伤害。 */
  function close(f, p) {
    var q = B();
    if (!f.armed || !f.origin) return null;
    if (dist(p, f.origin) > q.closeRadius || f.path.length < q.minPoints) return null;
    var c = classify(f.path);
    if (c.area < q.minArea) return { rejected: 'area', area: c.area, poly: f.path.slice() };
    /* craft 在兑现瞬间结算并写入 f 的圈型历史；拒绝分支不调用，不算一圈。 */
    return { type: 'closed', poly: f.path.slice(), report: c, craft: craft(f, c) };
  }
  function report(f, c, streak) {
    var q = B(), n = clamp(streak || 1, 1, q.streakCap);
    var mul = 1 + q.streakStep * (n - 1);
    return { tag: c.tag, bent: c.bent, label: c.label, area: c.area,
             length: c.length, bends: c.bends, streak: n, nextMul: mul,
             damage: Math.round(c.damage * mul) };
  }
  /* ---------- M13 圈型策略：换型连扫 / 重复衰减 / 专属效果 ----------
   * 诊断（一次性真实 WASD 实跑）：小圈 7.87 伤害/秒 > 中圈 6.16 > 大圈 5.23，
   * 且连扫只按次数累加，连刷最小圈可滚到 9.51 伤害/秒 —— 大圈与折角圈除被
   * 护盾相位强制外毫无动机。这里把「换圈型」变成唯一涨倍率的途径，并给四种圈
   * 各一个不可替代的效果；classify() / report() 的原返回值保持不变，因此 M11
   * 的 23 条基线断言与冻结数值契约都不受影响。 */
  var EFFECT_LABEL = {
    quick: '迅捷 · 冷却缩减',
    mend: '续航 · 回复生命',
    breach: '破阵 · 额外蓄势',
    pierce: '穿透 · 圈边也扫'
  };
  function craftCfg() {
    var d = { switchStep: 0.20, switchCap: 3, repeatDecay: 0.80, repeatFloor: 0.50,
      smallCdCut: 0.55, smallCombo: 1, midHeal: 5,
      bigCharge: 1, bigStall: 0.22, bentReach: 32, liveMinPoints: 4 };
    var q = B().craft || {};
    Object.keys(d).forEach(function (k) { if (typeof q[k] === 'number') d[k] = q[k]; });
    return d;
  }
  function craftKey(c) { return c.tag + (c.bent ? '+bent' : ''); }
  /* 主效果由面积档决定；折点是「附加穿透」而不是另一个圈型，
   * 否则矩形大圈（本身就有 3 个折点）会把大圈的「破阵」效果永久吃掉。 */
  function craftEffect(c) {
    if (c.tag === 'small') return 'quick';
    if (c.tag === 'mid') return 'mend';
    return 'breach';
  }
  /* 走位过程中的实时预估：把当前路径接回起点，先看自己正在画哪种圈、
   * 是否比上一圈换了型、离兑现门槛还差多少。渲染与 HUD 共用这一份结果。 */
  function live(f) {
    var q = craftCfg();
    if (!f || !f.armed || !f.origin || f.path.length < q.liveMinPoints) return null;
    var c = classify(f.path.concat([f.origin])), eff = craftEffect(c), key = craftKey(c);
    return {
      tag: c.tag, bent: c.bent, label: c.label, area: c.area, bends: c.bends,
      points: f.path.length, key: key,
      switched: !!f.lastTag && key !== f.lastTag,
      ready: c.area >= B().minArea && f.path.length >= B().minPoints,
      streak: f.craftStreak || 0,
      effect: eff, effectLabel: EFFECT_LABEL[eff],
      pierce: !!c.bent
    };
  }
  /* 兑现时结算：换型 → 连扫 +1 并给倍率；重复同型 → 倍率逐次衰减。
   * 同时更新 f 上的圈型历史（reset() 不清这些字段，跨圈保留）。 */
  function craft(f, c) {
    var q = craftCfg(), key = craftKey(c);
    var first = !f.lastTag, switched = !first && key !== f.lastTag;
    var streak, repeatCount, mul;
    if (first || switched) {
      repeatCount = 0;
      streak = first ? 1 : Math.min(q.switchCap, (f.craftStreak || 0) + 1);
      mul = 1 + q.switchStep * (streak - 1);
    } else {
      repeatCount = (f.repeatCount || 0) + 1;
      streak = Math.max(1, f.craftStreak || 1);
      mul = Math.max(q.repeatFloor, Math.pow(q.repeatDecay, repeatCount));
    }
    var effect = craftEffect(c);
    var out = {
      first: first, switched: switched, key: key, lastKey: f.lastTag || null,
      streak: streak, repeatCount: repeatCount, mul: +mul.toFixed(3),
      effect: effect, label: EFFECT_LABEL[effect], pierce: !!c.bent,
      bonus: {
        smallCdCut: q.smallCdCut, smallCombo: q.smallCombo,
        midHeal: q.midHeal, bigCharge: q.bigCharge,
        bigStall: q.bigStall, bentReach: q.bentReach
      }
    };
    f.lastTag = key; f.craftStreak = streak; f.repeatCount = repeatCount;
    f.lastCraft = out;
    return out;
  }
  /* 26 秒窗口超时：连扫与圈型历史一并归零，下一圈重新起算。 */
  function decayCraft(f) {
    f.streak = 0; f.craftStreak = 0; f.repeatCount = 0;
    f.lastTag = null; f.lastCraft = null;
  }

  function waveFrom(poly, rep) {
    return { path: poly.slice().reverse(), position: 0, speed: B().waveSpeed,
             damage: rep.damage, hit: {}, tag: rep.tag, label: rep.label, life: 0 };
  }
  function advanceWave(w, dt) {
    if (!w) return null;
    var total = 0, i;
    for (i = 1; i < w.path.length; i++) total += dist(w.path[i - 1], w.path[i]);
    w.position = Math.min(total, w.position + w.speed * dt);
    w.life += dt;
    var d = w.position, head = w.path[0];
    for (i = 1; i < w.path.length; i++) {
      var seg = dist(w.path[i - 1], w.path[i]);
      if (d <= seg) {
        var k = seg ? d / seg : 0;
        head = pt(w.path[i - 1].x + (w.path[i].x - w.path[i - 1].x) * k,
                  w.path[i - 1].y + (w.path[i].y - w.path[i - 1].y) * k);
        break;
      }
      d -= seg;
    }
    return { head: head, done: w.position >= total, total: total };
  }

  /* ---------- 护盾相位：按面积档要求，结构兼容 M9 渲染 ---------- */
  var SHIELD_LABEL = { any: '任意闭环', big: '大圈', small: '小圈', bent: '折角圈' };
  function shieldSpec(breaks, perks) {
    var S = B().shield, p = perks || {}, n = Math.max(0, breaks | 0);
    var need = Math.min(S.needCap, Math.max(1, S.baseNeed + Math.floor(n / S.needEvery) -
      (p.p_loop_breach ? 1 : 0)));
    var required = S.phases[n % S.phases.length];
    return {
      phase: n + 1, required: required, requiredLabel: SHIELD_LABEL[required] || required,
      need: need,
      window: Math.max(S.windowMin, S.baseWindow - n * S.windowStep +
        (p.p_loop_window ? 0.9 * p.p_loop_window : 0)),
      reformTime: S.reformTime,
      speedMul: Math.min(S.speedCap, 1 + n * S.speedStep),
      weakCharge: p.p_loop_shard ? Math.min(0.85, S.weakCharge + 0.33 * p.p_loop_shard) : S.weakCharge,
      exposedWaveMul: S.exposedWaveMul * (p.p_loop_overdrive ? 1.6 : 1)
    };
  }
  function matchesShield(rep, required) {
    if (required === 'any') return true;
    if (required === 'big') return rep.tag === 'big';
    if (required === 'small') return rep.tag === 'small';
    if (required === 'bent') return !!rep.bent;
    return false;
  }

  /* 卡池取决于开局流派，和玩家当前拿着哪把武器无关。 */
  var STYLES = {
    sweep: { id: 'sweep', label: '回扫', pool: ['p_loop_mend', 'p_loop_cd', 'p_loop_breach', 'p_loop_dash',
      'p_loop_window', 'p_loop_shard', 'p_loop_overdrive'] },
    blade: { id: 'blade', label: '大剑', pool: ['p_free_blade_reach', 'p_free_blade_damage', 'p_free_blade_speed', 'p_free_blade_heal'] },
    cannon: { id: 'cannon', label: '手炮', pool: ['p_impact_homing', 'p_free_cannon_damage', 'p_free_cannon_suppress',
      'p_free_cannon_pierce', 'p_free_cannon_range', 'p_free_cannon_spread', 'p_free_cannon_focus', 'p_free_cannon_speed'] }
  };
  function getStyle(id) {
    return Object.prototype.hasOwnProperty.call(STYLES, id) ? STYLES[id] : STYLES.sweep;
  }
  function stylePerk(s, id) {
    var selected = getStyle(s.free && s.free.style);
    if (selected.pool.indexOf(id) < 0) return null;
    return C.core.perks.FREE_WEAPON[id] || C.core.perks.LOOP[id];
  }
  function offer(s) {
    var available = getStyle(s.free && s.free.style).pool.filter(function (id) {
      return (s.perks[id] || 0) < stylePerk(s, id).max;
    });
    if (!available.length) return [];
    var offset = (s.pickCount || 0) % available.length;
    return available.slice(offset).concat(available.slice(0, offset)).slice(0, 3);
  }
  function loopRewards(s) {
    return { heal: s.perks.p_loop_mend ? 6 * s.perks.p_loop_mend : 0,
             dash: !!s.perks.p_loop_dash,
             goldPerKill: s.perks.p_loop_greed ? 3 * s.perks.p_loop_greed : 0 };
  }

  /* ---------- 存档：只存可恢复状态 ---------- */
  function save(s) {
    if (!s || !s.free) return null;
    var f = s.free;
    var data = { version: 1, seed: f.seed, layer: f.layer, roomInLayer: f.roomInLayer,
      hp: Math.max(1, Math.round(s.player.hp)), maxHp: s.player.maxHp,
      style: f.style, weapon: f.weapon, shieldUsed: s.shieldUsed,
      gold: s.gold, perks: Object.assign({}, s.perks), pickCount: s.pickCount || 0,
      kills: s.kills, elapsed: Math.round(s.elapsed), theme: s.run.theme };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { return null; }
    return data;
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.version !== 1 || !d.seed || d.layer < 1 || d.layer > B().layers ||
          d.roomInLayer < 0 || d.roomInLayer >= B().roomsPerLayer) return null;
      return d;
    } catch (e) { return null; }
  }
  function hasSave() { return !!load(); }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ } }
  function saveLabel() {
    var d = load();
    return d ? '继续' + getStyle(d.style).label + ' · 第 ' + d.layer + ' 层 第 ' + (d.roomInLayer + 1) + ' 间' : '';
  }

  C.core = C.core || {};
  C.core.freewave = {
    W: W, H: H, SAVE_KEY: SAVE_KEY, SHIELD_LABEL: SHIELD_LABEL,
    area: area, perimeter: perimeter, bends: bends, inside: inside,
    distanceToPoly: distanceToPoly, classify: classify,
    tiles: tiles, tileAt: tileAt, tileBuff: tileBuff, gridStep: function () { return B().gridStep; },
    create: create, arm: arm, reset: reset, record: record, close: close,
    report: report, craftKey: craftKey, craftEffect: craftEffect, craft: craft,
    live: live, decayCraft: decayCraft, EFFECT_LABEL: EFFECT_LABEL,
    waveFrom: waveFrom, advanceWave: advanceWave, STYLES: STYLES, getStyle: getStyle, stylePerk: stylePerk,
    shieldSpec: shieldSpec, matchesShield: matchesShield,
    offer: offer, loopRewards: loopRewards,
    save: save, load: load, hasSave: hasSave, clearSave: clearSave, saveLabel: saveLabel
  };
})(window.Corridor = window.Corridor || {});
