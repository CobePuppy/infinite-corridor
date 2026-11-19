'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../src/core/perks.js');
require('../src/core/enemy-trial.js');
require('../src/ui/combat-guide.js');

const C = global.Corridor;
const guide = C.ui.combatGuide;
const rules = C.core.enemyTrial;

function scene(weapon, kind, preset = 'skills') {
  const charge = { kind: 'charge', x: 695, y: 277, dx: -1, dy: 0, radius: 27, travel: 210 };
  const e = kind === 'borrow' ?
    { x: 695, y: 277, r: 15, hp: 78, brain: { role: 'charge', state: 'wind', attack: charge } } :
    { x: 692, y: 252, r: 15, hp: 52, vx: 0, vy: 300, flight: { reflected: true, chain: { targets: new Set() } } };
  return {
    phase: 'playing', player: { x: 480, y: 278, r: 12, fireCd: 0.31 },
    walls: rules.walls.concat([{ x: 0, y: 0, w: 960, h: 18 }, { x: 942, y: 0, w: 18, h: 600 }]),
    enemies: [e, { x: 696, y: 394, r: 15, hp: 50 }, { x: 807, y: 257, r: 15, hp: 62 }],
    impact: { weapon, trial: { preset, hint: null } }
  };
}

for (const weapon of ['blade', 'cannon']) {
  for (const effect of ['borrow', 'fold']) {
    test(weapon + ' ' + effect + ' 刚出现机会就给走位提示，站位与真实威胁区分开', () => {
      const s = scene(weapon, effect);
      const early = guide.get(s);
      assert.equal(early.effect, effect);
      assert.ok(!early.ready && early.spot && early.next);
      assert.ok(Math.hypot(early.spot.x - s.player.x, early.spot.y - s.player.y) > 60);
      if (effect === 'borrow') {
        const a = early.enemy.brain.attack;
        assert.equal(rules.zoneContains(s.walls, a, early.spot, a.travel), false);
      }
      s.impact.trial.hint = { effect, enemy: early.enemy };
      assert.deepEqual(guide.get(s), { effect, ready: true, enemy: early.enemy });
    });
  }
}

test('基础预设、机会结束和已锁定折冲均清掉早期走位标记', () => {
  assert.equal(guide.get(scene('blade', 'borrow', 'basic')), null);
  const charge = scene('blade', 'borrow');
  charge.enemies[0].brain.attack = null;
  assert.equal(guide.get(charge), null);
  const fold = scene('cannon', 'fold');
  fold.enemies[0].flight.reflected = false;
  assert.equal(guide.get(fold), null);
  fold.enemies[0].flight.reflected = true;
  fold.enemies[0].flight.effect = { kind: 'fold' };
  assert.equal(guide.get(fold), null);
});
