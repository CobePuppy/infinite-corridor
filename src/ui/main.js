/* ui/main.js — 启动、输入、主循环、事件编排
 * 唯一把 core / gen / theme / ui 四层接起来的地方。
 */
(function (C) {
  'use strict';

  var canvas, ctx;
  var engine, render, screens, audio;
  var last = 0, clock = 0, battleClock = 0, paused = false, starting = false;
  var input = { up: false, down: false, left: false, right: false, fire: false, dash: false, arm: false, aimX: null, aimY: null };
  var held = {};

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = render.W * dpr;
    canvas.height = render.H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toWorld(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * render.W,
      y: (ev.clientY - r.top) / r.height * render.H
    };
  }

  function syncInput() {
    input.up = !!(held.w || held.arrowup);
    input.down = !!(held.s || held.arrowdown);
    input.left = !!(held.a || held.arrowleft);
    input.right = !!(held.d || held.arrowright);
    input.dash = !!held.shift;
    input.arm = !!held.e;
    input.fire = !!held.mouse || !!held[' '] || !!held.j;
  }

  function clearInput() {
    held = {};
    syncInput();
    input.attackPressed = false;
  }

  /* ---------- T27-C：主题 data 属性 ---------- */
  /* 兼容旧接口 active()，异常时回落 readyIds()[0] / geometry，保证一定能开局 */
  function activeThemeId() {
    try {
      if (C.theme && typeof C.theme.active === 'function') {
        var id = C.theme.active();
        if (id) return id;
      }
      if (C.theme && typeof C.theme.readyIds === 'function') {
        var ids = C.theme.readyIds();
        if (ids && ids.length) return ids[0];
      }
    } catch (e) { /* 主题层并行改动时容错 */ }
    return 'geometry';
  }

  /* 开局时把当前主题 id 写到 #app，供 visual-dev 的 [data-theme="..."] CSS 命中 */
  function applyAppDataTheme(themeId) {
    try {
      var app = document.getElementById('app');
      if (app) app.dataset.theme = themeId || activeThemeId();
    } catch (e) { /* 不影响开局 */ }
  }

  /* ---------- T27-B：新事件 toast（全部软依赖，事件/字段缺失即跳过） ---------- */
  function optField(p, keys) {
    if (!p || typeof p !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      if (p[keys[i]] != null && p[keys[i]] !== '') return p[keys[i]];
    }
    return null;
  }

  /* 房间类型标签：优先复用 screens.js 的映射，方法缺失时本地兜底 */
  function roomLabel(v) {
    try {
      if (screens && typeof screens.roomTypeLabel === 'function') return screens.roomTypeLabel(v);
    } catch (e) { /* 落到本地兜底 */ }
    if (v == null) return '';
    var map = { normal: '普通', common: '普通', elite: '精英', event: '事件', rest: '休整' };
    var s = String(v);
    return map[s.toLowerCase()] || s;
  }

  function toastRoomType(p) {
    var v = optField(p, ['roomType', 'room_type', 'kind', 'label', 'name', 'value']);
    var label = roomLabel(v);
    if (!label) return;                 // 取不到字段 → 安全跳过，不 toast 空内容
    screens.toast('进入' + label + '房间', 2200);
  }

  function toastBossPhase(p) {
    var v = optField(p, ['bossPhase', 'boss_phase', 'phase', 'value']);
    var n = Number(v);
    if (!isFinite(n) || n < 2) return; // 仅阶段 >=2 提示（含 bossPhase=2），缺省/1 跳过
    screens.toast('首领进入第 ' + n + ' 阶段 · 攻势强化', 2600);
  }

  /* logic-dev 的新事件名尚未定稿：按关键字软识别，未知事件一律安全跳过 */
  function softEvent(type, p) {
    try {
      var t = String(type || '').toLowerCase();
      if (t.indexOf('roomtype') !== -1 || t.indexOf('room_type') !== -1 ||
          t === 'roomkind' || t === 'roomkindenter') {
        toastRoomType(p);
      } else if (t.indexOf('bossphase') !== -1 || t.indexOf('boss_phase') !== -1 ||
                 t.indexOf('phasechange') !== -1 || t === 'bosspowerup') {
        toastBossPhase(p);
      }
    } catch (e) { /* payload 形态未知时不影响主流程 */ }
  }

  var lastClosureToast = 0;

  function onEvent(type, p) {
    switch (type) {
      case 'runStart':
        screens.show(null);
        if (p.free) {
          screens.toast(p.continued ? ('续玩 · 第 ' + p.layer + ' 层') :
            ('自由回廊 · 按 E 定起点，绕一圈回到起点'), 3200);
          break;
        }
        if (p.loop) {
          screens.toast(p.continued ? ('续玩 · 第 ' + p.layer + ' 层') :
            ('回廊长局 · 第 ' + p.layer + ' 层 · 从另一边回来'), 3000);
          break;
        }
        if (p.prototype || p.impact) break;
        screens.toast('第 ' + p.runIndex + ' 局 · ' + (p.source === 'fallback' ? '离线关卡模板' : 'AI 生成关卡'), 2200);
        break;
      case 'loopClosed':
        if (p.streak > 1) screens.toast('连扫 ×' + p.streak + (p.heal ? ' · 归廊 +' + p.heal + ' 生命' : ''), 1500);
        break;
      /* M11：自由回扫 / 凝滞 / 完美闪避 / 地效 / 连段的界面反馈。
       * 首领房的破盾 toast 由 M9 五个 case 独占，这里不插嘴。 */
      case 'freeArm':
        screens.toast('起点已定 · 绕一圈，回到这里兑现', 1800);
        break;
      case 'freeReject':
        screens.toast('圈太小 · 起点已重设，绕大一点再回来（面积 ' + p.area + '）', 1800);
        break;
      case 'perfectDodge':
        if (p.kind === 'perfect') screens.toast('完美闪避 · 增伤 + 冷却缩减', 1400);
        else if (p.kind === 'normal') screens.toast('闪避 · 削弱版增益', 1000);
        break;
      case 'tileEnter':
        screens.toast(p.kind === 'good' ? ('增幅格 · ' + p.label) : ('滞涩格 · ' + p.label), 1100);
        break;
      case 'chargeWarning':
        screens.toast('冲锋预警 · 现在闪避可触发完美闪避', 900);
        break;
      case 'comboTier':
        screens.toast('连段 ×' + p.combo + ' · 等级 ' + p.tier, 1200);
        break;
      /* M10：闭环兑现反馈。首领房有 M9 的五个护盾 toast，这里主动让位避免刷屏；
       * 普通房按 1.5 秒节流播报圈型 / 长度 / 连扫倍率 / 下圈回扫伤害。 */
      case 'loopClosure': {
        var lst = C.core.engine.getState();
        var shielded = lst && lst.enemies && lst.enemies.some(function (e) { return e.shield && !e.dead; });
        var now = Date.now();
        if (!shielded && now - lastClosureToast > 1500) {
          lastClosureToast = now;
          screens.toast('闭环兑现 · ' + p.label + ' ' + (p.length / 1000).toFixed(1) +
            'k · 连扫 ×' + p.streak + ' · 下圈回扫 ' + p.damage, 1500);
        }
        break;
      }
      case 'loopLayer':
        screens.toast('第 ' + p.layer + ' 层 · 进度已保存，可随时退出续玩', 3200);
        break;
      /* M9：破盾三态反馈。此前 engine 发出的 loopShieldOpen 没有任何 case 接，
       * 破盾/未破盾在界面上完全无感；这里把相位推进逐条讲清楚。 */
      case 'bossShieldBreak':
        screens.toast('护盾崩解 · 第 ' + p.phase + ' 相位 · ' + p.window.toFixed(1) + ' 秒全额输出', 2400);
        break;
      case 'bossShieldCharge':
        if (!p.matched) screens.toast('圈型不符 · 本相位需' + p.requiredLabel + '（折算蓄势）', 1500);
        break;
      case 'bossShieldClose':
        screens.toast('窗口结束 · 护盾开始重构', 1600);
        break;
      case 'bossShieldReform':
        screens.toast('第 ' + p.phase + ' 相位 · 需「' + p.requiredLabel + '」闭环破盾 · ' + p.need + ' 次', 3000);
        break;
      case 'bossShieldHit':
        break;
      case 'roomEnter': {
        /* M1 文案不变；若 logic-dev 把 roomType 挂在 roomEnter 上则追加类型标签 */
        var r = (p && p.room) || {};
        var rt = optField(p, ['roomType', 'room_type', 'kind']);
        /* normal 是默认态，不额外标注（避免每间房都刷「· 普通房」） */
        var lbl = (rt != null && String(rt).toLowerCase() !== 'normal') ? roomLabel(rt) : '';
        screens.toast((r.name || '') + ' · ' + (r.path_hint || '') + (lbl ? ' · ' + lbl + '房' : ''), 3200);
        break;
      }
      /* T28：engine.enterRoom() 对 rest / event 房发出的 roomEvent，此前无任何 case 接，
       * 玩家拿到回血 / 金币却没有反馈。此处精确接住，缺省字段安全跳过。 */
      case 'roomEvent':
        if (p && p.kind === 'rest' && p.healed) screens.toast('休整间 · 回复 ' + p.healed + ' 点生命', 2200);
        else if (p && p.kind === 'event' && p.gold) screens.toast('事件间 · 拾得 ' + p.gold + ' 金币', 2200);
        else if (p && p.kind === 'elite') screens.toast('精英间 · 敌人更强，小心', 2200);
        break;
      case 'roomClear':
        screens.toast('本间已清 · 出口开启' + (p.healed ? ' · 回响 +' + p.healed : ''), 2200);
        break;
      case 'bossEnter':
        screens.toast(p.shield ? ('巡廊者 · 护盾第 ' + p.shield.phase + ' 相位 · 需' + p.shield.requiredLabel + '破盾') :
          ('终室 · ' + p.boss.name), 3200);
        break;
      case 'roomTypeEnter':
      case 'roomType':
      case 'roomTypeChange':
      case 'roomKind':
        toastRoomType(p);
        break;
      case 'bossPhase':
      case 'bossPhaseChange':
      case 'bossPhaseEnter':
        toastBossPhase(p);
        break;
      case 'perkOffer':
        screens.showPerk(p.choices, p.nextIsBoss, p.prototype, p.impact, p.loop);
        break;
      case 'perkPicked':
        screens.toast('获得「' + p.def.name + '」· ' + p.def.desc, 2000);
        break;
      case 'playerHurt':
        if (p.shielded) screens.toast('余烬触发 · 保留 1 点生命', 2000);
        break;
      case 'runEnd':
        screens.showEnd(p);
        break;
      default:
        softEvent(type, p);
        break;
    }
  }

  async function begin(mode) {
    if (starting) return;
    starting = true;
    clearInput();
    audio.resume();
    screens.dismissToast();
    var themeId = activeThemeId();
    applyAppDataTheme(themeId);
    input.aimX = input.aimY = null;
    try {
      screens.show('loading');
      var s = await engine.startRun(Object.assign({ onEvent: onEvent, theme: themeId }, mode));
      screens.updateHud(s);
      battleClock = 0;
      paused = false;
    } catch (e) {
      screens.show(mode && mode.impactTrial ? 'trial' : 'start');
      screens.toast('开局失败，请重试');
    } finally {
      starting = false;
    }
  }

  function restart() {
    var s = engine.getState();
    if (s && s.free) return begin({ free: true });
    if (s && s.loop) return begin({ loop: true });
    if (s && s.impact) return begin({
      impactWeapon: s.impact.weapon, impactCombinations: s.impact.combinations, impactTrial: s.impact.trial
    });
    return begin(s && { prototype: s.prototype });
  }

  /* B9：统一的暂停开关 —— 暂停时打开面板，继续时收起面板 */
  function setPaused(v) {
    paused = !!v;
    clearInput();
    if (paused) {
      var s = engine.getState();
      var trial = s.impact && s.impact.trial;
      document.getElementById('pause-context').textContent = s.room.name +
        (s.impact ? ' · 第 ' + s.impact.wave + ' / 2 组' : '');
      document.getElementById('btn-pause-home').textContent = trial ? '返回单房设置' : '返回首页';
    }
    screens.show(paused ? 'pause' : null);
  }

  function loop(ts) {
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    clock += dt;
    /* B7/B9：暂停或任意弹窗打开时只重绘静止帧、不推进引擎，
     * 避免「弹窗里游戏还在后台跑」以及暂停后 HUD 继续走字。 */
    var cur = screens.current();
    if (!starting && !paused && !cur) {
      battleClock += dt;
      syncInput();
      var s = engine.update(dt, input);
      if (dt > 0) input.attackPressed = false;
      var cue = C.ui.combatGuide.get(s);
      render.draw(ctx, s, battleClock, null, cue);
      screens.updateHud(s, cue);
    } else {
      var backdrop = cur === 'start' || cur === 'trial' || cur === 'loading' || cur === 'unlock';
      render.draw(ctx, backdrop ? null : engine.getState(), backdrop ? clock : battleClock);
    }
    requestAnimationFrame(loop);
  }

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    engine = C.core.engine;
    render = C.ui.render;
    screens = C.ui.screens;
    audio = C.core.audio;

    resize();
    window.addEventListener('resize', resize);
    engine.loadMeta();

    screens.init({
      onStart: begin,
      onFree: function () { begin({ free: true }); },
      onFreeContinue: function () { begin({ free: true, continueRun: true }); },
      onLoop: function () { begin({ loop: true }); },
      onLoopContinue: function () { begin({ loop: true, continueRun: true }); },
      onRecall: function (variant) { begin({ prototype: variant }); },
      onImpact: function (weapon) { begin({ impactWeapon: weapon }); },
      onImpactCombinations: function (weapon) { begin({ impactWeapon: weapon, impactCombinations: true }); },
      onTrial: function (weapon, version, preset) {
        begin({ impactWeapon: weapon, impactTrial: { version: version, preset: preset } });
      },
      onRestart: restart,
      onPick: function (id) {
        if (engine.choosePerk(id)) {
          clearInput();
          screens.show(null);
        }
      },
      onUnlock: function (id) {
        var from = document.getElementById('unlock-back').dataset.from;
        var r = engine.unlock(id);
        if (r.ok) { audio.play('pick'); screens.showUnlock(from === 'end'); screens.toast('已解锁 · 下局开局自带'); }
        else screens.toast(r.reason === 'poor' ? '金币不足，需要 60' : '已经解锁过了');
      },
      onToggleMute: function () {
        var m = !audio.isMuted();
        audio.setMuted(m);
        screens.setMuted(m);
      },
      onPause: function () { if (!starting && !screens.current()) setPaused(true); },
      /* B9：暂停面板三个出口 */
      onResume: function () { setPaused(false); },
      onHome: function () {
        paused = true;
        clearInput();
        screens.dismissToast();
        var s = engine.getState();
        screens.show(s && s.impact && s.impact.trial ? 'trial' : 'start');
      }
    });
    screens.setMuted(audio.isMuted());

    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      var cur = screens.current();
      if (starting || (e.target && e.target.tagName === 'SELECT' && k !== 'escape')) return;
      if (k === 'm' && !e.repeat) {
        var m = !audio.isMuted(); audio.setMuted(m); screens.setMuted(m);
      }
      if (k === 'escape') {
        if (e.repeat) return;
        /* B7：Esc 语义按当前弹窗分流，杜绝「解锁页 / 词条页里叠加暂停」的冲突。
         *  - 解锁页 → 返回（等同顶部 × / 底部「返回」）
         *  - 暂停面板 → 继续
         *  - 开始页 / 结算页 / 词条页 → 不叠加暂停（词条选择不可跳过）
         *  - 无弹窗（游戏中）→ 切换暂停并打开暂停面板 */
        if (cur === 'unlock') screens.backFromUnlock();
        else if (cur === 'trial') screens.show('start');
        else if (cur === 'pause') setPaused(false);
        else if (cur === 'perk') screens.toast('请先选择一条路径', 1600);
        else if (cur === 'start' || cur === 'end') { /* 不叠加暂停 */ }
        else setPaused(!paused);
        return;
      }
      if (cur === 'end' && !e.repeat && (k === 'r' || (k === 'enter' && (!e.target || e.target.tagName !== 'BUTTON')))) {
        restart();
        return;
      }
      if (cur || paused) return;
      if (k === ' ' && e.target && e.target.tagName === 'BUTTON') return;
      held[k] = true;
      if (!e.repeat && (k === ' ' || k === 'j')) input.attackPressed = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) !== -1) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { held[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', clearInput);

    canvas.addEventListener('mousemove', function (e) {
      var p = toWorld(e);
      input.aimX = p.x; input.aimY = p.y;
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || starting || paused || screens.current()) return;
      held.mouse = true;
      var p = toWorld(e);
      input.aimX = p.x; input.aimY = p.y;
      input.attackPressed = true;
      audio.resume();
    });
    window.addEventListener('mouseup', function () { held.mouse = false; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* 开局前也渲染一帧静态背景，避免黑屏 */
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.Corridor = window.Corridor || {});
