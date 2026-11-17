/* gen/templates.js — 3 套结构不同的降级模板（3 / 4 / 5 房间各一套）
 * 按 hash(seed) 轮换，保证连续失败三局也不会一模一样。
 * 模板内只放结构；数值会由 reseed() 按 difficulty / last_run 重算。
 */
(function (C) {
  'use strict';

  var TEMPLATES = [
    {
      run_id: 'run_tpl_a', theme: 'geometry', difficulty: 1,
      rooms: [
        { index: 0, name: '方庭', shape: 'arena',    color_token: 'ink',    threat: 1,
          enemies: [{ type: 'e_dot', count: 3, hp: 14, damage: 2, pattern: 'chase' }],
          perk_choices: ['p_dash', 'p_hp'],
          path_hint: '沿外圈绕行即可避开追击，不需要任何词条' },
        { index: 1, name: '折廊', shape: 'corridor', color_token: 'teal',   threat: 2,
          enemies: [{ type: 'e_dot', count: 4, hp: 18, damage: 3, pattern: 'chase' },
                    { type: 'e_orbit', count: 1, hp: 22, damage: 4, pattern: 'orbit' }],
          perk_choices: ['p_thorn', 'p_regen'],
          path_hint: '贴墙推进可绕开环绕型敌人，普通攻击足以清场' },
        { index: 2, name: '交集', shape: 'cross',    color_token: 'amber',  threat: 3,
          enemies: [{ type: 'e_charge', count: 2, hp: 26, damage: 5, pattern: 'charge' },
                    { type: 'e_ranged', count: 2, hp: 20, damage: 4, pattern: 'ranged' }],
          perk_choices: ['p_crit', 'p_slow'],
          path_hint: '等待冲锋落空后从侧口通过，远程敌人可用掩体挡住' }
      ],
      boss: { name: '合点', hp: 140, damage: 9, pattern: 'orbit', weakness_perk: 'p_range' },
      reward_perk_pool: ['p_chain', 'p_shield', 'p_greed'],
      summary: '方与线再次相遇，走廊记住了你上次停下的位置。'
    },
    {
      run_id: 'run_tpl_b', theme: 'geometry', difficulty: 1,
      rooms: [
        { index: 0, name: '环室', shape: 'chamber',  color_token: 'ink',    threat: 1,
          enemies: [{ type: 'e_block', count: 2, hp: 16, damage: 2, pattern: 'static' }],
          perk_choices: ['p_hp', 'p_regen'],
          path_hint: '静止障碍不会追击，从缺口直穿即可' },
        { index: 1, name: '方庭', shape: 'arena',    color_token: 'teal',   threat: 2,
          enemies: [{ type: 'e_dot', count: 4, hp: 20, damage: 3, pattern: 'chase' },
                    { type: 'e_orbit', count: 1, hp: 24, damage: 4, pattern: 'orbit' }],
          perk_choices: ['p_dash', 'p_thorn'],
          path_hint: '保持移动拉开距离，冲刺留给被合围的瞬间' },
        { index: 2, name: '隙间', shape: 'corridor', color_token: 'violet', threat: 3,
          enemies: [{ type: 'e_ranged', count: 3, hp: 26, damage: 5, pattern: 'ranged' },
                    { type: 'e_charge', count: 1, hp: 30, damage: 6, pattern: 'charge' }],
          perk_choices: ['p_range', 'p_crit'],
          path_hint: '利用中央掩体挡住弹道，侧身推进逐一点掉远程' },
        { index: 3, name: '交集', shape: 'cross',    color_token: 'rust',   threat: 4,
          enemies: [{ type: 'e_charge', count: 3, hp: 34, damage: 7, pattern: 'charge' },
                    { type: 'e_ranged', count: 2, hp: 30, damage: 6, pattern: 'ranged' }],
          perk_choices: ['p_slow', 'p_chain'],
          path_hint: '先清掉十字口的远程，再沿单向通道逐个引诱冲锋' }
      ],
      boss: { name: '重线', hp: 220, damage: 14, pattern: 'charge', weakness_perk: 'p_slow' },
      reward_perk_pool: ['p_chain', 'p_shield', 'p_greed', 'p_crit'],
      summary: '每一次折返都通向不同的房间，几何从不为谁停留。'
    },
    {
      run_id: 'run_tpl_c', theme: 'geometry', difficulty: 1,
      rooms: [
        { index: 0, name: '折廊', shape: 'corridor', color_token: 'ink',    threat: 1,
          enemies: [{ type: 'e_dot', count: 3, hp: 15, damage: 2, pattern: 'chase' }],
          perk_choices: ['p_dash', 'p_regen'],
          path_hint: '窄廊里保持贴边移动，追击者会被墙拖慢' },
        { index: 1, name: '环室', shape: 'chamber',  color_token: 'teal',   threat: 2,
          enemies: [{ type: 'e_orbit', count: 2, hp: 20, damage: 3, pattern: 'orbit' },
                    { type: 'e_block', count: 2, hp: 22, damage: 3, pattern: 'static' }],
          perk_choices: ['p_hp', 'p_thorn'],
          path_hint: '沿环形外圈走，环绕者始终够不到你' },
        { index: 2, name: '方庭', shape: 'arena',    color_token: 'amber',  threat: 3,
          enemies: [{ type: 'e_dot', count: 5, hp: 26, damage: 5, pattern: 'chase' },
                    { type: 'e_ranged', count: 2, hp: 24, damage: 5, pattern: 'ranged' }],
          perk_choices: ['p_crit', 'p_range'],
          path_hint: '绕外圈分批拉扯，优先解决站在边缘的远程' },
        { index: 3, name: '交集', shape: 'cross',    color_token: 'violet', threat: 4,
          enemies: [{ type: 'e_charge', count: 3, hp: 34, damage: 7, pattern: 'charge' },
                    { type: 'e_orbit', count: 2, hp: 32, damage: 7, pattern: 'orbit' }],
          perk_choices: ['p_slow', 'p_chain'],
          path_hint: '等冲锋落空再穿十字口，环绕者用掩体隔断' },
        { index: 4, name: '隙间', shape: 'corridor', color_token: 'rust',   threat: 5,
          enemies: [{ type: 'e_ranged', count: 4, hp: 40, damage: 9, pattern: 'ranged' },
                    { type: 'e_charge', count: 2, hp: 44, damage: 9, pattern: 'charge' }],
          perk_choices: ['p_shield', 'p_greed'],
          path_hint: '贴墙吃掩体，逐段推进，不要同时暴露在两条弹道上' }
      ],
      boss: { name: '闭域', hp: 300, damage: 18, pattern: 'ranged', weakness_perk: 'p_shield' },
      reward_perk_pool: ['p_shield', 'p_greed', 'p_chain', 'p_crit', 'p_slow'],
      summary: '边界收拢，色彩退去，只剩路径仍然成立。'
    }
  ];

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h | 0);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* 按 difficulty / last_run 重算数值，并重新保证 threat 单调不减 */
  function reseed(tpl, input) {
    var run = clone(tpl);
    var d = Math.max(1, Math.min(5, Number(input.difficulty) || 1));
    var seed = input.seed || 'seed';
    var h = hash(seed);

    run.run_id = 'run_' + seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + input.run_index;
    run.theme = input.theme || 'geometry';
    run.difficulty = d;

    var bump = Math.floor((d - 1) / 2);
    run.rooms.forEach(function (room, i) {
      room.threat = Math.min(5, room.threat + bump);
      room.enemies.forEach(function (e) {
        e.hp = Math.min(120, Math.round(e.hp * (1 + (d - 1) * 0.14)));
        e.damage = Math.min(20, e.damage + (d - 1));
      });
    });

    var last = input.last_run;
    if (last) {
      if (last.cleared === true) {
        run.rooms.forEach(function (r) { r.threat = Math.min(5, r.threat + 1); });
      } else if (typeof last.died_at_room === 'number' && last.died_at_room <= 1) {
        run.rooms.slice(0, 2).forEach(function (r) { r.threat = Math.max(1, r.threat - 1); });
      }
    }

    /* 首房间不得低于 difficulty 对应的威胁档位 */
    var minThreat = Math.min(5, 1 + Math.floor((d - 1) / 2));
    if (run.rooms[0].threat < minThreat) run.rooms[0].threat = minThreat;

    /* 单调性修复：任何一档不得低于前一档 */
    for (var i = 1; i < run.rooms.length; i++) {
      if (run.rooms[i].threat < run.rooms[i - 1].threat) run.rooms[i].threat = run.rooms[i - 1].threat;
    }

    var hpScale = 1 + (d - 1) * 0.16;
    run.boss.hp = Math.min(400, Math.round(run.boss.hp * hpScale));
    run.boss.damage = Math.min(30, run.boss.damage + (d - 1) * 2);

    var themes = C.theme;
    if (themes) run.summary = themes.randomSummary(run.theme, h) || run.summary;

    /* 主题色轮换：让同一模板在不同 seed 下视觉也有差异 */
    var tokens = ['ink', 'teal', 'amber', 'violet', 'rust'];
    run.rooms.forEach(function (r, i) {
      if (i === 0) return;
      r.color_token = tokens[(h + i * 3) % tokens.length];
      if (i > 1 && r.color_token === 'ink') r.color_token = 'teal';
    });

    /* 名称主题中立化：模板内 room.name / enemy.type / boss.name 是 geometry 词表硬编码，
     * schema.validate 用 input.theme_vocab 做白名单校验，新主题下会校验失败。
     * 按「模板原值在 geometry 词表中的索引」映射到 input.theme_vocab 的同索引项。
     * 约定三套新词表与 geometry 同构：enemy_types 恰 5 项（chase/orbit/charge/ranged/static）、
     * room_names ≥5、boss_names ≥3；geometry 下 vocab===GEOM，映射恒等，M1 行为零回归。
     * 只重映射名称：结构 / 数值 / pattern / color_token / path_hint / summary 逻辑全部不动。 */
    var GEOM = (C.theme && C.theme.get('geometry').vocab) || null;
    var vocab = input.theme_vocab || (C.theme ? (C.theme.get(run.theme) || {}).vocab : null);
    if (GEOM && vocab) {
      var remap = function (value, geomList, newList) {
        if (!Array.isArray(geomList) || !Array.isArray(newList) || !newList.length) return value;
        var idx = geomList.indexOf(value);
        return (idx >= 0 && idx < newList.length) ? newList[idx] : value;
      };
      run.rooms.forEach(function (r) {
        r.name = remap(r.name, GEOM.room_names, vocab.room_names);
        r.enemies.forEach(function (e) {
          e.type = remap(e.type, GEOM.enemy_types, vocab.enemy_types);
        });
      });
      run.boss.name = remap(run.boss.name, GEOM.boss_names, vocab.boss_names);
    }

    return run;
  }

  C.gen = C.gen || {};
  C.gen.templates = { TEMPLATES: TEMPLATES, hash: hash, clone: clone, reseed: reseed };
})(window.Corridor = window.Corridor || {});
