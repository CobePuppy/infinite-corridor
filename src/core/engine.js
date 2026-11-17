/* core/engine.js — 规则引擎（完全不依赖 AI 的可玩闭环）
 * 移动、碰撞、伤害、词条效果、房间推进、死亡与重开。
 * 所有效果数值只从 core/perks.js 查表；关卡 JSON 只提供结构与白名单 id。
 */
(function (C) {
  'use strict';

  var W = 960, H = 600;
  var T = 18;                 // 外墙厚度
  var PLAYER_R = 12;
  var SPEED = 232;
  var DASH_SPEED = 790;
  var DASH_TIME = 0.14;
  var FIRE_CD = 0.185;
  var BULLET_SPEED = 660;
  var BULLET_DMG = 10;
  var BULLET_RANGE = 330;
  var HURT_INVULN = 0.62;
  var ENEMY_R = 15;
  var EXIT_R = 34;

  function A(name) { C.core.audio.play(name); }
  function emit(s, type, payload) { if (s && s.onEvent) s.onEvent(type, payload || {}); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function uuid() {
    return 'xxxxxxxx'.replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16); }) +
      Date.now().toString(16);
  }

  var state = null;
  var meta = null;
  var lastRun = null;
  var runIndex = 1;

  /* ---------- 元数据 / 局外解锁 ---------- */
  var META_KEY = 'corridor.meta.v1';
  function loadMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY));
      if (m && typeof m === 'object') meta = m;
    } catch (e) { /* 忽略损坏存档 */ }
    if (!meta) meta = { gold: 0, unlocked: [], runs: 0, clears: 0, bestSeconds: 0 };
    if (!Array.isArray(meta.unlocked)) meta.unlocked = [];
    return meta;
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 无痕模式忽略 */ }
  }
  function unlock(id) {
    if (meta.unlocked.indexOf(id) !== -1) return { ok: false, reason: 'already' };
    if (meta.gold < 60) return { ok: false, reason: 'poor' };
    meta.gold -= 60;
    meta.unlocked.push(id);
    saveMeta();
    return { ok: true };
  }

  /* ---------- 墙体：按 shape 生成程序化布局 ---------- */
  function border() {
    return [
      { x: 0, y: 0, w: W, h: T },
      { x: 0, y: H - T, w: W, h: T },
      { x: 0, y: 0, w: T, h: H },
      { x: W - T, y: 0, w: T, h: H }
    ];
  }
  function buildWalls(shape) {
    var w = border();
    var cx = W / 2, cy = H / 2;
    if (shape === 'arena') {
      w.push({ x: cx - 74, y: cy - 74, w: 52, h: 52 });
      w.push({ x: cx + 22, y: cy - 74, w: 52, h: 52 });
      w.push({ x: cx - 74, y: cy + 22, w: 52, h: 52 });
      w.push({ x: cx + 22, y: cy + 22, w: 52, h: 52 });
    } else if (shape === 'corridor') {
      w.push({ x: 210, y: 0, w: 30, h: 178 });
      w.push({ x: 210, y: H - 178, w: 30, h: 178 });
      w.push({ x: 520, y: 0, w: 30, h: 178 });
      w.push({ x: 520, y: H - 178, w: 30, h: 178 });
      w.push({ x: 720, y: cy - 16, w: 34, h: 32 });
    } else if (shape === 'cross') {
      w.push({ x: 250, y: 60, w: 190, h: 168 });
      w.push({ x: 250, y: H - 228, w: 190, h: 168 });
      w.push({ x: 570, y: 60, w: 150, h: 168 });
      w.push({ x: 570, y: H - 228, w: 150, h: 168 });
    } else { /* chamber */
      w.push({ x: cx - 168, y: cy - 168, w: 336, h: 34 });
      w.push({ x: cx - 168, y: cy + 134, w: 336, h: 34 });
      w.push({ x: cx - 168, y: cy - 168, w: 34, h: 336 });
      w.push({ x: cx + 134, y: cy - 168, w: 34, h: 336 });
    }
    return w;
  }

  function circleRect(e, r, rect) {
    var nx = clamp(e.x, rect.x, rect.x + rect.w);
    var ny = clamp(e.y, rect.y, rect.y + rect.h);
    var dx = e.x - nx, dy = e.y - ny;
    var d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 0.001) {
      var d = Math.sqrt(d2);
      e.x += (dx / d) * (r - d);
      e.y += (dy / d) * (r - d);
    } else {
      var left = e.x - rect.x, right = rect.x + rect.w - e.x;
      var top = e.y - rect.y, bottom = rect.y + rect.h - e.y;
      var m = Math.min(left, right, top, bottom);
      if (m === left) e.x = rect.x - r;
      else if (m === right) e.x = rect.x + rect.w + r;
      else if (m === top) e.y = rect.y - r;
      else e.y = rect.y + rect.h + r;
    }
    return true;
  }
  function collideWalls(e, r) {
    for (var i = 0; i < state.walls.length; i++) circleRect(e, r, state.walls[i]);
    e.x = clamp(e.x, r, W - r);
    e.y = clamp(e.y, r, H - r);
  }
  function hitsWall(x, y, r) {
    for (var i = 0; i < state.walls.length; i++) {
      var q = state.walls[i];
      var nx = clamp(x, q.x, q.x + q.w), ny = clamp(y, q.y, q.y + q.h);
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return true;
    }
    return false;
  }
  function spawnPoint() {
    for (var i = 0; i < 40; i++) {
      var p = { x: rand(W * 0.42, W * 0.86), y: rand(70, H - 70) };
      if (!hitsWall(p.x, p.y, ENEMY_R + 6)) return p;
    }
    return { x: W * 0.72, y: H / 2 };
  }

  /* ---------- 粒子 / 特效 ---------- */
  function burst(s, x, y, color, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2), v = rand(spd * 0.3, spd);
      s.particles.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.22, 0.55), max: 0.55, color: color,
        size: rand(2, 5), shape: Math.random() < 0.5 ? 'rect' : 'circle'
      });
    }
  }

  /* ---------- 敌人 ---------- */
  function makeEnemy(spec, isBoss) {
    var p = spawnPoint();
    var r = isBoss ? 34 : ENEMY_R;
    return {
      x: p.x, y: p.y, vx: 0, vy: 0, r: r,
      hp: spec.hp, maxHp: spec.hp, damage: spec.damage,
      pattern: spec.pattern, type: spec.type, isBoss: !!isBoss,
      shape: isBoss ? 'boss' : spec.pattern,
      timer: rand(0.4, 1.4), mode: 'idle', angle: rand(0, Math.PI * 2),
      lockX: 0, lockY: 0, flash: 0, touchCd: 0,
      color: isBoss ? '#D9644B' : (spec.pattern === 'ranged' ? '#8E7CE8' : spec.pattern === 'charge' ? '#E9A23B' : '#39C6A5')
    };
  }

  function enterRoom(i) {
    var s = state;
    var room = s.run.rooms[i];
    s.roomIndex = i;
    s.room = room;
    s.walls = buildWalls(room.shape);
    s.enemies = [];
    s.bullets = [];
    s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'playing';
    s.player.x = 92;
    s.player.y = H / 2;
    s.player.vx = s.player.vy = 0;
    room.enemies.forEach(function (spec) {
      for (var k = 0; k < spec.count; k++) s.enemies.push(makeEnemy(spec, false));
    });
    s.transition = 0.45;
    emit(s, 'roomEnter', { index: i, room: room, total: s.run.rooms.length });
  }

  function enterBoss() {
    var s = state;
    s.roomIndex = s.run.rooms.length;
    s.room = { name: '终室', shape: 'arena', color_token: 'rust', path_hint: '观察蓄力方向，侧身闪避后反击' };
    s.walls = buildWalls('arena');
    s.enemies = [makeEnemy(s.run.boss, true)];
    s.bullets = [];
    s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'boss';
    s.player.x = 92; s.player.y = H / 2;
    s.player.vx = s.player.vy = 0;
    s.transition = 0.55;
    A('boss');
    emit(s, 'bossEnter', { boss: s.run.boss });
  }

  /* ---------- 状态创建 ---------- */
  function createState(run, unlocked) {
    var s = {
      run: run,
      roomIndex: 0, room: null, walls: [], enemies: [], bullets: [], enemyBullets: [],
      particles: [], trail: [],
      phase: 'playing', transition: 0.4, hitstop: 0, shake: 0,
      exitActive: false, perkPending: null,
      perks: {}, shieldUsed: false,
      player: {
        x: 92, y: H / 2, vx: 0, vy: 0, r: PLAYER_R,
        hp: 100, maxHp: 100, angle: 0,
        invuln: 0, dashCd: 0, dashTime: 0, dashX: 1, dashY: 0, fireCd: 0
      },
      kills: 0, gold: 0, elapsed: 0,
      onEvent: null
    };
    (unlocked || []).forEach(function (id) { C.core.perks.add(s, id); });
    return s;
  }

  /* ---------- 开局 ---------- */
  async function startRun(opts) {
    opts = opts || {};
    loadMeta();
    var idx = opts.runIndex || runIndex;
    var theme = C.theme.get('geometry');
    var input = {
      seed: uuid(),
      difficulty: clamp(1 + Math.floor(idx / 2), 1, 5),
      run_index: idx,
      theme: 'geometry',
      theme_vocab: theme.vocab,
      unlocked: meta.unlocked.slice(),
      last_run: lastRun,
      perk_pool: C.core.perks.IDS.slice()
    };
    var res = await C.gen.buildRun(input);
    state = createState(res.run, meta.unlocked);
    state.source = res.source;
    state.templateIndex = res.templateIndex;
    state.onEvent = opts.onEvent || null;
    enterRoom(0);
    meta.runs += 1;
    saveMeta();
    A('start');
    emit(state, 'runStart', { run: res.run, source: res.source, runIndex: idx });
    return state;
  }

  /* ---------- 伤害 ---------- */
  function damageEnemy(s, e, dmg, crit, chainDepth) {
    e.hp -= dmg;
    e.flash = 0.12;
    burst(s, e.x, e.y, crit ? '#E9A23B' : e.color, crit ? 9 : 5, 150);
    A('hit');
    s.hitstop = crit ? 0.055 : 0.028;
    s.shake = Math.max(s.shake, crit ? 7 : 3.5);
    if (e.hp <= 0) {
      e.dead = true;
      s.kills += 1;
      s.gold += 2;
      burst(s, e.x, e.y, e.color, 16, 260);
      A('kill');
      var payload = C.core.perks.on(s, 'kill', { chainChance: 0, x: e.x, y: e.y });
      if (!chainDepth && Math.random() < payload.chainChance) {
        s.enemies.forEach(function (o) {
          if (o !== e && !o.dead && dist(o, e) < 130) damageEnemy(s, o, 8, false, 1);
        });
        burst(s, e.x, e.y, '#8E7CE8', 12, 220);
      }
      if (e.isBoss) s.shake = 16;
    }
  }

  function hurtPlayer(s, source, baseDamage) {
    var p = s.player;
    if (p.invuln > 0 || p.dashTime > 0 || s.phase === 'dead' || s.phase === 'won') return;
    var payload = C.core.perks.on(s, 'hurt', { damage: baseDamage, source: source, shielded: false, reflected: 0 });
    p.hp -= payload.damage;
    p.invuln = HURT_INVULN;
    s.shake = Math.max(s.shake, 11);
    s.hitstop = 0.06;
    burst(s, p.x, p.y, '#D9644B', 14, 240);
    A('hurt');
    emit(s, 'playerHurt', { damage: payload.damage, shielded: payload.shielded, reflected: payload.reflected });
    if (payload.reflected && source && !source.dead && source.hp <= 0) damageEnemy(s, source, 1, false, 1);
    if (p.hp <= 0) finishRun(s, false);
  }

  function finishRun(s, cleared) {
    if (s.phase === 'dead' || s.phase === 'won') return;
    s.phase = cleared ? 'won' : 'dead';
    var gained = s.gold + (cleared ? 50 : 0) + s.roomIndex * 12;
    var out = C.core.perks.on(s, 'runEnd', { gold: gained });
    s.finalGold = out.gold;
    meta.gold += out.gold;
    if (cleared) meta.clears += 1;
    meta.bestSeconds = Math.max(meta.bestSeconds || 0, Math.round(s.elapsed));
    saveMeta();
    lastRun = {
      survived_seconds: Math.round(s.elapsed),
      died_at_room: s.roomIndex,
      picked_perks: Object.keys(s.perks),
      cleared: cleared
    };
    runIndex = s.run.run_id.split('_').pop() ? (parseInt(s.run.run_id.split('_').pop(), 10) || 1) + 1 : runIndex + 1;
    A(cleared ? 'clear' : 'death');
    emit(s, 'runEnd', {
      cleared: cleared, gold: out.gold, seconds: s.elapsed,
      kills: s.kills, rooms: s.roomIndex, summary: s.run.summary, lastRun: lastRun
    });
  }

  function restart(opts) { return startRun(opts); }

  /* ---------- 词条选择 ---------- */
  function offerPerks(s) {
    var want = (s.room && s.room.perk_choices) || [];
    var pool = C.core.perks.IDS.filter(function (id) { return C.core.perks.canOffer(s, id); });
    var chosen = want.filter(function (id) { return pool.indexOf(id) !== -1; });
    var i = 0;
    while (chosen.length < 2 && i < pool.length) {
      if (chosen.indexOf(pool[i]) === -1) chosen.push(pool[i]);
      i++;
    }
    return chosen.slice(0, 2);
  }
  function choosePerk(id) {
    var s = state;
    if (!s || s.phase !== 'perk') return false;
    if (!C.core.perks.add(s, id)) return false;
    A('pick');
    emit(s, 'perkPicked', { id: id, def: C.core.perks.TABLE[id] });
    s.phase = 'transition';
    s.perkPending = null;
    if (s.roomIndex + 1 < s.run.rooms.length) enterRoom(s.roomIndex + 1);
    else enterBoss();
    return true;
  }

  /* ---------- 每帧更新 ---------- */
  function update(dt, input) {
    var s = state;
    if (!s) return null;
    dt = Math.min(dt, 0.05);

    if (s.hitstop > 0) { s.hitstop -= dt; return s; }
    s.shake = Math.max(0, s.shake - dt * 42);
    s.transition = Math.max(0, s.transition - dt);

    s.particles = s.particles.filter(function (p) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      return p.life > 0;
    });
    s.trail = s.trail.filter(function (p) { p.life -= dt; return p.life > 0; });

    if (s.phase === 'dead' || s.phase === 'won' || s.phase === 'perk') return s;

    s.elapsed += dt;
    var p = s.player;
    var d = C.core.perks.derive(s);
    p.invuln = Math.max(0, p.invuln - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);

    /* 输入 → 移动 */
    var ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    var al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;

    if (input.dash && p.dashCd <= 0 && p.dashTime <= 0) {
      var dx = ax, dy = ay;
      if (!ax && !ay) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
      p.dashX = dx; p.dashY = dy;
      p.dashTime = DASH_TIME;
      p.dashCd = d.dashCd;
      A('dash');
      s.shake = Math.max(s.shake, 4);
      emit(s, 'dash', {});
    }

    if (p.dashTime > 0) {
      p.dashTime -= dt;
      p.vx = p.dashX * DASH_SPEED;
      p.vy = p.dashY * DASH_SPEED;
      s.trail.push({ x: p.x, y: p.y, life: 0.24, max: 0.24 });
    } else {
      var k = Math.min(1, dt * 13);
      p.vx += (ax * SPEED - p.vx) * k;
      p.vy += (ay * SPEED - p.vy) * k;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    collideWalls(p, p.r);

    /* 瞄准与射击 */
    if (input.aimX != null) {
      var tx = input.aimX - p.x, ty = input.aimY - p.y;
      if (Math.hypot(tx, ty) > 6) p.angle = Math.atan2(ty, tx);
    }
    if (input.fire && p.fireCd <= 0) {
      var atk = C.core.perks.on(s, 'attack', { damage: BULLET_DMG, range: BULLET_RANGE, crit: false });
      var ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      s.bullets.push({
        x: p.x + ca * (p.r + 8), y: p.y + sa * (p.r + 8),
        vx: ca * BULLET_SPEED, vy: sa * BULLET_SPEED,
        damage: atk.damage, life: atk.range / BULLET_SPEED, crit: atk.crit
      });
      p.fireCd = FIRE_CD;
      A('shoot');
    }

    /* 玩家子弹 */
    s.bullets = s.bullets.filter(function (b) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H || hitsWall(b.x, b.y, 3)) {
        burst(s, b.x, b.y, '#39C6A5', 3, 80);
        return false;
      }
      for (var i = 0; i < s.enemies.length; i++) {
        var e = s.enemies[i];
        if (!e.dead && dist(b, e) < e.r + 5) {
          var mult = (e.isBoss && s.run.boss.weakness_perk && s.perks[s.run.boss.weakness_perk]) ? 1.35 : 1;
          damageEnemy(s, e, Math.round(b.damage * mult), b.crit, 0);
          return false;
        }
      }
      return true;
    });

    /* 敌人 AI */
    var speedMul = d.enemySpeed;
    s.enemies.forEach(function (e) {
      if (e.dead) return;
      e.flash = Math.max(0, e.flash - dt);
      e.touchCd = Math.max(0, e.touchCd - dt);
      e.timer -= dt;
      var toX = p.x - e.x, toY = p.y - e.y;
      var len = Math.hypot(toX, toY) || 1;
      var nx = toX / len, ny = toY / len;
      var sp = (e.isBoss ? 96 : 118) * speedMul;

      if (e.pattern === 'chase') {
        e.vx = nx * sp; e.vy = ny * sp;
      } else if (e.pattern === 'orbit') {
        e.angle += dt * (e.isBoss ? 1.1 : 1.6);
        var targetR = e.isBoss ? 190 : 132;
        var wantX = p.x + Math.cos(e.angle) * targetR;
        var wantY = p.y + Math.sin(e.angle) * targetR;
        e.vx = (wantX - e.x) * 2.4; e.vy = (wantY - e.y) * 2.4;
      } else if (e.pattern === 'charge') {
        if (e.mode === 'idle' && e.timer <= 0) { e.mode = 'wind'; e.timer = 0.42; e.lockX = nx; e.lockY = ny; }
        else if (e.mode === 'wind' && e.timer <= 0) { e.mode = 'charge'; e.timer = 0.44; }
        else if (e.mode === 'charge' && e.timer <= 0) { e.mode = 'cool'; e.timer = 0.85; }
        else if (e.mode === 'cool' && e.timer <= 0) { e.mode = 'idle'; e.timer = rand(0.5, 1.1); }
        if (e.mode === 'charge') { e.vx = e.lockX * sp * 3.6; e.vy = e.lockY * sp * 3.6; }
        else if (e.mode === 'wind') { e.vx = -nx * 24; e.vy = -ny * 24; }
        else { e.vx *= 0.9; e.vy *= 0.9; }
      } else if (e.pattern === 'ranged') {
        var want = e.isBoss ? 250 : 215;
        var pull = len > want + 30 ? 1 : (len < want - 30 ? -1 : 0);
        e.vx = nx * sp * 0.7 * pull + Math.sin(e.angle += dt * 1.3) * 18;
        e.vy = ny * sp * 0.7 * pull + Math.cos(e.angle) * 18;
        if (e.timer <= 0) {
          e.timer = e.isBoss ? 1.15 : rand(1.4, 2.1);
          var bl = Math.hypot(toX, toY) || 1;
          s.enemyBullets.push({
            x: e.x, y: e.y, vx: (toX / bl) * 275, vy: (toY / bl) * 275,
            damage: e.damage, life: 2.6, r: 6
          });
          if (e.isBoss) {
            [-0.28, 0.28].forEach(function (off) {
              var a = Math.atan2(toY, toX) + off;
              s.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 275, vy: Math.sin(a) * 275, damage: e.damage, life: 2.6, r: 6 });
            });
          }
        }
      } else { /* static */
        e.vx = 0; e.vy = 0;
      }

      e.x += e.vx * dt; e.y += e.vy * dt;
      collideWalls(e, e.r);
      if (dist(e, p) < e.r + p.r && e.touchCd <= 0) {
        e.touchCd = 0.55;
        hurtPlayer(s, e, e.damage);
      }
    });

    /* 敌方子弹 */
    s.enemyBullets = s.enemyBullets.filter(function (b) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || hitsWall(b.x, b.y, b.r)) { burst(s, b.x, b.y, '#8E7CE8', 3, 70); return false; }
      if (dist(b, p) < p.r + b.r) { hurtPlayer(s, null, b.damage); return false; }
      return true;
    });

    s.enemies = s.enemies.filter(function (e) { return !e.dead; });

    /* 清房 → 出口 → 词条 / 通关 */
    if (s.enemies.length === 0 && !s.exitActive) {
      s.exitActive = true;
      if (s.phase === 'boss') {
        finishRun(s, true);
        return s;
      }
      var rc = C.core.perks.on(s, 'roomClear', { healed: 0 });
      s.gold += 12;
      A('clear');
      emit(s, 'roomClear', { healed: rc.healed, hint: s.room.path_hint, index: s.roomIndex });
    }
    if (s.exitActive && s.phase !== 'perk' && s.phase !== 'dead' && s.phase !== 'won') {
      var exit = { x: W - 74, y: H / 2 };
      if (dist(p, exit) < EXIT_R + p.r) {
        s.phase = 'perk';
        s.perkPending = offerPerks(s);
        A('ui');
        emit(s, 'perkOffer', { choices: s.perkPending, nextIsBoss: s.roomIndex + 1 >= s.run.rooms.length });
      }
    }

    return s;
  }

  function getState() { return state; }
  function getMeta() { return meta || loadMeta(); }
  function getLastRun() { return lastRun; }
  function setOnEvent(fn) { if (state) state.onEvent = fn; }

  C.core = C.core || {};
  C.core.engine = {
    W: W, H: H, EXIT_R: EXIT_R,
    startRun: startRun, restart: restart, update: update,
    choosePerk: choosePerk, offerPerks: offerPerks,
    getState: getState, getMeta: getMeta, getLastRun: getLastRun,
    loadMeta: loadMeta, unlock: unlock, setOnEvent: setOnEvent,
    uuid: uuid
  };
})(window.Corridor = window.Corridor || {});
