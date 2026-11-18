/* ui/screens.js — DOM 覆盖层：开始页 / HUD / 词条弹窗 / 结算页 / 局外解锁页
 * 视觉排版交给 CSS，这里只做状态与内容填充。
 * 约定：T27 新增的字段/接口/DOM 均为「可选增强」，缺失时行为等同 M1。
 */
(function (C) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var handlers = {};
  var toastTimer = null;
  var themeLabel = '';
  var currentScreen = 'start';   /* B7：main.js 需按当前弹窗决定 Esc 语义 */

  function show(name) {
    ['start', 'perk', 'end', 'unlock', 'pause'].forEach(function (n) {
      var el = $('screen-' + n);
      if (el) el.classList.toggle('hidden', n !== name);
    });
    var overlay = $('overlay');
    overlay.classList.toggle('hidden', !name);
    overlay.classList.toggle('dim', !!name && name !== 'perk');
    overlay.classList.toggle('unlocking', name === 'unlock');
    $('hud').classList.toggle('hidden', name === 'start' || name === 'unlock');
    $('btn-pause').disabled = !!name;
    if (currentScreen !== name) {
      var focusIds = { start: 'btn-start', pause: 'btn-resume', unlock: 'unlock-close', end: 'btn-restart' };
      var focus = name === 'perk' ? $('perk-cards').querySelector('button:not(:disabled)') :
        $(name ? focusIds[name] : 'game');
      if (focus && focus.focus) focus.focus({ preventScroll: true });
    }
    currentScreen = name || null;
  }

  /* 当前打开的弹窗名（null = 无弹窗、正在游戏中）。供 main.js 的 Esc / 主循环判定。 */
  function current() { return currentScreen; }

  /* B6/B7：解锁页统一返回入口 —— 顶部 ×、底部「返回」、Esc 都走这里 */
  function backFromUnlock() {
    var back = $('unlock-back');
    var from = back ? back.dataset.from : 'start';
    show(from === 'end' ? 'end' : 'start');
  }

  function toast(text, ms) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }

  function dismissToast() {
    clearTimeout(toastTimer);
    var el = $('toast');
    el.classList.remove('show');
    el.textContent = '';
  }

  function rarityClass(r) { return 'r-' + r; }

  /* ---------- T27 通用小工具（纯函数，不改写既有状态） ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 房间类型 → 中文标签：兼容常见英文枚举、中文直传与未知值 */
  var ROOM_TYPE_LABEL = {
    normal: '普通', common: '普通', ordinary: '普通', basic: '普通', plain: '普通',
    elite: '精英',
    event: '事件',
    rest: '休整', respite: '休整', recovery: '休整', heal: '休整', safe: '休整'
  };
  function roomTypeLabel(v) {
    if (v == null || v === '') return '';
    var s = String(v);
    var low = s.toLowerCase();
    if (ROOM_TYPE_LABEL[low]) return ROOM_TYPE_LABEL[low];
    if (['普通', '精英', '事件', '休整'].indexOf(s) !== -1) return s;
    return s; // 未知枚举原样显示，避免出现空白，交由 logic-dev 对齐
  }

  /* 可选容器填充：字段缺失/空 → 隐藏并清空；存在 → 显示。容器不存在也不抛 */
  function fillOptional(id, text) {
    var el = $(id);
    if (!el) return;
    if (text == null || text === '') {
      el.textContent = '';
      el.classList.add('hidden');
    } else {
      el.textContent = text;
      el.classList.remove('hidden');
    }
  }

  /* 切主题即时刷新 #app 的 data-theme；开局时 main.js 会再兜一次 */
  function applyThemeAttr(id) {
    try {
      var app = $('app');
      var v = id || (C.theme && typeof C.theme.active === 'function' ? C.theme.active() : '');
      if (app) app.dataset.theme = v || '';
    } catch (e) { /* 主题接口暂缺时不影响开局 */ }
  }

  /* ---------- 协同提示：全部软依赖，接口缺失/异常一律返回 ''（不渲染） ---------- */
  function textOf(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return String(v.text || v.hint || v.label || v.desc || '');
    return String(v);
  }

  /* 把可能是 字符串 / 数组 / {with,ids,...} 的可选关系字段规整为 id 数组 */
  function toIdList(v) {
    if (!v) return [];
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) {
      return v.map(function (x) {
        if (x && typeof x === 'object') return x.id || x.perk || x.with || '';
        return x == null ? '' : String(x);
      }).filter(Boolean);
    }
    if (typeof v === 'object') {
      var arr = v.with || v.ids || v.perks || v.partners || v.targets || v.combo;
      return arr ? toIdList(arr) : [];
    }
    return [];
  }

  function ownedPerkIds() {
    try {
      var st = (C.core && C.core.engine && C.core.engine.getState) ? C.core.engine.getState() : null;
      var perks = (st && st.perks) || {};
      return Object.keys(perks).filter(function (k) { return perks[k] > 0; });
    } catch (e) { return []; }
  }

  /* 若候选词条与「本局已持有词条」能触发协同，返回简短提示；否则 '' */
  function synergyHint(id, owned) {
    try {
      var P = (C.core && C.core.perks) || {};
      var TABLE = P.TABLE || {};
      var def = TABLE[id] || {};
      var st = (C.core && C.core.engine && C.core.engine.getState) ? C.core.engine.getState() : null;

      // ① logic-dev 可能新增的模块级查询函数（它内部自行判定协同）
      if (typeof P.synergyHint === 'function') {
        var r = null;
        try { r = P.synergyHint(id, owned); } catch (e) { r = null; }
        if (!r) { try { r = P.synergyHint(id, st); } catch (e2) { r = null; } }
        var t = textOf(r);
        if (t) return t;
      }

      // ② 关系定义：TABLE 条目字段 / 模块级 SYNERGIES 表（均可选）
      var partners = toIdList(def.synergy || def.synergyWith || def.comboWith || def.combos);
      var synTable = P.SYNERGIES || P.synergies || P.COMBOS || null;
      var row = (synTable && typeof synTable === 'object') ? synTable[id] : null;
      if (row) partners = partners.concat(toIdList(row));

      var matched = partners.filter(function (pid) { return owned.indexOf(pid) !== -1 && TABLE[pid] && TABLE[pid].name; });

      // ③ 可选提示文本字段
      var note = textOf(def.synergyHint || def.synergyText || def.comboHint || def.comboNote ||
        (def.synergy && typeof def.synergy === 'object' ? def.synergy : null) ||
        (row && typeof row === 'object' ? row : null));

      if (matched.length) {
        var names = matched.map(function (pid) { return TABLE[pid].name; });
        return '协同 · 已持有「' + names.join('、') + '」' + (note ? ' · ' + note : '');
      }
      return ''; // 无协同关系 / 接口缺失 → 不渲染，避免刷屏
    } catch (e) { return ''; }
  }

  function mechanicBadge(def) {
    var m = def && (def.mechanic || def.mechanics || def.mechanicTag);
    var t = textOf(m);
    return t ? '<span class="perk-mechanic">' + esc(t) + '</span>' : '';
  }
  function synergyBlock(hint) {
    return hint ? '<div class="perk-synergy">' + esc(hint) + '</div>' : '';
  }

  /* 主题选择状态：选择器与 HUD 标签均由 JS 注入，不触碰 index.html 静态结构 */
  function syncThemeUI() {
    var id = C.theme.active();
    themeLabel = (C.theme.get(id) || {}).label || id || '';
    applyThemeAttr(id);
    Array.prototype.forEach.call(document.querySelectorAll('.theme-opt'), function (b) {
      var on = b.dataset.theme === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function injectHudTheme() {
    if ($('hud-theme')) return;
    var stats = document.querySelector('.hud-right .hud-stats');
    if (!stats) return;
    var tag = document.createElement('span');
    tag.className = 'theme-tag';
    tag.innerHTML = '<span class="theme-tag-k">主题</span> <b id="hud-theme"></b>';
    /* T28：主题标签独占一行。原先 append 进 .hud-stats 会与「金币 / 用时 / 来源」
     * 挤在 230px 宽度里，中文被折成多行、右上角排版错乱（浏览器实拍确认）。 */
    var parent = stats.parentNode;
    if (!parent) return;
    if (stats.nextSibling) parent.insertBefore(tag, stats.nextSibling);
    else parent.appendChild(tag);
  }

  function buildThemePicker() {
    var start = $('screen-start');
    var actions = start && start.querySelector('.start-actions');
    if (!actions || $('theme-picker')) return;
    var wrap = document.createElement('div');
    wrap.id = 'theme-picker';
    wrap.className = 'theme-picker';
    var head = document.createElement('div');
    head.className = 'theme-picker-label';
    head.innerHTML = '选择主题 <span>THEME</span>';
    wrap.appendChild(head);
    var opts = document.createElement('div');
    opts.className = 'theme-options';
    C.theme.readyIds().forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-opt';
      b.dataset.theme = id;
      b.textContent = C.theme.get(id).label;
      b.addEventListener('click', function () {
        if (C.theme.setActive(id)) syncThemeUI();
      });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    start.insertBefore(wrap, actions);
  }

  function perkDefinition(id) {
    if (typeof id !== 'string') return null;
    var perks = C.core.perks;
    var tables = [perks.TABLE, perks.RECALL, perks.IMPACT];
    var table = tables.find(function (entry) { return entry && Object.prototype.hasOwnProperty.call(entry, id); });
    var def = table && table[id];
    return def && typeof def.name === 'string' && def.name ? def : null;
  }

  function perkCard(id, opts) {
    opts = opts || {};
    var RL = C.core.perks.RARITY_LABEL;
    var impact = C.core.perks.IMPACT[id];
    var def = perkDefinition(id);
    if (!def) return null;
    var rarityLabel = impact ? '构筑点 ×1' : (RL[def.rarity] || '');
    var d = document.createElement('button');
    d.className = 'perk-card ' + rarityClass(def.rarity) + (opts.locked ? ' locked' : '');
    d.type = 'button';
    d.innerHTML =
      '<div class="perk-top"><span class="perk-rarity">' + esc(rarityLabel) + '</span>' +
      '<span class="perk-tag">' + esc(def.tag || '') + '</span>' +
      mechanicBadge(def) + '</div>' +
      '<div class="perk-name">' + esc(def.name) + '</div>' +
      '<div class="perk-desc">' + esc(def.desc || '') + '</div>' +
      synergyBlock(opts.synergy) +
      (opts.footer || '');
    if (opts.locked) d.disabled = true;
    else if (!opts.noPick) d.addEventListener('click', function () { handlers.onPick && handlers.onPick(id); });
    return d;
  }

  /* C8：候选数由 choices 决定，2 或 3（乃至其它数量）均动态生成，不写死 2 */
  function showPerk(choices, nextIsBoss, prototype, impact) {
    var box = $('perk-cards');
    var list = Array.isArray(choices) ? choices.filter(perkDefinition) : [];
    if (box) {
      box.innerHTML = '';
      /* 供 visual-dev 的 CSS 按候选数布局（可选消费 [data-count]）；M1 下为 2，外观不变 */
      try { box.dataset.count = String(list.length); } catch (e) { /* 忽略 */ }
      var owned = ownedPerkIds();
      list.forEach(function (id) {
        box.appendChild(perkCard(id, { synergy: synergyHint(id, owned) }));
      });
    }
    var st = (C.core && C.core.engine && C.core.engine.getState) ? (C.core.engine.getState() || {}) : {};
    if (!list.length) {
      $('perk-room').textContent = '';
      $('perk-title').textContent = '没有可用词条';
      $('perk-sub').textContent = '请返回开始页重新进入回廊';
      var home = document.createElement('button');
      home.type = 'button';
      home.className = 'btn primary';
      home.textContent = '返回开始页';
      home.addEventListener('click', function () { handlers.onHome && handlers.onHome(); });
      if (box) box.appendChild(home);
    } else if (impact) {
      $('perk-room').textContent = '第 1 组已清';
      $('perk-title').textContent = '强化' + C.core.impact.weapons[st.impact.weapon].name;
      $('perk-sub').textContent = '获得 1 个构筑点。选一项强化，迎战下一组。';
    } else {
      $('perk-title').textContent = prototype ? '选择回扫词条' : '选择一条路径';
      $('perk-sub').textContent = prototype ? '选一种效果带入普通房和首领战' :
        (nextIsBoss ? '选完即将进入终室 · 迎接本局的首领' : '选一个带进下一间房 · 效果可叠加');
      $('perk-room').textContent = prototype ? '试玩站位 ' + st.prototype : '第 ' + ((st.roomIndex || 0) + 1) + ' 间 通过';
    }
    show('perk');
  }

  function updateHud(s) {
    var impact = s && s.impact;
    var hudTheme = $('hud-theme');
    /* T28：实时取当前主题，不再依赖 syncThemeUI() 的缓存值。
     * 原先若通过非开始页入口 / 程序化 setActive() 切主题，HUD 标签会停留在旧值
     * （acceptance.md 附录已记录该现象）。每帧读一次 active() 成本可忽略。 */
    if (hudTheme) {
      try {
        var tid = C.theme.active();
        hudTheme.textContent = (C.theme.get(tid) || {}).label || tid || themeLabel;
      } catch (e) { hudTheme.textContent = themeLabel; }
    }

    /* T27-B 可选 HUD 字段：缺省 → 隐藏（等同 M1）；任何异常不影响主 HUD */
    try {
      var st = s || {};
      var combo = st.combo;
      fillOptional('hud-combo', impact ? (!impact.combinations && impact.comboTime > 0 ? '接力 ×' + impact.combo : '') :
        ((typeof combo === 'number' && combo >= 2) ? ('连击 ×' + combo) : ''));
      /* T28：normal 为默认态，与 render.js 徽标策略保持一致，不常显「房间 · 普通」 */
      var rt = st.roomType;
      fillOptional('hud-room-type',
        (rt != null && rt !== '' && String(rt).toLowerCase() !== 'normal') ? ('房间 · ' + roomTypeLabel(rt)) : '');
      var bp = st.bossPhase;
      fillOptional('hud-boss-phase',
        (typeof bp === 'number' && bp >= 2) ? ('首领 · 第 ' + bp + ' 阶段') : '');
    } catch (e) { /* 新字段读取异常时保持隐藏即可 */ }

    if (!s || !s.room) return;
    if (impact || s.prototype) $('hud').dataset.prototype = impact ? 'impact' : s.prototype;
    else delete $('hud').dataset.prototype;
    $('run-gold').classList.toggle('hidden', !!(impact || s.prototype));
    var p = s.player;
    var ratio = Math.max(0, p.hp / p.maxHp);
    $('hp-fill').style.width = (ratio * 100) + '%';
    $('hp-text').textContent = Math.max(0, Math.ceil(p.hp)) + ' / ' + p.maxHp;
    $('hp-fill').classList.toggle('low', ratio < 0.3);
    var dash = $('dash-status');
    dash.textContent = p.dashCd > 0 ? (Math.ceil(p.dashCd * 10) / 10).toFixed(1) + ' 秒' : '可用';
    dash.classList.toggle('cooling', p.dashCd > 0);

    var total = impact ? 2 : s.run.rooms.length;
    var idx = impact ? impact.wave - 1 : Math.min(s.roomIndex, total);
    var bossRoom = !impact && s.roomIndex >= total;
    $('room-name').textContent = s.room.name;
    $('room-count').textContent = bossRoom ? '终室 · 首领' : '第 ' + (idx + 1) + ' / ' + total + (impact ? ' 组' : ' 间');

    var dots = $('room-dots');
    dots.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var d = document.createElement('i');
      d.className = 'dot' + (i < idx || (impact && s.phase === 'won') ? ' done' : (i === idx ? ' now' : ''));
      dots.appendChild(d);
    }
    if (!impact) {
      var bossDot = document.createElement('i');
      bossDot.className = 'dot boss' + (s.phase === 'won' ? ' done' : (bossRoom ? ' now' : ''));
      dots.appendChild(bossDot);
    }

    $('gold').textContent = s.gold;
    $('timer').textContent = s.elapsed.toFixed(1) + 's';

    var chips = $('perk-chips');
    chips.innerHTML = '';
    var carried = impact && impact.perk ? [impact.perk] : (s.recallPerk ? [s.recallPerk] : Object.keys(s.perks));
    carried.forEach(function (id) {
      var def = perkDefinition(id);
      if (!def) return;
      var c = document.createElement('span');
      c.className = 'chip ' + rarityClass(def.rarity);
      c.textContent = def.name + (s.perks[id] > 1 ? ' ×' + s.perks[id] : '');
      c.title = def.desc;
      chips.appendChild(c);
    });

    var boss = s.enemies.filter(function (e) { return e.isBoss; })[0];
    var bw = $('boss-bar');
    if (boss) {
      bw.classList.remove('hidden');
      $('boss-name').textContent = s.run.boss.name;
      $('boss-fill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
    } else bw.classList.add('hidden');

    var hint = s.room.path_hint || '';
    if (s.phase === 'won' || s.phase === 'dead') hint = '';
    else if (impact) {
      if (impact.combinations) hint = impact.awakeAt === Infinity ? '打飞，再松开左键补击一次' : '';
      else if (impact.awakeAt === Infinity) hint = C.core.impact.weapons[impact.weapon].opening;
      else if (impact.wave === 2) hint = C.core.perks.IMPACT[impact.perk].desc;
      else hint = impact.weapon === 'blade' ? '贴近飞行中的敌人，朝新方向再挥一刀' : '换个角度补一枪，改写飞行方向';
    }
    else if (s.exitActive) hint = '出口已开启 → 走到右侧光环';
    else if (boss && boss.patrol) {
      if (boss.guardOpen > 0) hint = '护盾已打开 · ' + boss.guardOpen.toFixed(1) + ' 秒';
      else if (boss.patrol.warning > 0) hint = '巡行预警 · 即将走' + boss.patrol.route.name;
      else if (s.recall.wave) hint = '回扫正在沿路传播';
      else if (s.recall.origin == null) hint = '走到任一廊口，开始下一圈';
    } else if (s.recall) {
      if (s.recall.wave) hint = '回扫正在沿路传播';
      else if (s.recall.origin == null) hint = '走到任一廊口，开始下一圈';
      else if (s.recall.outbound) hint = '从另一条廊回到标记处';
    }
    $('hint').textContent = hint;
    $('source').textContent = impact ? C.core.impact.weapons[impact.weapon].name : (s.prototype ? '试玩 ' + s.prototype :
      (s.source === 'fallback' ? '离线模板 #' + ((s.templateIndex || 0) + 1) : 'AI 生成'));
  }

  function showEnd(result) {
    var trial = result.prototype || result.impact;
    $('end-title').textContent = result.cleared ? (result.impact ? '两组敌人已击退' : '走廊走到了尽头') : '这次停在了这里';
    $('end-title').className = result.cleared ? 'end-title win' : 'end-title lose';
    $('end-summary').textContent = result.summary || '';
    $('end-stats').innerHTML =
      stat('存活', result.seconds.toFixed(1) + 's') +
      (result.impact ? stat('通过组数', String(result.waves)) : stat('通过房间', String(result.rooms))) +
      stat('击杀', String(result.kills)) +
      (result.impact && !result.combinations ? stat('最长接力', String(result.bestChain)) :
        (trial ? '' : stat('获得金币', '+' + result.gold)));
    $('end-wallet').classList.toggle('hidden', !!trial);
    $('btn-unlock').classList.toggle('hidden', !!trial);
    $('btn-end-home').classList.toggle('hidden', !trial);
    if (!trial) $('end-gold').textContent = C.core.engine.getMeta().gold;
    show('end');
  }

  function stat(label, value) {
    return '<div class="stat"><span class="stat-v">' + value + '</span><span class="stat-l">' + label + '</span></div>';
  }

  function showUnlock(fromEnd) {
    var meta = C.core.engine.getMeta();
    $('unlock-gold').textContent = meta.gold;
    var box = $('unlock-grid');
    var scrollTop = currentScreen === 'unlock' ? box.scrollTop : 0;
    box.innerHTML = '';
    C.core.perks.IDS.forEach(function (id) {
      var owned = meta.unlocked.indexOf(id) !== -1;
      var card = perkCard(id, {
        locked: owned,
        noPick: true,
        footer: '<div class="perk-price">' + (owned ? '已解锁 · 开局自带' : '60 金币解锁') + '</div>'
      });
      if (!card) return;
      if (!owned) {
        card.addEventListener('click', function () { handlers.onUnlock && handlers.onUnlock(id); });
        card.classList.toggle('poor', meta.gold < 60);
      }
      box.appendChild(card);
    });
    $('unlock-back').dataset.from = fromEnd ? 'end' : 'start';
    show('unlock');
    box.scrollTop = scrollTop;
  }

  function setMuted(m) {
    var b = $('btn-mute');
    b.textContent = m ? '音效 关' : '音效 开';
    b.classList.toggle('off', m);
  }

  function init(h) {
    handlers = h || {};
    $('btn-start').addEventListener('click', function () { handlers.onStart && handlers.onStart(); });
    $('btn-impact').addEventListener('click', function () { handlers.onImpact && handlers.onImpact($('impact-weapon').value); });
    $('btn-impact-combinations').addEventListener('click', function () {
      if (handlers.onImpactCombinations) handlers.onImpactCombinations($('impact-weapon').value);
    });
    $('btn-recall').addEventListener('click', function () { handlers.onRecall && handlers.onRecall($('recall-layout').value); });
    $('btn-restart').addEventListener('click', function () { handlers.onRestart && handlers.onRestart(); });
    $('btn-end-home').addEventListener('click', function () { handlers.onHome && handlers.onHome(); });
    $('btn-unlock').addEventListener('click', function () { showUnlock(true); });
    $('btn-unlock-start').addEventListener('click', function () { showUnlock(false); });
    $('unlock-back').addEventListener('click', backFromUnlock);
    $('unlock-close').addEventListener('click', backFromUnlock);
    $('btn-pause').addEventListener('click', function () { handlers.onPause && handlers.onPause(); });
    $('btn-mute').addEventListener('click', function () { handlers.onToggleMute && handlers.onToggleMute(); });
    /* B9：暂停面板三个出口，全部交给 main.js 编排 */
    $('btn-resume').addEventListener('click', function () { handlers.onResume && handlers.onResume(); });
    $('btn-pause-restart').addEventListener('click', function () { handlers.onRestart && handlers.onRestart(); });
    $('btn-pause-home').addEventListener('click', function () { handlers.onHome && handlers.onHome(); });
    injectHudTheme();
    buildThemePicker();
    syncThemeUI();
    show('start');
  }

  C.ui = C.ui || {};
  C.ui.screens = {
    init: init, show: show, current: current, backFromUnlock: backFromUnlock,
    toast: toast, dismissToast: dismissToast, showPerk: showPerk,
    updateHud: updateHud, showEnd: showEnd, showUnlock: showUnlock, setMuted: setMuted,
    roomTypeLabel: roomTypeLabel
  };
})(window.Corridor = window.Corridor || {});
