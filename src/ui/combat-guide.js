/* 走位提示只读战斗状态。命中和组合仍由武器的实际判定确认。 */
(function (C) {
  'use strict';

  function rayClear(s, from, to, padding) {
    var dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    return length < 0.01 || C.core.enemyTrial.wallLimit(s.walls, from.x, from.y,
      dx / length, dy / length, length, padding) >= length - 0.01;
  }

  function fits(s, p) {
    return !s.walls.some(function (w) {
      var x = Math.max(w.x, Math.min(p.x, w.x + w.w));
      var y = Math.max(w.y, Math.min(p.y, w.y + w.h));
      return Math.hypot(p.x - x, p.y - y) < s.player.r + 2;
    });
  }

  function aimedTarget(s, from, to) {
    var dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    return !s.enemies.some(function (e) {
      if (e === to) return false;
      var x = e.x - from.x, y = e.y - from.y;
      var ahead = (x * dx + y * dy) / length;
      var across = Math.abs(x * dy - y * dx) / length;
      return ahead > 0 && ahead < length - to.r && across < e.r;
    });
  }

  function stance(s, e, axis, effect) {
    var p = s.player, melee = s.impact.weapon === 'blade';
    var choices = [{ x: -axis.y, y: axis.x }, { x: axis.y, y: -axis.x }];
    s.enemies.forEach(function (next) {
      if (next === e || next.hp <= 0 || (e.flight && e.flight.chain.targets.has(next))) return;
      var dx = next.x - e.x, dy = next.y - e.y, len = Math.hypot(dx, dy);
      if (len > 225 || len < 28 || !rayClear(s, e, next, 0)) return;
      if (Math.abs((dx * axis.x + dy * axis.y) / len) > 0.55) return;
      choices.push({ x: dx / len, y: dy / len, follow: true });
    });

    var best = null;
    choices.forEach(function (d) {
      (melee ? [56, 76] : [76, 116, 150]).forEach(function (distance) {
        var spot = { x: e.x - d.x * distance, y: e.y - d.y * distance };
        if (!fits(s, spot) || !rayClear(s, spot, e, 0) || (!melee && !aimedTarget(s, spot, e))) return;
        if (effect === 'borrow' && C.core.enemyTrial.zoneContains(s.walls, e.brain.attack, spot, e.brain.attack.travel)) return;
        var gap = Math.hypot(p.x - spot.x, p.y - spot.y);
        if (gap > 450) return;
        var direct = rayClear(s, p, spot, p.r);
        var score = gap + (direct ? 0 : 100) - (d.follow ? 42 : 0);
        if (!best || score < best.score) best = { enemy: e, spot: spot, direct: direct, effect: effect, score: score };
      });
    });
    return best;
  }

  function get(s) {
    var trial = s && s.impact && s.impact.trial;
    if (!trial || trial.preset !== 'skills' || s.phase !== 'playing') return null;
    if (trial.hint) return { ready: true, enemy: trial.hint.enemy, effect: trial.hint.effect };
    var best = null;
    s.enemies.forEach(function (e) {
      var effect, axis;
      if (e.flight && e.flight.reflected && !e.flight.effect) {
        var speed = Math.hypot(e.vx, e.vy);
        if (!speed) return;
        effect = 'fold';
        axis = { x: e.vx / speed, y: e.vy / speed };
      } else if (e.brain && e.brain.role === 'charge' && e.brain.attack) {
        effect = 'borrow';
        axis = { x: e.brain.attack.dx, y: e.brain.attack.dy };
      } else return;
      var cue = stance(s, e, axis, effect);
      if (cue && (!best || cue.score < best.score)) best = cue;
    });
    if (!best) return null;
    best.next = best.direct ? best.spot : C.core.enemyTrial.nearestOpening(s, s.player, best.spot);
    if (best.next === s.player) return null;
    return best;
  }

  C.ui = C.ui || {};
  C.ui.combatGuide = { get: get };
})(window.Corridor = window.Corridor || {});
