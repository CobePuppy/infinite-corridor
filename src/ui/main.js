/* ui/main.js — 启动、输入、主循环、事件编排
 * 唯一把 core / gen / theme / ui 四层接起来的地方。
 */
(function (C) {
  'use strict';

  var canvas, ctx;
  var engine, render, screens, audio;
  var last = 0, clock = 0, paused = false;
  var input = { up: false, down: false, left: false, right: false, fire: false, dash: false, aimX: null, aimY: null };
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
    input.fire = !!held.mouse || !!held[' '] || !!held.j;
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

  function onEvent(type, p) {
    switch (type) {
      case 'runStart':
        screens.show(null);
        screens.toast('第 ' + p.runIndex + ' 局 · ' + (p.source === 'fallback' ? '离线关卡模板' : 'AI 生成关卡'), 2200);
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
        screens.toast('终室 · ' + p.boss.name, 2600);
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
        screens.showPerk(p.choices, p.nextIsBoss);
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

  async function begin() {
    audio.resume();
    screens.show(null);
    var themeId = activeThemeId();
    applyAppDataTheme(themeId);        // 每次开局刷新，覆盖切主题后的重开
    await engine.startRun({ onEvent: onEvent, theme: themeId });
  }

  function loop(ts) {
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    clock += dt;
    if (!paused) {
      syncInput();
      var s = engine.update(dt, input);
      render.draw(ctx, s, clock);
      screens.updateHud(s);
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
      onRestart: begin,
      onPick: function (id) { engine.choosePerk(id); screens.show(null); },
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
      }
    });
    screens.setMuted(audio.isMuted());

    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      held[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) !== -1) e.preventDefault();
      if (k === 'm') {
        var m = !audio.isMuted(); audio.setMuted(m); screens.setMuted(m);
      }
      if (k === 'escape') {
        paused = !paused;
        screens.toast(paused ? '已暂停 · 再按 Esc 继续' : '继续', 1600);
      }
      if ((k === 'r' || k === 'enter') && e.target && e.target.tagName !== 'BUTTON' && !document.getElementById('screen-end').classList.contains('hidden')) begin();
    });
    window.addEventListener('keyup', function (e) { held[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', function () { held = {}; });

    canvas.addEventListener('mousemove', function (e) {
      var p = toWorld(e);
      input.aimX = p.x; input.aimY = p.y;
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) { held.mouse = true; audio.resume(); }
    });
    window.addEventListener('mouseup', function () { held.mouse = false; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* 开局前也渲染一帧静态背景，避免黑屏 */
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.Corridor = window.Corridor || {});
