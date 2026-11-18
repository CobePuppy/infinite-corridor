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
  /* B1：刷怪点统一校验。此前 40 次随机只查 hitsWall()，且兜底坐标 (691,300)
   * 完全不校验，随机区还包含画布中心 —— 敌人可能刷在墙里 / 玩家脸上，
   * 表现为「刷到中心、偶尔清不掉场」的死档。现在所有返回点都过同一套校验：
   * 边界 / 墙体 / 中心禁区 / 与玩家的最小安全距离。 */
  var SPAWN_CENTER_GUARD = 120;   // 画布中心禁区半径
  var SPAWN_PLAYER_GUARD = 170;   // 与玩家的最小出生距离
  function spawnValid(x, y) {
    if (x < T + ENEMY_R + 4 || x > W - T - ENEMY_R - 4 ||
        y < T + ENEMY_R + 4 || y > H - T - ENEMY_R - 4) return false;
    if (hitsWall(x, y, ENEMY_R + 6)) return false;
    var cx = W / 2, cy = H / 2;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < SPAWN_CENTER_GUARD * SPAWN_CENTER_GUARD) return false;
    var p = state && state.player;
    if (p) {
      var dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < SPAWN_PLAYER_GUARD * SPAWN_PLAYER_GUARD) return false;
    }
    return true;
  }
  function spawnPoint() {
    for (var i = 0; i < 48; i++) {
      var p = { x: rand(W * 0.42, W * 0.86), y: rand(70, H - 70) };
      if (spawnValid(p.x, p.y)) return p;
    }
    /* 随机失败 → 固定候选点扫描（右侧 / 上下 / 中部），同样逐个过校验 */
    var fx = [0.72, 0.72, 0.82, 0.60, 0.60, 0.88, 0.88, 0.50, 0.50, 0.44];
    var fy = [0.25, 0.75, 0.50, 0.20, 0.80, 0.32, 0.68, 0.16, 0.84, 0.50];
    for (var j = 0; j < fx.length; j++) {
      var q = { x: W * fx[j], y: H * fy[j] };
      if (spawnValid(q.x, q.y)) return q;
    }
    /* 网格兜底：整片可刷区域逐格找第一个合法点，绝不返回未校验坐标 */
    for (var gy = 80; gy <= H - 80; gy += 36) {
      for (var gx = W * 0.42; gx <= W * 0.86; gx += 36) {
        if (spawnValid(gx, gy)) return { x: gx, y: gy };
      }
    }
    return { x: W * 0.72, y: H * 0.25 };
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
    var p = position || spawnPoint();
    var r = isBoss ? 34 : ENEMY_R;
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
        for (var k = 0; k < c.count; k++) s.enemies.push(makeEnemy(shaped, false, room.color_token));
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
    } else s.enemies = [makeEnemy(bossSpec, true, s.room.color_token)];
    s.bullets = [];
    s.enemyBullets = [];
    s.exitActive = false;
    s.phase = 'boss';
    s.player.x = 92; s.player.y = H / 2;
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
    var room = { name: '接力直廊', color_token: 'teal' };
    var run = { theme: C.theme.get(opts.theme).id, rooms: [room] };
    state = createState(run, []);
    state.room = room;
    state.walls = border().concat(rules.walls);
    if (opts.impactCombinations) state.walls.push(rules.shortWall);
    state.transition = 0;
    state.onEvent = opts.onEvent || null;
    rules.start(state, weapon, !!opts.impactCombinations, impactGame);
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

  async function startRun(opts) {
    opts = opts || {};
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
    if (e.patrol && e.guardOpen <= 0) {
      e.shieldFlash = 0.12;
      return false;
    }
    e.hp -= dmg;
    e.flash = 0.12;
    burst(s, e.x, e.y, crit ? '#E9A23B' : e.color, crit ? 9 : 5, 150);
    A('hit');
    /* B3：普通命中不再触发时间定格。此前每颗子弹都写 0.028s，配合 update()
     * 的 hitstop 早退，密集射击时画面一格一格卡、且所有计时器停摆（B2 同源）。
     * 定格只留给暴击 / 击杀等重事件并封顶；普通命中只保留轻微震屏与粒子。 */
    if (crit) {
      s.hitstop = Math.min(s.hitstop + 0.02, 0.05);
      s.shake = Math.max(s.shake, 5);
    } else {
      s.shake = Math.max(s.shake, 1.6);
    }
    /* C5 伤害飘字：engine 产出、render 只读；每帧由 update 衰减 life */
    if (s.damagePops) {
      s.damagePops.push({
        x: e.x, y: e.y - e.r, value: Math.round(dmg), crit: !!crit,
        life: B.popLife, max: B.popLife
      });
    }
    /* T24-B Boss 两阶段：hp 跌破 50% 且仍存活 → 切 P2（弹幕/移速在 AI 处变化） */
    if (e.isBoss && (s.bossPhase || 1) === 1 && e.hp > 0 && e.hp <= e.maxHp * B.bossPhase2At) {
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
      s.hitstop = Math.min(s.hitstop + 0.03, 0.06);
      s.shake = Math.max(s.shake, 6);
      var payload = C.core.perks.on(s, 'kill', { chainChance: 0, x: e.x, y: e.y });
      if (!chainDepth) {
        /* 连锁：概率/范围/伤害全由 perks 提供；缺省回退 v1 的 130 / 8 */
        if (Math.random() < payload.chainChance) {
          var cr = payload.chainRadius || 130;
          var cd = payload.chainDamage || 8;
          var nextDepth = payload.chainInfinite ? 0 : 1;
          s.enemies.forEach(function (o) {
            if (o !== e && !o.dead && dist(o, e) < cr) damageEnemy(s, o, cd, false, nextDepth);
          });
          burst(s, e.x, e.y, '#8E7CE8', 12, 220);
        }
        /* 击杀爆裂：伤害只作用一次（chainDepth=1 阻断递归爆裂） */
        if (payload.explodeDamage > 0) {
          var er = payload.fullscreenNova ? W * 2 : (payload.explodeRadius || 70);
          s.enemies.forEach(function (o) {
            if (o !== e && !o.dead && dist(o, e) < er) damageEnemy(s, o, payload.explodeDamage, false, 1);
          });
          burst(s, e.x, e.y, '#E9A23B', payload.fullscreenNova ? 40 : 14, 260);
        }
      }
      if (e.isBoss) s.shake = 16;
    }
    return true;
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

  /* ---------- 每帧更新 ---------- */
  function update(dt, input) {
    var s = state;
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
      p.dashCd = s.impact ? d.dashCd / 1000 : d.dashCd;
      A('dash');
      s.shake = Math.max(s.shake, 4);
      emit(s, 'dash', {});
    }

    if (p.dashTime > 0) {
      p.dashTime -= dt;
      p.vx = p.dashX * DASH_SPEED;
      p.vy = p.dashY * DASH_SPEED;
      s.trail.push({ x: p.x, y: p.y, life: 0.24, max: 0.24 });
      /* T24-B 掠影冲刺伤害 + 协同「疾步 + 爆裂」冲刺爆炸轨迹 */
      var dd = C.core.perks.on(s, 'dash', {});
      if (dd.dashDamage > 0) {
        s.enemies.forEach(function (e) {
          e.dashCd = e.dashCd || 0;
          if (!e.dead && e.dashCd <= 0 && dist(e, p) < e.r + p.r + 6) {
            e.dashCd = B.dashHitCd;
            damageEnemy(s, e, dd.dashDamage, false, 1);
          }
        });
      }
      if (dd.dashTrail) {
        s.dashTrailCd = (s.dashTrailCd || 0) - dt;
        if (s.dashTrailCd <= 0) {
          s.dashTrailCd = B.dashTrailCd;
          var tr = Math.round((dd.explodeDamage || 8) * B.dashTrailMul);
          s.enemies.forEach(function (o) {
            if (!o.dead && dist(o, p) < (dd.explodeRadius || 70)) damageEnemy(s, o, tr, false, 1);
          });
          burst(s, p.x, p.y, '#E9A23B', 8, 180);
        }
      }
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
        if (s.recall && C.core.recall.record(s.recall, p, s.recallPerk)) {
          A('recall');
          s.shake = Math.max(s.shake, 4);
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
          if (!damageEnemy(s, e, Math.round(b.damage * mult), b.crit, 0)) return false;
          /* C5 连击：仅玩家子弹命中累积，刷新 1.5s 窗口 */
          s.combo = (s.combo || 0) + 1;
          s.comboTimer = B.comboWindow;
          /* T24-B 吸血 / 霜击钩子 */
          var hk = C.core.perks.on(s, 'hit', { x: e.x, y: e.y });
          if (hk.lifesteal) s.player.hp = Math.min(s.player.maxHp, s.player.hp + hk.lifesteal);
          if (hk.frost) { e.slowTime = hk.frost.time; e.slowFactor = hk.frost.factor; }
          hitList.push(e);
          /* 贯穿：仍有穿透次数则继续飞（可同帧命中后续敌人），否则子弹消失 */
          if (b.pierce > 0) { b.pierce -= 1; continue; }
          return false;
        }
      }
      return true;
    });

    /* 敌人 AI */
    var speedMul = d.enemySpeed;
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
      var sp = (e.isBoss ? 96 : 118) * speedMul;
      /* T24-B 寒域光环 / 霜击 / Boss P2 提速 */
      if (d.slowAuraRadius > 0 && dist(e, p) < d.slowAuraRadius) sp *= d.slowAuraFactor;
      if (e.slowTime > 0) sp *= (e.slowFactor || 1);
      if (e.isBoss && inBossP2) sp *= B.bossPhase2Speed;

      if (e.pattern === 'chase') {
        if (s.recall) {
          var target = C.core.recall.chaseTarget(e, p);
          var gap = dist(e, target) || 1;
          nx = (target.x - e.x) / gap;
          ny = (target.y - e.y) / gap;
          sp = Math.min(sp, gap / dt);
        }
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
        if (e.patrol) {
          e.guardOpen = Math.max(0, e.guardOpen - dt);
          e.shieldFlash = Math.max(0, e.shieldFlash - dt);
          var pos = C.core.recall.advancePatrol(e, dt, B.recall.patrolSpeed * (inBossP2 ? B.bossPhase2Speed : 1),
            inBossP2 ? 2 : 1);
          e.vx = (pos.x - e.x) / dt; e.vy = (pos.y - e.y) / dt;
        }
        if (e.timer <= 0) {
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
        if (e.turret) e.angle = Math.atan2(toY, toX);
        if (e.timer <= 0) {
          e.timer = rand(1.5, 2.3);
          var bl = Math.hypot(toX, toY) || 1;
          s.enemyBullets.push({
            x: e.x, y: e.y, vx: (toX / bl) * 250, vy: (toY / bl) * 250,
            damage: e.damage, life: 2.6, r: 6
          });
        }
      }

      /* T24-B 协同「卫轮 + 寒域 / 涡心」：卫星范围内敌人被向心吸附 */
      if (d.synergy.vortexPull && d.satellites > 0 && len < d.satelliteRadius * 2) {
        e.vx += nx * sp; e.vy += ny * sp;
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      collideWalls(e, e.r);
      if (dist(e, p) < e.r + p.r && e.touchCd <= 0) {
        e.touchCd = 0.55;
        hurtPlayer(s, e, e.damage);
      }
    });

    if (s.recall && s.recall.wave && s.phase !== 'dead') {
      C.core.recall.advanceWave(s.recall, dt, p, s.enemies, function (enemy, damage) {
        if (enemy.patrol) {
          enemy.guardOpen = B.recall.guardWindow;
          A('clear');
        }
        damageEnemy(s, enemy, damage, false, 1);
      });
    }

    /* T24-B 环绕卫星：位置写入 state.satellites（视觉层可选读取），撞击造成伤害 */
    if (d.satellites > 0) {
      s.satAngle = (s.satAngle || 0) + dt * d.satelliteSpeed;
      var sats = s.satellites || (s.satellites = []);
      sats.length = d.satellites;
      for (var k = 0; k < d.satellites; k++) {
        var sang = s.satAngle + k * (Math.PI * 2 / d.satellites);
        var sx = p.x + Math.cos(sang) * d.satelliteRadius;
        var sy = p.y + Math.sin(sang) * d.satelliteRadius;
        sats[k] = { x: sx, y: sy };
        s.enemies.forEach(function (e) {
          e.satCd = e.satCd || 0;
          if (!e.dead && e.satCd <= 0 && dist({ x: sx, y: sy }, e) < e.r + 8) {
            e.satCd = B.satHitCd;
            damageEnemy(s, e, d.satelliteDmg, false, 1);
          }
        });
      }
    } else if (s.satellites) {
      s.satellites = [];
    }

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
      if (!s.prototype) s.gold += 12;
      A('clear');
      emit(s, 'roomClear', { healed: rc.healed, hint: s.room.path_hint, index: s.roomIndex });
    }
    if (s.exitActive && s.phase !== 'perk' && s.phase !== 'dead' && s.phase !== 'won') {
      var exit = { x: W - 74, y: s.prototype ? C.core.recall.hub[1].y : H / 2 };
      if (dist(p, exit) < EXIT_R + p.r) {
        if (s.prototype) {
          enterBoss();
          return s;
        }
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
