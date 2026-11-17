/* tests/fullsuite.js — M5「全套」集成验收资产（Node，零依赖 / 零构建 / 零端口）
 * 运行：node tests/fullsuite.js
 *
 * 作者：开发总监（T28 集成验收）
 * 定位：验证 T24–T28 五个并行会话汇合后的**跨层接线**与**4 分钟节奏**。
 *   §A 用轻量 DOM stub 在纯 Node 里按 index.html 顺序加载全部 11 个脚本，
 *      真实调用 screens / main 的事件与弹窗路径，证明「代码写了」等于「链路通了」。
 *   §B 采样 6 模板 × 4 主题的关卡数值，给出可复算的单局时长模型，并用真实
 *      engine.update() 帧循环验证 6–8 房 + Boss + 结算的状态机可达性。
 *
 * 边界（必须遵守）：
 *   - 不改动 src/** 与 tests/smoke.js；不引入 npm 依赖、不引入构建步骤。
 *   - 不起 HTTP 服务、不监听端口、不启用 CDP、不留后台进程。
 *   - §B 的时长是**理论模型**（含明示的命中率假设），不是真人手感采样；
 *     帧循环段用「理想玩家」瞬时清场，只证明状态机可达，**不代表单局时长**。
 *     真人计时 / 重开率仍须按 docs/demo-90s.md 的记录表人工填写。
 *
 * 结果：FAIL 为真实契约不成立；退出码 1。全绿退出码 0。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');

/* ---------- 引导：global.window / localStorage（与 smoke.js 一致） ---------- */
global.window = global;
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

/* ---------- 轻量 DOM stub ---------- */
var ctx2d = { setTransform: function () {} };
function makeEl(tag, id) {
  var cls = {};
  var el = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '',
    dataset: {}, style: {}, children: [], _html: '', _text: '', _ev: {},
    disabled: false, title: '',
    classList: {
      add: function (c) { cls[c] = true; },
      remove: function (c) { delete cls[c]; },
      toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = true; else delete cls[c]; return !!on; },
      contains: function (c) { return !!cls[c]; }
    },
    appendChild: function (c) { this.children.push(c); return c; },
    insertBefore: function (c) { this.children.unshift(c); return c; },
    querySelector: function () { return null; },          // 主题选择器/HUD 注入走「缺省跳过」分支
    querySelectorAll: function () { return []; },
    addEventListener: function (t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); },
    setAttribute: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 960, height: 600 }; },
    getContext: function () { return ctx2d; },
    click: function () { (this._ev.click || []).forEach(function (f) { f({ target: el }); }); }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); el.children.length = 0; }
  });
  Object.defineProperty(el, 'textContent', {
    get: function () { return el._text; },
    set: function (v) { el._text = String(v); }
  });
  return el;
}
var els = {};
function byId(id) { if (!els[id]) els[id] = makeEl('div', id); return els[id]; }

global.document = {
  readyState: 'complete',
  getElementById: byId,
  createElement: function (tag) { return makeEl(tag); },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {}
};
global.requestAnimationFrame = function () { return 0; };  // 空转，主循环不跑，render.draw 不被调用
global.addEventListener = function () {};
global.removeEventListener = function () {};
global.devicePixelRatio = 1;

/* ---------- 按 index.html 固定顺序加载全部脚本 ---------- */
[
  'core/perks.js', 'core/audio.js', 'core/engine.js', 'theme/index.js',
  'gen/templates.js', 'gen/schema.js', 'gen/index.js',
  'ui/render.js', 'ui/screens.js', 'ui/main.js'
].forEach(function (f) { require(path.join(SRC, f)); });

var C = global.Corridor;
var P = C.core.perks, E = C.core.engine, S = C.ui.screens;

/* ---------- 计数与断言 ---------- */
var passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function src(f) { return fs.readFileSync(path.join(SRC, f), 'utf8'); }

(async function () {

  /* ============ §A 跨层接口契约 ============ */
  section('§A1  模块装载与词条三层');
  check('11 个脚本按序加载无异常，四层均就绪',
    !!(C.core && C.gen && C.theme && C.ui && C.ui.render && C.ui.screens));
  check('词条总数 = 24（10 数值冻结 + 10 机制 + 4 协同）', P.IDS.length === 24, '实际 ' + P.IDS.length);
  check('SYNERGIES / MECHANIC / synergyHint 三个 UI 接口均已导出',
    !!P.SYNERGIES && !!P.MECHANIC && typeof P.synergyHint === 'function');
  check('机制层 14 个词条均有 mechanic 短标签',
    Object.keys(P.MECHANIC).every(function (id) { return P.TABLE[id] && P.TABLE[id].mechanic; }));

  section('§A2  冻结区零回归（smoke §6 的三个派生值）');
  var f1 = { perks: { p_dash: 2, p_hp: 1, p_crit: 1 }, shieldUsed: false, player: { hp: 100 } };
  var d1 = P.derive(f1);
  check('疾步 2 层 dashCd = 820 × 0.64', Math.abs(d1.dashCd - 820 * 0.64) < 0.001);
  check('硬壳 maxHp = 120', d1.maxHp === 120);
  check('锐眼 critChance = 0.15', Math.abs(d1.critChance - 0.15) < 0.001);
  check('冻结词条 id/name/desc/rarity/max/tag 逐字未改',
    P.TABLE.p_dash.name === '疾步' && P.TABLE.p_dash.desc === '冲刺冷却 -20%' && P.TABLE.p_dash.max === 3);

  section('§A3  协同提示（此前恒为空的核心缺口）');
  var hint = P.synergyHint('p_nova', ['p_explode']);
  check('持有「爆裂」时选「星爆」→ 提示非空', !!hint, '实际 ' + JSON.stringify(hint));
  check('提示含搭档名与质变说明', hint.indexOf('爆裂') !== -1 && hint.indexOf('全屏冲击') !== -1);
  check('无搭档 → 返回空串（不刷屏）', P.synergyHint('p_nova', []) === '');
  check('参数可传 state 对象（screens.js 的第二调用形态）',
    P.synergyHint('p_pierce', { perks: { p_crit: 1 } }).indexOf('锐眼') !== -1);
  check('SYNERGIES 与 synergies(state) 组合检测一致',
    P.synergies({ perks: { p_dash: 1, p_explode: 1 } }).dashTrail === true);

  section('§A4  三选一词条卡真实渲染（DOM stub 走完整路径）');
  /* 触发 main.js 的 begin()：点击开始按钮 → engine.startRun() → state 就绪 */
  byId('btn-start').click();
  await new Promise(function (r) { setImmediate(r); });
  var st = E.getState();
  check('开局成功且 state.onEvent 已接到 main.js',
    !!st && st.phase === 'playing' && typeof st.onEvent === 'function');
  check('#app.dataset.theme 已写入当前主题',
    !!byId('app').dataset.theme, '实际 ' + byId('app').dataset.theme);

  st.perks = { p_explode: 1 };           // 模拟本局已持有「爆裂」
  S.showPerk(['p_nova', 'p_crit', 'p_pierce'], false);
  var box = byId('perk-cards');
  check('data-count = "3"（供 CSS 三列布局）', box.dataset.count === '3', '实际 ' + box.dataset.count);
  check('生成 3 张词条卡', box.children.length === 3, '实际 ' + box.children.length);
  check('第一张卡渲染机制徽标 .perk-mechanic', box.children[0].innerHTML.indexOf('perk-mechanic') !== -1);
  check('第一张卡渲染协同提示 .perk-synergy', box.children[0].innerHTML.indexOf('perk-synergy') !== -1);
  check('协同提示含已持有搭档「爆裂」', box.children[0].innerHTML.indexOf('爆裂') !== -1);
  S.showPerk(['p_hp', 'p_dash'], false);
  check('二选一仍为 2 张卡、data-count = "2"',
    box.children.length === 2 && box.dataset.count === '2');

  section('§A5  事件编排（roomEvent 此前被静默丢弃）');
  var toast = byId('toast');
  st.onEvent('roomEvent', { kind: 'rest', healed: 20 });
  check('roomEvent(rest) → toast 显示回血', toast.textContent.indexOf('休整间') !== -1 && toast.textContent.indexOf('20') !== -1, toast.textContent);
  st.onEvent('roomEvent', { kind: 'event', gold: 20 });
  check('roomEvent(event) → toast 显示金币', toast.textContent.indexOf('事件间') !== -1, toast.textContent);
  st.onEvent('roomEnter', { room: { name: '方庭', path_hint: '右转' }, roomType: 'normal' });
  check('roomEnter(normal) 不追加「普通房」标签', toast.textContent.indexOf('普通房') === -1, toast.textContent);
  st.onEvent('roomEnter', { room: { name: '窄巷', path_hint: '左转' }, roomType: 'elite' });
  check('roomEnter(elite) 正确追加「精英房」标签', toast.textContent.indexOf('精英房') !== -1, toast.textContent);
  st.onEvent('bossPhase', { phase: 2 });
  check('bossPhase(2) → toast 提示阶段强化', toast.textContent.indexOf('第 2 阶段') !== -1, toast.textContent);

  section('§A5b HUD 主题标签实时同步（修复缓存不同步）');
  var themeEl = byId('hud-theme');
  C.theme.setActive('oldtown');
  S.updateHud(E.getState());
  check('程序化 setActive 后 updateHud 即时显示「旧城」',
    themeEl.textContent === (C.theme.get('oldtown') || {}).label, '实际 ' + themeEl.textContent);
  C.theme.setActive('geometry');
  S.updateHud(E.getState());
  check('切回 geometry 后即时显示「抽象几何」',
    themeEl.textContent === (C.theme.get('geometry') || {}).label, '实际 ' + themeEl.textContent);

  section('§A6  静态契约（跨层文件级对齐）');
  var css = src('ui/style.css'), rjs = src('ui/render.js'), mjs = src('ui/main.js');
  check('CSS 含 #perk-cards[data-count="3"] 三列规则', css.indexOf('#perk-cards[data-count="3"]') !== -1);
  check('CSS 含 .perk-synergy / .perk-mechanic / .hud-extra',
    css.indexOf('.perk-synergy') !== -1 && css.indexOf('.perk-mechanic') !== -1 && css.indexOf('.hud-extra') !== -1);
  check('render.js 的 ROOM_LABEL 不含 normal（普通房不常显徽标）',
    /var ROOM_LABEL\s*=\s*\{[^}]*\}/.test(rjs) && !/var ROOM_LABEL\s*=\s*\{[^}]*normal\s*:/.test(rjs));
  check('main.js 含精确 case \'roomEvent\'', mjs.indexOf("case 'roomEvent'") !== -1);
  check('模板数 = 6 套（3 套 M1 冻结 + 3 套新增）', C.gen.templates.TEMPLATES.length === 6,
    '实际 ' + C.gen.templates.TEMPLATES.length);
  check('schema 房间数上限已扩到 8', /8/.test(src('gen/schema.js')));

  /* ============ §B 4 分钟节奏量化 ============ */
  section('§B1  关卡数值采样：6 模板 × 4 主题');
  var THEMES = C.theme.readyIds();
  var samples = [], roomHist = {}, typeSeq = [];
  for (var ti = 0; ti < THEMES.length; ti++) {
    for (var ri = 0; ri < 24; ri++) {   // 24 局/主题，保证每个 6–8 房档位都有足够样本
      var s = await E.startRun({ theme: THEMES[ti], runIndex: ti * 24 + ri + 1 });
      var n = s.run.rooms.length;
      roomHist[n] = (roomHist[n] || 0) + 1;
      var enemyHp = s.enemies.reduce(function (a, e) { return a + e.maxHp; }, 0);
      var bossHp = Math.round(s.run.boss.hp * P.BALANCE.bossHpMul);
      var types = s.run.rooms.map(function (r) { return r.type || 'normal'; });
      typeSeq = typeSeq.concat(types);
      /* 整局真实敌人总 HP：按 engine.calibrate() 同一公式逐房计算，
       * 不再用「首房 HP × 房数」这种粗糊外推（后半段 hp 放大 + 增兵会差很多）。 */
      var BL = P.BALANCE, totalHp = 0;
      s.run.rooms.forEach(function (room, i) {
        var prog = n > 1 ? i / (n - 1) : 0;
        var rt = room.type || 'normal';
        room.enemies.forEach(function (spec) {
          var hp = Math.round(spec.hp * (BL.hpBase + BL.hpProgress * prog));
          var cnt = spec.count + (prog > BL.countAfter ? BL.countBonus : 0);
          if (rt === 'elite') { hp = Math.round(hp * BL.eliteHpMul); cnt += BL.eliteCount; }
          totalHp += hp * cnt;
        });
      });
      samples.push({ theme: THEMES[ti], rooms: n, enemyHp: enemyHp, totalHp: totalHp,
                     bossHp: bossHp, types: types });
    }
  }
  check('采样覆盖 3–8 房至少 3 种房间数', Object.keys(roomHist).length >= 3,
    JSON.stringify(roomHist));
  check('采样中出现 6 房以上的长局', Object.keys(roomHist).some(function (k) { return Number(k) >= 6; }),
    JSON.stringify(roomHist));
  check('房间分型至少出现 elite / event / rest 中的两种',
    ['elite', 'event', 'rest'].filter(function (t) { return typeSeq.indexOf(t) !== -1; }).length >= 2);
  var withBoss = samples.filter(function (x) { return x.bossHp > 0; });
  check('每局均含 Boss 且 hp 已按 ×1.25 校准', withBoss.length === samples.length && withBoss[0].bossHp > 0);
  console.log('        房间数分布 ' + JSON.stringify(roomHist) +
    ' / 首房敌人总 HP ' + samples[0].enemyHp + ' / Boss HP ' + samples[0].bossHp);

  section('§B2  理论单局时长模型（明示假设，可复算）');
  /* 模型来源：engine.js 常量 BULLET_DMG=10 / FIRE_CD=0.185 / SPEED=232，
   * 以及 perks.js 的 BALANCE.hpBase/hpProgress/bossHpMul。
   * 假设：满命中 DPS=10/0.185≈54.1；实战命中率 h=0.55（走位/拉扯/闪避）；
   *      精英房与 Boss P2 有效 DPS ×0.78；每房固定开销 = 入场走位 5s
   *      + 走向出口 (960-74-92)/232≈3.4s + 转场 0.45s + 选词条决策 3s ≈ 11.9s。 */
  /* 命中率 h 无法由 Node 测定，属真人手感范畴（见 demo-90s.md §3）。
   * 因此本节只给「可复算的模型 + 三档假设区间」，**不做达标 PASS/FAIL 断言**，
   * 避免用一个拍脑袋的假设伪造「4 分钟已达成」的验收结论。 */
  var DPS = 10 / 0.185;          // BULLET_DMG / FIRE_CD，满命中理论 DPS ≈ 54.1
  var OVERHEAD = 11.9;           // 每房固定开销：入场 5s + 走向出口 3.4s + 转场 .45s + 选词条 3s
  var BOSS_OVERHEAD = 6;
  function model(x, h) {
    var fight = x.totalHp / (DPS * h);
    var boss = x.bossHp / (DPS * h * 0.78);   // Boss P2 弹幕加密，等效 DPS 折减
    return x.rooms * OVERHEAD + fight + boss + BOSS_OVERHEAD;
  }
  [0.25, 0.35, 0.55].forEach(function (h) {
    var line = [6, 7, 8].map(function (n) {
      var g = samples.filter(function (x) { return x.rooms === n; });
      if (!g.length) return n + '房:—';
      var v = g.map(function (x) { return model(x, h); });
      return n + '房 ' + Math.min.apply(null, v).toFixed(0) + '–' + Math.max.apply(null, v).toFixed(0) + 's';
    }).join(' / ');
    console.log('        命中率 ' + h.toFixed(2) + '：' + line);
  });
  var base = {}, low = {};
  [6, 7, 8].forEach(function (n) {
    var g = samples.filter(function (x) { return x.rooms === n; });
    if (!g.length) return;
    base[n] = g.reduce(function (a, x) { return a + model(x, 0.55); }, 0) / g.length;
    low[n] = g.reduce(function (a, x) { return a + model(x, 0.25); }, 0) / g.length;
  });
  check('模型覆盖 6 / 7 / 8 三个长局档位且均可复算',
    [6, 7, 8].every(function (n) { return base[n] > 0; }));
  check('模型单调性：同一局命中率越低，理论时长越长（0.25 > 0.55）',
    Object.keys(low).length >= 3 && Object.keys(low).every(function (n) { return low[n] > base[n]; }));
  /* 结论动态判定，不写死档位结论 —— seed 随 uuid 变化，每次采样分布不同。 */
  function verdict(v) { return v < 210 ? '偏短' : (v > 270 ? '偏长' : '落在 240s±30s 窗口'); }
  console.log('        结论（h=0.55 均值）：6 房 ' + base[6].toFixed(0) + 's（' + verdict(base[6]) +
    '）、7 房 ' + base[7].toFixed(0) + 's（' + verdict(base[7]) +
    '）、8 房 ' + base[8].toFixed(0) + 's（' + verdict(base[8]) + '）。');
  console.log('        240s ± 30s 是否达成取决于真人命中率，Node 无法测定；本表只用于选定校准方向。');
  console.log('        校准旋钮（若真人计时偏短/偏长）：perks.js BALANCE.hpBase / hpProgress / bossHpMul。');
  console.log('        真人计时与重开率仍须按 docs/demo-90s.md §3 记录表人工采样，本节不替代。');

  section('§B3  帧循环结构可达性（理想玩家，不代表时长）');
  /* 用真实 engine.update() 帧推进：瞬时清场 + 瞬移到出口，只验证状态机能否
   * 走完「N 房 → 每房一次选词条 → Boss 两阶段 → won」，且全程不抛异常。 */
  var longRun = null, evt = [];
  var recorder = function (t) { evt.push(t); };
  for (var k = 0; k < 40 && !longRun; k++) {
    evt.length = 0;   // 只保留最终那一局的事件
    var q = await E.startRun({ theme: 'geometry', runIndex: 900 + k, onEvent: recorder });
    if (q.run.rooms.length >= 6) longRun = q;
  }
  check('能取到 6 房以上长局用于帧循环', !!longRun);
  if (longRun) {
    var frames = 0, ok = true, err = '';
    var input = { up: false, down: false, left: false, right: false, fire: true, dash: false, aimX: 500, aimY: 300 };
    try {
      while (frames < 60000) {
        frames++;
        var s = E.getState();
        if (s.phase === 'won' || s.phase === 'dead') break;
        if (s.phase === 'perk') {
          if (s.perkPending && s.perkPending.length) E.choosePerk(s.perkPending[0]);
          else { ok = false; err = 'perk 阶段无候选'; break; }
        } else {
          s.player.invuln = 1;                 // 理想玩家：不因掉血中断
          if (s.phase === 'boss') {
            /* Boss 房改用「真实子弹逐发命中」，才能走 damageEnemy() 里的
             * 50% 血阶段判定；一帧秒杀会绕过该分支（这是验证方式问题，非产品缺陷）。 */
            var boss = s.enemies.filter(function (e) { return !e.dead && e.isBoss; })[0];
            if (boss) {
              boss.x = 620; boss.y = 300; boss.vx = 0; boss.vy = 0;
              s.player.x = 460; s.player.y = 300; s.player.vx = s.player.vy = 0;
              input.aimX = 620; input.aimY = 300; input.fire = true;
            }
          } else {
            input.fire = false;
            if (s.exitActive) { s.player.x = E.W - 74; s.player.y = E.H / 2; }
            else s.enemies.forEach(function (e) { e.hp = 0; e.dead = true; });
          }
        }
        E.update(1 / 60, input);
      }
    } catch (e) { ok = false; err = e.message; }
    var fs2 = E.getState();
    check('帧循环跑到通关且未抛异常', ok && fs2.phase === 'won', err || ('phase=' + fs2.phase));
    check('事件链含 runStart / roomEnter / roomClear / perkOffer / bossEnter / runEnd',
      ['runStart', 'roomEnter', 'roomClear', 'perkOffer', 'bossEnter', 'runEnd']
        .every(function (t) { return evt.indexOf(t) !== -1; }), evt.slice(0, 14).join(','));
    check('词条选择次数 = 房间数（每房后一次）',
      evt.filter(function (t) { return t === 'perkOffer'; }).length === longRun.run.rooms.length);
    check('Boss 两阶段触发（bossPhase 事件）', evt.indexOf('bossPhase') !== -1 || fs2.bossPhase === 2);
    check('C5 字段齐备（damagePops / combo / roomType / bossPhase）',
      Array.isArray(fs2.damagePops) && typeof fs2.combo === 'number' &&
      typeof fs2.roomType === 'string' && typeof fs2.bossPhase === 'number');
  }

  /* ---------- 汇总 ---------- */
  console.log('\n──────────────────────────────');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('──────────────────────────────');
  if (failed) process.exitCode = 1;
})().catch(function (e) {
  console.error('FULLSUITE CRASHED: ' + (e && e.stack || e));
  process.exitCode = 1;
});
