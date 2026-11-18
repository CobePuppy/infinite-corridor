/* 单房 A/B 的阵容、路径和敌人动作。击飞和接力仍由 impact.js 结算。 */
(function (C) {
  'use strict';

  var B = C.core.perks.BALANCE.impact.trial;
  var PAD = 19;
  var EPS = 0.001;
  var WALLS = [
    { x: 238, y: 154, w: 435, h: 32 },
    { x: 258, y: 424, w: 430, h: 32 }
  ];
  var WAVES = [
    [[226, 300, 'press'], [350, 300, 'press'], [474, 300, 'press']],
    [[377, 301, 'press'], [486, 301, 'press'], [592, 301, 'press'],
      [456, 214, 'flank', 'upper'], [777, 396, 'flank', 'lower'], [783, 265, 'charge']]
  ];
  var TIMING = {
    A: { upper: [0, 0.6], lower: [1.22, 1.86], charge: [0.73, 1.5] },
    B: { upper: [1.40, 2.05], lower: [0.84, 1.5], charge: [0, 0.6] }
  };
  var SHAPES = { press: 'chase', flank: 'orbit', charge: 'charge' };

  function create(version, preset) {
    return { version: version === 'B' ? 'B' : 'A', preset: preset === 'skills' ? 'skills' : 'basic' };
  }

  function spawn(s, wave, game) {
    var trial = s.impact.trial;
    trial.waveTime = 0;
    trial.nextPounce = 0;
    return WAVES[wave - 1].map(function (spot, id) {
      var role = spot[2], side = spot[3];
      var stats = B[role];
      var release = role === 'press' ? [(wave === 1 ? 0.46 : 0.04) + id * 0.3, 0] : TIMING[trial.version][side || role];
      var e = game.makeEnemy({
        hp: wave === 1 ? B.firstHp : stats.hp,
        damage: stats.damage, pattern: SHAPES[role]
      }, false, 'teal', { x: spot[0], y: spot[1] });
      e.impactId = id;
      e.flight = null;
      e.brain = {
        role: role, side: side, state: 'seek', timer: 0,
        moveAt: release[0], attackAt: release[1], attack: null,
        route: side ? [mouth(side, side === 'upper' ? 495 : 751)] : null,
        waypoint: null, replanAt: 0
      };
      return e;
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  // 同一个截断结果决定提示线、身体停点和有效攻击区。
  function wallLimit(walls, x, y, dx, dy, range, padding) {
    var best = range;
    walls.forEach(function (w) {
      var l = w.x - padding, r = w.x + w.w + padding;
      var t = w.y - padding, b = w.y + w.h + padding;
      if ((!dx && (x <= l || x >= r)) || (!dy && (y <= t || y >= b))) return;
      var x1 = dx ? (l - x) / dx : -Infinity;
      var x2 = dx ? (r - x) / dx : Infinity;
      var y1 = dy ? (t - y) / dy : -Infinity;
      var y2 = dy ? (b - y) / dy : Infinity;
      var near = Math.max(Math.min(x1, x2), Math.min(y1, y2));
      var far = Math.min(Math.max(x1, x2), Math.max(y1, y2));
      if (far <= Math.max(0, near) + EPS || near >= best) return;
      if (near < -EPS) {
        // 反弹后可能在矩形的扩展角里。允许朝最近的边向外离开。
        var edge = Math.min(x - l, r - x, y - t, b - y);
        if ((edge === x - l && dx < 0) || (edge === r - x && dx > 0) ||
            (edge === y - t && dy < 0) || (edge === b - y && dy > 0)) return;
      }
      best = Math.max(0, near);
    });
    return best;
  }

  function clear(walls, a, b, padding) {
    var dx = b.x - a.x, dy = b.y - a.y, gap = Math.hypot(dx, dy);
    return gap < EPS || wallLimit(walls, a.x, a.y, dx / gap, dy / gap, gap, padding) >= gap - EPS;
  }

  function walkableGoal(walls, goal, radius) {
    var p = { x: clamp(goal.x, 18 + radius, 942 - radius), y: clamp(goal.y, 18 + radius, 582 - radius) };
    walls.forEach(function (w) {
      var left = p.x - (w.x - radius), right = w.x + w.w + radius - p.x;
      var top = p.y - (w.y - radius), bottom = w.y + w.h + radius - p.y;
      var min = Math.min(left, right, top, bottom);
      if (min <= 0) return;
      if (min === left) p.x -= left + EPS;
      else if (min === right) p.x += right + EPS;
      else if (min === top) p.y -= top + EPS;
      else p.y += bottom + EPS;
    });
    return p;
  }

  function nearestOpening(s, from, goal) {
    var points = [from, goal];
    WALLS.forEach(function (w) {
      [w.x - PAD, w.x + w.w + PAD].forEach(function (x) {
        [w.y - PAD, w.y + w.h + PAD].forEach(function (y) { points.push({ x: x, y: y }); });
      });
    });
    var costs = points.map(function (_, i) { return i === 0 ? 0 : Infinity; });
    var first = [], visited = new Set();
    for (var i = 0; i < points.length; i++) {
      var next = -1;
      for (var j = 0; j < points.length; j++) {
        if (!visited.has(j) && (next === -1 || costs[j] < costs[next])) next = j;
      }
      if (next === -1 || !Number.isFinite(costs[next])) break;
      if (next === 1) return first[next];
      visited.add(next);
      for (var k = 1; k < points.length; k++) {
        if (visited.has(k) || !clear(s.walls, points[next], points[k], from.r)) continue;
        var cost = costs[next] + Math.hypot(points[k].x - points[next].x, points[k].y - points[next].y);
        if (cost >= costs[k]) continue;
        costs[k] = cost;
        first[k] = next === 0 ? points[k] : first[next];
      }
    }
    return from;
  }

  function stop(e) { e.vx = 0; e.vy = 0; }

  function moveToward(s, e, goal, speed, dt, game) {
    var brain = e.brain;
    var to = walkableGoal(s.walls, goal, e.r + EPS);
    if (clear(s.walls, e, to, e.r)) {
      brain.waypoint = null;
    } else {
      if (!brain.waypoint || s.impact.trial.waveTime >= brain.replanAt ||
          Math.hypot(e.x - brain.waypoint.x, e.y - brain.waypoint.y) < 2) {
        brain.waypoint = nearestOpening(s, e, to);
        brain.replanAt = s.impact.trial.waveTime + 0.15;
      }
      to = brain.waypoint;
    }
    var dx = to.x - e.x, dy = to.y - e.y, gap = Math.hypot(dx, dy);
    if (!gap) { stop(e); return; }
    var step = Math.min(gap, speed * dt);
    e.vx = dx / gap * step / dt;
    e.vy = dy / gap * step / dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    game.collideWalls(e, e.r);
  }

  function mouth(side, x) { return { x: x, y: side === 'upper' ? 242 : 366 }; }

  function flankRoute(e, player) {
    var x = clamp(player.x + (player.x < e.x ? 55 : -55), 212, 716);
    var upper = mouth('upper', x), lower = mouth('lower', x);
    var takeUpper = Math.hypot(e.x - upper.x, e.y - upper.y) + Math.abs(player.y - upper.y) * 0.35 <=
      Math.hypot(e.x - lower.x, e.y - lower.y) + Math.abs(player.y - lower.y) * 0.35;
    var outer = takeUpper ? 214 : 397;
    e.brain.side = takeUpper ? 'upper' : 'lower';
    return [{ x: clamp(e.x, 212, 716), y: outer }, { x: x, y: outer }, takeUpper ? upper : lower];
  }

  function prepare(s, e, dx, dy) {
    var brain = e.brain, stats = B[brain.role];
    var len = Math.hypot(dx, dy);
    if (len < EPS) return;
    dx /= len; dy /= len;
    var travel = wallLimit(s.walls, e.x, e.y, dx, dy, stats.speed * stats.duration, e.r);
    if (travel < 12) return;
    var attack = {
      kind: brain.role, x: e.x, y: e.y, dx: dx, dy: dy, travel: travel,
      radius: stats.width, range: travel + stats.width, half: stats.half,
      moved: 0, hit: false
    };
    if (brain.role === 'press') {
      var angle = Math.atan2(dy, dx);
      attack.fan = Array.from({ length: 15 }, function (_, i) {
        var ray = angle + (i / 14 * 2 - 1) * stats.half;
        var ca = Math.cos(ray), sa = Math.sin(ray);
        var dist = wallLimit(s.walls, e.x, e.y, ca, sa, attack.range, 0);
        return { x: e.x + ca * dist, y: e.y + sa * dist };
      });
      s.impact.trial.nextPounce = s.impact.trial.waveTime + stats.warning + stats.duration + 0.17;
    }
    brain.attack = attack;
    brain.state = 'wind';
    brain.timer = stats.warning;
    e.lockX = dx; e.lockY = dy;
    stop(e);
  }

  function seek(s, e, dt, game) {
    var brain = e.brain, stats = B[brain.role], trial = s.impact.trial, p = s.player;
    if (trial.waveTime < brain.moveAt) { stop(e); return; }
    var dx = p.x - e.x, dy = p.y - e.y, gap = Math.hypot(dx, dy);
    var ready = trial.waveTime + EPS >= brain.attackAt;
    if (brain.role === 'press') {
      if (gap <= stats.reach && trial.waveTime >= trial.nextPounce && clear(s.walls, e, p, 0)) {
        prepare(s, e, dx, dy);
        if (brain.state === 'wind') return;
      }
    } else if (brain.role === 'flank') {
      if (!brain.route) brain.route = flankRoute(e, p);
      while (brain.route.length && Math.hypot(e.x - brain.route[0].x, e.y - brain.route[0].y) < 5) brain.route.shift();
      if (brain.route.length) { moveToward(s, e, brain.route[0], stats.approach, dt, game); return; }
      stop(e);
      if (ready) {
        prepare(s, e, clamp(dx, -64, 64), brain.side === 'upper' ? 132 : -132);
        if (brain.state !== 'wind') brain.route = null;
      }
      return;
    } else {
      if (gap >= stats.min && gap <= stats.max && clear(s.walls, e, p, 0)) {
        stop(e);
        if (ready) prepare(s, e, dx, dy);
        if (!ready || brain.state === 'wind') return;
      }
      if (gap < stats.min) {
        var nx = gap > EPS ? dx / gap : 1, ny = gap > EPS ? dy / gap : 0;
        moveToward(s, e, { x: e.x - nx * 64, y: e.y - ny * 64 }, stats.approach, dt, game);
        return;
      }
    }
    moveToward(s, e, p, stats.approach, dt, game);
  }

  function zoneContains(walls, a, p, distance) {
    var dx = p.x - a.x, dy = p.y - a.y;
    var ahead = dx * a.dx + dy * a.dy;
    var gap = Math.hypot(dx, dy);
    if (a.kind === 'press') {
      if (gap > distance + a.radius || ahead < gap * Math.cos(a.half)) return false;
      return clear(walls, a, p, 0);
    } else {
      var along = clamp(ahead, 0, distance);
      if (Math.hypot(dx - along * a.dx, dy - along * a.dy) > a.radius) return false;
    }
    return clear(walls, { x: a.x + a.dx * Math.min(Math.max(ahead, 0), distance),
      y: a.y + a.dy * Math.min(Math.max(ahead, 0), distance) }, p, 0);
  }

  function recover(e, time) {
    e.brain.state = 'recover';
    e.brain.timer = time;
    e.brain.attack = null;
    e.brain.route = null;
    e.brain.waypoint = null;
    stop(e);
  }

  function advance(s, e, dt, game) {
    var brain = e.brain, stats = B[brain.role];
    if (brain.state === 'recover') {
      brain.timer = Math.max(0, brain.timer - dt);
      if (!brain.timer) brain.state = 'seek';
      return;
    }
    if (brain.state === 'seek') { seek(s, e, dt, game); return; }
    if (brain.state === 'wind') {
      brain.timer = Math.max(0, brain.timer - dt);
      if (brain.timer) return;
      brain.state = 'attack';
    }
    var a = brain.attack;
    a.moved = Math.min(a.travel, a.moved + stats.speed * dt);
    e.x = a.x + a.dx * a.moved; e.y = a.y + a.dy * a.moved;
    e.vx = a.dx * stats.speed; e.vy = a.dy * stats.speed;
    if (!a.hit && zoneContains(s.walls, a, s.player, a.moved)) {
      a.hit = true;
      game.hurtPlayer(s, e, e.damage);
    }
    if (a.moved + EPS >= a.travel) recover(e, stats.recovery);
  }

  function interrupt(e) {
    e.brain.state = 'fly';
    e.brain.timer = 0;
    e.brain.attack = null;
    e.brain.route = null;
    e.brain.waypoint = null;
  }

  function land(e) { recover(e, B[e.brain.role].landing); }

  C.core.enemyTrial = {
    walls: WALLS, create: create, spawn: spawn, advance: advance, interrupt: interrupt, land: land,
    wallLimit: wallLimit, zoneContains: zoneContains, nearestOpening: nearestOpening
  };
})(window.Corridor = window.Corridor || {});
