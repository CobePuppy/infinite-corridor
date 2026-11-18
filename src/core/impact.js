/* 击飞接力试玩：固定两组敌人，共享同一套击飞、反弹与接力。 */
(function (C) {
  'use strict';

  var B = C.core.perks.BALANCE.impact;
  var K = B.combinations;
  var STEP = 1 / 120;
  var EPS = 0.001;
  var WEAPONS = {
    blade: {
      name: '重刃', choices: ['p_impact_heavy', 'p_impact_pursuit'],
      opening: '贴近挥击第一只，把它打向后面两只'
    },
    cannon: {
      name: '手炮', choices: ['p_impact_bank', 'p_impact_pierce'],
      opening: '瞄准最前一只点射，让击飞沿直廊传递'
    }
  };
  var REFLECTOR = { x: 801, y: 214, w: 35, h: 172 };
  var SHORT_WALL = { x: 496, y: 342, w: 22, h: 46 };
  var WALLS = [
    { x: 245, y: 174, w: 521, h: 38 },
    { x: 245, y: 388, w: 521, h: 38 },
    REFLECTOR
  ];
  var WAVES = [
    [[226, 300, 'chase'], [350, 300, 'orbit'], [474, 300, 'charge']],
    [[465, 326, 'chase'], [611, 326, 'orbit'], [746, 302, 'charge'],
      [690, 360, 'chase'], [539, 249, 'orbit']]
  ];
  var COMBINATION_WAVES = [
    [[226, 300, 'chase'], [451, 300, 'orbit'], [575, 300, 'chase']],
    [[452, 290, 'chase'], [601, 275, 'orbit'], [725, 275, 'chase'],
      [614, 342, 'chase'], [647, 365, 'orbit'], [516, 246, 'charge', true]]
  ];

  function hasWeapon(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, id); }
  function sound(name, depth) { C.core.audio.play(name, depth); }

  function spawnWave(s, wave, game) {
    var g = s.impact;
    g.wave = wave;
    g.awakeAt = wave === 1 ? Infinity : s.elapsed + B.secondGrace;
    g.contacts.clear();
    g.buffer = 0;
    g.swing = null;
    g.shot = null;
    g.marks = [];
    g.combo = 0;
    g.comboTime = 0;
    s.player.fireCd = 0;
    var layout = g.combinations ? COMBINATION_WAVES : WAVES;
    var health = g.combinations ? K : B;
    s.enemies = layout[wave - 1].map(function (spot, id) {
      var e = game.makeEnemy({
        hp: wave === 1 ? health.firstHp : health.secondHp,
        damage: B.enemyDamage, pattern: spot[2]
      }, false, 'teal', { x: spot[0], y: spot[1] });
      e.impactId = id;
      e.flight = null;
      e.vx = 0;
      e.vy = 0;
      if (spot[3]) {
        e.charger = true;
        e.mode = 'wind';
        e.timer = K.chargeWarning;
        e.lockX = 0;
        e.lockY = 1;
      }
      return e;
    });
  }

  function start(s, weapon, combinations, game) {
    s.impact = {
      weapon: weapon, combinations: combinations, perk: null, points: 0, bestChain: 0,
      contacts: new Set()
    };
    s.player.x = 144;
    s.player.y = 300;
    spawnWave(s, 1, game);
  }

  function choose(s, id, game) {
    var g = s.impact;
    if (g.points !== 1 || s.perkPending.indexOf(id) === -1) return false;
    g.perk = id;
    g.points = 0;
    s.perkPending = null;
    spawnWave(s, 2, game);
    s.phase = 'playing';
    sound('pick');
    return true;
  }

  /* 射线分别裁切到两个轴的墙体区间，保留先进入的面的法线。 */
  function castWall(walls, x, y, dx, dy, limit) {
    var hit = null;
    walls.forEach(function (w) {
      if ((!dx && (x < w.x || x > w.x + w.w)) ||
          (!dy && (y < w.y || y > w.y + w.h))) return;
      var x1 = dx ? (w.x - x) / dx : -Infinity;
      var x2 = dx ? (w.x + w.w - x) / dx : Infinity;
      var y1 = dy ? (w.y - y) / dy : -Infinity;
      var y2 = dy ? (w.y + w.h - y) / dy : Infinity;
      var nearX = Math.min(x1, x2), nearY = Math.min(y1, y2);
      var near = Math.max(nearX, nearY);
      var far = Math.min(Math.max(x1, x2), Math.max(y1, y2));
      if (near < 0 || near > limit || near > far) return;
      // 同一墙角的两个面都能改变方向。
      var flipX = near - nearX < EPS, flipY = near - nearY < EPS;
      if (!hit || near < hit.distance - EPS) {
        hit = { distance: near, flipX: flipX, flipY: flipY };
      } else if (Math.abs(near - hit.distance) < EPS) {
        hit.flipX = hit.flipX || flipX;
        hit.flipY = hit.flipY || flipY;
      }
    });
    return hit;
  }

  function rayEnemy(x, y, dx, dy, e) {
    var ox = e.x - x, oy = e.y - y;
    var ahead = ox * dx + oy * dy;
    var offset = ox * dy - oy * dx;
    if (offset * offset > e.r * e.r) return Infinity;
    var reach = Math.sqrt(e.r * e.r - offset * offset);
    return ahead + reach < 0 ? Infinity : Math.max(0, ahead - reach);
  }

  function mark(g, kind, x, y, dx, dy, depth) {
    g.marks.push({ kind: kind, x: x, y: y, dx: dx, dy: dy, depth: depth, life: 0.42, max: 0.42 });
  }

  function launch(s, e, dx, dy, speed, damage, chain, kind, game) {
    var g = s.impact;
    var actual = Math.min(e.hp, damage);
    // 击倒后保留这次飞行。后续改向可以救连锁，但不能延长击倒目标的寿命。
    var previous = e.flight;
    var time = e.hp === 0 && previous ? previous.time : B.flightTime;
    e.hp -= actual;
    e.flash = 0.12;
    e.vx = dx * speed;
    e.vy = dy * speed;
    e.flight = {
      time: time, chain: chain, reflected: !!(previous && previous.reflected),
      effect: previous ? previous.effect : null
    };
    if (e.charger && e.mode !== 'cool') {
      e.mode = 'cool';
      e.timer = K.chargeRecovery;
    }
    chain.targets.add(e);
    if (actual) s.damagePops.push({ x: e.x, y: e.y, value: actual, crit: kind === 'relay', life: 0.52, max: 0.52 });
    if (kind === 'relay') {
      g.combo = chain.targets.size;
      g.comboTime = 1.25;
      g.bestChain = Math.max(g.bestChain, g.combo);
      mark(g, kind, e.x, e.y, dx, dy, g.combo);
      sound('impactChain', g.combo);
      if (g.combo >= 3) s.shake = Math.max(s.shake, 4);
    } else if (kind === 'direct' || kind === 'redirect') {
      sound('hit');
      if (kind === 'redirect') mark(g, kind, e.x, e.y, dx, dy);
    }
    game.burst(s, e.x, e.y, kind === 'relay' ? '#E9A23B' : '#39C6A5', kind === 'relay' ? 7 : 3, 115);
  }

  function selectEffect(e, dx, dy) {
    if (e.flight) {
      if (e.flight.effect) return null;
      var dot = (e.vx * dx + e.vy * dy) / (Math.hypot(e.vx, e.vy) || 1);
      if (!e.flight.reflected && dot >= K.sameDirection) return 'straight';
      if (e.flight.reflected && Math.abs(dot) <= K.sideDirection) return 'fold';
      return null;
    }
    if (e.charger && (e.mode === 'wind' || e.mode === 'charge') &&
        Math.abs(e.lockX * dx + e.lockY * dy) <= K.sideDirection) return 'borrow';
    return null;
  }

  function strike(s, e, dx, dy, explicit, game) {
    var g = s.impact;
    var w = B[g.weapon];
    var redirect = !!e.flight;
    var speed = redirect ? w.redirect : w.speed;
    var effect = g.combinations && explicit ? selectEffect(e, dx, dy) : null;
    if (effect === 'borrow' && e.mode === 'charge') speed += Math.hypot(e.vx, e.vy) * K.borrowCarry;
    if (!redirect && g.perk === 'p_impact_heavy') speed *= B.heavyMultiplier;
    var chain = redirect ? e.flight.chain : { targets: new Set() };
    launch(s, e, dx, dy, speed, w.damage, chain, redirect ? 'redirect' : 'direct', game);
    if (effect) {
      e.flight.effect = { kind: effect, dx: dx, dy: dy };
      sound('impactArm', effect);
    }
    if (g.awakeAt === Infinity) g.awakeAt = s.elapsed + B.firstGrace;
    return redirect;
  }

  function lunge(p, dx, dy, distance, game) {
    var steps = Math.ceil(distance / 5);
    for (var i = 0; i < steps; i++) {
      p.x += dx * distance / steps;
      p.y += dy * distance / steps;
      game.collideWalls(p, p.r);
    }
  }

  function swing(s, dx, dy, explicit, game) {
    var g = s.impact, p = s.player;
    var w = B.blade;
    var x = p.x, y = p.y;
    lunge(p, dx, dy, B.lunge, game);
    var reached = (p.x - x) * dx + (p.y - y) * dy;
    g.swing = { x: p.x, y: p.y, angle: p.angle, life: 0.18, max: 0.18 };
    sound('impactSwing');
    var redirected = false;
    s.enemies.forEach(function (e) {
      var ex = e.x - x, ey = e.y - y;
      var len = Math.hypot(ex, ey);
      if (len > w.range + e.r + reached || (ex * dx + ey * dy) < len * Math.cos(w.halfArc)) return;
      if (len && castWall(s.walls, x, y, ex / len, ey / len, len)) return;
      if (strike(s, e, dx, dy, explicit, game)) redirected = true;
    });
    if (redirected && g.perk === 'p_impact_pursuit') {
      lunge(p, dx, dy, B.pursuitStep, game);
      p.dashCd = 0;
    }
  }

  function shoot(s, dx, dy, explicit, game) {
    var g = s.impact, p = s.player;
    var x = p.x, y = p.y;
    var range = B.cannon.range;
    var points = [{ x: x, y: y }];
    var hits = g.perk === 'p_impact_pierce' ? 2 : 1;
    var legs = g.perk === 'p_impact_bank' ? 2 : 1;
    sound('shoot');
    for (var i = 0; i < legs && range > EPS; i++) {
      var wall = castWall(s.walls, x, y, dx, dy, range);
      var limit = wall ? wall.distance : range;
      var targets = s.enemies.map(function (e) {
        return { enemy: e, distance: rayEnemy(x, y, dx, dy, e) };
      }).filter(function (target) {
        return target.distance < limit;
      }).sort(function (a, b) { return a.distance - b.distance; });
      targets.slice(0, hits).forEach(function (target) { strike(s, target.enemy, dx, dy, explicit, game); });
      if (targets.length >= hits) {
        limit = targets[hits - 1].distance;
        points.push({ x: x + dx * limit, y: y + dy * limit });
        break;
      }
      points.push({ x: x + dx * limit, y: y + dy * limit });
      if (!wall || i + 1 >= legs) break;
      dx = wall.flipX ? -dx : dx;
      dy = wall.flipY ? -dy : dy;
      mark(g, 'bank', points[1].x, points[1].y, dx, dy);
      sound('impactWall');
      x = points[1].x + dx * EPS;
      y = points[1].y + dy * EPS;
      range -= limit + EPS;
    }
    g.shot = { points: points, life: 0.18, max: 0.18 };
  }

  function moveFlight(s, e, dt, game) {
    var drag = Math.exp(-B.drag * dt);
    e.vx *= drag;
    e.vy *= drag;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    var bounce = null;
    s.walls.forEach(function (wall) {
      var x = e.x, y = e.y;
      if (!game.circleRect(e, e.r, wall)) return;
      var len = Math.hypot(e.x - x, e.y - y);
      if (len < EPS) return;
      var nx = (e.x - x) / len, ny = (e.y - y) / len;
      var inward = e.vx * nx + e.vy * ny;
      if (inward >= 0) return;
      e.vx = (e.vx - 2 * inward * nx) * B.bounce;
      e.vy = (e.vy - 2 * inward * ny) * B.bounce;
      if (!bounce) bounce = { x: e.x - nx * e.r, y: e.y - ny * e.r };
    });
    if (bounce) {
      e.flight.reflected = true;
      var speed = Math.hypot(e.vx, e.vy) || 1;
      mark(s.impact, 'wall', bounce.x, bounce.y, e.vx / speed, e.vy / speed);
      sound('impactWall');
    }
    e.flight.time -= dt;
  }

  function advanceCharger(s, e, dt, game) {
    var p = s.player;
    e.timer -= dt;
    if (e.timer <= 0) {
      if (e.mode === 'wind') {
        e.mode = 'charge';
        e.timer = K.chargeTime;
      } else if (e.mode === 'charge') {
        e.mode = 'cool';
        e.timer = K.chargeRecovery;
      } else {
        var dx = p.x - e.x, dy = p.y - e.y;
        var gap = Math.hypot(dx, dy);
        if (gap > 1) { e.lockX = dx / gap; e.lockY = dy / gap; }
        e.mode = 'wind';
        e.timer = K.chargeWarning;
      }
    }
    if (e.mode !== 'charge') {
      e.vx = 0; e.vy = 0;
      return;
    }
    e.vx = e.lockX * K.chargeSpeed;
    e.vy = e.lockY * K.chargeSpeed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    game.collideWalls(e, e.r);
    if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r) game.hurtPlayer(s, e, e.damage);
  }

  function advanceEnemy(s, e, dt, game) {
    e.flash = Math.max(0, e.flash - dt);
    var p = s.player;
    if (e.flight) {
      moveFlight(s, e, dt, game);
    } else if (e.charger) {
      advanceCharger(s, e, dt, game);
    } else if (e.hp > 0 && s.elapsed >= s.impact.awakeAt) {
      var gap = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      var speed = Math.min(B.enemySpeed, gap / dt);
      e.vx = (p.x - e.x) / gap * speed;
      e.vy = (p.y - e.y) / gap * speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      game.collideWalls(e, e.r);
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r) game.hurtPlayer(s, e, e.damage);
    }
  }

  function foldImpact(s, target, effect, speed, chain, game) {
    s.enemies.forEach(function (e) {
      if (chain.targets.has(e)) return;
      var dx = e.x - target.x, dy = e.y - target.y;
      var gap = Math.hypot(dx, dy);
      if (!gap || gap > K.foldRadius || castWall(s.walls, target.x, target.y, dx / gap, dy / gap, gap)) return;
      var side = effect.dx * dy - effect.dy * dx;
      var angle = Math.atan2(effect.dy, effect.dx) + (side >= 0 ? K.foldAngle : -K.foldAngle);
      launch(s, e, Math.cos(angle), Math.sin(angle), speed * K.foldSpeed,
        Math.round(speed * B.impactDamage * K.foldSpeed), chain, 'spread', game);
    });
  }

  function relay(s, source, target, nx, ny, incoming, speed, fresh, game) {
    var chain = source.flight.chain;
    source.vx -= nx * incoming;
    source.vy -= ny * incoming;
    // 持续接触只结算一次；同一串也不能绕回已经结算的目标。
    if (!fresh || speed < B.minSpeed || chain.targets.has(target)) return;
    var effect = source.flight.effect;
    source.flight.effect = null;
    var push = speed * B.relay;
    if (effect && effect.kind !== 'fold') {
      push *= effect.kind === 'straight' ? K.straightBoost : K.borrowBoost;
      nx = effect.dx; ny = effect.dy;
    }
    launch(s, target, nx, ny, push, Math.round(speed * B.impactDamage), chain, 'relay', game);
    if (effect) {
      if (effect.kind === 'fold') foldImpact(s, target, effect, speed, chain, game);
      mark(s.impact, effect.kind, target.x, target.y, effect.dx, effect.dy);
      sound('impactSpecial', effect.kind);
      if (effect.kind === 'borrow') s.shake = Math.max(s.shake, 4);
    }
  }

  function resolvePairs(s, game) {
    var g = s.impact;
    var touching = new Set();
    for (var i = 0; i < s.enemies.length; i++) {
      var a = s.enemies[i];
      for (var j = i + 1; j < s.enemies.length; j++) {
        var b = s.enemies[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var gap = Math.hypot(dx, dy), sum = a.r + b.r;
        if (gap > sum + EPS) continue;
        var nx = gap ? dx / gap : 1, ny = gap ? dy / gap : 0;
        var push = Math.max(0, sum - gap) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        game.collideWalls(a, a.r);
        game.collideWalls(b, b.r);
        var key = a.impactId + ':' + b.impactId;
        touching.add(key);
        var fresh = !g.contacts.has(key);
        var va = a.flight ? a.vx * nx + a.vy * ny : 0;
        var vb = b.flight ? -b.vx * nx - b.vy * ny : 0;
        var closing = va + vb;
        if (closing <= 0) continue;
        if (va >= vb && a.flight) relay(s, a, b, nx, ny, va, Math.min(va, closing), fresh, game);
        else if (b.flight) relay(s, b, a, -nx, -ny, vb, Math.min(vb, closing), fresh, game);
      }
    }
    g.contacts = touching;
  }

  function land(s, e) {
    if (!e.flight || (e.flight.time > 0 && Math.hypot(e.vx, e.vy) >= B.minSpeed)) return;
    e.flight = null;
    e.vx = 0;
    e.vy = 0;
    if (e.hp === 0) {
      e.dead = true;
      s.kills++;
      sound('kill');
    }
  }

  function update(s, dt, input, game) {
    var g = s.impact, p = s.player;
    g.comboTime = Math.max(0, g.comboTime - dt);
    if (g.swing) g.swing.life -= dt;
    if (g.shot) g.shot.life -= dt;
    g.marks = g.marks.filter(function (m) { m.life -= dt; return m.life > 0; });
    if ((input.fire || g.buffer > 0) && p.fireCd <= 0) {
      var dx = Math.cos(p.angle), dy = Math.sin(p.angle);
      var explicit = g.buffer > 0;
      if (g.weapon === 'blade') swing(s, dx, dy, explicit, game);
      else shoot(s, dx, dy, explicit, game);
      p.fireCd = B[g.weapon].cooldown;
      g.buffer = 0;
    }
    g.buffer = Math.max(0, g.buffer - dt);

    // 小步移动让高速击飞在低帧率下仍逐个经过敌人与墙。
    var steps = Math.ceil(dt / STEP);
    var step = dt / steps;
    for (var i = 0; i < steps && s.phase === 'playing'; i++) {
      s.enemies.forEach(function (e) { advanceEnemy(s, e, step, game); });
      if (s.phase !== 'playing') return;
      resolvePairs(s, game);
      s.enemies.forEach(function (e) { land(s, e); });
      s.enemies = s.enemies.filter(function (e) { return !e.dead; });
    }
    if (s.enemies.length) return;
    if (g.wave === 2) game.finishRun(s, true);
    else if (g.combinations) {
      spawnWave(s, 2, game);
      sound('clear');
    }
    else {
      g.points = 1;
      s.phase = 'perk';
      s.perkPending = WEAPONS[g.weapon].choices.slice();
      game.offer(s);
    }
  }

  C.core.impact = {
    weapons: WEAPONS, hasWeapon: hasWeapon, walls: WALLS, reflector: REFLECTOR, shortWall: SHORT_WALL,
    start: start, choose: choose, update: update
  };
})(window.Corridor = window.Corridor || {});
