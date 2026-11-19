/* core/engine.js — 规则引擎（完全不依赖 AI 的可玩闭环）
 * 移动、碰撞、伤害、词条效果、房间推进、死亡与重开。
 * 所有效果数值只从 core/perks.js 查表；关卡 JSON 只提供结构与白名单 id。
 *
 * ── T24-C 4 分钟节奏估算模型 ────────────────────────────────────────────
 * 目标：单条命通关 6–8 房 + Boss ≈ 240 秒。
 *   T = Σ 清房战斗 + Boss 战 + 转场/选词条
 *     ≈ 25s × 7 房(=175s) + 50s Boss + 15s 转场/选词条 = 240s
 *   单房 25s：入场走位 ~5s、清场 ~16s（瞄准/拉扯/精英词缀）、走向出口 ~4s。
 *   Boss 50s：P1 约 30s 打掉前半血；50% 血切 P2，弹幕加密 + 移速提升，
 *     需更多闪避使等效 DPS 下降，约 20s 收尾。
 * 校准手段（刻意不靠单纯堆血，配合房间分型与阶段变化）：
 *   1) 房间敌人 hp 随进度线性放大 1.15→1.70 倍（B.hpBase / B.hpProgress）；
 *   2) 后半段每类敌人 +1 只（B.countAfter / B.countBonus）；
 *   3) elite 房再叠加 hp×1.35 / 伤害 +2 / +1 只（见房间分型）；
 *   4) Boss hp ×1.25，且 50% 血切 P2 提移速、加密弹幕。
 * 基础手感常量（BULLET_DMG / FIRE_CD / SPEED / DASH_* 等）保持 v1 不动。
 * 注：房间数由关卡 JSON 决定 —— T25 后 schema 允许 3–8 房、共 6 套模板，本模型按 7 房标称；
 *     T28 已补 `tests/fullsuite.js`：按 calibrate 同一公式采样整局真实敌人 HP，
 *     给出命中率敏感性区间，并用真实 engine.update() 帧循环验证状态机可达性。
 *     但命中率属真人手感范畴，Node 无法测定，**240s 是否达成仍须按
 *     docs/demo-90s.md §3 记录表人工计时**，不得用理论模型冒充验收结论。
 * ──────────────────────────────────────────────────────────────────────── */
(function (C) {
  'use strict';

  /* 依赖 index.html 固定加载顺序：perks.js 先于 engine.js。所有新增「词条效果数值」
   * 集中在 perks.js 的 derive()/on()/BALANCE，engine 只消费；基础手感/碰撞参数沿用 v1。 */
  var B = C.core.perks.BALANCE;

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

  function A(name, detail) { C.core.audio.play(name, detail); }
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
  var TEST_GOLD = 9999;
  var UNLOCK_COST = 60;
  function loadMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY));
      if (m && typeof m === 'object' && !Array.isArray(m)) meta = m;
    } catch (e) { /* 忽略损坏存档 */ }
    if (!meta) meta = { gold: 0, unlocked: [], runs: 0, clears: 0, bestSeconds: 0 };
    if (!Array.isArray(meta.unlocked)) meta.unlocked = [];
    if (!meta.testGoldGranted) {
      var balance = Number.isFinite(meta.gold) ? meta.gold : 0;
      meta.gold = Math.max(balance, TEST_GOLD);
      meta.testGoldGranted = true;
      saveMeta();
    }
    return meta;
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 无痕模式忽略 */ }
  }
  function unlock(id) {
    loadMeta();
    if (C.core.perks.IDS.indexOf(id) < 0) return { ok: false, reason: 'invalid' };
    if (meta.unlocked.indexOf(id) !== -1) return { ok: false, reason: 'already' };
    if (meta.gold < UNLOCK_COST) return { ok: false, reason: 'poor' };
    meta.gold -= UNLOCK_COST;
    meta.unlocked.push(id);
    saveMeta();
    return { ok: true };
  }
  function resetUnlocks() {
    loadMeta();
    if (!meta.unlocked.length) return 0;
    var owned = new Set(meta.unlocked);
    var count = C.core.perks.IDS.filter(function (id) { return owned.has(id); }).length;
    var refund = count * UNLOCK_COST;
    meta.unlocked = [];
    meta.gold += refund;
    saveMeta();
    return refund;
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
  /* 房间墙体每次进房生成。缓存各体型可走的格点和到玩家的步数。 */
  var NAV_STEP = 24, NAV_COLS = W / NAV_STEP, NAV_ROWS = H / NAV_STEP;
  function clearPath(x, y, tx, ty, radius) {
    var steps = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) / (NAV_STEP / 2)));
    for (var i = 1; i <= steps; i++) {
      if (hitsWall(x + (tx - x) * i / steps, y + (ty - y) * i / steps, radius)) return false;
    }
    return true;
  }

  function nearestNavCell(nav, x, y, radius, reachable) {
    var row = Math.floor(y / NAV_STEP), col = Math.floor(x / NAV_STEP);
    var nearest = -1, distance = Infinity;
    for (var r = Math.max(0, row - 1); r <= Math.min(NAV_ROWS - 1, row + 1); r++) {
      for (var c = Math.max(0, col - 1); c <= Math.min(NAV_COLS - 1, col + 1); c++) {
        var index = r * NAV_COLS + c;
        var point = nav.points[index];
        if (!point || (reachable && nav.depth[index] < 0)) continue;
        var gap = Math.hypot(x - point.x, y - point.y);
        if (gap >= distance || !clearPath(x, y, point.x, point.y, radius)) continue;
        nearest = index; distance = gap;
      }
    }
    return nearest;
  }

  function roomNavigation(s, radius) {
    if (!s.nav || s.nav.walls !== s.walls) s.nav = { walls: s.walls, byRadius: {} };
    var nav = s.nav.byRadius[radius];
    if (!nav) {
      var count = NAV_COLS * NAV_ROWS;
      nav = s.nav.byRadius[radius] = { points: new Array(count), edges: new Array(count),
        depth: new Int16Array(count), queue: new Uint16Array(count), playerCell: -1 };
      for (var i = 0; i < count; i++) {
        var x = (i % NAV_COLS + 0.5) * NAV_STEP, y = (Math.floor(i / NAV_COLS) + 0.5) * NAV_STEP;
        if (!hitsWall(x, y, radius + 2)) nav.points[i] = { x: x, y: y };
      }
      nav.points.forEach(function (from, index) {
        var col = index % NAV_COLS;
        var adjacent = [index - NAV_COLS, index + NAV_COLS];
        if (col > 0) adjacent.push(index - 1);
        if (col < NAV_COLS - 1) adjacent.push(index + 1);
        nav.edges[index] = adjacent.filter(function (next) {
          var to = nav.points[next];
          return to && clearPath(from.x, from.y, to.x, to.y, radius + 2);
        });
      });
    }
    var p = s.player;
    var cell = Math.floor(p.y / NAV_STEP) * NAV_COLS + Math.floor(p.x / NAV_STEP);
    if (nav.playerCell !== cell) {
      nav.playerCell = cell;
      nav.depth.fill(-1);
      var start = nearestNavCell(nav, p.x, p.y, PLAYER_R, false);
      if (start >= 0) {
        nav.depth[start] = 0;
        nav.queue[0] = start;
        for (var head = 0, size = 1; head < size; head++) {
          var current = nav.queue[head];
          var edges = nav.edges[current];
          for (var k = 0; k < edges.length; k++) {
            var next = edges[k];
            if (nav.depth[next] >= 0) continue;
            nav.depth[next] = nav.depth[current] + 1;
            nav.queue[size++] = next;
          }
        }
      }
    }
    return nav;
  }

  function enemyWaypoint(s, e, p) {
    if (clearPath(e.x, e.y, p.x, p.y, e.r)) return p;
    var nav = roomNavigation(s, e.r);
    var index = nearestNavCell(nav, e.x, e.y, e.r, true);
    if (index < 0) return p;
    var edges = nav.edges[index];
    for (var i = 0; i < edges.length; i++) {
      var next = edges[i], point = nav.points[next];
      if (nav.depth[next] < nav.depth[index] && nav.depth[next] >= 0 &&
          clearPath(e.x, e.y, point.x, point.y, e.r)) return point;
    }
    return nav.points[index];
  }

  function moveToward(e, target, speed, dt) {
    var x = target.x - e.x, y = target.y - e.y;
    var gap = Math.hypot(x, y);
    var scale = gap > 0 && dt > 0 ? Math.min(speed / gap, 1 / dt) : 0;
    e.vx = x * scale; e.vy = y * scale;
  }

  var SPAWN_CENTER_GUARD = 120;   // 画布中心禁区半径
  var SPAWN_PLAYER_GUARD = 170;   // 与玩家的最小出生距离
  function spawnValid(x, y, radius, nav) {
    if (hitsWall(x, y, radius + 6)) return false;
    var cx = W / 2, cy = H / 2;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < SPAWN_CENTER_GUARD * SPAWN_CENTER_GUARD) return false;
    var p = state.player, dx = x - p.x, dy = y - p.y;
    if (dx * dx + dy * dy < SPAWN_PLAYER_GUARD * SPAWN_PLAYER_GUARD) return false;
    if (state.enemies.some(function (e) { return !e.dead && Math.hypot(x - e.x, y - e.y) < radius + e.r; })) return false;
    return nearestNavCell(nav, x, y, radius + 2, true) >= 0;
  }
  function spawnPoint(radius) {
    var nav = roomNavigation(state, radius);
    for (var i = 0; i < 48; i++) {
      var p = { x: rand(W * 0.42, W * 0.86), y: rand(70, H - 70) };
      if (spawnValid(p.x, p.y, radius, nav)) return p;
    }
    return nav.points.find(function (point, index) {
      return nav.depth[index] >= 0 && spawnValid(point.x, point.y, radius, nav);
    });
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
  var PATTERN_TOKEN = { ranged: 'violet', charge: 'amber' };

  /* T24-D：按 pattern（或房间 color_token）产出 enemy.colorToken 供视觉层取色；
   * enemy.color 保留 v1 计算作为兼容回退，geometry 下视觉等价。 */
  function makeEnemy(spec, isBoss, roomToken, position) {
    var r = isBoss ? 34 : ENEMY_R;
    var p = position || spawnPoint(r);
    if (!p) return null;
    var fallbackToken = (typeof roomToken === 'string' && roomToken) ? roomToken : 'teal';
    var token = isBoss ? 'rust' : (PATTERN_TOKEN[spec.pattern] || fallbackToken);
    return {
      x: p.x, y: p.y, vx: 0, vy: 0, r: r,
      hp: spec.hp, maxHp: spec.hp, damage: spec.damage,
      pattern: spec.pattern, type: spec.type, isBoss: !!isBoss,
      shape: isBoss ? 'boss' : spec.pattern,
      timer: rand(0.4, 1.4), mode: 'idle', angle: rand(0, Math.PI * 2),
      lockX: 0, lockY: 0, flash: 0, touchCd: 0,
      color: isBoss ? '#D9644B' : (spec.pattern === 'ranged' ? '#8E7CE8' : spec.pattern === 'charge' ? '#E9A23B' : '#39C6A5'),
      colorToken: token
    };
  }

  /* T24-C 节奏校准：按房间进度温和放大 hp / 数量，elite 再叠词缀。
   * 只作用于运行时实例，绝不回写关卡 JSON（关卡不含数值）。 */
  function calibrate(spec, roomIndex, roomCount, roomType) {
    var prog = roomCount > 1 ? roomIndex / (roomCount - 1) : 0;
    var hp = Math.round(spec.hp * (B.hpBase + B.hpProgress * prog));
    var damage = spec.damage;
    var count = spec.count + (prog > B.countAfter ? B.countBonus : 0);
    if (roomType === 'elite') {
      hp = Math.round(hp * B.eliteHpMul);
      damage += B.eliteDamage;
      count += B.eliteCount;
    }
    return { hp: hp, damage: damage, count: count, pattern: spec.pattern, type: spec.type };
  }

  function enterRoom(i) {
    var s = state;
    var room = s.run.rooms[i];
    var roomType = room.type || 'normal';        /* C6：缺省 normal → 行为等同 M1 */
    s.roomIndex = i;
    s.room = room;
    s.roomType = roomType;                       /* C5 */
    s.bossPhase = 1;                             /* C5 */
    s.walls = s.prototype ? border().concat(C.core.recall.walls) : buildWalls(room.shape);
    s.enemies = [];
    s.bullets = [];
    s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'playing';
    s.player.x = 92;
    s.player.y = H / 2;
    s.player.vx = s.player.vy = 0;
    if (s.prototype) {
      resetRecall(s);
      var turret = makeEnemy({ hp: 44, damage: 8, pattern: 'static' }, false, 'violet',
        { x: 480, y: s.prototype === 'B' ? 126 : 516 });
      turret.turret = true;
      turret.timer = 1.6;
      s.enemies = [
        makeEnemy({ hp: 36, damage: 8, pattern: 'chase' }, false, room.color_token, { x: 565, y: 264 }),
        makeEnemy({ hp: 30, damage: 7, pattern: 'chase' }, false, room.color_token, { x: 755, y: 264 }),
        turret
      ];
    } else {
      room.enemies.forEach(function (spec) {
        var c = calibrate(spec, i, s.run.rooms.length, roomType);
        var shaped = { hp: c.hp, damage: c.damage, pattern: spec.pattern, type: spec.type };
        for (var k = 0; k < c.count; k++) {
          var enemy = makeEnemy(shaped, false, room.color_token);
          if (enemy) s.enemies.push(enemy);
        }
      });
    }
    /* T24-B 房间分型：rest 回血 / event 自动奖励（风险选择简化）/ elite 词缀已在 calibrate */
    if (roomType === 'rest') {
      var heal = Math.min(B.restHeal, s.player.maxHp - s.player.hp);
      s.player.hp += heal;
      emit(s, 'roomEvent', { kind: 'rest', healed: heal });
    } else if (roomType === 'event') {
      s.gold += B.eventGold;
      emit(s, 'roomEvent', { kind: 'event', gold: B.eventGold });
    }
    s.transition = 0.45;
    emit(s, 'roomEnter', { index: i, room: room, roomType: roomType, total: s.run.rooms.length });
  }

  function enterBoss() {
    var s = state;
    s.roomIndex = s.run.rooms.length;
    s.room = { name: '终室', shape: 'arena', color_token: 'rust', path_hint: '观察蓄力方向，侧身闪避后反击' };
    s.roomType = 'normal';
    s.bossPhase = 1;                              /* C5：Boss 两阶段 */
    s.walls = s.prototype ? border().concat(C.core.recall.walls) : buildWalls('arena');
    s.player.x = 92; s.player.y = H / 2;
    var bossSpec = {
      hp: Math.round(s.run.boss.hp * B.bossHpMul),  /* T24-C：Boss hp 增长曲线 */
      damage: s.run.boss.damage,
      pattern: s.run.boss.pattern,
      type: s.run.boss.name
    };
    if (s.prototype) {
      bossSpec.hp = B.recall.bossHp;
      var boss = makeEnemy(bossSpec, true, s.room.color_token, C.core.recall.hub[1]);
      boss.r = 28;
      boss.guardOpen = 0;
      boss.shieldFlash = 0;
      boss.patrol = { hub: 1, cursor: 0, phase: 1, route: null, warning: 0 };
      s.enemies = [boss];
      s.room.path_hint = '用回扫打开首领护盾';
    } else {
      var regularBoss = makeEnemy(bossSpec, true, s.room.color_token);
      s.enemies = regularBoss ? [regularBoss] : [];
    }
    s.bullets = [];
    s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'boss';
    s.player.vx = s.player.vy = 0;
    if (s.prototype) resetRecall(s);
    s.transition = 0.55;
    A('boss');
    emit(s, 'bossEnter', { boss: s.run.boss, phase: 1 });
  }

  function resetRecall(s) {
    var start = C.core.recall.hub[0];
    s.recall = C.core.recall.create();
    s.player.x = start.x;
    s.player.y = start.y;
    s.player.dashTime = 0;
    s.trail = [];
    s.particles = [];
    s.damagePops = [];
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
      /* T24-B / C5：新增字段全部可选，缺省时代码用 || 兜底走 M1 路径 */
      damagePops: [],          /* C5 [{x,y,value,crit,life,max}] */
      combo: 0,               /* C5 连击数 */
      roomType: 'normal',     /* C5 normal|elite|event|rest */
      bossPhase: 1,           /* C5 1|2 */
      comboTimer: 0,          /* 内部：>1.5s 未命中清零 */
      pickCount: 0,           /* 内部：已选词条次数，驱动三选一 */
      dashTrailCd: 0, satAngle: 0, satellites: [],  /* 内部：协同/卫星状态 */
      onEvent: null
    };
    (unlocked || []).forEach(function (id) { C.core.perks.add(s, id); });
    return s;
  }

  /* ---------- 开局 ---------- */
  var impactGame = {
    makeEnemy: makeEnemy, collideWalls: collideWalls, circleRect: circleRect,
    hurtPlayer: hurtPlayer, finishRun: finishRun, burst: burst,
    offer: function (s) {
      A('clear');
      emit(s, 'perkOffer', { choices: s.perkPending, impact: true });
    }
  };

  function startImpact(opts) {
    var rules = C.core.impact;
    var weapon = rules.hasWeapon(opts.impactWeapon) ? opts.impactWeapon : 'blade';
    var trial = opts.impactTrial ? C.core.enemyTrial.create(opts.impactTrial.version, opts.impactTrial.preset) : null;
    var room = { name: '接力直廊', color_token: 'teal' };
    var run = { theme: C.theme.get(opts.theme).id, rooms: [room] };
    state = createState(run, []);
    state.room = room;
    state.walls = border().concat(trial ? C.core.enemyTrial.walls : rules.walls);
    if (opts.impactCombinations && !trial) state.walls.push(rules.shortWall);
    state.transition = 0;
    state.onEvent = opts.onEvent || null;
    rules.start(state, weapon, !!opts.impactCombinations || !!trial, trial, impactGame);
    A('start');
    emit(state, 'runStart', { impact: true });
    return state;
  }

  function startRecall(opts) {
    var variant = opts.prototype === 'B' ? 'B' : 'A';
    var run = {
      theme: C.theme.get(opts.theme).id,
      rooms: [{ name: '三岔廊', color_token: 'teal', path_hint: '从标记廊口出发，从另一边回来' }],
      boss: { name: '巡廊者', hp: B.recall.bossHp, damage: B.recall.bossDamage, pattern: 'ranged' }
    };
    state = createState(run, []);
    state.prototype = variant;
    state.onEvent = opts.onEvent || null;
    enterRoom(0);
    state.phase = 'perk';
    state.perkPending = Object.keys(C.core.perks.RECALL);
    emit(state, 'runStart', { prototype: variant });
    emit(state, 'perkOffer', { choices: state.perkPending, prototype: true });
    return state;
  }

  /* ---------- 回廊长局（2026-11-19 玩法本体）：三层 × 三间 + 每层巡廊首领 ----------
   * 与 prototype 的关键差别：房间由 core/loop.js 编排，廊道折线每间不同；
   * 敌人按廊段布阵；词条走 LOOP 池（改变选路偏好）；层末写存档供续玩。
   * 旧 startRun / startImpact / startRecall 三条路径保持原样。 */
  function setupLoopRoom(s) {
    var L = s.loop, B = C.core.perks.BALANCE.loop;
    var room = C.core.loop.roomAt(L.plan, L.layer, L.roomInLayer);
    if (!room) { finishRun(s, true); return; }
    L.room = room;
    s.roomIndex = L.roomInLayer;
    s.room = { name: room.name, shape: 'loop', color_token: 'teal', path_hint: room.hint };
    s.roomType = 'normal';
    s.bossPhase = 1;
    s.walls = room.layout.walls;
    s.recall = C.core.recall.create(room.layout);
    var scale = 1 + 0.18 * (L.layer - 1);
    s.enemies = room.enemies.map(function (sp) {
      var e = makeEnemy({ hp: Math.round(sp.hp * scale), damage: B.enemyDamage,
                          pattern: sp.pattern, type: sp.pattern }, false, 'teal', sp.pos);
      if (e) {
        e.lane = sp.lane;
        if (sp.pattern === 'static') { e.turret = true; e.timer = 1.5; }
      }
      return e;
    }).filter(Boolean);
    s.bullets = []; s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'playing';
    s.player.x = room.layout.hub[0].x;
    s.player.y = room.layout.hub[0].y;
    s.player.vx = s.player.vy = 0;
    s.player.dashTime = 0;
    s.trail = []; s.particles = []; s.damagePops = [];
    s.transition = 0.45;
    C.core.loop.save(s);
    emit(s, 'roomEnter', { index: s.roomIndex, room: s.room, roomType: 'normal',
                           total: B.roomsPerLayer, loop: true, layer: L.layer });
  }

  function setupLoopBoss(s) {
    var L = s.loop, B = C.core.perks.BALANCE.loop;
    var layout = C.core.loop.makeLayout(0, L.layer * 10 + 7);
    s.roomIndex = B.roomsPerLayer;
    s.room = { name: '第 ' + L.layer + ' 层 · 巡廊者', shape: 'loop', color_token: 'rust',
               path_hint: '用回扫打开首领护盾，再趁窗口补枪' };
    s.roomType = 'normal'; s.bossPhase = 1;
    s.walls = layout.walls;
    s.recall = C.core.recall.create(layout);
    s.run.boss = { name: '巡廊者', hp: Math.round(B.bossHp * (1 + 0.2 * (L.layer - 1))),
                   damage: B.bossDamage, pattern: 'ranged' };
    var boss = makeEnemy({ hp: s.run.boss.hp, damage: B.bossDamage,
                           pattern: 'ranged', type: '巡廊者' }, true, 'rust', layout.hub[1]);
    if (boss) {
      boss.r = 28; boss.guardOpen = 0; boss.shieldFlash = 0;
      boss.patrol = { hub: 1, cursor: 0, phase: 1, route: null, warning: 0 };
      /* M9：多相位护盾状态机。旧 prototype 首领不带 shield，行为完全不变。 */
      boss.shield = {
        state: 'closed', breaks: 0, charge: 0,
        flash: 0, reform: 0,
        spec: C.core.loop.shieldSpec(0, s.perks)
      };
    }
    s.enemies = boss ? [boss] : [];
    s.bullets = []; s.enemyBullets = []; s.exitActive = false;
    s.phase = 'boss';
    s.player.x = layout.hub[0].x; s.player.y = layout.hub[0].y;
    s.player.vx = s.player.vy = 0;
    s.transition = 0.55;
    A('boss');
    emit(s, 'bossEnter', { boss: s.run.boss, phase: 1, loop: true, layer: L.layer,
                           shield: boss ? boss.shield.spec : null });
  }

  function advanceLoopLayer(s) {
    var L = s.loop;
    L.layer += 1;
    L.roomInLayer = 0;
    L.streak = 0; L.streakTimer = 0; L.goldPerKill = 0;
    s.player.invuln = Math.max(s.player.invuln, 1.0);
    emit(s, 'loopLayer', { layer: L.layer, gold: s.gold, hp: s.player.hp });
    setupLoopRoom(s);
  }

  /* ==================== M11 自由回扫主模式（隔离分支） ====================
   * 主模式已从「固定廊道长局」替换为「按玩家真实路径画圈」。
   * update() 开头直接分流到 updateFree()，旧 update 主干一行未动 —— 因此
   * smoke / fullsuite / recall / impact / enemy-trial / loop 全部零回归。
   * 复用 damageEnemy / burst / emit / collideWalls / hurtPlayer / makeEnemy。 */
  var freeSeq = 0;

  function freeWalls() {
    return [
      { x: 0, y: 0, w: W, h: 18 }, { x: 0, y: H - 18, w: W, h: 18 },
      { x: 0, y: 0, w: 18, h: H }, { x: W - 18, y: 0, w: 18, h: H },
      { x: 250, y: 176, w: 92, h: 26 }, { x: 618, y: 398, w: 92, h: 26 },
      { x: 440, y: 268, w: 80, h: 64 }
    ];
  }
  function freeEnemy(x, y, pattern, stats) {
    var e = makeEnemy({ hp: stats.hp, damage: stats.damage, pattern: pattern,
                        type: '巡廊残影' }, false, 'teal', { x: x, y: y });
    e.mode = 'idle'; e.timer = 0.5 + rand(0.2, 0.9);
    e.lockX = 0; e.lockY = 1;
    e.freeId = 'f' + (++freeSeq);
    e.freeSpeed = stats.speed;
    return e;
  }
  function setupFreeRoom(s) {
    var f = s.free, FW = C.core.freewave, q = B.free;
    s.walls = freeWalls();
    s.roomIndex = f.roomInLayer;
    s.room = { name: '第 ' + f.layer + ' 层 · 第 ' + (f.roomInLayer + 1) + ' 间',
               shape: 'free', color_token: 'teal',
               path_hint: '按 E 定起点，绕一圈回到起点兑现；踩增幅格、避开滞涩格' };
    s.roomType = 'normal';
    var depth = (f.layer - 1) * q.roomsPerLayer + f.roomInLayer;
    var growth = q.enemyGrowth;
    var stats = { hp: q.enemyHp + depth * growth.hpPerRoom,
      damage: q.enemyDamage + Math.floor(depth * growth.damagePerRoom), speed: 1 + depth * growth.speedPerRoom };
    var n = 3 + f.roomInLayer + f.layer;
    s.enemies = [];
    for (var i = 0; i < n; i++) {
      var a = i * Math.PI * 2 / n;
      s.enemies.push(freeEnemy(480 + Math.cos(a) * 250, 300 + Math.sin(a) * 175,
        i % 3 === 0 ? 'charge' : (i % 3 === 1 ? 'chase' : 'ranged'), stats));
    }
    s.bullets = []; s.enemyBullets = []; s.exitActive = false;
    s.phase = 'playing';
    f.boss = false; f.wave = null;
    resetFreeWeaponFx(f);
    f.tiles = FW.tiles(f.seed + '-' + f.layer + '-' + f.roomInLayer);
    f.tileBuff = null; f.lastTile = null;
    FW.reset(f);
    s.closure = null; s.breakFlash = 0;
    s.transition = 0.45;
    /* M12：出生点必须落在自由房的可走区域。旧值 (480,300) 正好嵌在中央掩体
     * (440,268,80,64) 内，首帧会被 collideWalls 弹出 44px（probe-play.cjs §A）。 */
    s.player.x = 400; s.player.y = 300;
    s.player.vx = s.player.vy = 0;
    s.player.invuln = Math.max(s.player.invuln, 0.8);
    emit(s, 'roomEnter', { index: f.roomInLayer, room: s.room, roomType: 'normal',
                           total: B.free.roomsPerLayer, free: true, layer: f.layer });
  }
  function setupFreeBoss(s) {
    var f = s.free, FW = C.core.freewave, q = B.free;
    s.walls = freeWalls();
    s.roomIndex = B.free.roomsPerLayer;
    s.room = { name: '第 ' + f.layer + ' 层 · 巡廊者', shape: 'free', color_token: 'rust',
               path_hint: '按当前相位要求的圈型破盾，破盾后趁窗口输出' };
    s.roomType = 'normal'; s.bossPhase = 1;
    var level = f.layer - 1, growth = q.enemyGrowth;
    s.run.boss = { name: '巡廊者', hp: Math.round(q.bossHp * (1 + growth.bossHpPerLayer * level)),
                   damage: q.bossDamage + growth.bossDamagePerLayer * level, pattern: 'ranged' };
    var boss = makeEnemy({ hp: s.run.boss.hp, damage: s.run.boss.damage,
                           pattern: 'ranged', type: '巡廊者' }, true, 'rust', { x: 700, y: 300 });
    if (boss) {
      boss.r = 28; boss.guardOpen = 0; boss.shieldFlash = 0;
      boss.freeId = 'boss';
      boss.freeSpeed = 1 + growth.bossSpeedPerLayer * level;
      boss.patrol = { hub: 1, cursor: 0, phase: 1, route: null, warning: 0 };
      boss.shield = { state: 'closed', breaks: 0, charge: 0, flash: 0, reform: 0,
                      spec: FW.shieldSpec(0, s.perks) };
    }
    s.enemies = boss ? [boss] : [];
    s.bullets = []; s.enemyBullets = []; s.exitActive = false;
    s.phase = 'boss';
    f.boss = true; f.wave = null;
    resetFreeWeaponFx(f);
    FW.reset(f);
    s.closure = null; s.breakFlash = 0;
    s.player.x = 260; s.player.y = 300;
    s.player.vx = s.player.vy = 0;
    s.transition = 0.55;
    A('boss');
    emit(s, 'bossEnter', { boss: s.run.boss, phase: 1, free: true, layer: f.layer,
                           shield: boss ? boss.shield.spec : null });
  }
  function startFree(opts) {
    var FW = C.core.freewave, CH = C.core.chrono;
    var saved = opts.continueRun ? FW.load() : null;
    var seed = saved ? saved.seed : (opts.seed || uuid());
    loadMeta();
    var theme = C.theme.get(saved ? saved.theme : opts.theme);
    var run = {
      theme: theme.id,
      rooms: [{ name: '自由回廊', color_token: 'teal', path_hint: '' }],
      boss: { name: '巡廊者', hp: B.free.bossHp, damage: B.free.bossDamage, pattern: 'ranged' },
      summary: '自己选起点，用走过的路圈住敌人。', run_id: 'free_' + seed
    };
    state = createState(run, []);
    state.source = 'free';
    state.onEvent = opts.onEvent || null;
    state.breakFlash = 0; state.closure = null;
    state.dodgeFlash = 0; state.comboFlash = 0; state.comboTier = 0;
    state.chrono = CH.create();
    state.free = FW.create(seed);
    state.free.style = FW.getStyle(saved ? saved.style : opts.style).id;
    state.free.weapon = saved && saved.weapon ? (saved.weapon === 'blade' ? 'blade' : 'cannon') :
      (state.free.style === 'blade' ? 'blade' : 'cannon');
    if (saved) {
      state.free.layer = saved.layer;
      state.free.roomInLayer = saved.roomInLayer;
      state.free.continued = true;
      state.player.maxHp = saved.maxHp || 100;
      state.player.hp = Math.min(state.player.maxHp, Math.max(1, saved.hp || 1));
      state.shieldUsed = saved.shieldUsed === true;
      state.gold = saved.gold || 0;
      state.perks = Object.assign({}, saved.perks || {});
      state.pickCount = saved.pickCount || 0;
      state.kills = saved.kills || 0;
      state.elapsed = saved.elapsed || 0;
    } else FW.clearSave();
    syncFreeUnlocks(state);
    setupFreeRoom(state);
    A('start');
    emit(state, 'runStart', { free: true, style: state.free.style, layer: state.free.layer,
                              continued: !!saved, run: run, runIndex: state.free.layer });
    return state;
  }

  function syncFreeUnlocks(s) {
    /* 自由回廊的清房词条和局外解锁使用独立 ID。旧存档里缓存的局外技能以当前解锁为准。 */
    var perks = C.core.perks;
    var owned = new Set(meta.unlocked);
    var oldMaxHp = perks.derive(s).maxHp;
    perks.IDS.forEach(function (id) { if (!owned.has(id)) delete s.perks[id]; });
    var removedHp = oldMaxHp - perks.derive(s).maxHp;
    if (removedHp > 0) {
      s.player.maxHp = Math.max(1, s.player.maxHp - removedHp);
      s.player.hp = Math.min(s.player.hp, s.player.maxHp);
    }
    meta.unlocked.forEach(function (id) {
      if (!s.perks[id]) perks.add(s, id);
    });
  }

  function switchFreeWeapon() {
    var s = state;
    if (!s || !s.free || (s.phase !== 'playing' && s.phase !== 'boss')) return false;
    s.free.weapon = s.free.weapon === 'blade' ? 'cannon' : 'blade';
    s.free.bladeBuffer = 0;
    return true;
  }

  function freeBoss(s) {
    for (var i = 0; i < s.enemies.length; i++) {
      if (!s.enemies[i].dead && s.enemies[i].shield) return s.enemies[i];
    }
    return null;
  }
  function breakFreeShield(s, boss) {
    var sh = boss.shield, spec = sh.spec;
    sh.state = 'exposed'; sh.charge = 0; sh.flash = 1; sh.reform = 0;
    boss.guardOpen = spec.window; boss.shieldFlash = 0.35;
    s.shake = Math.max(s.shake, 20); s.breakFlash = 1;
    s.free.shieldBreaks = (s.free.shieldBreaks || 0) + 1;
    burst(s, boss.x, boss.y, '#E9A23B', 34, 330);
    burst(s, boss.x, boss.y, '#D9644B', 20, 250);
    A('clear'); A('boss');
    emit(s, 'bossShieldBreak', { phase: spec.phase, breaks: sh.breaks,
      window: spec.window, required: spec.required, requiredLabel: spec.requiredLabel });
  }
  function updateFreeShield(s, dt) {
    var boss = freeBoss(s), FW = C.core.freewave;
    if (!boss) return;
    var sh = boss.shield;
    sh.flash = Math.max(0, sh.flash - dt * 2.2);
    if (sh.state === 'exposed') {
      boss.guardOpen = Math.max(0, boss.guardOpen - dt);
      if (boss.guardOpen === 0) { sh.state = 'reforming'; sh.reform = 0;
        emit(s, 'bossShieldClose', { phase: sh.spec.phase }); }
    } else if (sh.state === 'reforming') {
      sh.reform = Math.min(1, sh.reform + dt / sh.spec.reformTime);
      if (sh.reform >= 1) {
        sh.breaks += 1; sh.spec = FW.shieldSpec(sh.breaks, s.perks);
        sh.state = 'closed'; sh.charge = 0; sh.reform = 0; sh.flash = 0.35;
        boss.guardOpen = 0;
        emit(s, 'bossShieldReform', { phase: sh.spec.phase, required: sh.spec.required,
          requiredLabel: sh.spec.requiredLabel, need: sh.spec.need, window: sh.spec.window });
      }
    }
  }
  function freeCombo(s, n) {
    s.combo = (s.combo || 0) + n; s.comboTimer = 1.5;
    var t = C.core.chrono.tier(s.combo);
    if (t > (s.comboTier || 0)) {
      s.comboTier = t; s.comboFlash = 1;
      /* ① 垫步连击：连段升段时沿当前朝向轻踏一步，接上下一刀。 */
      var step = B.free.mod.stepPx;
      if (step > 0) {
        var p = s.player, dx = Math.cos(p.angle || 0), dy = Math.sin(p.angle || 0);
        p.x += dx * step; p.y += dy * step;
        collideWalls(p, p.r);
      }
      emit(s, 'comboTier', { tier: t, combo: s.combo });
    }
  }
  /* ① 取消后摇：命中即清掉一部分剩余攻击冷却，连段越顺、顺锋层数越高清得越多。 */
  function freeCancel(s, weaponHit) {
    var m = B.free.mod;
    var tier = C.core.chrono.tier(s.combo || 0);
    var routeCut = weaponHit ? 0 : m.cdCutPerk * (s.perks.p_loop_cd || 0);
    var cut = m.cdCutBase + m.cdCutPerTier * tier + routeCut;
    s.player.fireCd = Math.max(0, s.player.fireCd * (1 - Math.min(0.8, cut)));
  }
  function onFreeClosed(s, closed) {
    var f = s.free, FW = C.core.freewave, CH = C.core.chrono;
    /* M13：连扫层数由「是否换圈型」决定，不再按闭环次数滚雪球。
     * report() 传 1 保持 M11 基础伤害语义，倍率统一由 craft.mul 给出，
     * 让换型 / 重复同型只有一处口径，HUD 与结算不会各说各话。 */
    var cr = closed.craft || FW.craft(f, closed.report);
    f.streak = cr.streak;
    f.streakTimer = B.free.streakWindow;
    f.closures += 1;
    var rep = FW.report(f, closed.report, 1);
    rep.streak = cr.streak; rep.nextMul = cr.mul; rep.mul = cr.mul;
    rep.switched = cr.switched; rep.effect = cr.effect;
    rep.effectLabel = cr.label; rep.pierce = cr.pierce;
    var damage = Math.round(rep.damage * cr.mul);
    rep.damage = damage;

    var boss = freeBoss(s);
    if (boss && boss.shield) {
      var sh = boss.shield, spec = sh.spec;
      if (sh.state === 'exposed') {
        if (damageEnemy(s, boss, Math.round(damage * spec.exposedWaveMul), true, 0)) applyHitPerks(s, boss);
        emit(s, 'bossShieldHit', { exposed: true });
      } else if (sh.state !== 'reforming') {
        var matched = FW.matchesShield(rep, spec.required);
        /* 大圈「破阵」：额外蓄势，让 10 秒的大绕在首领战里真的值。 */
        var bonus = cr.effect === 'breach' ? cr.bonus.bigCharge : 0;
        sh.charge += (matched ? 1 : spec.weakCharge) + bonus;
        boss.shieldFlash = matched ? 0.24 : 0.12;
        emit(s, 'bossShieldCharge', { matched: matched, required: spec.required,
          requiredLabel: spec.requiredLabel, charge: sh.charge, need: spec.need,
          craftBonus: bonus });
        if (sh.charge >= spec.need) breakFreeShield(s, boss);
      }
    }
    /* M13 圈型专属效果：小圈减 CD + 连段、中圈回血、大圈延长凝滞；
     * 折角圈作为附加穿透，让回扫波也能扫到贴着圈边的敌人。 */
    var p = s.player;
    if (cr.effect === 'quick') {
      p.fireCd = Math.max(0, p.fireCd * (1 - cr.bonus.smallCdCut));
      freeCombo(s, cr.bonus.smallCombo);
    } else if (cr.effect === 'mend') {
      p.hp = Math.min(p.maxHp, p.hp + cr.bonus.midHeal);
    }
    var rw = FW.loopRewards(s);
    if (rw.heal) p.hp = Math.min(p.maxHp, p.hp + rw.heal);
    if (rw.dash) p.dashCd = 0;
    f.goldPerKill = rw.goldPerKill;
    CH.stall(s.chrono);                 /* ① 兑现瞬间凝滞，玩家全速补刀 */
    /* M13 大圈「破阵」：把凝滞拉到 stallTime+bigStall。用 max 而非 +=，
     * 连续两圈大圈不会把凝滞无限叠上去；CH.stall() 的 max 语义保证
     * 随后波命中触发的短凝滞不会把它抹掉。 */
    if (cr.effect === 'breach')
      s.chrono.stall = Math.max(s.chrono.stall, B.chrono.stallTime + cr.bonus.bigStall);
    f.wave = FW.waveFrom(closed.poly, rep);
    if (cr.pierce) f.wave.reach = cr.bonus.bentReach;
    s.closure = { t: 1, loops: f.closures,
      report: Object.assign({}, rep, { path: closed.poly, lanes: [] }) };
    s.shake = Math.max(s.shake, 6); s.comboFlash = 1;
    A('recall');
    FW.reset(f);
    emit(s, 'loopClosed', { loops: f.closures, streak: cr.streak, heal: rw.heal,
      switched: cr.switched, mul: cr.mul, effectLabel: cr.label });
    emit(s, 'loopClosure', { loops: f.closures, tag: rep.tag, label: rep.label,
      length: rep.length, area: rep.area, lanes: [], corner: rep.bent,
      streak: cr.streak, nextMul: cr.mul, damage: damage, path: closed.poly,
      switched: cr.switched, effect: cr.effect, effectLabel: cr.label,
      pierce: cr.pierce });
    if (cr.switched) emit(s, 'craftSwitch', { streak: cr.streak, mul: cr.mul, label: rep.label });
  }

  function hitFreeEnemy(s, e, damage, crit, weaponAttack) {
    if (!damageEnemy(s, e, damage, crit, 0, !!weaponAttack)) return false;
    applyHitPerks(s, e);
    freeCombo(s, 1);
    if (!weaponAttack || !weaponAttack.recovered) {
      freeCancel(s, !!weaponAttack);
      if (weaponAttack) weaponAttack.recovered = true;
    }
    return true;
  }

  function resetFreeWeaponFx(f) {
    f.swing = null;
    f.bladeBuffer = 0;
    f.bladeContacts = [];
    f.bladeDirection = 1;
    f.cannonShot = null;
    f.cannonContacts = [];
    f.cannonContactSound = -Infinity;
    f.cannonSpreadDirection = 1;
  }

  function advanceFreeBlade(s, dt) {
    var f = s.free, sw = f.swing;
    if (!sw) return;
    var from = sw.progress;
    sw.age += dt;
    sw.progress = clamp((sw.age - sw.windup) / sw.sweep, 0, 1);
    if (sw.progress > from) {
      if (from === 0) A('bladeSlash');
      var p = s.player;
      sw.x = p.x; sw.y = p.y;
      var center = sw.angle + sw.direction * sw.halfArc * (from + sw.progress - 1);
      var halfStep = sw.halfArc * (sw.progress - from) + 0.001;
      var dx = Math.cos(center), dy = Math.sin(center);
      var contact = false, blocked = false;
      var tuning = B.free.bladeAction;
      var targets = [];
      s.enemies.forEach(function (e) {
        if (e.dead || sw.hit.has(e) || !C.core.impact.inSwing(s.walls, e, sw.x, sw.y, dx, dy, sw.range, halfStep)) return;
        var angle = Math.atan2(e.y - sw.y, e.x - sw.x);
        var offset = angle - sw.angle;
        targets.push({ enemy: e, angle: angle, order: sw.direction * Math.atan2(Math.sin(offset), Math.cos(offset)),
          distance: Math.hypot(e.x - sw.x, e.y - sw.y) });
      });
      targets.sort(function (a, b) { return a.order - b.order || a.distance - b.distance; });
      targets.forEach(function (target) {
        var e = target.enemy, angle = target.angle;
        if (e.dead) return;
        sw.hit.add(e);
        var damage = Math.max(1, Math.floor(sw.damage * Math.pow(tuning.followHitMul, sw.landed)));
        var landed = hitFreeEnemy(s, e, damage, sw.crit, sw);
        var strong = landed && (e.dead || e.isBoss || sw.crit);
        if (landed) {
          contact = true;
          if (sw.landed === 0) {
            A('bladeContact', strong);
            var heal = (s.perks.p_free_blade_heal || 0) * B.free.weaponPerks.bladeHeal;
            p.hp = Math.min(p.maxHp, p.hp + heal);
          }
          sw.landed++;
          if (!e.dead) {
            var distance = e.isBoss ? tuning.bossRecoil : strong ? tuning.heavyRecoil : tuning.recoil;
            e.bladeRecoil = { angle: angle, direction: sw.direction, distance: distance, life: tuning.recoilTime };
          }
        } else blocked = true;
        f.bladeContacts.push({ x: e.x - Math.cos(angle) * e.r * 0.6, y: e.y - Math.sin(angle) * e.r * 0.6,
          angle: angle, direction: sw.direction, kind: strong ? 'heavy' : (landed ? 'hit' : 'guard'),
          life: tuning.contactLife, max: tuning.contactLife });
      });
      if (!contact && blocked) A('bladeGuard');
    }
    if (sw.age >= sw.windup + sw.sweep + sw.recovery) f.swing = null;
  }

  function attackFree(s) {
    var p = s.player, f = s.free, q = B.free, bladeSpec = B.impact.blade;
    var blade = f.weapon === 'blade';
    var reachLevel = (s.perks.p_impact_reach || 0) + (s.perks.p_free_blade_reach || 0);
    var homing = !blade && s.perks.p_impact_homing > 0;
    var speed = homing ? q.mod.homingSpeed : BULLET_SPEED;
    var baseRange = blade ? bladeSpec.range + reachLevel * q.mod.reachWidth :
      speed * (homing ? q.mod.homingLife : 0.55);
    var tuning = q.weaponPerks;
    var baseDamage = blade ? q.bladeDamage + (s.perks.p_free_blade_damage || 0) * tuning.bladeDamage :
      BULLET_DMG * q.bulletMul + (s.perks.p_free_cannon_damage || 0) * tuning.cannonDamage;
    var atk = C.core.perks.on(s, 'attack', { damage: baseDamage, range: baseRange, crit: false });
    var damage = Math.max(1, Math.round(atk.damage * f.tileBuff.damage * C.core.chrono.buffDamage(s.chrono)));
    var speedLevel = (blade ? s.perks.p_free_blade_speed : s.perks.p_free_cannon_speed) || 0;
    var tempo = f.tileBuff.cd * (1 - C.core.chrono.buffCd(s.chrono)) * Math.pow(1 - tuning.speedCut, speedLevel);
    p.fireCd = (blade ? bladeSpec.cooldown : FIRE_CD) * tempo;
    if (blade) {
      var bladeAction = q.bladeAction;
      var halfArc = bladeSpec.halfArc + reachLevel * q.mod.bladeArcPerReach;
      f.swing = { age: 0, progress: 0, x: p.x, y: p.y, angle: p.angle, direction: f.bladeDirection,
        range: atk.range, halfArc: halfArc, damage: damage, crit: atk.crit, hit: new Set(), landed: 0, recovered: false,
        windup: bladeAction.windup * tempo, sweep: bladeAction.sweep * tempo, recovery: bladeAction.recovery * tempo };
      f.bladeDirection *= -1;
      f.bladeBuffer = 0;
      return;
    }
    f.swing = null;
    f.cannonShot = { age: 0, x: p.x, y: p.y, angle: p.angle };
    var spread = atk.multishot + (s.perks.p_free_cannon_spread || 0);
    var pierce = atk.pierce + (s.perks.p_free_cannon_pierce || 0);
    var range = atk.range * (1 + (s.perks.p_free_cannon_range || 0) * tuning.cannonRange);
    var spreadAngle = atk.spread * (1 - (s.perks.p_free_cannon_focus || 0) * tuning.cannonFocus);
    var suppress = 1 - (s.perks.p_free_cannon_suppress || 0) * tuning.cannonSuppress;
    var side = f.cannonSpreadDirection;
    if (spread % 2) f.cannonSpreadDirection *= -1;
    var volley = { recovered: false };
    for (var i = 0; i <= spread; i++) {
      var secondary = i > 0;
      var slot = Math.ceil(i / 2) * (i % 2 ? side : -side);
      var angle = p.angle + slot * spreadAngle;
      var ca = Math.cos(angle), sa = Math.sin(angle);
      s.bullets.push({ x: p.x + ca * 14, y: p.y + sa * 14, vx: ca * speed, vy: sa * speed,
        damage: secondary ? Math.max(1, Math.floor(damage * q.cannonAction.secondaryDamageMul)) : damage,
        life: range / speed, r: 4, color: '#E9A23B', secondary: secondary, suppress: secondary ? 1 : suppress,
        crit: atk.crit, pierce: pierce, hit: [], homing: homing, volley: volley });
    }
    A('cannonFire');
  }

  function cannonContact(s, b, e, landed) {
    var f = s.free, tuning = B.free.cannonAction;
    var angle = Math.atan2(b.vy, b.vx);
    f.cannonContacts.push({ x: b.x, y: b.y, angle: angle, guard: !landed,
      heavy: landed && (b.crit || e.dead), life: tuning.contactLife });
    if (s.elapsed - f.cannonContactSound >= tuning.hitSoundGap) {
      f.cannonContactSound = s.elapsed;
      A(landed ? 'cannonContact' : 'cannonGuard');
    }
  }

  function updateFree(s, dt, input) {
    var f = s.free, FW = C.core.freewave, CH = C.core.chrono, q = B.free;
    var p = s.player;
    dt = Math.min(dt, 0.05);
    if (s.phase === 'dead' || s.phase === 'won' || s.phase === 'perk') return s;
    if (f.weapon === 'blade' && input.attackPressed) f.bladeBuffer = q.bladeAction.inputBuffer;
    var d = C.core.perks.derive(s);
    s.elapsed += dt;
    CH.push(s.chrono, s.elapsed, p);
    CH.update(s.chrono, dt);
    var wdt = dt * CH.worldScale(s.chrono);   /* 世界缩放，玩家仍用 dt */
    s.shake = Math.max(0, s.shake - dt * 42);
    s.transition = Math.max(0, s.transition - dt);
    s.breakFlash = Math.max(0, s.breakFlash - dt * 1.7);
    s.dodgeFlash = Math.max(0, s.dodgeFlash - dt * 2.2);
    s.comboFlash = Math.max(0, s.comboFlash - dt * 1.8);
    if (s.closure && s.closure.t > 0) s.closure.t = Math.max(0, s.closure.t - dt * 1.35);
    f.bladeContacts = f.bladeContacts.filter(function (c) { c.life -= dt; return c.life > 0; });
    if (f.cannonShot && (f.cannonShot.age += dt) >= q.cannonAction.smokeTime) f.cannonShot = null;
    f.cannonContacts = f.cannonContacts.filter(function (c) { c.life -= dt; return c.life > 0; });
    s.particles = s.particles.filter(function (x) {
      x.life -= dt; x.x += x.vx * dt; x.y += x.vy * dt; return x.life > 0;
    });
    s.trail = s.trail.filter(function (x) { x.life -= dt; return x.life > 0; });
    s.damagePops = (s.damagePops || []).filter(function (x) { x.life -= dt; return x.life > 0; });
    if (s.combo || s.comboTimer) {
      s.comboTimer = (s.comboTimer || 0) - dt;
      if (s.comboTimer <= 0) { s.combo = 0; s.comboTimer = 0; s.comboTier = 0; }
    }
    /* ③ 地效：正负常驻，逐帧生效 */
    var tile = FW.tileAt(f.tiles, p.x, p.y);
    f.tileBuff = FW.tileBuff(tile);
    if (tile && f.lastTile !== tile) emit(s, 'tileEnter', { kind: tile.kind, label: tile.label });
    f.lastTile = tile;
    var tb = f.tileBuff;
    if (f.streakTimer > 0) {
      f.streakTimer = Math.max(0, f.streakTimer - dt);
      /* M13：窗口超时把圈型历史一并归零，下一圈重新起算换型连扫。 */
      if (f.streakTimer === 0) FW.decayCraft(f);
    }
    /* 输入 → 玩家移动（真实 dt） */
    var ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    var al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    p.invuln = Math.max(0, p.invuln - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (input.dash && p.dashCd <= 0 && p.dashTime <= 0) {
      var dx = ax, dy = ay;
      if (!ax && !ay) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
      p.dashX = dx; p.dashY = dy; p.dashTime = DASH_TIME;
      /* 自由回廊的基础冷却是 0.62 秒，沿用疾步对经典 820ms 基值的缩放。 */
      p.dashCd = 0.62 * (d.dashCd / 820);
      var dodge = CH.resolveDodge(s.chrono, true, s.perks);
      s.dodgeFlash = 1; A('dash');
      emit(s, 'perfectDodge', { kind: dodge ? dodge.kind : 'none',
        damage: dodge ? dodge.damage : 1 });
    }
    if (p.dashTime > 0) {
      p.dashTime -= dt; p.vx = p.dashX * DASH_SPEED; p.vy = p.dashY * DASH_SPEED;
      s.trail.push({ x: p.x, y: p.y, life: 0.24, max: 0.24 });
      applyDashPerks(s, dt);
    } else {
      var k = Math.min(1, dt * 13), sp = SPEED * tb.speed;
      p.vx += (ax * sp - p.vx) * k; p.vy += (ay * sp - p.vy) * k;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    collideWalls(p, p.r);
    if (input.aimX != null) {
      var tx0 = input.aimX - p.x, ty0 = input.aimY - p.y;
      if (Math.hypot(tx0, ty0) > 6) p.angle = Math.atan2(ty0, tx0);
    }
    /* ⑤-b 自由路径：E 定起点 → 逐帧采样 → 回到起点且面积达标才兑现 */
    if (input.arm && !f.armed) { FW.arm(f, p); emit(s, 'freeArm', { x: p.x, y: p.y }); }
    if (f.armed) FW.record(f, p);
    /* M13：每帧算一次实时圈型预估，渲染与 HUD 共用，避免两边各算一遍。 */
    f.live = FW.live(f);
    var closed = FW.close(f, p);
    if (closed && closed.type === 'closed') onFreeClosed(s, closed);
    else if (closed && closed.rejected === 'area') {
      /* M12：旧逻辑 reset 后 armed=false，玩家松开 E 就再也画不了下一圈
       * （probe-play.cjs §C：后续最大采样点恒为 0）。拒绝点必在起点 30px 内，
       * 直接以当前位置重设起点，玩家继续绕大一点即可，无需再按一次 E。 */
      emit(s, 'freeReject', { reason: 'area', area: Math.round(closed.area) });
      FW.reset(f); FW.arm(f, p);
    }
    advanceFreeBlade(s, dt);
    if ((input.fire || input.attackPressed || f.bladeBuffer > 0) && p.fireCd <= 0 &&
        (!f.swing || f.swing.progress === 1)) attackFree(s);
    f.bladeBuffer = Math.max(0, f.bladeBuffer - dt);
    s.bullets = s.bullets.filter(function (b) {
      b.life -= wdt;
      var hitList = b.hit || (b.hit = []);
      if (b.homing) {
        /* ⑧ 导引：子弹不再是直线射线，而是会朝最近敌人转向的投射物实体。 */
        var best = null, bd = Infinity;
        s.enemies.forEach(function (e) {
          if (e.dead || hitList.indexOf(e) !== -1) return;
          var dd = Math.hypot(e.x - b.x, e.y - b.y);
          if (dd < bd) { bd = dd; best = e; }
        });
        if (best) {
          var want = Math.atan2(best.y - b.y, best.x - b.x);
          var cur = Math.atan2(b.vy, b.vx);
          var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          var lim = q.mod.homingTurn * wdt;
          var na = cur + Math.max(-lim, Math.min(lim, diff));
          var sp = Math.hypot(b.vx, b.vy) || 1;
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      b.x += b.vx * wdt; b.y += b.vy * wdt;
      if (b.life <= 0) return false;
      for (var i = 0; i < s.enemies.length; i++) {
        var e = s.enemies[i];
        if (!e.dead && hitList.indexOf(e) === -1 && dist(b, e) < e.r + b.r) {
          var landed = hitFreeEnemy(s, e, b.damage, b.crit, b.volley || (b.volley = { recovered: false }));
          cannonContact(s, b, e, landed);
          if (!landed) return false;
          if (!e.dead && b.suppress < 1) e.cannonSlow = { factor: b.suppress, life: q.weaponPerks.cannonSuppressTime };
          hitList.push(e);
          if (b.pierce > 0) { b.pierce--; continue; }
          return false;
        }
      }
      return true;
    });
    /* 敌人 AI：② 影子延迟 + ① 世界凝滞 + ④ 冲锋预警 */
    s.enemies.forEach(function (e) {
      if (e.dead) return;
      e.flash = Math.max(0, (e.flash || 0) - wdt);
      e.dashCd = Math.max(0, (e.dashCd || 0) - wdt);
      e.satCd = Math.max(0, (e.satCd || 0) - wdt);
      e.slowTime = Math.max(0, (e.slowTime || 0) - wdt);
      if (e.cannonSlow && (e.cannonSlow.life -= wdt) <= 0) e.cannonSlow = null;
      if (e.bladeRecoil && (e.bladeRecoil.life -= dt) <= 0) e.bladeRecoil = null;
      var speedFactor = (e.freeSpeed || 1) * enemySpeedFactor(d, p, e);
      if (e.patrol) {
        e.x += Math.sin(s.elapsed * 0.8) * 34 * wdt * speedFactor;
        if (dist(e, p) < e.r + p.r) hurtPlayer(s, e, e.damage);
        return;
      }
      var target = CH.shadow(s.chrono, s.elapsed, false) || p;
      var tx = target.x - e.x, ty = target.y - e.y, len = Math.hypot(tx, ty) || 1;
      var nx = tx / len, ny = ty / len;
      if (e.pattern === 'charge') {
        e.timer = (e.timer || 0) - wdt;
        if (e.mode === 'idle' && e.timer <= 0) {
          e.mode = 'wind'; e.timer = 0.42; e.lockX = nx; e.lockY = ny;
          CH.armPerfect(s.chrono); emit(s, 'chargeWarning', { x: e.x, y: e.y });
        } else if (e.mode === 'wind' && e.timer <= 0) { e.mode = 'charge'; e.timer = 0.44; }
        else if (e.mode === 'charge' && e.timer <= 0) { e.mode = 'cool'; e.timer = 0.85; }
        else if (e.mode === 'cool' && e.timer <= 0) { e.mode = 'idle'; e.timer = 0.6 + rand(0.2, 0.8); }
        if (e.mode === 'charge') { e.vx = e.lockX * 425; e.vy = e.lockY * 425; }
        else { e.vx = 0; e.vy = 0; }
      } else if (e.pattern === 'ranged') {
        var want = 200, pull = len > want + 30 ? 1 : (len < want - 30 ? -1 : 0);
        e.vx = nx * 80 * pull; e.vy = ny * 80 * pull;
      } else { e.vx = nx * 100; e.vy = ny * 100; }
      pullTowardPlayer(d, p, e, 100);
      e.x += e.vx * wdt * speedFactor; e.y += e.vy * wdt * speedFactor;
      collideWalls(e, e.r);
      if (dist(e, p) < e.r + p.r) hurtPlayer(s, e, e.damage);
    });
    if (s.phase === 'dead') return s;
    updateSatellites(s, wdt, d);
    /* 回扫波：沿玩家路径逆向推进，只打圈内的敌人 */
    if (f.wave) {
      var info = FW.advanceWave(f.wave, wdt);
      var poly = f.wave.path.slice().reverse();
      /* 长锋：把「圈内」放宽到「圈内或贴边」，仍用同一套多边形几何工具。 */
      var reach = (s.perks.p_impact_reach || 0) * q.mod.reachWidth + (f.wave.reach || 0);
      s.enemies.forEach(function (e) {
        if (e.dead || f.wave.hit[e.freeId]) return;
        if (!FW.inside(poly, e) && (!reach || FW.distanceToPoly(poly, e) > reach)) return;
        f.wave.hit[e.freeId] = true;
        if (hitFreeEnemy(s, e, Math.round(f.wave.damage * tb.damage * CH.buffDamage(s.chrono)), true)) CH.stall(s.chrono);
      });
      if (info && info.done) f.wave = null;
    }
    if (f.boss) updateFreeShield(s, dt);
    s.enemies = s.enemies.filter(function (e) { return !e.dead; });
    if (s.phase === 'playing' && !s.enemies.length) {
      var hpBefore = p.hp;
      C.core.perks.on(s, 'roomClear', {});
      if (p.hp > hpBefore) emit(s, 'roomClear', { free: true, healed: p.hp - hpBefore });
      s.phase = 'perk'; s.perkPending = FW.offer(s);
      A('clear'); FW.save(s);
      emit(s, 'perkOffer', { choices: s.perkPending, nextIsBoss: f.roomInLayer + 1 >= q.roomsPerLayer, free: true, loop: true });
    } else if (s.phase === 'boss' && !s.enemies.length) {
      if (f.layer >= q.layers) { FW.clearSave(); finishRun(s, true); }
      else {
        f.layer += 1; f.roomInLayer = 0; f.streak = 0; f.streakTimer = 0;
        s.player.invuln = Math.max(s.player.invuln, 1.0);
        emit(s, 'loopLayer', { layer: f.layer, free: true });
        FW.save(s); setupFreeRoom(s);
      }
    }
    return s;
  }

  function startLoop(opts) {
    var LM = C.core.loop, B = C.core.perks.BALANCE.loop;
    var saved = opts.continueRun ? LM.load() : null;
    var seed = saved ? saved.seed : (opts.seed || uuid());
    loadMeta();
    var theme = C.theme.get(saved ? saved.theme : opts.theme);
    var run = {
      theme: theme.id,
      rooms: [{ name: '回廊', color_token: 'teal', path_hint: '' },
              { name: '回廊', color_token: 'teal', path_hint: '' },
              { name: '回廊', color_token: 'teal', path_hint: '' }],
      boss: { name: '巡廊者', hp: B.bossHp, damage: B.bossDamage, pattern: 'ranged' },
      summary: '沿回廊绕行，从另一侧回击。', run_id: 'loop_' + seed
    };
    state = createState(run, []);
    state.source = 'loop';
    state.onEvent = opts.onEvent || null;
    state.breakFlash = 0;                 /* M9：全屏破盾爆发信号，render 只读 */
    state.closure = null;                 /* M10：闭环兑现演出，render 只读 */
    state.loop = {
      plan: LM.plan(seed),
      layer: saved ? saved.layer : 1,
      roomInLayer: saved ? saved.roomInLayer : 0,
      streak: 0, streakTimer: 0, goldPerKill: 0, shieldBreaks: 0,
      continued: !!saved
    };
    if (saved) {
      state.player.maxHp = saved.maxHp || 100;
      state.player.hp = Math.min(state.player.maxHp, Math.max(1, saved.hp || 1));
      state.gold = saved.gold || 0;
      state.perks = Object.assign({}, saved.perks || {});
      state.pickCount = saved.pickCount || 0;
      state.kills = saved.kills || 0;
      state.elapsed = saved.elapsed || 0;
    } else {
      LM.clearSave();
    }
    setupLoopRoom(state);
    A('start');
    emit(state, 'runStart', { loop: true, layer: state.loop.layer,
                              continued: !!saved, run: run, runIndex: state.loop.layer });
    return state;
  }

  async function startRun(opts) {
    opts = opts || {};
    if (opts.free && C.core.freewave) return startFree(opts);
    if (opts.loop && C.core.loop) return startLoop(opts);
    if (opts.impactWeapon != null) return startImpact(opts);
    if (opts.prototype) return startRecall(opts);
    loadMeta();
    var idx = opts.runIndex || runIndex;
    var theme = C.theme.get(opts.theme);
    var input = {
      seed: uuid(),
      difficulty: clamp(1 + Math.floor(idx / 2), 1, 5),
      run_index: idx,
      theme: theme.id,
      theme_vocab: theme.vocab,
      unlocked: meta.unlocked.slice(),
      last_run: lastRun,
      perk_pool: C.core.perks.IDS.slice()
    };
    var res = await C.gen.buildRun(input);
    loadMeta();
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
  function damageEnemy(s, e, dmg, crit, chainDepth, localFeedback) {
    if (e.patrol && e.guardOpen <= 0) {
      e.shieldFlash = 0.12;
      return false;
    }
    e.hp -= dmg;
    /* 一簇弹体各自结算伤害，同一敌人的密集命中合并成一次反馈。 */
    var pop = e.hitPop;
    var merge = pop && s.elapsed - pop.at < 0.09;
    if (!localFeedback && crit && (!merge || !pop.crit)) {
      s.hitstop = Math.max(s.hitstop, 0.02);
      s.shake = Math.max(s.shake, 4);
    }
    if (merge) {
      pop.value += Math.round(dmg);
      pop.crit = pop.crit || !!crit;
    } else {
      e.flash = crit ? 0.10 : 0.07;
      burst(s, e.x, e.y, crit ? '#E9A23B' : e.color, crit ? 6 : 3, 150);
      if (!localFeedback && (s.lastHitSound == null || s.elapsed - s.lastHitSound >= 0.09)) {
        A('hit');
        s.lastHitSound = s.elapsed;
      }
      e.hitPop = { x: e.x, y: e.y - e.r, value: Math.round(dmg), crit: !!crit,
        at: s.elapsed, life: B.popLife, max: B.popLife };
      (s.damagePops || (s.damagePops = [])).push(e.hitPop);
    }
    /* T24-B Boss 两阶段：hp 跌破 50% 且仍存活 → 切 P2（弹幕/移速在 AI 处变化） */
    /* M9：长局首领用护盾相位承载节奏，屏蔽旧的「50% 血切 P2」，
     * 避免两个「阶段」概念同时弹幕/提示。经典模式（tests/fullsuite §B3）不受影响。 */
    if (e.isBoss && !s.loop && !s.free && (s.bossPhase || 1) === 1 && e.hp > 0 && e.hp <= e.maxHp * B.bossPhase2At) {
      s.bossPhase = 2;
      s.shake = Math.max(s.shake, 18);
      burst(s, e.x, e.y, '#E9A23B', 26, 300);
      A('boss');
      /* 阶段切换瞬间发一圈环形弹幕，给出明显的阶段变化（visual-dev 读 state.bossPhase） */
      for (var q = 0; q < 8; q++) {
        var pa = q * Math.PI / 4;
        s.enemyBullets.push({
          x: e.x, y: e.y, vx: Math.cos(pa) * 275, vy: Math.sin(pa) * 275,
          damage: e.damage, life: 2.6, r: 6
        });
      }
      emit(s, 'bossPhase', { phase: 2, boss: e });
    }
    if (e.hp <= 0) {
      e.dead = true;
      s.kills += 1;
      s.gold += 2;
      burst(s, e.x, e.y, e.color, 16, 260);
      A('kill');
      /* B3：击杀属重事件，给一次短定格（封顶），普通命中不触发 */
      if (!localFeedback) {
        s.hitstop = Math.min(s.hitstop + 0.03, 0.06);
        s.shake = Math.max(s.shake, 6);
      }
      var payload = C.core.perks.on(s, 'kill', { chainChance: 0, x: e.x, y: e.y });
      if (!chainDepth) {
        /* 连锁：概率/范围/伤害全由 perks 提供；缺省回退 v1 的 130 / 8 */
        if (Math.random() < payload.chainChance) {
          var cr = payload.chainRadius || 130;
          var cd = payload.chainDamage || 8;
          var nextDepth = payload.chainInfinite ? 0 : 1;
          s.enemies.forEach(function (o) {
            if (o !== e && !o.dead && dist(o, e) < cr) damageEnemy(s, o, cd, false, nextDepth, localFeedback);
          });
          burst(s, e.x, e.y, '#8E7CE8', 12, 220);
        }
        /* 击杀爆裂：伤害只作用一次（chainDepth=1 阻断递归爆裂） */
        if (payload.explodeDamage > 0) {
          var er = payload.fullscreenNova ? W * 2 : (payload.explodeRadius || 70);
          s.enemies.forEach(function (o) {
            if (o !== e && !o.dead && dist(o, e) < er) damageEnemy(s, o, payload.explodeDamage, false, 1, localFeedback);
          });
          burst(s, e.x, e.y, '#E9A23B', payload.fullscreenNova ? 40 : 14, 260);
        }
      }
      if (e.isBoss && !localFeedback) s.shake = 16;
    }
    return true;
  }

  function hurtPlayer(s, source, baseDamage) {
    var p = s.player;
    if (p.invuln > 0 || p.dashTime > 0 || s.phase === 'dead' || s.phase === 'won') return;
    var protectedSource = s.free && source && source.patrol && source.guardOpen <= 0;
    var payload = C.core.perks.on(s, 'hurt', { damage: baseDamage, source: protectedSource ? null : source,
      shielded: false, reflected: 0 });
    p.hp -= payload.damage;
    p.invuln = HURT_INVULN;
    /* 长局：被打断就失去「连续闭环」蓄势，绕圈节奏本身成为一种风险收益。 */
    if (s.loop) { s.loop.streak = 0; s.loop.streakTimer = 0; }
    if (s.free) { s.free.streak = 0; s.free.streakTimer = 0; }
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
    if (s.impact) {
      var g = s.impact;
      A(cleared ? 'clear' : 'death');
      emit(s, 'runEnd', {
        impact: true, combinations: g.combinations, cleared: cleared, seconds: s.elapsed, kills: s.kills,
        waves: cleared ? 2 : g.wave - 1, bestChain: g.bestChain,
        summary: C.core.impact.weapons[g.weapon].name +
          (g.perk ? ' · ' + C.core.perks.IMPACT[g.perk].name : '')
      });
      return;
    }
    if (s.prototype) {
      A(cleared ? 'clear' : 'death');
      emit(s, 'runEnd', {
        prototype: s.prototype, cleared: cleared, seconds: s.elapsed,
        kills: s.kills, rooms: cleared ? 2 : s.roomIndex,
        summary: cleared ? '击败了巡廊者。' : '回到廊口，再试一圈。'
      });
      return;
    }
    loadMeta();
    if (s.free) {
      A(cleared ? 'clear' : 'death');
      C.core.freewave.clearSave();
      var fEarned = C.core.perks.on(s, 'runEnd', { gold: Math.floor(s.gold / 2) + (cleared ? 60 : 0) }).gold;
      meta.gold += fEarned;
      if (cleared) meta.clears += 1;
      saveMeta();
      emit(s, 'runEnd', {
        loop: true, free: true, cleared: cleared, seconds: s.elapsed, kills: s.kills,
        layers: s.free.layer, gold: fEarned, loopGold: s.gold,
        rooms: (s.free.layer - 1) * B.free.roomsPerLayer + s.free.roomInLayer,
        loops: s.free.closures, breaks: s.free.shieldBreaks || 0,
        dodges: s.free.perfectDodges || 0,
        summary: cleared ? '三层自由回廊走通了。' :
          ('停在第 ' + s.free.layer + ' 层 · 你圈住的路还在。')
      });
      return;
    }
    if (s.loop) {
      A(cleared ? 'clear' : 'death');
      C.core.loop.clearSave();
      var earned = Math.floor(s.gold / 2) + (cleared ? 60 : 0);
      meta.gold += earned;
      if (cleared) meta.clears += 1;
      saveMeta();
      emit(s, 'runEnd', {
        loop: true, cleared: cleared, seconds: s.elapsed, kills: s.kills,
        layers: s.loop.layer, gold: earned, loopGold: s.gold,
        rooms: (s.loop.layer - 1) * B.loop.roomsPerLayer + s.loop.roomInLayer,
        loops: s.recall ? s.recall.loops : 0,
        breaks: s.loop.shieldBreaks || 0,
        summary: cleared ? '三层回廊走通了。' :
          ('停在第 ' + s.loop.layer + ' 层 · 回廊记得你走过的路。')
      });
      return;
    }
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

  function applyHitPerks(s, e) {
    var hk = C.core.perks.on(s, 'hit', { x: e.x, y: e.y });
    if (hk.lifesteal) s.player.hp = Math.min(s.player.maxHp, s.player.hp + hk.lifesteal);
    if (hk.frost) { e.slowTime = hk.frost.time; e.slowFactor = hk.frost.factor; }
  }

  function applyDashPerks(s, dt) {
    var p = s.player, dd = C.core.perks.on(s, 'dash', {});
    if (dd.dashDamage > 0) {
      s.enemies.forEach(function (e) {
        if (!e.dead && (e.dashCd || 0) <= 0 && dist(e, p) < e.r + p.r + 6) {
          e.dashCd = B.dashHitCd;
          damageEnemy(s, e, dd.dashDamage, false, 1);
        }
      });
    }
    if (dd.dashTrail) {
      s.dashTrailCd = (s.dashTrailCd || 0) - dt;
      if (s.dashTrailCd <= 0) {
        s.dashTrailCd = B.dashTrailCd;
        var damage = Math.round((dd.explodeDamage || 8) * B.dashTrailMul);
        s.enemies.forEach(function (e) {
          if (!e.dead && dist(e, p) < (dd.explodeRadius || 70)) damageEnemy(s, e, damage, false, 1);
        });
        burst(s, p.x, p.y, '#E9A23B', 8, 180);
      }
    }
  }

  function enemySpeedFactor(d, p, e) {
    var factor = d.enemySpeed;
    if (d.slowAuraRadius > 0 && dist(e, p) < d.slowAuraRadius) factor *= d.slowAuraFactor;
    var onHitSlow = e.slowTime > 0 ? (e.slowFactor || 1) : 1;
    if (e.cannonSlow) onHitSlow = Math.min(onHitSlow, e.cannonSlow.factor);
    return factor * onHitSlow;
  }

  function pullTowardPlayer(d, p, e, speed) {
    if (!d.synergy.vortexPull || d.satellites <= 0) return;
    var len = dist(e, p);
    if (len > 0 && len < d.satelliteRadius * 2) {
      e.vx += (p.x - e.x) / len * speed;
      e.vy += (p.y - e.y) / len * speed;
    }
  }

  function updateSatellites(s, dt, d) {
    var p = s.player;
    if (d.satellites <= 0) { s.satellites.length = 0; return; }
    s.satAngle += dt * d.satelliteSpeed;
    s.satellites.length = d.satellites;
    for (var i = 0; i < d.satellites; i++) {
      var angle = s.satAngle + i * (Math.PI * 2 / d.satellites);
      var sat = { x: p.x + Math.cos(angle) * d.satelliteRadius, y: p.y + Math.sin(angle) * d.satelliteRadius };
      s.satellites[i] = sat;
      s.enemies.forEach(function (e) {
        if (!e.dead && (e.satCd || 0) <= 0 && dist(sat, e) < e.r + 8) {
          e.satCd = B.satHitCd;
          damageEnemy(s, e, d.satelliteDmg, false, 1);
        }
      });
    }
  }

  function restart(opts) { return startRun(opts); }

  /* ---------- 词条选择 ---------- */
  function offerPerks(s) {
    var want = (s.room && s.room.perk_choices) || [];
    var pool = C.core.perks.IDS.filter(function (id) { return C.core.perks.canOffer(s, id); });
    var chosen = want.filter(function (id) { return pool.indexOf(id) !== -1; });
    /* T24-A：每 3 次选择插入一次「稀有/史诗三选一」，默认仍为二选一。
     * pickCount=已选次数；第 3/6/9 次对应 nth=(pickCount+1) 且 nth%3===0。
     * 返回数组长度可为 2 或 3（screens.js 由 ui-dev 适配）。 */
    var nth = (s.pickCount || 0) + 1;
    var special = nth % 3 === 0;
    var target = special ? 3 : 2;
    var fill = pool.slice();
    if (special) {
      var rank = C.core.perks.RARITY_RANK;
      fill.sort(function (a, b) {
        return (rank[C.core.perks.TABLE[b].rarity] || 0) - (rank[C.core.perks.TABLE[a].rarity] || 0);
      });
    }
    var i = 0;
    while (chosen.length < target && i < fill.length) {
      if (chosen.indexOf(fill[i]) === -1) chosen.push(fill[i]);
      i++;
    }
    return chosen.slice(0, target);
  }
  function choosePerk(id) {
    var s = state;
    if (!s || s.phase !== 'perk') return false;
    if (s.impact) return C.core.impact.choose(s, id, impactGame);
    if (s.prototype) {
      if (s.perkPending.indexOf(id) === -1) return false;
      s.recallPerk = id;
      s.perkPending = null;
      s.phase = 'playing';
      A('pick');
      return true;
    }
    if (s.free) {
      if (!s.perkPending || s.perkPending.indexOf(id) === -1) return false;
      var fdef = C.core.freewave.stylePerk(s, id);
      if (!fdef || (s.perks[id] || 0) >= fdef.max) return false;
      s.perks[id] = (s.perks[id] || 0) + 1;
      s.pickCount = (s.pickCount || 0) + 1;
      A('pick');
      emit(s, 'perkPicked', { id: id, def: fdef, free: true });
      s.perkPending = null; s.phase = 'transition';
      s.free.roomInLayer += 1;
      if (s.free.roomInLayer >= B.free.roomsPerLayer) setupFreeBoss(s);
      else {
        setupFreeRoom(s);
        /* 存档指向「下一间」，续玩不会重打刚清完的那间；首领房不写档，
         * 避免 load() 因 roomInLayer 越界而把存档判为损坏。 */
        C.core.freewave.save(s);
      }
      return true;
    }
    if (s.loop) {
      if (!s.perkPending || s.perkPending.indexOf(id) === -1) return false;
      var def = C.core.perks.LOOP[id];
      if (!def || (s.perks[id] || 0) >= (def.max || 2)) return false;
      s.perks[id] = (s.perks[id] || 0) + 1;
      s.pickCount = (s.pickCount || 0) + 1;
      A('pick');
      emit(s, 'perkPicked', { id: id, def: def, loop: true });
      s.perkPending = null;
      s.phase = 'transition';
      s.loop.roomInLayer += 1;
      if (s.loop.roomInLayer >= B.loop.roomsPerLayer) setupLoopBoss(s);
      else setupLoopRoom(s);
      return true;
    }
    if (!C.core.perks.add(s, id)) return false;
    s.pickCount = (s.pickCount || 0) + 1;      /* 驱动三选一节奏 */
    A('pick');
    emit(s, 'perkPicked', { id: id, def: C.core.perks.TABLE[id] });
    s.phase = 'transition';
    s.perkPending = null;
    if (s.roomIndex + 1 < s.run.rooms.length) enterRoom(s.roomIndex + 1);
    else enterBoss();
    return true;
  }

  /* 完成一次闭环：累积「连续回扫」蓄势、结算词条即时收益。
   * 蓄势计入下一圈的规则，因此波已在 record() 内用上一圈的 rules 生成。 */
  function onLoopClosed(s) {
    var B = C.core.perks.BALANCE.loop, L = s.loop;
    L.streak = Math.min(B.streakCap, (L.streak || 0) + 1);
    L.streakTimer = B.streakWindow;
    var rw = C.core.loop.loopRewards(s);
    if (rw.heal) s.player.hp = Math.min(s.player.maxHp, s.player.hp + rw.heal);
    if (rw.dash) s.player.dashCd = 0;
    L.goldPerKill = rw.goldPerKill;
    A('recall');
    s.shake = Math.max(s.shake, 4);
    /* M10：把这一圈的兑现结果算成可渲染数据。此前只有空壳 loopClosed，
     * 圈型 / 长度 / 连扫倍率 / 下圈回扫伤害全不可读，闭环瞬间也没有画面演出。
     * waveRules(s) 用更新后的 streak，因此 damage 与 nextMul 都指「下一圈」。 */
    var LM = C.core.loop;
    var rep = LM.closureReport(s.recall && s.recall.wave,
      s.recall && s.recall.layout, L.streak, LM.waveRules(s));
    s.closure = { t: 1, report: rep, loops: s.recall.loops };
    emit(s, 'loopClosed', { loops: s.recall.loops, streak: L.streak, heal: rw.heal });
    emit(s, 'loopClosure', {
      loops: s.recall.loops, tag: rep.tag, label: rep.label, length: rep.length,
      lanes: rep.lanes, corner: rep.corner, streak: rep.streak,
      nextMul: rep.nextMul, damage: rep.damage
    });
  }

  /* ---------- M9：巡廊首领多相位护盾 ----------
   * 状态机挂在 boss 实例（不是 state）：closed → exposed → reforming → closed(下一相位)。
   * guardOpen > 0 仍表示「可被伤害」，因此 damageEnemy / 子弹削弱 / HUD 判定
   * 全部无需改动；差别是：闭合时回扫只削「护盾蓄势」而不磨血，只有破盾后的
   * 窗口才是真输出，且每个相位要求不同圈型，逼玩家在战斗中改走法。 */
  function loopBoss(s) {
    for (var i = 0; i < s.enemies.length; i++) {
      if (!s.enemies[i].dead && s.enemies[i].patrol && s.enemies[i].shield) return s.enemies[i];
    }
    return null;
  }

  function breakShield(s, boss) {
    var sh = boss.shield, spec = sh.spec;
    sh.state = 'exposed';
    sh.charge = 0;
    sh.flash = 1;
    sh.reform = 0;
    boss.guardOpen = spec.window;
    boss.shieldFlash = 0.35;
    s.shake = Math.max(s.shake, 20);
    s.breakFlash = 1;                 /* 全屏爆发信号，drawBreakBurst 消费 */
    s.loop.shieldBreaks = (s.loop.shieldBreaks || 0) + 1;
    burst(s, boss.x, boss.y, '#E9A23B', 34, 330);
    burst(s, boss.x, boss.y, '#D9644B', 20, 250);
    A('clear'); A('boss');
    emit(s, 'bossShieldBreak', {
      phase: spec.phase, breaks: sh.breaks, window: spec.window,
      required: spec.required, requiredLabel: spec.requiredLabel,
      next: spec.phase + 1
    });
  }

  function onWaveHitLoopBoss(s, boss, wave, damage) {
    var sh = boss.shield, spec = sh.spec, LM = C.core.loop;
    if (sh.state === 'reforming') {
      boss.shieldFlash = 0.18;       /* 重构中 immune，只给弹开反馈 */
      return;
    }
    if (sh.state === 'exposed') {
      /* 窗口内继续绕圈：回扫吃加成，边跑边打比站桩更划算。 */
      damageEnemy(s, boss, Math.round(damage * spec.exposedWaveMul), false, 1);
      if (s.loop.goldPerKill && boss.dead) s.gold += s.loop.goldPerKill;
      emit(s, 'bossShieldHit', { exposed: true });
      return;
    }
    var tags = LM.waveTags(wave, s.recall.layout);
    var matched = LM.matchesShield(tags, spec.required);
    sh.charge += matched ? 1 : spec.weakCharge;
    boss.shieldFlash = matched ? 0.24 : 0.12;
    emit(s, 'bossShieldCharge', {
      matched: matched, required: spec.required, requiredLabel: spec.requiredLabel,
      charge: sh.charge, need: spec.need, tags: tags
    });
    if (sh.charge >= spec.need) breakShield(s, boss);
  }

  function updateLoopShield(s, dt) {
    var boss = loopBoss(s);
    if (!boss) return;
    var sh = boss.shield;
    sh.flash = Math.max(0, sh.flash - dt * 2.2);
    if (sh.state === 'exposed') {
      boss.guardOpen = Math.max(0, boss.guardOpen - dt);
      if (boss.guardOpen === 0) {
        sh.state = 'reforming';
        sh.reform = 0;
        emit(s, 'bossShieldClose', { phase: sh.spec.phase });
      }
    } else if (sh.state === 'reforming') {
      sh.reform = Math.min(1, sh.reform + dt / sh.spec.reformTime);
      if (sh.reform >= 1) {
        sh.breaks += 1;
        sh.spec = C.core.loop.shieldSpec(sh.breaks, s.perks);
        sh.state = 'closed';
        sh.charge = 0;
        sh.reform = 0;
        sh.flash = 0.35;
        boss.guardOpen = 0;
        emit(s, 'bossShieldReform', {
          phase: sh.spec.phase, required: sh.spec.required,
          requiredLabel: sh.spec.requiredLabel, need: sh.spec.need,
          window: sh.spec.window
        });
      }
    }
  }

  /* ---------- 每帧更新 ---------- */
  function update(dt, input) {
    var s = state;
    if (s && s.free) return updateFree(s, dt, input);
    if (!s) return null;
    dt = Math.min(dt, 0.05);
    if ((s.prototype || s.impact) && dt <= 0) return s;
    if (s.impact && s.phase === 'playing' && input.attackPressed) s.impact.buffer = B.impact.inputBuffer;

    if (s.hitstop > 0) {
      s.hitstop -= dt;
      /* B2：定格期间玩家计时器照常推进。此前 hitstop>0 直接 return，
       * dashCd / fireCd / invuln 全部停摆，密集命中下冲刺冷却看似永远不刷新。 */
      if (s.player) {
        s.player.invuln = Math.max(0, s.player.invuln - dt);
        s.player.fireCd = Math.max(0, s.player.fireCd - dt);
        s.player.dashCd = Math.max(0, s.player.dashCd - dt);
      }
      return s;
    }
    s.shake = Math.max(0, s.shake - dt * 42);
    s.transition = Math.max(0, s.transition - dt);
    if (s.breakFlash > 0) s.breakFlash = Math.max(0, s.breakFlash - dt * 1.7);
    if (s.closure && s.closure.t > 0) s.closure.t = Math.max(0, s.closure.t - dt * 1.35);

    s.particles = s.particles.filter(function (p) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      return p.life > 0;
    });
    s.trail = s.trail.filter(function (p) { p.life -= dt; return p.life > 0; });
    /* C5 伤害飘字：engine 每帧衰减 life，render 只读 */
    if (s.damagePops) {
      s.damagePops = s.damagePops.filter(function (q) { q.life -= dt; return q.life > 0; });
    }
    /* C5 连击：超过 1.5s 未命中清零（缺省字段时整段跳过，行为等同 M1） */
    if (s.combo || s.comboTimer) {
      s.comboTimer = (s.comboTimer || 0) - dt;
      if (s.comboTimer <= 0) { s.combo = 0; s.comboTimer = 0; }
    }

    if (s.phase === 'dead' || s.phase === 'won' || s.phase === 'perk') return s;

    s.elapsed += dt;
    var p = s.player;
    var d = C.core.perks.derive(s);
    var loopRules = s.loop ? C.core.loop.waveRules(s) : null;
    if (s.loop && s.loop.streakTimer > 0) {
      s.loop.streakTimer = Math.max(0, s.loop.streakTimer - dt);
      if (s.loop.streakTimer === 0) s.loop.streak = 0;
    }
    if (s.loop && s.phase === 'boss') updateLoopShield(s, dt);
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
      p.dashCd = d.dashCd / 1000;
      A('dash');
      s.shake = Math.max(s.shake, 4);
      emit(s, 'dash', {});
    }

    if (p.dashTime > 0) {
      p.dashTime -= dt;
      p.vx = p.dashX * DASH_SPEED;
      p.vy = p.dashY * DASH_SPEED;
      s.trail.push({ x: p.x, y: p.y, life: 0.24, max: 0.24 });
      applyDashPerks(s, dt);
    } else {
      var k = Math.min(1, dt * 13);
      p.vx += (ax * SPEED - p.vx) * k;
      p.vy += (ay * SPEED - p.vy) * k;
    }
    if (s.recall || s.impact) {
      // 冲刺也逐段经过廊口和分界，使用碰撞结算后的位置记录。
      var steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / (p.r / 2)));
      for (var step = 0; step < steps; step++) {
        p.x += p.vx * dt / steps;
        p.y += p.vy * dt / steps;
        collideWalls(p, p.r);
        if (s.recall && C.core.recall.record(s.recall, p, loopRules || s.recallPerk)) {
          if (s.loop) onLoopClosed(s);
          else { A('recall'); s.shake = Math.max(s.shake, 4); }
        }
      }
    } else {
      p.x += p.vx * dt; p.y += p.vy * dt;
      collideWalls(p, p.r);
    }

    /* 瞄准与射击 */
    if (input.aimX != null) {
      var tx = input.aimX - p.x, ty = input.aimY - p.y;
      if (Math.hypot(tx, ty) > 6) p.angle = Math.atan2(ty, tx);
    }
    if (s.impact) {
      C.core.impact.update(s, dt, input, impactGame);
      return s;
    }
    if (input.fire && p.fireCd <= 0) {
      var atk = C.core.perks.on(s, 'attack', { damage: BULLET_DMG, range: BULLET_RANGE, crit: false });
      /* T24-B 多重射击：shots=1 时与 v1 完全一致；pierce/hit 为可选子弹字段 */
      var shots = 1 + (atk.multishot || 0);
      var spread = atk.spread || 0;
      for (var m = 0; m < shots; m++) {
        var ang = p.angle + (m - (shots - 1) / 2) * spread;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        s.bullets.push({
          x: p.x + ca * (p.r + 8), y: p.y + sa * (p.r + 8),
          vx: ca * BULLET_SPEED, vy: sa * BULLET_SPEED,
          damage: atk.damage, life: atk.range / BULLET_SPEED, crit: atk.crit,
          pierce: atk.pierce || 0, hit: []
        });
      }
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
      var hitList = b.hit || (b.hit = []);
      for (var i = 0; i < s.enemies.length; i++) {
        var e = s.enemies[i];
        if (!e.dead && hitList.indexOf(e) === -1 && dist(b, e) < e.r + 5) {
          var mult = (e.isBoss && s.run.boss.weakness_perk && s.perks[s.run.boss.weakness_perk]) ? 1.35 : 1;
          /* 长局里射击退为牵制：只有护盾打开的首领窗口能打出全额，
           * 逼玩家用「绕一圈」的回扫作为主要输出。 */
          var shot = b.damage;
          if (s.loop) {
            var guarded = e.patrol && e.guardOpen > 0;
            shot = b.damage * (guarded ? 1 : C.core.perks.BALANCE.loop.bulletMul);
          }
          if (!damageEnemy(s, e, Math.max(1, Math.round(shot * mult)), b.crit, 0)) return false;
          /* C5 连击：仅玩家子弹命中累积，刷新 1.5s 窗口 */
          s.combo = (s.combo || 0) + 1;
          s.comboTimer = B.comboWindow;
          applyHitPerks(s, e);
          hitList.push(e);
          /* 贯穿：仍有穿透次数则继续飞（可同帧命中后续敌人），否则子弹消失 */
          if (b.pierce > 0) { b.pierce -= 1; continue; }
          return false;
        }
      }
      return true;
    });

    /* 敌人 AI */
    var inBossP2 = (s.bossPhase || 1) === 2;
    s.enemies.forEach(function (e) {
      if (e.dead) return;
      e.flash = Math.max(0, e.flash - dt);
      e.touchCd = Math.max(0, e.touchCd - dt);
      e.dashCd = Math.max(0, (e.dashCd || 0) - dt);   /* 掠影命中冷却 */
      e.satCd = Math.max(0, (e.satCd || 0) - dt);     /* 卫星命中冷却 */
      e.slowTime = Math.max(0, (e.slowTime || 0) - dt); /* 霜击减速剩余 */
      e.timer -= dt;
      var toX = p.x - e.x, toY = p.y - e.y;
      var len = Math.hypot(toX, toY) || 1;
      var nx = toX / len, ny = toY / len;
      var sp = (e.isBoss ? 96 : 118) * enemySpeedFactor(d, p, e);
      if (e.isBoss && inBossP2) sp *= B.bossPhase2Speed;

      if (e.pattern === 'chase') {
        moveToward(e, s.recall ? C.core.recall.chaseTarget(e, p, s.recall) : enemyWaypoint(s, e, p), sp, dt);
      } else if (e.pattern === 'orbit') {
        e.angle += dt * (e.isBoss ? 1.1 : 1.6);
        var targetR = e.isBoss ? 190 : 132;
        var wantX = p.x + Math.cos(e.angle) * targetR;
        var wantY = p.y + Math.sin(e.angle) * targetR;
        e.vx = (wantX - e.x) * 2.4; e.vy = (wantY - e.y) * 2.4;
        if (!s.recall && !clearPath(e.x, e.y, e.x + e.vx * 0.10, e.y + e.vy * 0.10, e.r)) {
          moveToward(e, enemyWaypoint(s, e, p), sp, dt);
        }
      } else if (e.pattern === 'charge') {
        if (!s.recall && e.mode === 'idle' && !clearPath(e.x, e.y, p.x, p.y, e.r)) {
          moveToward(e, enemyWaypoint(s, e, p), sp * 0.75, dt);
        } else {
          if (e.mode === 'idle' && e.timer <= 0) { e.mode = 'wind'; e.timer = 0.42; e.lockX = nx; e.lockY = ny; }
          else if (e.mode === 'wind' && e.timer <= 0) { e.mode = 'charge'; e.timer = 0.44; }
          else if (e.mode === 'charge' && e.timer <= 0) { e.mode = 'cool'; e.timer = 0.85; }
          else if (e.mode === 'cool' && e.timer <= 0) { e.mode = 'idle'; e.timer = rand(0.5, 1.1); }
          if (e.mode === 'charge') { e.vx = e.lockX * sp * 3.6; e.vy = e.lockY * sp * 3.6; }
          else if (e.mode === 'wind') { e.vx = -nx * 24; e.vy = -ny * 24; }
          else { e.vx *= 0.9; e.vy *= 0.9; }
        }
      } else if (e.pattern === 'ranged') {
        var want = e.isBoss ? 250 : 215;
        var pull = len > want + 30 ? 1 : (len < want - 30 ? -1 : 0);
        e.vx = nx * sp * 0.7 * pull + Math.sin(e.angle += dt * 1.3) * 18;
        e.vy = ny * sp * 0.7 * pull + Math.cos(e.angle) * 18;
        if (e.patrol) {
          e.guardOpen = Math.max(0, e.guardOpen - dt);
          e.shieldFlash = Math.max(0, e.shieldFlash - dt);
          var shieldMul = (e.shield && e.shield.spec) ? e.shield.spec.speedMul : 1;
          var patrolSpeed = (s.loop ? B.loop.patrolSpeed : B.recall.patrolSpeed) *
            (inBossP2 ? B.bossPhase2Speed : 1) * shieldMul;
          var pos = C.core.recall.advancePatrol(e, dt, patrolSpeed,
            inBossP2 ? 2 : 1, s.recall);
          e.vx = (pos.x - e.x) / dt; e.vy = (pos.y - e.y) / dt;
        }
        var canShoot = !!s.recall || clearPath(e.x, e.y, p.x, p.y, 6);
        if (!canShoot) moveToward(e, enemyWaypoint(s, e, p), sp * 0.7, dt);
        /* M9：破盾窗口与重构期间首领停火，把这段时间真正让给玩家输出。 */
        var shieldHold = e.shield && e.shield.state !== 'closed';
        if (e.timer <= 0 && canShoot && !shieldHold) {
          e.timer = e.isBoss ? (inBossP2 ? B.bossPhase2Cd : 1.15) : rand(1.4, 2.1);
          var bl = Math.hypot(toX, toY) || 1;
          s.enemyBullets.push({
            x: e.x, y: e.y, vx: (toX / bl) * 275, vy: (toY / bl) * 275,
            damage: e.damage, life: 2.6, r: 6
          });
          if (e.isBoss) {
            /* T24-B Boss P2：弹幕加密（更短间隔 + 更多散射角） */
            var offs = inBossP2 ? [-0.55, -0.28, 0.28, 0.55] : [-0.28, 0.28];
            offs.forEach(function (off) {
              var a = Math.atan2(toY, toX) + off;
              s.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 275, vy: Math.sin(a) * 275, damage: e.damage, life: 2.6, r: 6 });
            });
          }
        }
      } else { /* static → B4 固定炮台：原地驻守，但周期性向玩家发弹，
                 * 消除「敌怪呆在原地且毫无威胁」的观感；伤害沿用 e.damage。 */
        e.vx = 0; e.vy = 0;
        e.angle = Math.atan2(toY, toX);
        if (e.timer <= 0) {
          e.timer = rand(1.5, 2.3);
          var bl = Math.hypot(toX, toY) || 1;
          s.enemyBullets.push({
            x: e.x, y: e.y, vx: (toX / bl) * 250, vy: (toY / bl) * 250,
            damage: e.damage, life: 2.6, r: 6
          });
        }
      }

      pullTowardPlayer(d, p, e, sp);
      e.x += e.vx * dt; e.y += e.vy * dt;
      collideWalls(e, e.r);
      if (dist(e, p) < e.r + p.r && e.touchCd <= 0) {
        e.touchCd = 0.55;
        hurtPlayer(s, e, e.damage);
      }
    });

    if (s.recall && s.recall.wave && s.phase !== 'dead') {
      var loopMode = !!s.loop;
      var guardWindow = loopMode ? B.loop.guardWindow : B.recall.guardWindow;
      C.core.recall.advanceWave(s.recall, dt, p, s.enemies, function (enemy, damage) {
        /* M9：长局巡廊首领走多相位护盾；闭合时回扫削蓄势不磨血，
         * 暴露时回扫吃加成。旧原型仍走原来的「一刀开窗」逻辑。 */
        if (loopMode && enemy.patrol && enemy.shield) {
          onWaveHitLoopBoss(s, enemy, s.recall.wave, damage);
          return;
        }
        if (enemy.patrol) {
          enemy.guardOpen = guardWindow;
          A('clear');
          emit(s, 'loopShieldOpen', { window: guardWindow });
        }
        /* 回扫命中巡行首领是破盾 + 一次更重的输出；普通敌人为常规波伤害。 */
        var dealt = (loopMode && enemy.isBoss) ? Math.round(damage * 1.5) : damage;
        damageEnemy(s, enemy, dealt, false, 1);
        if (enemy.dead && loopMode && s.loop.goldPerKill) s.gold += s.loop.goldPerKill;
      });
    }

    updateSatellites(s, dt, d);

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
        if (s.loop && s.loop.layer < B.loop.layers) { advanceLoopLayer(s); return s; }
        finishRun(s, true);
        return s;
      }
      var rc = C.core.perks.on(s, 'roomClear', { healed: 0 });
      if (!s.prototype) s.gold += 12;
      A('clear');
      emit(s, 'roomClear', { healed: rc.healed, hint: s.room.path_hint, index: s.roomIndex });
    }
    if (s.exitActive && s.phase !== 'perk' && s.phase !== 'dead' && s.phase !== 'won') {
      var exit = { x: W - 74, y: s.recall ? s.recall.layout.hub[1].y : H / 2 };
      if (dist(p, exit) < EXIT_R + p.r) {
        if (s.prototype) {
          enterBoss();
          return s;
        }
        s.phase = 'perk';
        s.perkPending = s.loop ? C.core.loop.offer(s) : offerPerks(s);
        A('ui');
        emit(s, 'perkOffer', {
          choices: s.perkPending, loop: !!s.loop,
          nextIsBoss: s.loop ? (s.loop.roomInLayer + 1 >= B.loop.roomsPerLayer)
                             : (s.roomIndex + 1 >= s.run.rooms.length)
        });
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
    startRun: startRun, restart: restart, update: update, switchFreeWeapon: switchFreeWeapon,
    choosePerk: choosePerk, offerPerks: offerPerks,
    getState: getState, getMeta: getMeta, getLastRun: getLastRun,
    loadMeta: loadMeta, unlock: unlock, resetUnlocks: resetUnlocks, UNLOCK_COST: UNLOCK_COST, setOnEvent: setOnEvent,
    uuid: uuid
  };
})(window.Corridor = window.Corridor || {});
