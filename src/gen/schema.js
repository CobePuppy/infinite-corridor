/* gen/schema.js — 输出契约校验器（对应提示词 §2 / §5 的 5 条必须实现的校验）
 * 所有关卡数据在进入渲染层之前都必须通过 validate()。
 * 手写实现，零依赖，浏览器与 Node 均可跑。
 */
(function (C) {
  'use strict';

  var ENUM = {
    theme:       ['geometry', 'oldtown', 'subject', 'wudang'],
    shape:       ['arena', 'corridor', 'cross', 'chamber'],
    color_token: ['ink', 'amber', 'teal', 'violet', 'rust'],
    pattern:     ['chase', 'orbit', 'charge', 'ranged', 'static']
  };

  var ALLOWED = {
    root: ['run_id', 'theme', 'difficulty', 'rooms', 'boss', 'reward_perk_pool', 'summary'],
    room: ['index', 'name', 'shape', 'color_token', 'threat', 'enemies', 'perk_choices', 'path_hint'],
    enemy: ['type', 'count', 'hp', 'damage', 'pattern'],
    boss: ['name', 'hp', 'damage', 'pattern', 'weakness_perk']
  };

  var FORBIDDEN_SUMMARY = ['AI', '生成', '模型', 'LLM', 'token'];

  function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function keysOf(o) { return Object.keys(o); }
  function only(o, list) { return keysOf(o).every(function (k) { return list.indexOf(k) !== -1; }); }
  function hasAll(o, list) { return list.every(function (k) { return Object.prototype.hasOwnProperty.call(o, k); }); }

  function validate(run, input) {
    var errors = [];
    function bad(msg) { errors.push(msg); }
    input = input || {};
    var perkPool = input.perk_pool || (C.core && C.core.perks ? C.core.perks.IDS : []);
    var vocab = input.theme_vocab || (C.theme ? C.theme.get(run && run.theme).vocab : null);

    /* 1. 结构与枚举、范围、数组长度 */
    if (!obj(run)) { return { ok: false, errors: ['run 不是对象'] }; }
    if (!only(run, ALLOWED.root)) bad('root 含多余字段');
    if (!hasAll(run, ALLOWED.root)) bad('root 缺字段');
    if (typeof run.run_id !== 'string' || run.run_id.indexOf('run_') !== 0) bad('run_id 非法');
    if (ENUM.theme.indexOf(run.theme) === -1) bad('theme 枚举越界');
    if (!isInt(run.difficulty) || run.difficulty < 1 || run.difficulty > 5) bad('difficulty 越界');
    if (!Array.isArray(run.rooms) || run.rooms.length < 3 || run.rooms.length > 5) bad('rooms 长度须为 3–5');
    if (typeof run.summary !== 'string' || run.summary.length > 80) bad('summary 超长或非字符串');
    FORBIDDEN_SUMMARY.forEach(function (w) {
      if (typeof run.summary === 'string' && run.summary.indexOf(w) !== -1) bad('summary 含元信息词: ' + w);
    });

    /* 2. 白名单 */
    if (!Array.isArray(run.reward_perk_pool) || run.reward_perk_pool.length < 3 || run.reward_perk_pool.length > 6) bad('reward_perk_pool 长度须为 3–6');
    else run.reward_perk_pool.forEach(function (id) { if (perkPool.indexOf(id) === -1) bad('reward id 越界: ' + id); });

    var maxHpByRoom = [];
    var maxDmgByRoom = [];
    var prevThreat = 0;
    var seenPairs = {};

    (run.rooms || []).forEach(function (r, i) {
      if (!obj(r)) { bad('room[' + i + '] 非对象'); return; }
      if (!only(r, ALLOWED.room)) bad('room[' + i + '] 含多余字段');
      if (!hasAll(r, ALLOWED.room)) bad('room[' + i + '] 缺字段');
      if (r.index !== i) bad('room[' + i + '].index 应为 ' + i);
      if (!vocab || vocab.room_names.indexOf(r.name) === -1) bad('房间名越界: ' + r.name);
      if (ENUM.shape.indexOf(r.shape) === -1) bad('shape 枚举越界 @' + i);
      if (ENUM.color_token.indexOf(r.color_token) === -1) bad('color_token 枚举越界 @' + i);
      if (!isInt(r.threat) || r.threat < 1 || r.threat > 5) bad('threat 越界 @' + i);

      /* 3. 单调性 + difficulty 对应的最低威胁档 */
      if (r.threat < prevThreat) bad('threat 非单调 @' + i);
      var minThreat = Math.min(5, 1 + Math.floor(((run.difficulty || 1) - 1) / 2));
      if (r.threat < minThreat) bad('threat 低于 difficulty 下限 @' + i);
      prevThreat = r.threat;

      /* 5. path_hint 必填 */
      if (typeof r.path_hint !== 'string' || !r.path_hint.length || r.path_hint.length > 60) bad('path_hint 缺失/超长 @' + i);

      /* 4. 词条对恰好 2 个且互不相同、来自白名单 */
      if (!Array.isArray(r.perk_choices) || r.perk_choices.length !== 2) bad('perk_choices 须恰好 2 个 @' + i);
      else {
        if (r.perk_choices[0] === r.perk_choices[1]) bad('perk_choices 重复 @' + i);
        r.perk_choices.forEach(function (id) { if (perkPool.indexOf(id) === -1) bad('perk id 越界: ' + id); });
        seenPairs[r.perk_choices.slice().sort().join('+')] = true;
      }

      if (!Array.isArray(r.enemies) || r.enemies.length < 1 || r.enemies.length > 4) bad('enemies 长度须为 1–4 @' + i);
      var roomMaxHp = 0, roomMaxDmg = 0;
      (r.enemies || []).forEach(function (e, j) {
        if (!obj(e)) { bad('enemy[' + i + '][' + j + '] 非对象'); return; }
        if (!only(e, ALLOWED.enemy)) bad('enemy 含多余字段 @' + i + '.' + j);
        if (!hasAll(e, ALLOWED.enemy)) bad('enemy 缺字段 @' + i + '.' + j);
        if (!vocab || vocab.enemy_types.indexOf(e.type) === -1) bad('敌人 id 越界: ' + e.type);
        if (ENUM.pattern.indexOf(e.pattern) === -1) bad('pattern 枚举越界 @' + i + '.' + j);
        if (!isInt(e.count) || e.count < 1 || e.count > 6) bad('count 越界 @' + i + '.' + j);
        if (!isInt(e.hp) || e.hp < 10 || e.hp > 120) bad('enemy.hp 越界 @' + i + '.' + j);
        if (!isInt(e.damage) || e.damage < 1 || e.damage > 20) bad('enemy.damage 越界 @' + i + '.' + j);
        roomMaxHp = Math.max(roomMaxHp, e.hp);
        roomMaxDmg = Math.max(roomMaxDmg, e.damage);
      });
      maxHpByRoom.push(roomMaxHp);
      maxDmgByRoom.push(roomMaxDmg);
    });

    /* 5. 数值随房间序号递增 */
    for (var k = 1; k < maxHpByRoom.length; k++) {
      if (maxHpByRoom[k] < maxHpByRoom[k - 1]) bad('enemy.hp 未随房间递增 @' + k);
      if (maxDmgByRoom[k] < maxDmgByRoom[k - 1]) bad('enemy.damage 未随房间递增 @' + k);
    }

    if (!obj(run.boss)) bad('boss 非对象');
    else {
      if (!only(run.boss, ALLOWED.boss)) bad('boss 含多余字段');
      if (!hasAll(run.boss, ALLOWED.boss)) bad('boss 缺字段');
      if (!vocab || vocab.boss_names.indexOf(run.boss.name) === -1) bad('boss 名越界: ' + run.boss.name);
      if (ENUM.pattern.indexOf(run.boss.pattern) === -1) bad('boss.pattern 枚举越界');
      if (!isInt(run.boss.hp) || run.boss.hp < 120 || run.boss.hp > 400) bad('boss.hp 越界');
      if (!isInt(run.boss.damage) || run.boss.damage < 8 || run.boss.damage > 30) bad('boss.damage 越界');
      if (perkPool.indexOf(run.boss.weakness_perk) === -1) bad('weakness_perk 越界');
    }

    return { ok: errors.length === 0, errors: errors };
  }

  C.gen = C.gen || {};
  C.gen.schema = { validate: validate, ENUM: ENUM, ALLOWED: ALLOWED };
})(window.Corridor = window.Corridor || {});
