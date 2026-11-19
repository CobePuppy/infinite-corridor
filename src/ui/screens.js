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
    var previous = currentScreen;
    ['start', 'free-setup', 'trial', 'loading', 'perk', 'end', 'unlock', 'pause'].forEach(function (n) {
      var el = $('screen-' + n);
      if (el) el.classList.toggle('hidden', n !== name);
    });
    if (name === 'start') refreshLoopContinue();
    var overlay = $('overlay');
    overlay.classList.toggle('hidden', !name);
    $('stage').dataset.screen = name || 'playing';
    var hud = $('hud');
    hud.classList.toggle('hidden', !!name && name !== 'pause' && name !== 'perk');
    hud.inert = !!name;
    currentScreen = name || null;
    var target = $(name ? 'screen-' + name : 'game');
    if (previous !== currentScreen && target && target.focus) target.focus({ preventScroll: true });
  }

  /* 当前打开的弹窗名（null = 无弹窗、正在游戏中）。供 main.js 的 Esc / 主循环判定。 */
  function current() { return currentScreen; }

  /* 回廊长局续玩入口：只有存在有效存档时才出现，显示当前层 / 间。 */
  function refreshLoopContinue() {
    var btn = $('btn-loop-continue');
    if (!btn) return;
    try {
      /* 主模式（自由回廊）优先；没有自由存档时仍要回落到经典回廊存档，
       * 否则「旧版可回退」入口的续玩按钮会永远隐藏。 */
      var label = '';
      if (C.core.freewave && C.core.freewave.saveLabel) label = C.core.freewave.saveLabel();
      if (!label && C.core.loop && C.core.loop.saveLabel) label = C.core.loop.saveLabel();
      btn.textContent = label || '';
      btn.classList.toggle('hidden', !label);
    } catch (e) { btn.classList.add('hidden'); }
  }

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

      var matched = partners.filter(function (pid) { return owned.indexOf(pid) !== -1; });

      // ③ 可选提示文本字段
      var note = textOf(def.synergyHint || def.synergyText || def.comboHint || def.comboNote ||
        (def.synergy && typeof def.synergy === 'object' ? def.synergy : null) ||
        (row && typeof row === 'object' ? row : null));

      if (matched.length) {
        var names = matched.map(function (pid) { return (TABLE[pid] || {}).name || pid; });
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

  function buildThemePicker() {
    var host = $('theme-host');
    if (!host || $('theme-picker')) return;
    var wrap = document.createElement('div');
    wrap.id = 'theme-picker';
    wrap.className = 'theme-picker';
    var head = document.createElement('div');
    head.className = 'theme-picker-label';
    head.textContent = '主题';
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
    host.appendChild(wrap);
  }

  function perkDefinition(id) {
    var perks = C.core.perks;
    return [perks.TABLE, perks.RECALL, perks.IMPACT, perks.LOOP, perks.FREE_WEAPON].reduce(function (found, table) {
      return found || (table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null);
    }, null);
  }

  function perkCard(id, opts) {
    opts = opts || {};
    var def = perkDefinition(id);
    var impact = Object.prototype.hasOwnProperty.call(C.core.perks.IMPACT, id);
    var rarityLabel = impact ? '专精' : (C.core.perks.RARITY_LABEL[def.rarity] || '');
    var d = document.createElement('button');
    d.className = 'perk-card ' + rarityClass(def.rarity) + (opts.locked ? ' locked' : '');
    d.type = 'button';
    d.innerHTML =
      '<div class="perk-top"><span class="perk-rarity">' + esc(rarityLabel) + '</span>' +
      '<span class="perk-tag">' + esc(def.tag || '') + '</span>' +
      mechanicBadge(def) + '</div>' +
      '<div class="perk-name">' + esc(def.name || id) + '</div>' +
      '<div class="perk-desc">' + esc(def.desc || '') + '</div>' +
      synergyBlock(opts.synergy) +
      (opts.footer || '');
    if (opts.locked) d.disabled = true;
    else if (!opts.noPick) d.addEventListener('click', function () { handlers.onPick && handlers.onPick(id); });
    return d;
  }

  /* C8：候选数由 choices 决定，2 或 3（乃至其它数量）均动态生成，不写死 2 */
  function showPerk(choices, nextIsBoss, prototype, impact, loop) {
    var box = $('perk-cards');
    var list = Array.isArray(choices) ? choices.filter(perkDefinition) : [];
    if (!list.length) {
      box.innerHTML = '';
      box.dataset.count = '1';
      $('perk-room').textContent = '';
      $('perk-title').textContent = '词条暂不可用';
      $('perk-sub').textContent = '返回首页可以重新开始。';
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn secondary';
      back.textContent = '返回首页';
      back.addEventListener('click', function () { if (handlers.onHome) handlers.onHome(); });
      box.appendChild(back);
      show('perk');
      return;
    }
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
    if (impact) {
      $('perk-room').textContent = '第 1 组已清';
      $('perk-title').textContent = '强化' + C.core.impact.weapons[st.impact.weapon].name;
      $('perk-sub').textContent = '获得 1 个构筑点。选一项强化，迎战下一组。';
    } else if (loop && st.free) {
      var style = C.core.freewave.getStyle(st.free.style);
      $('perk-title').textContent = '选择' + style.label + '强化';
      $('perk-room').textContent = '第 ' + st.free.layer + ' 层 · 第 ' + (st.free.roomInLayer + 1) + ' 间通过';
      $('perk-sub').textContent = nextIsBoss ? '选择一项强化，迎战巡廊者。' : '选择一项强化，带进下一间。';
    } else if (loop) {
      $('perk-title').textContent = '下一圈怎么走';
      $('perk-room').textContent = '第 ' + (st.loop ? st.loop.layer : 1) + ' 层 · 第 ' + ((st.roomIndex || 0) + 1) + ' 间 通过';
      $('perk-sub').textContent = nextIsBoss ?
        '选一条路线偏好 · 接下来是这一层的巡廊首领' :
        '选一条路线偏好 · 下一间廊道会换折角与敌人站位';
    } else {
      $('perk-title').textContent = prototype ? '选择回扫词条' : '选择词条';
      $('perk-sub').textContent = prototype ? '选一种效果带入普通房和首领战' :
        (nextIsBoss ? '选完即将进入终室 · 迎接本局的首领' : '选一个带进下一间房 · 效果可叠加');
      $('perk-room').textContent = prototype ? '试玩站位 ' + st.prototype : '第 ' + ((st.roomIndex || 0) + 1) + ' 间 通过';
    }
    show('perk');
  }

  function updateHud(s, cue) {
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
    var weaponButton = $('btn-switch-weapon');
    weaponButton.classList.toggle('hidden', !s.free);
    if (s.free && weaponButton.dataset.weapon !== s.free.weapon) {
      var isBlade = s.free.weapon === 'blade';
      weaponButton.dataset.weapon = s.free.weapon;
      $('hud-weapon').textContent = isBlade ? '大剑' : '手炮';
      weaponButton.setAttribute('aria-label', isBlade ? '当前大剑，切换手炮' : '当前手炮，切换大剑');
    }
    var p = s.player;
    var ratio = Math.max(0, p.hp / p.maxHp);
    $('hp-fill').style.width = (ratio * 100) + '%';
    var hp = Math.max(0, Math.ceil(p.hp));
    $('hp-text').textContent = hp + ' / ' + p.maxHp;
    $('hp-track').setAttribute('aria-valuenow', hp);
    $('hp-track').setAttribute('aria-valuemax', p.maxHp);
    $('hp-fill').classList.toggle('low', ratio < 0.3);
    var dash = $('dash-status');
    dash.textContent = p.dashCd > 0 ? p.dashCd.toFixed(1) + ' 秒' : '可用';
    dash.classList.toggle('waiting', p.dashCd > 0);

    var total = impact ? 2 : s.run.rooms.length;
    var idx = impact ? impact.wave - 1 : Math.min(s.roomIndex, total);
    var bossRoom = !impact && s.roomIndex >= total;
    $('room-name').textContent = s.room.name;
    var layerPrefix = s.free ? '第 ' + s.free.layer + ' 层 · ' :
      (s.loop ? '第 ' + s.loop.layer + ' 层 · ' : '');
    $('room-count').textContent = bossRoom ? (layerPrefix + '终室 · 首领') :
      (layerPrefix + '第 ' + (idx + 1) + ' / ' + total + (impact ? ' 组' : ' 间'));

    var dots = $('room-dots');
    var dotsKey = [total, idx, !!impact, s.phase === 'won'].join(':');
    if (dots.dataset.progress !== dotsKey) {
      dots.dataset.progress = dotsKey;
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
    }

    $('gold').textContent = s.gold;
    $('timer').textContent = s.elapsed.toFixed(1) + 's';

    var chips = $('perk-chips');
    var carried = impact && impact.perk ? [impact.perk] : (s.recallPerk ? [s.recallPerk] : Object.keys(s.perks));
    var chipsKey = carried.map(function (id) { return id + ':' + (s.perks[id] || 1); }).join(',');
    if (chips.dataset.carried !== chipsKey) {
      chips.dataset.carried = chipsKey;
      chips.innerHTML = '';
      carried.forEach(function (id) {
        var def = perkDefinition(id);
        if (!def) return;
        var c = document.createElement('span');
        c.className = 'chip ' + rarityClass(def.rarity);
        c.textContent = def.name + (s.perks[id] > 1 ? ' ×' + s.perks[id] : '');
        c.title = def.desc;
        chips.appendChild(c);
      });
    }

    var boss = s.enemies.filter(function (e) { return e.isBoss; })[0];
    var bw = $('boss-bar');
    if (boss) {
      bw.classList.remove('hidden');
      $('boss-name').textContent = s.run.boss.name;
      $('boss-fill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
    } else bw.classList.add('hidden');

    /* M9：护盾相位条 —— 闭合显示所需圈型与蓄势，暴露显示窗口倒计时，
     * 重构显示重建进度与下一相位。旧原型无 shield，整块自动隐藏。 */
    var sb = $('shield-bar'), sh = boss && boss.shield;
    if (sh && sh.spec) {
      sb.classList.remove('hidden');
      sb.dataset.state = sh.state;
      var spec = sh.spec;
      if (sh.state === 'closed') {
        $('shield-state').textContent = '护盾闭合 · 第 ' + spec.phase + ' 相位 · 需' + spec.requiredLabel;
        $('shield-fill').style.width = Math.min(100, sh.charge / spec.need * 100) + '%';
        $('shield-timer').textContent = sh.charge.toFixed(1) + '/' + spec.need;
      } else if (sh.state === 'exposed') {
        $('shield-state').textContent = '护盾崩解 · 全额输出窗口';
        $('shield-fill').style.width = Math.min(100, boss.guardOpen / spec.window * 100) + '%';
        $('shield-timer').textContent = boss.guardOpen.toFixed(1) + 's';
      } else {
        $('shield-state').textContent = '护盾重构 · 即将进入第 ' + (spec.phase + 1) + ' 相位';
        $('shield-fill').style.width = Math.min(100, sh.reform * 100) + '%';
        $('shield-timer').textContent = '';
      }
    } else sb.classList.add('hidden');

    /* M10：连扫蓄势条。此前只有 hint 里一句「连扫 ×N」，玩家看不到
     * 26 秒窗口还剩多久、倍率到底是多少，连续闭环的收益不可读。 */
    var tb = $('streak-bar');
    if ((s.loop || s.free) && s.phase !== 'won' && s.phase !== 'dead') {
      var L2 = s.loop || s.free;
      var SW = s.free ? C.core.perks.BALANCE.free : C.core.perks.BALANCE.loop;
      var lv = Math.max(1, L2.streak || 0);
      tb.classList.remove('hidden');
      tb.dataset.level = String(lv);
      if (s.free) {
        /* M13：倍率由「换型连扫」给出，重复同型逐次衰减；直接显示真实倍率，
         * 不再用 M11 那条按次数累加的旧口径，免得 HUD 与结算各说各话。 */
        var cr = s.free.lastCraft;
        $('streak-state').textContent = cr
          ? ('换型连扫 ×' + cr.streak + ' · 回扫 ' + cr.mul.toFixed(2) + '× · ' +
             (cr.switched ? '换型生效' : cr.first ? '首圈' : '同型衰减'))
          : '按 E 定起点 · 换圈型可叠连扫';
      } else {
        $('streak-state').textContent = lv > 1
          ? ('连扫 ×' + lv + ' · 回扫 ' + (1 + SW.streakStep * (lv - 1)).toFixed(2) + '×')
          : '连扫待蓄 · 连续闭环可叠加';
      }
      $('streak-fill').style.width = (lv > 1
        ? Math.min(100, (L2.streakTimer || 0) / SW.streakWindow * 100) : 0) + '%';
      $('streak-timer').textContent = lv > 1 ? (L2.streakTimer || 0).toFixed(1) + 's' : '';
    } else tb.classList.add('hidden');

    var hint = s.room.path_hint || '';
    if (s.phase === 'won' || s.phase === 'dead') hint = '';
    else if (impact) {
      if (impact.trial) {
        hint = '';
        if (cue) {
          if (cue.ready) hint = cue.effect === 'fold' ? '松开再按左键 · 侧向补击' : '左键 · 侧击借势';
          else hint = Math.hypot(p.x - cue.spot.x, p.y - cue.spot.y) < 18 ? '转向标记指向的目标' : '走到青色标记处，寻找侧击角度';
        }
      }
      else if (impact.combinations) hint = impact.awakeAt === Infinity ? '打飞，再松开左键补击一次' : '';
      else if (impact.awakeAt === Infinity) hint = C.core.impact.weapons[impact.weapon].opening;
      else if (impact.wave === 2) hint = C.core.perks.IMPACT[impact.perk].desc;
      else hint = impact.weapon === 'blade' ? '贴近飞行中的敌人，朝新方向再挥一刀' : '换个角度补一枪，改写飞行方向';
    }
    else if (s.loop || s.free) {
      var L = s.loop || s.free, rec = s.recall;
      var streakTag = L.streak > 1 ? ' · 连扫 ×' + L.streak : '';
      if (s.free) {
        var f = s.free, sh3 = boss && boss.shield, lv = f.live;
        if (f.armed) {
          hint = lv
            ? ('正在画 ' + lv.label + ' ' + lv.area + 'm² · ' +
               (lv.switched ? '换型可叠连扫' : '与上圈同型 · 换个圈型') +
               (lv.ready ? ' · 回起点兑现' : ' · 还不够大'))
            : ('回到起点兑现 · 已走 ' + f.path.length + ' 点' + streakTag);
        }
        else if (sh3 && sh3.state === 'exposed') hint = '护盾崩解 · ' + boss.guardOpen.toFixed(1) + ' 秒全额输出';
        else if (sh3) hint = '第 ' + sh3.spec.phase + ' 相位 · 需' + sh3.spec.requiredLabel + '闭环破盾';
        else {
          var lastCn = f.lastTag
            ? (f.lastTag.indexOf('big') === 0 ? '大圈' :
               f.lastTag.indexOf('mid') === 0 ? '中圈' : '小圈') +
              (f.lastTag.indexOf('+bent') !== -1 ? '·折角' : '')
            : '';
          hint = '按 E 定起点 · 绕一圈回到起点兑现' +
            (lastCn ? ' · 上一圈 ' + lastCn + '，换型可叠连扫' : '') + streakTag;
        }
        if (f.tileBuff && f.tileBuff.kind !== 'none') hint += ' · ' + f.tileBuff.label;
      }
      else if (s.exitActive) hint = '本间已清 · 走到右侧廊口' + streakTag;
      else if (boss && boss.patrol) {
        var sh2 = boss.shield;
        if (sh2 && sh2.state === 'exposed') hint = '护盾崩解 · ' + boss.guardOpen.toFixed(1) + ' 秒全额输出 · 继续绕圈可吃回扫加成';
        else if (sh2 && sh2.state === 'reforming') hint = '护盾重构中 · 下一相位需' + sh2.spec.requiredLabel;
        else if (sh2) hint = '第 ' + sh2.spec.phase + ' 相位 · 用' + sh2.spec.requiredLabel + '闭环破盾（' +
          sh2.charge.toFixed(1) + '/' + sh2.spec.need + '）';
        else if (boss.guardOpen > 0) hint = '护盾已开 · ' + boss.guardOpen.toFixed(1) + ' 秒 · 趁窗口补枪';
        else if (boss.patrol.warning > 0) hint = '巡行预警 · 即将走' + (boss.patrol.route ? boss.patrol.route.name : '下一条廊');
        else if (rec && rec.wave) hint = '回扫正在沿路传播' + streakTag;
        else hint = '从另一条廊绕回，回扫打开护盾' + streakTag;
      } else if (rec && rec.wave) hint = '回扫正在沿路传播' + streakTag;
      else if (rec && rec.origin == null) hint = '走到任一廊口，开始下一圈' + streakTag;
      else if (rec && rec.outbound) hint = '从另一条廊回到标记处' + streakTag;
      else hint = (s.room.path_hint || '') + streakTag;
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
    $('hint').classList.toggle('hint-guide', !!cue);
    $('source').textContent = s.free ? C.core.freewave.getStyle(s.free.style).label + '流派' : (s.loop ? '回廊长局' :
      (impact ? C.core.impact.weapons[impact.weapon].name : (s.prototype ? '试玩 ' + s.prototype :
      (s.source === 'fallback' ? '离线模板 #' + ((s.templateIndex || 0) + 1) : 'AI 生成'))));
  }

  function showEnd(result) {
    var trial = result.prototype || result.impact;
    var loop = !!result.loop;
    var state = C.core.engine.getState();
    $('end-title').textContent = result.cleared ? '通关' : '本局结束';
    $('end-title').className = result.cleared ? 'end-title win' : 'end-title lose';
    $('end-summary').textContent = result.summary || '';
    $('end-stats').innerHTML =
      stat('战斗用时', result.seconds.toFixed(1) + ' 秒') +
      (result.impact ? stat('通过组数', String(result.waves)) : stat('通过房间', String(result.rooms))) +
      stat('击杀', String(result.kills)) +
      (loop ? stat('抵达层数', String(result.layers || 1)) + stat('完成闭环', String(result.loops || 0)) +
        stat('护盾崩解', String(result.breaks || 0)) :
        (result.impact && !result.combinations ? stat('最长接力', String(result.bestChain)) :
          (trial ? '' : stat('获得金币', '+' + result.gold))));
    $('end-wallet').classList.toggle('hidden', !!trial);
    $('btn-unlock').classList.toggle('hidden', !!trial);
    $('btn-end-home').textContent = state && state.impact && state.impact.trial ? '更换武器 / 设置' : '返回首页';
    if (!trial) $('end-gold').textContent = C.core.engine.getMeta().gold;
    show('end');
  }

  function stat(label, value) {
    return '<div class="stat"><span class="stat-v">' + value + '</span><span class="stat-l">' + label + '</span></div>';
  }

  function showUnlock(fromEnd) {
    var engine = C.core.engine, meta = engine.loadMeta();
    $('unlock-gold').textContent = meta.gold;
    if (fromEnd) $('end-gold').textContent = meta.gold;
    var reset = $('unlock-reset');
    reset.disabled = !meta.unlocked.length;
    reset.textContent = '重置并返还金币';
    delete reset.dataset.confirm;
    var box = $('unlock-grid');
    var scroll = currentScreen === 'unlock' ? box.scrollTop : 0;
    box.innerHTML = '';
    C.core.perks.IDS.forEach(function (id) {
      var owned = meta.unlocked.indexOf(id) !== -1;
      var card = perkCard(id, {
        locked: owned,
        noPick: true,
        footer: '<div class="perk-price">' + (owned ? '已解锁 · 开局自带' : engine.UNLOCK_COST + ' 金币解锁') + '</div>'
      });
      if (!owned) {
        card.addEventListener('click', function () { handlers.onUnlock && handlers.onUnlock(id); });
        card.classList.toggle('poor', meta.gold < engine.UNLOCK_COST);
      }
      box.appendChild(card);
    });
    $('unlock-back').dataset.from = fromEnd ? 'end' : 'start';
    show('unlock');
    box.scrollTop = scroll;
  }

  function setMuted(m) {
    var b = $('btn-mute');
    b.textContent = m ? '音效 关' : '音效 开';
    b.classList.toggle('off', m);
    b.setAttribute('aria-pressed', m ? 'true' : 'false');
  }

  function init(h) {
    handlers = h || {};
    $('btn-start').addEventListener('click', function () { handlers.onStart && handlers.onStart(); });
    var loopBtn = $('btn-loop');
    if (loopBtn) loopBtn.addEventListener('click', function () { show('free-setup'); });
    if (C.core.freewave) {
      Object.keys(C.core.freewave.STYLES).forEach(function (id) {
        $('btn-free-' + id).addEventListener('click', function () { if (handlers.onFree) handlers.onFree(id); });
      });
    }
    $('btn-free-back').addEventListener('click', function () { show('start'); });
    var contBtn = $('btn-loop-continue');
    if (contBtn) contBtn.addEventListener('click', function () { handlers.onFreeContinue && handlers.onFreeContinue(); });
    var classicBtn = $('btn-loop-classic');
    if (classicBtn) classicBtn.addEventListener('click', function () { handlers.onLoop && handlers.onLoop(); });
    $('btn-trial-setup').addEventListener('click', function () { show('trial'); });
    $('btn-trial-back').addEventListener('click', function () { show('start'); });
    $('btn-trial-start').addEventListener('click', function () {
      if (handlers.onTrial) handlers.onTrial($('trial-weapon').value, $('trial-version').value, $('trial-preset').value);
    });
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
    var reset = $('unlock-reset');
    reset.addEventListener('click', function () {
      if (reset.disabled) return;
      if (reset.dataset.confirm) {
        if (handlers.onResetUnlocks) handlers.onResetUnlocks($('unlock-back').dataset.from === 'end');
      } else {
        reset.dataset.confirm = 'true';
        reset.textContent = '确认重置所有局外技能';
      }
    });
    $('btn-switch-weapon').addEventListener('click', function () { if (handlers.onSwitchWeapon) handlers.onSwitchWeapon(); });
    $('btn-mute').addEventListener('click', function () { handlers.onToggleMute && handlers.onToggleMute(); });
    $('btn-pause').addEventListener('click', function () { handlers.onPause && handlers.onPause(); });
    /* B9：暂停面板三个出口，全部交给 main.js 编排 */
    $('btn-resume').addEventListener('click', function () { handlers.onResume && handlers.onResume(); });
    $('btn-pause-restart').addEventListener('click', function () { handlers.onRestart && handlers.onRestart(); });
    $('btn-pause-home').addEventListener('click', function () { handlers.onHome && handlers.onHome(); });
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
