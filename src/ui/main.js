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

  function onEvent(type, p) {
    switch (type) {
      case 'runStart':
        screens.show(null);
        screens.toast('第 ' + p.runIndex + ' 局 · ' + (p.source === 'fallback' ? '离线关卡模板' : 'AI 生成关卡'), 2200);
        break;
      case 'roomEnter':
        screens.toast(p.room.name + ' · ' + p.room.path_hint, 3200);
        break;
      case 'roomClear':
        screens.toast('本间已清 · 出口开启' + (p.healed ? ' · 回响 +' + p.healed : ''), 2200);
        break;
      case 'bossEnter':
        screens.toast('终室 · ' + p.boss.name, 2600);
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
      default: break;
    }
  }

  async function begin() {
    audio.resume();
    screens.show(null);
    await engine.startRun({ onEvent: onEvent });
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
