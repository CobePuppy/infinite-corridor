/* ui/screens.js — DOM 覆盖层：开始页 / HUD / 二选一词条弹窗 / 结算页 / 局外解锁页
 * 视觉排版交给 CSS，这里只做状态与内容填充。
 */
(function (C) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var handlers = {};
  var toastTimer = null;

  function show(name) {
    ['start', 'perk', 'end', 'unlock'].forEach(function (n) {
      var el = $('screen-' + n);
      if (el) el.classList.toggle('hidden', n !== name);
    });
    var overlay = $('overlay');
    overlay.classList.toggle('hidden', !name);
    overlay.classList.toggle('dim', !!name && name !== 'perk');
    $('hud').classList.toggle('hidden', name === 'start' || name === 'unlock');
  }

  function toast(text, ms) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }

  function rarityClass(r) { return 'r-' + r; }

  function perkCard(id, opts) {
    var def = C.core.perks.TABLE[id];
    opts = opts || {};
    var d = document.createElement('button');
    d.className = 'perk-card ' + rarityClass(def.rarity) + (opts.locked ? ' locked' : '');
    d.type = 'button';
    d.innerHTML =
      '<div class="perk-top"><span class="perk-rarity">' + C.core.perks.RARITY_LABEL[def.rarity] + '</span>' +
      '<span class="perk-tag">' + def.tag + '</span></div>' +
      '<div class="perk-name">' + def.name + '</div>' +
      '<div class="perk-desc">' + def.desc + '</div>' +
      '<div class="perk-id">' + def.id + '</div>' +
      (opts.footer || '');
    if (opts.locked) d.disabled = true;
    else if (!opts.noPick) d.addEventListener('click', function () { handlers.onPick && handlers.onPick(id); });
    return d;
  }

  function showPerk(choices, nextIsBoss) {
    var box = $('perk-cards');
    box.innerHTML = '';
    choices.forEach(function (id) { box.appendChild(perkCard(id)); });
    $('perk-sub').textContent = nextIsBoss ? '选完即将进入终室 · 迎接本局的首领' : '选一个带进下一间房 · 效果可叠加';
    $('perk-room').textContent = '第 ' + (C.core.engine.getState().roomIndex + 1) + ' 间 通过';
    show('perk');
  }

  function updateHud(s) {
    if (!s || !s.room) return;
    var p = s.player;
    var ratio = Math.max(0, p.hp / p.maxHp);
    $('hp-fill').style.width = (ratio * 100) + '%';
    $('hp-text').textContent = Math.max(0, Math.ceil(p.hp)) + ' / ' + p.maxHp;
    $('hp-fill').classList.toggle('low', ratio < 0.3);

    var total = s.run.rooms.length;
    var idx = Math.min(s.roomIndex, total);
    $('room-name').textContent = s.room.name;
    $('room-count').textContent = s.phase === 'boss' ? '终室 · 首领' : '第 ' + (idx + 1) + ' / ' + total + ' 间';

    var dots = $('room-dots');
    dots.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var d = document.createElement('i');
      d.className = 'dot' + (i < idx ? ' done' : (i === idx ? ' now' : ''));
      dots.appendChild(d);
    }
    var bossDot = document.createElement('i');
    bossDot.className = 'dot boss' + (s.phase === 'boss' ? ' now' : (s.phase === 'won' ? ' done' : ''));
    dots.appendChild(bossDot);

    $('gold').textContent = s.gold;
    $('timer').textContent = s.elapsed.toFixed(1) + 's';

    var chips = $('perk-chips');
    chips.innerHTML = '';
    Object.keys(s.perks).forEach(function (id) {
      var def = C.core.perks.TABLE[id];
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

    $('hint').textContent = s.exitActive ? '出口已开启 → 走到右侧光环' : (s.room.path_hint || '');
    $('source').textContent = s.source === 'fallback' ? '离线模板 #' + ((s.templateIndex || 0) + 1) : 'AI 生成';
  }

  function showEnd(result) {
    $('end-title').textContent = result.cleared ? '走廊走到了尽头' : '这次停在了这里';
    $('end-title').className = result.cleared ? 'end-title win' : 'end-title lose';
    $('end-summary').textContent = result.summary || '';
    $('end-stats').innerHTML =
      stat('存活', result.seconds.toFixed(1) + 's') +
      stat('通过房间', String(result.rooms)) +
      stat('击杀', String(result.kills)) +
      stat('获得金币', '+' + result.gold);
    $('end-gold').textContent = C.core.engine.getMeta().gold;
    show('end');
  }

  function stat(label, value) {
    return '<div class="stat"><span class="stat-v">' + value + '</span><span class="stat-l">' + label + '</span></div>';
  }

  function showUnlock(fromEnd) {
    var meta = C.core.engine.getMeta();
    $('unlock-gold').textContent = meta.gold;
    var box = $('unlock-grid');
    box.innerHTML = '';
    C.core.perks.IDS.forEach(function (id) {
      var owned = meta.unlocked.indexOf(id) !== -1;
      var card = perkCard(id, {
        locked: owned,
        noPick: true,
        footer: '<div class="perk-price">' + (owned ? '已解锁 · 开局自带' : '60 金币解锁') + '</div>'
      });
      if (!owned) {
        card.addEventListener('click', function () { handlers.onUnlock && handlers.onUnlock(id); });
        card.classList.toggle('poor', meta.gold < 60);
      }
      box.appendChild(card);
    });
    $('unlock-back').dataset.from = fromEnd ? 'end' : 'start';
    show('unlock');
  }

  function setMuted(m) {
    var b = $('btn-mute');
    b.textContent = m ? '音效 关' : '音效 开';
    b.classList.toggle('off', m);
  }

  function init(h) {
    handlers = h || {};
    $('btn-start').addEventListener('click', function () { handlers.onStart && handlers.onStart(); });
    $('btn-restart').addEventListener('click', function () { handlers.onRestart && handlers.onRestart(); });
    $('btn-unlock').addEventListener('click', function () { showUnlock(true); });
    $('btn-unlock-start').addEventListener('click', function () { showUnlock(false); });
    $('unlock-back').addEventListener('click', function () {
      show($('unlock-back').dataset.from === 'end' ? 'end' : 'start');
    });
    $('btn-mute').addEventListener('click', function () { handlers.onToggleMute && handlers.onToggleMute(); });
    show('start');
  }

  C.ui = C.ui || {};
  C.ui.screens = {
    init: init, show: show, toast: toast, showPerk: showPerk,
    updateHud: updateHud, showEnd: showEnd, showUnlock: showUnlock, setMuted: setMuted
  };
})(window.Corridor = window.Corridor || {});
