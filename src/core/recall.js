/* 固定廊道、行走记录与回扫。所有坐标均为 Canvas 世界坐标。 */
(function (C) {
  'use strict';

  var upperWall = { x: 174, y: 180, w: 612, h: 32 };
  var lowerWall = { x: 174, y: 316, w: 612, h: 34 };
  var hub = [{ x: 112, y: 264 }, { x: 836, y: 264 }];
  var walls = [
    { x: 18, y: 18, w: 924, h: 56 },
    { x: 18, y: 74, w: 42, h: 385 },
    { x: 922, y: 74, w: 20, h: 385 },
    upperWall, lowerWall,
    { x: 385, y: 350, w: 190, h: 112 },
    { x: 18, y: 459, w: 258, h: 123 },
    { x: 684, y: 459, w: 258, h: 123 },
    { x: 276, y: 568, w: 408, h: 14 }
  ];

  function point(x, y) { return { x: x, y: y }; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lane(id, name, bends) {
    var points = [hub[0]].concat(bends, hub[1]);
    var marks = [0];
    for (var i = 1; i < points.length; i++) {
      marks.push(marks[i - 1] + distance(points[i - 1], points[i]));
    }
    return { id: id, name: name, points: points, marks: marks, length: marks[marks.length - 1] };
  }

  var lanes = {
    upper: lane('upper', '上廊', [point(112, 126), point(836, 126)]),
    middle: lane('middle', '中廊', []),
    lower: lane('lower', '下廊', [
      point(112, 404), point(330, 404), point(330, 516),
      point(630, 516), point(630, 404), point(836, 404)
    ])
  };

  function nearestOnSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var lengthSquared = dx * dx + dy * dy;
    var t = lengthSquared ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1) : 0;
    return { x: a.x + dx * t, y: a.y + dy * t, t: t };
  }

  function along(route, d) {
    var i = 1;
    while (i < route.marks.length - 1 && d > route.marks[i]) i++;
    var a = route.points[i - 1], b = route.points[i];
    var t = (d - route.marks[i - 1]) / (route.marks[i] - route.marks[i - 1]);
    return point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  function locate(p) {
    var id = 'middle';
    if (p.y < upperWall.y + upperWall.h) id = 'upper';
    else if (p.y > lowerWall.y) id = 'lower';
    else if (p.x < upperWall.x) return { hub: 0 };
    else if (p.x > upperWall.x + upperWall.w) return { hub: 1 };

    var route = lanes[id], best = Infinity, d = 0;
    for (var i = 1; i < route.points.length; i++) {
      var q = nearestOnSegment(p, route.points[i - 1], route.points[i]);
      var gap = distance(p, q);
      if (gap < best) {
        best = gap;
        d = route.marks[i - 1] + (route.marks[i] - route.marks[i - 1]) * q.t;
      }
    }
    return { route: route, d: d };
  }

  function endpoint(route, side) { return side === 0 ? 0 : route.length; }

  function pathSlice(route, from, to) {
    var points = [along(route, Math.min(from, to))];
    for (var i = 1; i < route.marks.length - 1; i++) {
      if (route.marks[i] > Math.min(from, to) && route.marks[i] < Math.max(from, to)) {
        points.push(route.points[i]);
      }
    }
    points.push(along(route, Math.max(from, to)));
    return from <= to ? points : points.reverse();
  }

  function create() {
    return { origin: 0, atHub: 0, current: null, outbound: null, wave: null, loops: 0 };
  }

  function trace(r) {
    var current = r.current, out = r.outbound;
    if (!out) {
      return current ? [pathSlice(current.route, endpoint(current.route, r.origin), current.d)] : [];
    }
    if (current && current.route === out) return [pathSlice(out, endpoint(out, r.origin), current.d)];
    var sections = [pathSlice(out, endpoint(out, r.origin), endpoint(out, r.atHub))];
    if (current) sections.push(pathSlice(current.route, endpoint(current.route, r.atHub), current.d));
    return sections;
  }

  function startWave(r, incoming, perk) {
    var B = C.core.perks.BALANCE.recall;
    var length = incoming.length + r.outbound.length;
    var boost = perk === 'p_recall_distance' && length >= B.longDistance;
    var parts = [], cursor = 0, lastVector;

    [incoming, r.outbound].forEach(function (route, i) {
      var side = i === 0 ? r.origin : r.atHub;
      var points = pathSlice(route, endpoint(route, side), endpoint(route, 1 - side));
      for (var j = 1; j < points.length; j++) {
        var a = points[j - 1], b = points[j], size = distance(a, b);
        var vector = point((b.x - a.x) / size, (b.y - a.y) / size);
        var bend = lastVector && lastVector.x * vector.x + lastVector.y * vector.y < 0.5;
        var extra = perk === 'p_recall_corner' && bend ? Math.min(size, B.cornerDistance) : 0;
        if (extra) {
          var end = point(a.x + vector.x * extra, a.y + vector.y * extra);
          parts.push({ a: a, b: end, start: cursor, end: cursor + extra, route: route, radius: B.cornerWidth });
          a = end;
        }
        if (size > extra) {
          parts.push({ a: a, b: b, start: cursor + extra, end: cursor + size, route: route, radius: B.width });
        }
        cursor += size;
        lastVector = vector;
      }
    });

    r.wave = {
      parts: parts, length: length, position: 0, hit: new Set(),
      damage: boost ? B.longDamage : B.damage,
      routes: [incoming.id, r.outbound.id]
    };
    r.loops++;
    r.origin = null;
    r.current = null;
    r.outbound = null;
  }

  function record(r, p, perk) {
    if (r.wave) return false;
    var loc = locate(p);
    if (loc.hub == null) {
      if (r.origin != null) r.current = loc;
      return false;
    }
    if (r.origin == null) {
      r.origin = r.atHub = loc.hub;
    } else if (r.current && loc.hub !== r.atHub) {
      var crossed = r.current.route;
      if (loc.hub !== r.origin) r.outbound = crossed;
      else if (r.outbound && crossed !== r.outbound) {
        startWave(r, crossed, perk);
        return true;
      } else r.outbound = null;
      r.atHub = loc.hub;
    }
    r.current = null;
    return false;
  }

  function pointOnPart(part, d) {
    var t = (d - part.start) / (part.end - part.start);
    return point(part.a.x + (part.b.x - part.a.x) * t, part.a.y + (part.b.y - part.a.y) * t);
  }

  function waveSections(wave, from, to) {
    var sections = [];
    wave.parts.forEach(function (part) {
      var lo = Math.max(from, part.start), hi = Math.min(to, part.end);
      if (hi < lo) return;
      sections.push({
        a: pointOnPart(part, lo), b: pointOnPart(part, hi), route: part.route, radius: part.radius
      });
    });
    return sections;
  }

  function clearLine(a, b, padding) {
    // 沿两个坐标轴裁剪线段，保留落入墙矩形的参数区间。
    return !walls.some(function (q) {
      var near = 0, far = 1;
      var bounds = [[a.x, b.x - a.x, q.x - padding, q.x + q.w + padding],
                    [a.y, b.y - a.y, q.y - padding, q.y + q.h + padding]];
      for (var i = 0; i < bounds.length; i++) {
        var start = bounds[i][0], delta = bounds[i][1], min = bounds[i][2], max = bounds[i][3];
        if (delta === 0) {
          if (start <= min || start >= max) return false;
          continue;
        }
        var t1 = (min - start) / delta, t2 = (max - start) / delta;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
        if (near >= far) return false;
      }
      return true;
    });
  }

  function advanceWave(r, dt, p, enemies, onHit) {
    var wave = r.wave;
    var next = Math.min(wave.length, wave.position + C.core.perks.BALANCE.recall.speed * dt);
    if (next === wave.position) return;
    var sections = waveSections(wave, wave.position, next);
    sections.forEach(function (part) {
      enemies.forEach(function (e) {
        if (e.dead || wave.hit.has(e)) return;
        var loc = locate(e);
        if (loc.route && loc.route !== part.route) return;
        var closest = nearestOnSegment(e, part.a, part.b);
        if (distance(e, closest) > part.radius + e.r || !clearLine(closest, e, 0)) return;
        wave.hit.add(e);
        onHit(e, wave.damage);
      });
    });
    wave.position = next;
    if (next === wave.length) {
      r.wave = null;
      record(r, p);
    }
  }

  function chaseTarget(e, p) {
    if (clearLine(e, p, e.r)) return p;
    var from = locate(e), to = locate(p);
    var shortest = Infinity, waypoints = [];
    if (from.route && from.route === to.route) {
      shortest = Math.abs(from.d - to.d);
      waypoints = pathSlice(from.route, from.d, to.d);
    }
    for (var a = 0; a < hub.length; a++) {
      if (from.hub != null && from.hub !== a) continue;
      var approach = from.route ? Math.abs(from.d - endpoint(from.route, a)) : distance(e, hub[a]);
      for (var b = 0; b < hub.length; b++) {
        if (to.hub != null && to.hub !== b) continue;
        var depart = to.route ? Math.abs(to.d - endpoint(to.route, b)) : distance(hub[b], p);
        var cost = approach + depart + (a === b ? 0 : lanes.middle.length);
        if (cost >= shortest) continue;
        shortest = cost;
        waypoints = from.route ? pathSlice(from.route, from.d, endpoint(from.route, a)) : [hub[a]];
        if (a !== b) waypoints.push(hub[b]);
        if (to.route) waypoints = waypoints.concat(pathSlice(to.route, endpoint(to.route, b), to.d));
      }
    }
    waypoints.push(p);
    var target = waypoints[0];
    for (var j = 1; j < waypoints.length && clearLine(e, waypoints[j], e.r); j++) {
      target = waypoints[j];
    }
    return target;
  }

  var patrols = [
    ['upper', 'lower', 'middle', 'lower'],
    ['middle', 'lower', 'middle', 'upper']
  ];

  function advancePatrol(boss, dt, speed, phase) {
    var patrol = boss.patrol;
    if (!patrol.route) {
      if (patrol.phase !== phase) {
        patrol.cursor = 0;
        patrol.phase = phase;
      }
      var order = patrols[phase - 1];
      patrol.route = lanes[order[patrol.cursor++ % order.length]];
      patrol.d = endpoint(patrol.route, patrol.hub);
      patrol.warning = phase === 2 ? 1 : 0.65;
    }
    if (patrol.warning > 0) {
      patrol.warning = Math.max(0, patrol.warning - dt);
      return point(boss.x, boss.y);
    }
    if (boss.guardOpen > 0) return point(boss.x, boss.y);
    var route = patrol.route, dest = endpoint(route, 1 - patrol.hub);
    var next = clamp(patrol.d + (patrol.hub === 0 ? 1 : -1) * speed * dt, 0, route.length);
    patrol.d = next;
    if (next === dest) {
      patrol.hub = 1 - patrol.hub;
      patrol.route = null;
    }
    return along(route, next);
  }

  C.core.recall = {
    walls: walls, hub: hub, lanes: lanes, create: create, trace: trace, record: record,
    waveSections: waveSections, advanceWave: advanceWave, chaseTarget: chaseTarget, advancePatrol: advancePatrol
  };
})(window.Corridor = window.Corridor || {});
