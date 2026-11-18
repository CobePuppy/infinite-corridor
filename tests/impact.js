'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
const storage = new Map([['corridor.meta.v1', '{"gold":43,"runs":4,"unlocked":["p_hp"]}']]);
global.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value)
};
require('../src/core/perks');
require('../src/core/audio');
require('../src/core/impact');
require('../src/core/engine');
require('../src/theme/index');

const C = global.Corridor;
const E = C.core.engine;
const DT = 1 / 60;

function tick(input = {}, dt = DT) { E.update(dt, input); }

function advance(seconds, dt = DT) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) tick({}, dt);
}

function until(check, seconds, dt = DT) {
  for (let i = 0; i < Math.ceil(seconds / dt) && !check(); i++) tick({}, dt);
  assert.ok(check(), '状态应当在时限内可达');
}

function fire(x, y, dt = DT) { tick({ attackPressed: true, aimX: x, aimY: y }, dt); }

function moveTo(p, x, y) { Object.assign(p, { x, y, vx: 0, vy: 0 }); }

async function start(weapon, events = [], combinations = false) {
  return E.startRun({
    impactWeapon: weapon, impactCombinations: combinations, theme: 'geometry',
    onEvent: (type, data) => events.push({ type, data })
  });
}

// 只用常规移动与间歇主攻清组。距离不足的近战继续走位，倒地目标留到落地。
function clearWave(s) {
  let aimAt = s.elapsed;
  let attack = true;
  const wave = s.impact.wave;
  for (let i = 0; i < 3600 && s.phase === 'playing' && s.impact.wave === wave; i++) {
    const p = s.player;
    const alive = s.enemies.filter(e => e.hp > 0);
    const target = alive.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (!target) {
      tick();
      continue;
    }
    const dx = target.x - p.x, dy = target.y - p.y;
    const gap = Math.hypot(dx, dy);
    const walking = gap > (s.impact.weapon === 'blade' ? 73 : 248);
    const retreat = gap < (s.impact.weapon === 'blade' ? 42 : 115);
    const canAttack = gap < (s.impact.weapon === 'blade' ? 90 : 490);
    const input = {
      left: (walking && dx < -6) || (retreat && dx > 6),
      right: (walking && dx > 6) || (retreat && dx < -6),
      up: (walking && dy < -6) || (retreat && dy > 6),
      down: (walking && dy > 6) || (retreat && dy < -6),
      aimX: target.x, aimY: target.y
    };
    const wall = C.core.impact.shortWall;
    const across = (wall.x + wall.w / 2 - p.x) / dx;
    const detour = s.impact.combinations && across > 0 && across < 1 &&
      p.y + dy * across > wall.y - 10 && p.y > wall.y - 45;
    if (detour) {
      input.left = input.right = input.down = false;
      input.up = true;
    }
    if (!detour && canAttack && (attack || s.elapsed >= aimAt)) {
      input.attackPressed = true;
      attack = false;
      aimAt = s.elapsed + (s.impact.weapon === 'blade' ? 0.84 : 0.76);
    }
    tick(input);
  }
}

async function secondWave(weapon, perk) {
  const s = await start(weapon);
  clearWave(s);
  assert.equal(s.phase, 'perk');
  assert.equal(E.choosePerk(perk), true);
  return s;
}

for (const weapon of ['blade', 'cannon']) {
  test(weapon + ' 基础起手在 20 FPS 下依次打中三只', async () => {
    const s = await start(weapon);
    const [first, second, third] = s.enemies;
    fire(first.x, first.y, 0.05);
    assert.ok(first.hp < first.maxHp);
    assert.equal(second.hp, second.maxHp);
    assert.equal(third.hp, third.maxHp);
    until(() => s.impact.bestChain === 3, 1.1, 0.05);
    assert.ok(second.hp < second.maxHp && third.hp < third.maxHp);
    assert.ok(third.vx > 0);
  });

  test(weapon + ' 主攻可以给活着的飞行目标改向，失手后仍可重新起手', async () => {
    const s = await start(weapon);
    const first = s.enemies[0], p = s.player;
    moveTo(p, first.x + 55, first.y);
    fire(first.x, first.y);
    const chain = first.flight.chain;
    assert.ok(first.vx < 0);
    advance(0.34);
    assert.ok(first.flight);
    moveTo(p, first.x, first.y + (weapon === 'blade' ? 61 : 158));
    fire(first.x, first.y);
    assert.equal(first.flight.chain, chain);
    assert.ok(first.vy < 0 && Math.abs(first.vx) < 0.01);
    assert.ok(s.impact.marks.some(m => m.kind === 'redirect'));

    // 另开一局验证朝空处挥砍或射击后，冷却一过就能正常起手。
    const fresh = await start(weapon);
    fire(58, 300);
    assert.ok(fresh.enemies.every(e => e.hp === e.maxHp));
    advance(0.34);
    fire(fresh.enemies[0].x, fresh.enemies[0].y);
    until(() => fresh.impact.bestChain === 3, 1.1);
  });
}

const pools = {
  blade: ['p_impact_heavy', 'p_impact_pursuit'],
  cannon: ['p_impact_bank', 'p_impact_pierce']
};

for (const [weapon, pool] of Object.entries(pools)) {
  for (const perk of pool) {
    test(weapon + ' 用主攻清两组且只消耗一次构筑点 ' + perk, async t => {
      const events = [];
      const initialMeta = storage.get('corridor.meta.v1');
      const s = await start(weapon, events);
      const walls = s.walls, room = s.room;
      assert.equal(s.player.maxHp, 100);
      assert.equal(E.choosePerk(perk), false);
      clearWave(s);
      assert.equal(s.phase, 'perk');
      assert.equal(s.kills, 3);
      assert.equal(s.impact.points, 1);
      assert.deepEqual(s.perkPending, pool);
      assert.equal(E.choosePerk(weapon === 'blade' ? pools.cannon[0] : pools.blade[0]), false);
      assert.equal(E.choosePerk('p_hp'), false);
      assert.equal(s.impact.points, 1);
      assert.equal(E.choosePerk(perk), true);
      assert.equal(E.choosePerk(pool.find(other => other !== perk)), false);
      assert.equal(s.impact.points, 0);
      assert.equal(s.impact.perk, perk);
      assert.equal(s.walls, walls);
      assert.equal(s.room, room);
      assert.equal(s.enemies.length, 5);
      clearWave(s);
      assert.equal(s.phase, 'won', '主攻与走位应能通关');
      assert.equal(s.kills, 8);
      assert.deepEqual(events.filter(e => e.type === 'perkOffer').map(e => e.data.choices), [pool]);
      assert.equal(events.at(-1).data.waves, 2);
      assert.equal(storage.get('corridor.meta.v1'), initialMeta);
      t.diagnostic('战斗计时 ' + s.elapsed.toFixed(2) + ' 秒，剩余生命 ' + s.player.hp);
    });
  }
}

test('重击在第二组提高首击距离，追击改向前踏并恢复冲刺', async () => {
  const velocities = {};
  for (const perk of pools.blade) {
    const s = await secondWave('blade', perk);
    const first = s.enemies[0], p = s.player;
    tick({ dash: true });
    assert.ok(p.dashCd > 0 && p.dashCd < 1);
    advance(0.15);
    moveTo(p, first.x, first.y + 56);
    fire(first.x, first.y);
    velocities[perk] = -first.vy;
    advance(0.33);
    assert.ok(first.flight);
    moveTo(p, first.x - 62, first.y);
    assert.ok(p.dashCd > 0);
    const startX = p.x;
    fire(first.x, first.y);
    assert.ok(first.vx > 0);
    assert.ok(Math.abs(p.x - startX - (perk === 'p_impact_pursuit' ? 40 : 14)) < 0.01);
    assert.equal(p.dashCd === 0, perk === 'p_impact_pursuit');
    tick({ dash: true });
    assert.equal(p.dashTime > 0, perk === 'p_impact_pursuit');
  }
  assert.ok(velocities.p_impact_heavy > velocities.p_impact_pursuit * 1.3);
});

test('折射同一枪借反弹墙命中，贯穿一枪直接击飞直线上两只', async () => {
  for (const perk of pools.cannon) {
    const s = await secondWave('cannon', perk);
    const p = s.player;
    const target = s.enemies[2];
    const wall = C.core.impact.reflector;
    moveTo(p, 625, 250);
    fire(2 * wall.x - target.x, target.y);
    if (perk === 'p_impact_bank') {
      assert.equal(s.impact.shot.points.length, 3);
      assert.equal(s.impact.shot.points[1].x, wall.x);
      assert.ok(target.hp < target.maxHp && target.vx < 0);
    } else {
      assert.equal(s.impact.shot.points.length, 2);
      assert.equal(target.hp, target.maxHp);
    }
    const straight = await secondWave('cannon', perk);
    moveTo(straight.player, 380, 326);
    fire(611, 326);
    const [a, b] = straight.enemies;
    assert.ok(a.flight);
    assert.equal(!!b.flight, perk === 'p_impact_pierce');
  }
});

test('敌人同时撞外墙两面时反向，墙角不反复计数', async () => {
  const s = await start('cannon');
  const first = s.enemies[0];
  moveTo(s.player, 140, 140);
  moveTo(first, 79, 79);
  fire(60, 60);
  until(() => s.impact.marks.some(m => m.kind === 'wall'), 0.4);
  assert.ok(first.vx > 0 && first.vy > 0);
  assert.ok(first.x >= 18 + first.r && first.y >= 18 + first.r);
  advance(0.13);
  assert.equal(s.impact.marks.filter(m => m.kind === 'wall').length, 1);
});

test('贴住的两只不会重复结算，绕回来也不会重复命中同一串的目标', async () => {
  const s = await start('cannon');
  const [a, b] = s.enemies;
  moveTo(a, 226, 270);
  moveTo(b, 269, 270);
  moveTo(s.player, 145, 270);
  fire(a.x, a.y);
  until(() => s.impact.bestChain === 2, 0.2);
  const hp = b.hp;
  const time = b.flight.time;
  const chain = b.flight.chain;
  assert.equal(s.impact.contacts.size, 1);

  // 模拟同一对被墙卡在接触中，重新起手也要等分离。
  moveTo(b, a.x + a.r + b.r - 0.5, a.y);
  a.flight = { time, chain: { targets: new Set([a]) } };
  a.vx = 350;
  b.flight = null;
  tick();
  assert.equal(b.hp, hp);

  moveTo(b, a.x + 40, a.y);
  const sourceHp = a.hp;
  tick();
  assert.equal(s.impact.contacts.size, 0);
  b.flight = { time, chain };
  b.vx = -350;
  until(() => s.impact.contacts.size === 1, 0.15);
  assert.equal(a.hp, sourceHp);
  assert.equal(s.impact.bestChain, 2);
});

test('致命首击保留飞行并接力，死亡重开清空技能和计数', async () => {
  const s = await start('cannon');
  const [first, second] = s.enemies;
  first.hp = 1;
  fire(first.x, first.y);
  assert.equal(first.hp, 0);
  assert.ok(first.flight);
  assert.equal(s.kills, 0);
  until(() => second.hp < second.maxHp, 0.5);
  assert.equal(s.kills, 1);
  assert.ok(!s.enemies.includes(first));
  clearWave(s);
  assert.equal(E.choosePerk('p_impact_bank'), true);
  s.player.hp = 1;
  const foe = s.enemies[0];
  moveTo(s.player, foe.x, foe.y);
  until(() => s.phase === 'dead', 3.5);
  const fresh = await start(s.impact.weapon);
  assert.notEqual(fresh, s);
  assert.equal(fresh.impact.weapon, 'cannon');
  assert.equal(fresh.impact.wave, 1);
  assert.equal(fresh.impact.bestChain, 0);
  assert.equal(fresh.impact.perk, null);
  assert.equal(fresh.impact.points, 0);
  assert.equal(fresh.kills, 0);
  assert.equal(fresh.player.hp, fresh.player.maxHp);
  assert.equal(fresh.elapsed, 0);
});

async function combinationWaveTwo(weapon, events = []) {
  const s = await start(weapon, events, true);
  clearWave(s);
  assert.equal(s.phase, 'playing');
  assert.equal(s.impact.wave, 2);
  assert.equal(s.kills, 3);
  return s;
}

function travel(s, x, y, margin = 5) {
  for (let frame = 0; frame < 64; frame++) {
    const p = s.player;
    const dx = x - p.x, dy = y - p.y;
    if (Math.hypot(dx, dy) <= margin) return;
    tick({ left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4 });
  }
  assert.fail('应能走到出手位置 (' + x + ', ' + y + ')');
}

function marked(s, kind) { return s.impact.marks.some(m => m.kind === kind); }

for (const weapon of ['blade', 'cannon']) {
  test(weapon + ' 直通需要第二次主动输入，下一撞增强前冲且只兑现一次', async () => {
    const pushes = [];
    for (const explicit of [false, true]) {
      const s = await start(weapon, [], true);
      const [first, second, third] = s.enemies;
      fire(first.x, first.y);
      for (let i = 0; i < 20; i++) {
        if (weapon === 'blade') tick({ right: true, dash: i === 5 });
        else tick();
      }
      assert.ok(first.flight && !first.flight.reflected);
      assert.equal(first.flight.effect, null);
      tick({ fire: true, attackPressed: explicit, aimX: first.x, aimY: first.y });
      assert.equal(first.flight.effect?.kind, explicit ? 'straight' : undefined);
      until(() => second.hp < second.maxHp, 0.9);
      pushes.push(second.vx);
      assert.equal(marked(s, 'straight'), explicit);
      assert.equal(first.flight?.effect || null, null);
      assert.equal(second.flight.effect, null);
      until(() => third.hp < third.maxHp, 0.9);
      assert.ok(s.impact.marks.filter(mark => mark.kind === 'straight').length <= 1);
    }
    assert.ok(pushes[1] > pushes[0] * 1.4);
  });

  test(weapon + ' 借上墙后侧向补击，下一撞将侧群掀向两边', async () => {
    const s = await combinationWaveTwo(weapon);
    const [first, upper, , target, lower] = s.enemies;
    // 用房间实际站位作战，先把玩家移到同一条中线再靠近发起。
    travel(s, s.player.x, 301);
    travel(s, first.x, 314);
    fire(first.x, first.y);
    until(() => first.flight && first.flight.reflected, 0.5);
    assert.equal(first.flight.effect, null);
    for (let frame = 0; frame < 44 && !first.flight?.effect; frame++) {
      const p = s.player;
      const ax = target.x - first.x, ay = target.y - first.y;
      const len = Math.hypot(ax, ay);
      const dx = ax / len, dy = ay / len;
      const ox = first.x - p.x, oy = first.y - p.y;
      const gap = Math.hypot(ox, oy);
      const canFire = p.fireCd <= DT &&
        (weapon === 'blade' ? gap < 87 && (ox * dx + oy * dy) / gap >= 0.81 :
          gap < 150 && ox * dx + oy * dy > 15 && Math.abs(ox * dy - oy * dx) < 5);
      if (canFire) {
        fire(p.x + dx * 155, p.y + dy * 155);
      } else {
        assert.ok(first.flight, '补击须在一次自然飞行内完成');
        const goalX = first.x - dx * 64, goalY = first.y - dy * 64;
        tick({ left: goalX < p.x - 4, right: goalX > p.x + 4, up: goalY < p.y - 4, down: goalY > p.y + 4 });
      }
    }
    assert.equal(first.flight?.effect?.kind, 'fold');
    const upperHp = upper.hp, lowerHp = lower.hp;
    const trace = [];
    for (let i = 0; i < 57 && !marked(s, 'fold'); i++) {
      if (i % 8 === 0) trace.push([first.x, first.y, target.x, target.y, first.flight?.effect?.kind]);
      tick();
    }
    assert.ok(marked(s, 'fold'), JSON.stringify(trace));
    assert.ok(target.hp < target.maxHp);
    assert.ok(upper.hp < upperHp && lower.hp < lowerHp);
    assert.ok(upper.vy < 0 && lower.vy > 0);
    assert.equal(first.flight?.effect || null, null);
  });

  test(weapon + ' 两拨连续打完，普通攻击通关后可干净重开', async t => {
    const events = [];
    const s = await combinationWaveTwo(weapon, events);
    assert.equal(s.impact.points, 0);
    assert.equal(s.perkPending, null);
    assert.equal(E.choosePerk(pools[weapon][0]), false);
    assert.ok(s.enemies.some(e => e.charger && e.mode === 'wind' && e.timer > 1));
    clearWave(s);
    assert.equal(s.phase, 'won', JSON.stringify({ p: [s.player.x, s.player.y],
      enemies: s.enemies.map(e => [e.x, e.y, e.hp, e.charger, e.mode]), kills: s.kills }));
    assert.equal(s.kills, 9);
    assert.deepEqual(events.filter(e => e.type !== 'playerHurt').map(e => e.type), ['runStart', 'runEnd']);
    const fresh = await start(weapon, [], true);
    assert.equal(fresh.impact.wave, 1);
    assert.equal(fresh.impact.marks.length, 0);
    assert.ok(fresh.enemies.every(e => !e.flight && !e.charger));
    assert.equal(fresh.elapsed, 0);
    t.diagnostic('连续战斗 ' + s.elapsed.toFixed(2) + ' 秒');
  });
}

for (const weapon of ['blade', 'cannon']) test(weapon + ' 预警和冲锋期都可侧击，起速后保留部分冲劲', async () => {
  const speeds = [];
  for (const mode of ['wind', 'charge']) {
    const s = await combinationWaveTwo(weapon);
    const charger = s.enemies.find(e => e.charger);
    const target = s.enemies[1];
    if (mode === 'charge') until(() => charger.mode === 'charge', 1.5);
    assert.equal(charger.mode, mode);
    const angle = Math.atan2(target.y - charger.y, target.x - charger.x);
    // 固定侧击起点，比较同一武器在预警期和起速后的冲量。
    const dx = Math.cos(angle), dy = Math.sin(angle);
    moveTo(s.player, charger.x - dx * 58, charger.y - dy * 58);
    fire(charger.x, charger.y);
    assert.equal(charger.mode, 'cool');
    assert.equal(charger.flight.effect.kind, 'borrow');
    speeds.push(Math.hypot(charger.vx, charger.vy));
    until(() => marked(s, 'borrow'), 0.8);
    assert.ok(target.hp < target.maxHp && target.vx > 0);
    assert.equal(charger.flight?.effect || null, null);
    assert.equal(target.flight.effect, null);
  }
  assert.ok(speeds[1] - speeds[0] > 100);
});
