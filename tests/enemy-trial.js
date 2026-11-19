'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

global.window = global;
const saves = new Map([['corridor.meta.v1', '{"gold":41,"runs":3,"unlocked":["p_hp"]}']]);
global.localStorage = { getItem: key => saves.get(key) || null, setItem: (key, value) => saves.set(key, value) };
for (const name of ['perks', 'audio', 'enemy-trial', 'impact', 'engine']) require('../src/core/' + name);
require('../src/theme/index');

const C = global.Corridor;
const E = C.core.engine;
const rules = C.core.enemyTrial;
const balance = C.core.perks.BALANCE.impact.trial;
const DT = 1 / 60;

function start(version, weapon, preset, events = []) {
  return E.startRun({
    theme: 'geometry', impactWeapon: weapon, impactTrial: { version, preset },
    onEvent: (kind, data) => events.push({ kind, data })
  });
}

function tick(input = {}) { E.update(DT, input); }

function until(condition, frames = 120) {
  for (let i = 0; i < frames && !condition(); i++) tick();
  assert.ok(condition(), '判定应在 ' + frames + ' 帧内成立');
}

function unit(x, y) {
  const gap = Math.hypot(x, y);
  return { x: x / (gap || 1), y: y / (gap || 1), gap };
}

function steer(s, x, y, extra = {}) {
  const dx = x - s.player.x, dy = y - s.player.y;
  tick({ left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4, ...extra });
}

function fire(s, dx, dy) {
  tick({ aimX: s.player.x + dx * 170, aimY: s.player.y + dy * 170, attackPressed: true });
}

function place(s, x, y) {
  Object.assign(s.player, { x, y, vx: 0, vy: 0 });
}

// 通关走真实 update，不改敌人位置或 HP，也不发主动组合输入。
function ordinary(s, engine = E, trialRules = rules, dt = DT) {
  const wave = s.impact.wave;
  const blade = s.impact.weapon === 'blade';
  let next = s.elapsed;
  for (let frame = 0; frame < 3600 && s.phase === 'playing' && s.impact.wave === wave; frame++) {
    const p = s.player;
    const target = s.enemies.filter(e => e.hp > 0).sort((a, b) =>
      Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (!target) { engine.update(dt, {}); continue; }
    const dx = target.x - p.x, dy = target.y - p.y, gap = Math.hypot(dx, dy);
    const visible = trialRules.wallLimit(s.walls, p.x, p.y, dx / (gap || 1), dy / (gap || 1), gap, 0) >= gap - 0.01;
    const forward = gap > (blade ? 82 : 220) || !visible;
    const back = gap < (blade ? 57 : 130) && visible;
    const waypoint = visible ? target : trialRules.nearestOpening(s, p, target);
    const mx = waypoint.x - p.x, my = waypoint.y - p.y;
    const attack = visible && s.elapsed >= next && gap < (blade ? 94 : 490);
    if (attack) next = s.elapsed + (blade ? 0.54 : 0.58);
    engine.update(dt, {
      left: (forward && mx < -4) || (back && dx > 4), right: (forward && mx > 4) || (back && dx < -4),
      up: (forward && my < -4) || (back && dy > 4), down: (forward && my > 4) || (back && dy < -4),
      aimX: target.x, aimY: target.y, fire: attack
    });
  }
}

async function second(version, weapon, preset = 'skills') {
  const s = await start(version, weapon, preset);
  ordinary(s);
  assert.equal(s.impact.wave, 2);
  assert.equal(s.phase, 'playing');
  return s;
}

function resultTime(s) { return Number(s.impact.trial.waveTime.toFixed(3)); }

test('A/B 共用墙体、玩家出生、两拨阵容及战斗数值', async () => {
  const layouts = [];
  for (const version of ['A', 'B']) {
    const s = await start(version, 'blade', 'basic');
    const layout = () => s.enemies.map(e => [e.x, e.y, e.r, e.hp, e.damage, e.brain.role, e.brain.side]);
    const first = layout();
    assert.deepEqual(first.map(e => e[5]), ['press', 'press', 'press']);
    for (let i = 1; i < s.enemies.length; i++) {
      assert.ok(Math.abs(s.enemies[i].brain.moveAt - s.enemies[i - 1].brain.moveAt - 0.3) < 1e-9);
    }
    const entry = [s.player.x, s.player.y, s.player.hp];
    const p = s.player, room = s.room, walls = s.walls;
    ordinary(s);
    assert.equal(s.kills, 3);
    assert.equal(s.player, p);
    assert.equal(s.walls, walls);
    assert.equal(s.room, room);
    assert.ok(s.elapsed > 0);
    assert.deepEqual(layout().map(e => e[5]), ['press', 'press', 'press', 'flank', 'flank', 'charge']);
    layouts.push([entry, [...walls], first, layout()]);
  }
  assert.deepEqual(layouts[0], layouts[1]);
});

for (const version of ['A', 'B']) for (const weapon of ['blade', 'cannon']) {
  test(version + ' ' + weapon + ' 第二拨优先动作与出招许可一致', async t => {
    const s = await second(version, weapon);
    const found = [];
    const visited = new Set();
    for (let i = 0; i < 155; i++) {
      tick();
      s.enemies.forEach(e => {
        if (e.brain.role === 'press' || e.brain.state !== 'wind' || visited.has(e)) return;
        visited.add(e);
        found.push([e.brain.side || e.brain.role, resultTime(s)]);
      });
    }
    assert.deepEqual(found.map(e => e[0]), version === 'A' ? ['upper', 'charge', 'lower'] : ['charge', 'lower', 'upper']);
    assert.ok(Math.abs(found[0][1] - 0.6) <= DT);
    assert.ok(Math.abs(found[1][1] - 1.5) <= DT);
    t.diagnostic(JSON.stringify(found));
  });

  for (const preset of ['basic', 'skills']) {
    test(version + ' ' + weapon + ' ' + preset + ' 普通攻击清两拨、结算、重开', async t => {
      const events = [], save = saves.get('corridor.meta.v1');
      const s = await start(version, weapon, preset, events);
      ordinary(s);
      assert.equal(s.impact.wave, 2);
      assert.equal(s.enemies.length, 6);
      assert.equal(s.perkPending, null);
      const first = s.elapsed;
      ordinary(s);
      assert.equal(s.phase, 'won');
      assert.equal(s.kills, 9);
      assert.deepEqual(events.filter(e => e.kind !== 'playerHurt').map(e => e.kind), ['runStart', 'runEnd']);
      assert.equal(saves.get('corridor.meta.v1'), save);
      t.diagnostic('first=' + first.toFixed(2) + ' second=' + (s.elapsed - first).toFixed(2) +
        ' total=' + s.elapsed.toFixed(2) + ' hp=' + s.player.hp);
      const fresh = await start(version, weapon, preset);
      assert.equal(fresh.impact.wave, 1);
      assert.equal(fresh.impact.trial.version, version);
      assert.equal(fresh.impact.trial.preset, preset);
      assert.equal(fresh.elapsed, 0);
      assert.equal(fresh.player.hp, 100);
      assert.equal(fresh.impact.trial.hint, null);
      assert.ok(fresh.enemies.every(e => !e.flight && !e.brain.attack));
    });
  }
}

test('前压怪遇上墙走最近开口，同组起扑错时', async () => {
  const s = await start('A', 'cannon', 'basic');
  place(s, 351, 123);
  const e = s.enemies[1];
  until(() => e.y < 147, 370);
  assert.ok(e.x < 224 || e.x > 687, '绕到上墙另一侧前应先经过开口');
  const fresh = await start('A', 'cannon', 'basic');
  place(fresh, 300, 300);
  const attacks = new Map();
  for (let i = 0; i < 125; i++) {
    tick();
    fresh.enemies.forEach(e => { if (e.brain.attack && !attacks.has(e)) attacks.set(e, resultTime(fresh)); });
  }
  assert.ok(attacks.size >= 2);
  const times = [...attacks.values()];
  assert.ok(times[1] - times[0] >= 0.60);
});

test('扇形、横线按实际锁定范围结算，冲锋遇墙截停', async () => {
  const s = await second('B', 'cannon', 'basic');
  const charger = s.enemies.find(e => e.brain.role === 'charge');
  s.enemies = [charger];
  Object.assign(charger, { x: 500, y: 361 });
  place(s, 500, 221);
  until(() => charger.brain.state === 'wind', 50);
  const a = charger.brain.attack;
  assert.equal(a.travel, 160);
  assert.equal(a.kind, 'charge');
  assert.ok(rules.zoneContains(s.walls, a, s.player, a.travel));
  assert.ok(!rules.zoneContains(s.walls, a, { x: 528, y: 221 }, a.travel));
  place(s, 500, 146);
  assert.ok(!rules.zoneContains(s.walls, a, s.player, a.travel));
  until(() => charger.brain.state === 'recover', 130);
  assert.equal(charger.y, 201);
  assert.equal(s.player.hp, 100);

  for (const role of ['press', 'flank']) {
    const room = await second('A', 'cannon', 'basic');
    const enemy = role === 'press' ? room.enemies[1] : room.enemies[3];
    until(() => enemy.brain.state === 'wind', 70);
    const warning = enemy.brain.attack;
    const onPath = { x: warning.x + warning.dx * 42, y: warning.y + warning.dy * 42 };
    const outside = { x: onPath.x + warning.dy * 66, y: onPath.y - warning.dx * 66 };
    assert.equal(!!warning.fan, role === 'press');
    assert.ok(rules.zoneContains(room.walls, warning, onPath, warning.travel));
    assert.ok(!rules.zoneContains(room.walls, warning, outside, warning.travel));
    room.enemies = [enemy];
    place(room, onPath.x, onPath.y);
    const hp = room.player.hp;
    until(() => room.player.hp < hp, 45);
    assert.equal(hp - room.player.hp, balance[role].damage);
  }
});

for (const role of ['press', 'flank', 'charge']) {
  test(role + ' 被普攻打断、飞行接管、落地恢复后才重新行动', async () => {
    const s = await second('B', 'cannon', 'basic');
    const e = s.enemies[role === 'press' ? 1 : (role === 'flank' ? 4 : 5)];
    until(() => e.brain.state === 'wind', 110);
    s.enemies = [e];
    place(s, e.x - 46, e.y);
    fire(s, 1, 0);
    assert.ok(e.flight);
    assert.equal(e.brain.state, 'fly');
    assert.equal(e.brain.attack, null);
    assert.equal(e.flight.effect, null);
    until(() => !e.flight, 75);
    assert.equal(e.brain.state, 'recover');
    assert.ok(e.brain.timer > balance[role].landing - DT);
    tick();
    assert.equal(e.brain.state, 'recover');
    assert.equal(e.brain.attack, null);
    until(() => e.brain.state === 'seek', 55);
  });
}

test('其他敌人的飞行接力也能打断冲锋预警', async () => {
  const s = await second('B', 'cannon', 'basic');
  const e = s.enemies[5], source = s.enemies[2];
  until(() => e.brain.state === 'wind', 55);
  s.enemies = [source, e];
  Object.assign(source, { x: e.x - 55, y: e.y });
  place(s, source.x - 83, source.y);
  fire(s, 1, 0);
  until(() => e.hp < e.maxHp, 45);
  assert.ok(e.flight && e.brain.state === 'fly' && !e.brain.attack && !e.flight.effect);
});

for (const weapon of ['blade', 'cannon']) {
  test(weapon + ' A 从中线改打上侧，用移动和主攻兑现折冲', async t => {
    const s = await second('A', weapon);
    const side = s.enemies[3], press = s.enemies[2];
    const aimX = weapon === 'blade' ? 0.22 : -0.22;
    const aimY = -Math.sqrt(1 - aimX * aimX);
    const frames = [];
    for (let i = 0; i < 90; i++) {
      const p = s.player;
      const first = side.brain.state === 'wind' ? side : (side.brain.route?.[0] || side);
      const x = first.x - aimX * 58, y = first.y - aimY * 58;
      if (i > 25 && side.brain.state === 'wind' && Math.hypot(p.x - x, p.y - y) < (weapon === 'blade' ? 16 : 8)) {
        assert.equal(press.hp, press.maxHp);
        fire(s, aimX, aimY);
        frames.push(resultTime(s));
        break;
      }
      steer(s, x, y, { dash: i === 0 && Math.hypot(p.x - x, p.y - y) > 110 });
    }
    assert.ok(side.flight, '上侧怪遇到上墙出手机会');
    for (let i = 0; i < 52 && side.flight; i++) {
      const p = s.player;
      const dir = unit(press.x - side.x, press.y - side.y);
      const flight = unit(side.vx, side.vy);
      const from = unit(side.x - p.x, side.y - p.y);
      const dot = dir.x * flight.x + dir.y * flight.y;
      const line = Math.abs((side.x - p.x) * dir.y - (side.y - p.y) * dir.x);
      const cosine = from.x * dir.x + from.y * dir.y;
      const feasible = weapon === 'blade' ? from.gap < 92 && cosine > 0.8 : line < 8 && cosine > 0.92;
      if (side.flight.reflected && Math.abs(dot) < 0.59 && p.fireCd <= DT && feasible) {
        fire(s, dir.x, dir.y);
        if (side.flight?.effect?.kind === 'fold') break;
      } else {
        steer(s, side.x - dir.x * 49, side.y - dir.y * 49, { aimX: p.x + dir.x * 170, aimY: p.y + dir.y * 170 });
      }
    }
    assert.equal(side.flight?.effect?.kind, 'fold');
    frames.push(resultTime(s));
    until(() => s.impact.marks.some(m => m.kind === 'fold'), 62);
    assert.equal(side.flight?.effect || null, null);
    assert.ok(s.enemies.filter(e => e !== side && e.hp < e.maxHp).length >= 2, '命中后应伤到目标及附近其他敌人');
    frames.push(resultTime(s));
    t.diagnostic('发射、补击、兑现（第二拨秒） ' + frames.join(' / '));
  });

  test(weapon + ' B 从红线外侧主动转火，将冲锋怪送进下侧怪', async t => {
    const s = await second('B', weapon);
    const e = s.enemies[5], lower = s.enemies[4];
    until(() => e.brain.state === 'wind', 55);
    const frames = [resultTime(s)];
    for (let i = 0; i < 100; i++) {
      const p = s.player;
      const dir = unit(lower.x - e.x, lower.y - e.y);
      const from = unit(e.x - p.x, e.y - p.y);
      const dot = dir.x * e.lockX + dir.y * e.lockY;
      const cosine = from.x * dir.x + from.y * dir.y;
      const line = Math.abs((e.x - p.x) * dir.y - (e.y - p.y) * dir.x);
      const feasible = weapon === 'blade' ? from.gap < 91 && cosine > 0.81 : line < 8 && cosine > 0.92;
      if (e.brain.attack && Math.abs(dot) < 0.59 && feasible) {
        fire(s, dir.x, dir.y);
        if (e.flight?.effect?.kind === 'borrow') break;
      } else {
        steer(s, e.x - dir.x * 66, e.y - dir.y * 66, { dash: i === 0 });
      }
    }
    assert.equal(e.flight?.effect?.kind, 'borrow');
    frames.push(resultTime(s));
    until(() => s.impact.marks.some(m => m.kind === 'borrow'), 62);
    assert.ok(lower.hp < lower.maxHp);
    assert.equal(e.flight?.effect || null, null);
    frames.push(resultTime(s));
    t.diagnostic('预警、侧击、兑现（第二拨秒） ' + frames.join(' / '));
  });
}

test('预设 1 与连发都走普通规则，预设 2 在起速后继承冲劲', async () => {
  const pushes = [];
  for (const [preset, explicit, moving] of [
    ['basic', true, false], ['skills', false, false], ['skills', true, false], ['skills', true, true]
  ]) {
    const s = await second('B', 'cannon', preset);
    const e = s.enemies[5];
    until(() => e.brain.state === (moving ? 'attack' : 'wind'), 123);
    s.enemies = [e];
    const dx = e.lockY, dy = -e.lockX;
    place(s, e.x - dx * 40, e.y - dy * 40);
    tick({ aimX: e.x, aimY: e.y });
    assert.equal(s.impact.trial.hint?.effect, preset === 'skills' ? 'borrow' : undefined);
    tick({ aimX: e.x, aimY: e.y, attackPressed: explicit, fire: !explicit });
    assert.ok(e.flight);
    assert.equal(e.flight.effect?.kind, preset === 'skills' && explicit ? 'borrow' : undefined);
    pushes.push(Math.hypot(e.vx, e.vy));
  }
  assert.ok(pushes[3] - pushes[2] > 130);
});

test('可用提示遵守武器距离、瞄准和输入缓冲窗口', async () => {
  const s = await second('B', 'blade');
  const enemy = s.enemies[5];
  until(() => enemy.brain.state === 'wind', 47);
  place(s, enemy.x, enemy.y - 117);
  tick({ aimX: enemy.x, aimY: enemy.y });
  assert.equal(s.impact.trial.hint, null);
  place(s, enemy.x, enemy.y - 55);
  tick({ aimX: enemy.x, aimY: enemy.y - 136 });
  assert.equal(s.impact.trial.hint, null);
  s.player.fireCd = 0.3;
  tick({ aimX: enemy.x, aimY: enemy.y });
  assert.equal(s.impact.trial.hint, null);
  s.player.fireCd = 0.08;
  tick({ aimX: enemy.x, aimY: enemy.y });
  assert.equal(s.impact.trial.hint?.effect, 'borrow');
});
