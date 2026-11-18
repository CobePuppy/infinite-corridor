/* core/perks.js — 词条表 v2（T24 三层扩容）
 * 唯一允许出现效果数值的地方。生成器只选 id，关卡 JSON 内不得携带任何数值。
 * 规则引擎通过 derive() 把叠层换算成派生属性，通过 on() 分发事件钩子。
 *
 * 三层结构：
 *   ① 数值层：原 10 个词条（冻结：id/name/desc/派生数值逐字不变，smoke §6 依赖）。
 *   ② 机制层：新增 10 个词条（穿透/多重射击/冲刺伤害/环绕卫星/击杀爆裂/
 *              吸血/减速光环/连锁增强/连击过载/命中霜击），改变玩法。
 *   ③ 协同层：新增 4 个词条（星爆/涡心/共振/疾焰），各自提供基础增幅，
 *              并在 derive() 里与指定搭档共存时解锁「组合质变」。
 *
 * 所有新增效果数值集中在 derive()/on()/BALANCE，engine 只消费、不写死数值。
 * derive() 原 11 个字段的表达式保持与 v1 完全一致；其余字段全为新增。
 * on() 原有分支语句保持与 v1 一致，仅追加新逻辑与新增事件分支。
 */
(function (C) {
  'use strict';

  /* ① 数值层 —— 冻结区，禁止任何改动（含 name/desc/rarity/max/tag/派生数值） */
  var TABLE = {
    p_dash:   { id: 'p_dash',   name: '疾步', rarity: 'common', max: 3,        tag: '机动', desc: '冲刺冷却 -20%' },
    p_hp:     { id: 'p_hp',     name: '硬壳', rarity: 'common', max: Infinity, tag: '生存', desc: '最大生命 +20 并回复等量' },
    p_thorn:  { id: 'p_thorn',  name: '反刺', rarity: 'common', max: Infinity, tag: '反伤', desc: '受击时对来源反弹 3 点伤害' },
    p_regen:  { id: 'p_regen',  name: '回响', rarity: 'common', max: Infinity, tag: '续航', desc: '每通过一间房回复 8 生命' },
    p_range:  { id: 'p_range',  name: '远击', rarity: 'rare',   max: 2,        tag: '输出', desc: '攻击距离 +1 格' },
    p_crit:   { id: 'p_crit',   name: '锐眼', rarity: 'rare',   max: Infinity, tag: '输出', desc: '15% 概率造成双倍伤害' },
    p_slow:   { id: 'p_slow',   name: '凝滞', rarity: 'rare',   max: 2,        tag: '控制', desc: '敌人移动速度 -15%' },
    p_chain:  { id: 'p_chain',  name: '连锁', rarity: 'rare',   max: 1,        tag: '爆发', desc: '击杀时 30% 概率波及相邻敌人' },
    p_shield: { id: 'p_shield', name: '余烬', rarity: 'epic',   max: 1,        tag: '保命', desc: '每局首次致命伤保留 1 点生命' },
    p_greed:  { id: 'p_greed',  name: '贪取', rarity: 'epic',   max: 1,        tag: '风险', desc: '结算金币 +50%，但敌人伤害 +2' },

    /* ② 机制层 —— 改变玩法（10 个） */
    p_pierce:     { id: 'p_pierce',     name: '贯穿', rarity: 'rare',   max: 2,        tag: '输出', desc: '子弹额外穿透 1 个敌人' },
    p_multishot:  { id: 'p_multishot',  name: '分裂', rarity: 'epic',   max: 2,        tag: '弹幕', desc: '每次射击分裂出 1 发偏射弹' },
    p_dashdmg:    { id: 'p_dashdmg',    name: '掠影', rarity: 'rare',   max: 2,        tag: '机动', desc: '冲刺掠过的敌人受到 6 点伤害' },
    p_satellite:  { id: 'p_satellite',  name: '卫轮', rarity: 'epic',   max: 2,        tag: '召唤', desc: '召唤 1 颗环绕卫星，撞击造成 5 点伤害' },
    p_explode:    { id: 'p_explode',    name: '爆裂', rarity: 'rare',   max: 2,        tag: '爆发', desc: '击杀时对附近敌人造成 8 点爆裂伤害' },
    p_lifesteal:  { id: 'p_lifesteal',  name: '汲血', rarity: 'epic',   max: 3,        tag: '续航', desc: '每次命中回复 1 点生命' },
    p_slowaura:   { id: 'p_slowaura',   name: '寒域', rarity: 'rare',   max: 2,        tag: '控制', desc: '身周敌人移动速度额外 -20%' },
    p_chainboost: { id: 'p_chainboost', name: '引流', rarity: 'rare',   max: 2,        tag: '爆发', desc: '连锁概率 +15%，波及范围与伤害提升' },
    p_overload:   { id: 'p_overload',   name: '过载', rarity: 'rare',   max: 2,        tag: '输出', desc: '连击每达到 5 层，子弹伤害 +2' },
    p_frost:      { id: 'p_frost',      name: '霜击', rarity: 'common', max: 2,        tag: '控制', desc: '命中使敌人短暂减速' },

    /* ③ 协同层 —— 组合质变（4 个，含基础增幅 + synergy 解锁） */
    p_nova:       { id: 'p_nova',       name: '星爆', rarity: 'epic', max: 1, tag: '协同', desc: '爆裂范围与伤害提升；与「爆裂」共鸣引发全屏冲击' },
    p_vortex:     { id: 'p_vortex',     name: '涡心', rarity: 'epic', max: 1, tag: '协同', desc: '卫星转速提升；与「卫轮」「寒域」共鸣产生吸附' },
    p_resonance:  { id: 'p_resonance',  name: '共振', rarity: 'epic', max: 1, tag: '协同', desc: '连锁伤害提升；与「引流」共鸣时连锁不再衰减' },
    p_zeal:       { id: 'p_zeal',       name: '疾焰', rarity: 'epic', max: 1, tag: '协同', desc: '冲刺伤害提升；与「疾步」「爆裂」共鸣留下爆炸轨迹' }
  };

  var IDS = Object.keys(TABLE);
  var RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗' };
  var RECALL = {
    p_recall_corner: {
      name: '折角扩散', rarity: 'rare', tag: '折角', desc: '回扫出折角后短暂变宽，能扫到廊道边缘。'
    },
    p_recall_distance: {
      name: '长程蓄力', rarity: 'rare', tag: '长圈', desc: '绕经下廊组成长圈（总路程至少 1850），回扫伤害从 26 提升到 44。'
    }
  };
  var IMPACT = {
    p_impact_heavy: {
      name: '重击', rarity: 'rare', tag: '重刃', desc: '挥击静止或行走中的敌人时，击飞距离更远。'
    },
    p_impact_pursuit: {
      name: '追击', rarity: 'rare', tag: '重刃', desc: '补击飞行目标时多跟进一步，并立即恢复冲刺。'
    },
    p_impact_bank: {
      name: '折射', rarity: 'rare', tag: '手炮', desc: '点射碰墙后会反弹一次，沿反弹方向击飞命中的目标。'
    },
    p_impact_pierce: {
      name: '贯穿', rarity: 'rare', tag: '手炮', desc: '一发点射可以连续击飞同一条线上的两个敌人。'
    }
  };

  /* ---- T28 集成修复：UI 展示元数据（表外注入，冻结区字面值一行未动） ----
   * ① 冻结契约 C1：前 10 个词条的 id/name/desc/rarity/max/tag 与 derive() 派生数值
   *    逐字不变，因此采用「表外 Object.keys().forEach 注入」而非改写 TABLE 条目，
   *    smoke.js §6 的 0.64 / 120 / 0.15 三个断言不受任何影响。
   * ② MECHANIC：机制短标签，供 ui/screens.js 的 mechanicBadge() 渲染「.perk-mechanic」。
   * ③ SYNERGIES：协同关系表，与 synergies(state) 的布尔组合一一对应，且**双向登记**
   *    （任一搭档作为候选词条时都能提示）。供 screens.js 的 synergyHint() 消费：
   *    它优先调 P.synergyHint(id, owned)，其次读 P.SYNERGIES[id] / TABLE[id].synergy，
   *    三者同时提供，任一路可用即不会出现「协同层词条在卡面上和普通词条没区别」。 */
  var MECHANIC = {
    p_pierce: '穿透', p_multishot: '多重', p_dashdmg: '冲刺伤害', p_satellite: '环绕',
    p_explode: '击杀爆裂', p_lifesteal: '吸血', p_slowaura: '光环', p_chainboost: '连锁',
    p_overload: '连击', p_frost: '霜击',
    p_nova: '共鸣', p_vortex: '共鸣', p_resonance: '共鸣', p_zeal: '共鸣'
  };
  var SYNERGIES = {
    p_dash:       { with: ['p_explode', 'p_zeal'],                            hint: '冲刺掠过留下爆炸轨迹' },
    p_explode:    { with: ['p_dash', 'p_zeal', 'p_nova', 'p_chainboost'],      hint: '爆裂升格：轨迹 / 全屏冲击 / 连锁引爆' },
    p_zeal:       { with: ['p_dash', 'p_explode'],                           hint: '疾焰轨迹引爆' },
    p_crit:       { with: ['p_pierce'],                                      hint: '暴击子弹全屏穿透' },
    p_pierce:     { with: ['p_crit'],                                        hint: '暴击子弹全屏穿透' },
    p_nova:       { with: ['p_explode'],                                     hint: '击杀引发全屏冲击' },
    p_vortex:     { with: ['p_satellite', 'p_slowaura'],                     hint: '卫星产生吸附力场' },
    p_satellite:  { with: ['p_vortex', 'p_slowaura'],                        hint: '卫星产生吸附力场' },
    p_slowaura:   { with: ['p_satellite', 'p_vortex'],                        hint: '寒域与卫轮共鸣吸附' },
    p_resonance:  { with: ['p_chainboost', 'p_chain'],                       hint: '连锁不再衰减' },
    p_chainboost: { with: ['p_resonance', 'p_explode'],                      hint: '连锁质变 / 连锁引爆' },
    p_chain:      { with: ['p_resonance'],                                   hint: '连锁不再衰减' }
  };
  Object.keys(MECHANIC).forEach(function (id) {
    if (TABLE[id]) TABLE[id].mechanic = MECHANIC[id];
  });
  Object.keys(SYNERGIES).forEach(function (id) {
    if (TABLE[id]) TABLE[id].synergy = SYNERGIES[id].with.slice();
  });
  var RARITY_RANK = { common: 0, rare: 1, epic: 2 };

  /* 引擎侧规则数值集中地：房间分型 / 节奏校准 / Boss 阶段 / 连击 / 各冷却。
   * 关卡 JSON 绝不含数值，engine 只从这里或 derive() 读数值。 */
  var BALANCE = {
    /* T24-C 节奏校准：房间敌人 hp 随进度 1.15→1.70 倍；后半段每类 +1 只；Boss hp ×1.25 */
    hpBase: 1.15, hpProgress: 0.55, countAfter: 0.5, countBonus: 1, bossHpMul: 1.25,
    /* T24-B 房间分型 */
    eliteHpMul: 1.35, eliteDamage: 2, eliteCount: 1, restHeal: 25, eventGold: 20,
    /* Boss 两阶段 */
    bossPhase2At: 0.5, bossPhase2Speed: 1.3, bossPhase2Cd: 0.78,
    /* 连击与伤害飘字（C5） */
    comboWindow: 1.5, comboStep: 5, popLife: 0.7,
    /* 各钩子冷却/系数 */
    dashHitCd: 0.35, satHitCd: 0.4, dashTrailCd: 0.12, dashTrailMul: 0.6,
    spread: 0.16,
    recall: {
      speed: 860, width: 30, damage: 26,
      cornerWidth: 57, cornerDistance: 96, longDistance: 1850, longDamage: 44,
      guardWindow: 3.3, bossHp: 224, bossDamage: 8, patrolSpeed: 132
    },
    impact: {
      blade: { damage: 12, cooldown: 0.32, range: 74, halfArc: 0.73, speed: 530, redirect: 480 },
      cannon: { damage: 10, cooldown: 0.28, range: 560, speed: 415, redirect: 385 },
      lunge: 14, pursuitStep: 26, heavyMultiplier: 1.35,
      flightTime: 0.94, drag: 1.15, bounce: 0.83, relay: 0.96, minSpeed: 65,
      impactDamage: 0.056, inputBuffer: 0.17, firstGrace: 1.65, secondGrace: 2.6,
      firstHp: 78, secondHp: 112, enemySpeed: 86, enemyDamage: 9,
      combinations: {
        firstHp: 72, secondHp: 89,
        sameDirection: 0.9, sideDirection: 0.62,
        straightBoost: 1.48, foldRadius: 99, foldAngle: 0.92, foldSpeed: 0.75,
        chargeWarning: 1.35, chargeTime: 0.64, chargeRecovery: 1.55,
        chargeSpeed: 290, borrowCarry: 0.42, borrowBoost: 1.22
      },
      trial: {
        firstHp: 54, foldRadius: 128,
        press: { hp: 66, damage: 8, approach: 95, reach: 65, warning: 0.28, speed: 300,
          duration: 0.17, recovery: 0.45, landing: 0.18, width: 24, half: 0.5 },
        flank: { hp: 62, damage: 9, approach: 120, warning: 0.25, speed: 350,
          duration: 0.42, recovery: 0.35, landing: 0.2, width: 26 },
        charge: { hp: 78, damage: 13, approach: 238, min: 120, max: 220, warning: 1.2, speed: 350,
          duration: 0.6, recovery: 0.85, landing: 0.85, width: 27 }
      }
    }
  };

  function stacks(state, id) { return (state.perks && state.perks[id]) || 0; }
  function has(state, id) { return stacks(state, id) > 0; }

  function canOffer(state, id) {
    var def = TABLE[id];
    if (!def) return false;
    return stacks(state, id) < def.max;
  }

  function add(state, id) {
    if (!TABLE[id]) return false;
    state.perks[id] = stacks(state, id) + 1;
    if (id === 'p_hp') {
      state.player.hp += 20;
      state.player.maxHp += 20;
    }
    return true;
  }

  /* 协同检测：两个特定 id 同时在 perks 中 → 解锁组合质变（≥4 条） */
  function synergies(state) {
    var h = function (id) { return has(state, id); };
    return {
      /* 跨层核心组合（任务举例） */
      dashTrail:      (h('p_dash') && h('p_explode')) || (h('p_zeal') && h('p_dash')),
      critPierceFull: h('p_crit') && h('p_pierce'),
      /* 协同词条解锁 */
      fullscreenNova: h('p_nova') && h('p_explode'),
      vortexPull:     (h('p_vortex') && h('p_satellite')) || (h('p_satellite') && h('p_slowaura')),
      chainInfinite:  (h('p_resonance') && h('p_chainboost')) || (h('p_resonance') && h('p_chain')),
      chainNova:      h('p_chainboost') && h('p_explode')
    };
  }

  /* 协同提示：候选词条 id + 已持有词条（数组或 state）→ 一句可展示的提示。
   * 纯展示逻辑，不含任何效果数值；无关系 / 接口异常一律返回 ''。
   * 契约对齐 ui/screens.js 的 synergyHint()：它先调本函数，返回空再回落到关系表。 */
  function toOwned(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      var p = v.perks || {};
      return Object.keys(p).filter(function (k) { return p[k] > 0; });
    }
    return [];
  }
  function synergyHint(id, ownedOrState) {
    var row = SYNERGIES[id];
    if (!row) return '';
    var owned = toOwned(ownedOrState);
    var matched = row.with.filter(function (pid) { return owned.indexOf(pid) !== -1; });
    if (!matched.length) return '';
    var names = matched.map(function (pid) { return (TABLE[pid] || {}).name || pid; });
    return '协同 · 已持有「' + names.join('、') + '」· ' + row.hint;
  }

  /* 派生属性：所有效果数值在这里一次性换算。
   * 前 11 个字段与 v1 逐字一致，绝不改动；其后全为 T24 新增字段。 */
  function derive(state) {
    var s = stacks;
    var syn = synergies(state);
    return {
      /* ---- v1 冻结字段（值不变） ---- */
      maxHp:       100 + 20 * s(state, 'p_hp'),
      dashCd:      820 * Math.pow(0.8, s(state, 'p_dash')),
      thorn:       3 * s(state, 'p_thorn'),
      regen:       8 * s(state, 'p_regen'),
      rangeBonus:  s(state, 'p_range'),
      critChance:  Math.min(0.9, 0.15 * s(state, 'p_crit')),
      enemySpeed:  Math.pow(0.85, s(state, 'p_slow')),
      chainChance: s(state, 'p_chain') > 0 ? 0.3 : 0,
      shieldReady: s(state, 'p_shield') > 0 && !state.shieldUsed,
      greed:       s(state, 'p_greed') > 0,
      enemyDamageBonus: s(state, 'p_greed') > 0 ? 2 : 0,

      /* ---- ② 机制层派生 ---- */
      pierce:           s(state, 'p_pierce'),
      multishot:        s(state, 'p_multishot'),
      dashDamage:       6 * s(state, 'p_dashdmg') + 4 * s(state, 'p_zeal'),
      satellites:       s(state, 'p_satellite'),
      satelliteDmg:     5,
      satelliteRadius:  62,
      satelliteSpeed:   2.2 + 0.8 * s(state, 'p_vortex'),
      explodeRadius:    70 + 18 * s(state, 'p_nova') + (syn.chainNova ? 24 : 0),
      explodeDamage:    8 * s(state, 'p_explode') + 4 * s(state, 'p_nova'),
      lifesteal:        1 * s(state, 'p_lifesteal'),
      slowAuraRadius:   s(state, 'p_slowaura') > 0 ? 130 : 0,
      slowAuraFactor:   Math.max(0.4, 1 - 0.2 * s(state, 'p_slowaura')),
      chainChanceBoost: 0.15 * s(state, 'p_chainboost') + 0.1 * s(state, 'p_resonance'),
      chainRadius:      130 + 24 * s(state, 'p_chainboost') + (syn.chainInfinite ? 30 : 0),
      chainDamage:      8 + 4 * s(state, 'p_chainboost') + 4 * s(state, 'p_resonance'),
      comboDamage:      2 * s(state, 'p_overload'),
      frostFactor:      s(state, 'p_frost') > 0 ? Math.max(0.5, 1 - 0.25 * s(state, 'p_frost')) : 1,
      frostTime:        0.9,

      /* ---- ③ 协同层：组合质变开关 ---- */
      synergy: syn
    };
  }

  /* 事件钩子：返回被修改过的 payload，由引擎决定是否采用。
   * 原有分支的原有语句与 v1 一致；新增语句与新增分支均为 T24 扩展。 */
  function on(state, event, payload) {
    var d = derive(state);
    switch (event) {
      case 'attack':
        if (Math.random() < d.critChance) payload.damage *= 2, payload.crit = true;
        payload.range += d.rangeBonus * 46;
        /* 新增：连击过载增伤 / 穿透 / 暴击穿透全屏 / 多重射击 / 卫星数 */
        if (d.comboDamage > 0) payload.damage += d.comboDamage * Math.floor((state.combo || 0) / BALANCE.comboStep);
        payload.pierce = d.pierce + ((payload.crit && d.synergy.critPierceFull) ? 99 : 0);
        payload.multishot = d.multishot;
        payload.spread = BALANCE.spread;
        payload.satellites = d.satellites;
        return payload;
      case 'hurt':
        payload.damage += d.enemyDamageBonus;
        if (payload.damage >= state.player.hp && d.shieldReady) {
          state.shieldUsed = true;
          payload.damage = state.player.hp - 1;
          payload.shielded = true;
        }
        if (d.thorn > 0 && payload.source) {
          payload.source.hp -= d.thorn;
          payload.reflected = d.thorn;
        }
        return payload;
      case 'roomClear':
        if (d.regen > 0) {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + d.regen);
          payload.healed = d.regen;
        }
        return payload;
      case 'kill':
        payload.chainChance = d.chainChance;
        /* 新增：连锁增强 / 击杀爆裂 / synergy */
        if (d.chainChanceBoost) payload.chainChance += d.chainChanceBoost;
        payload.chainRadius = d.chainRadius;
        payload.chainDamage = d.chainDamage;
        payload.chainInfinite = d.synergy.chainInfinite;
        payload.explodeRadius = d.explodeRadius;
        payload.explodeDamage = d.explodeDamage + (d.synergy.chainNova ? 6 : 0);
        payload.fullscreenNova = d.synergy.fullscreenNova;
        return payload;
      case 'runEnd':
        if (d.greed) payload.gold = Math.floor(payload.gold * 1.5);
        return payload;

      /* ---- T24 新增事件分支 ---- */
      case 'dash':
        payload.dashDamage = d.dashDamage + (d.synergy.dashTrail ? d.explodeDamage : 0);
        payload.dashTrail = d.synergy.dashTrail;
        payload.explodeRadius = d.explodeRadius;
        payload.explodeDamage = d.explodeDamage;
        return payload;
      case 'hit':
        payload.lifesteal = d.lifesteal;
        payload.frost = d.frostFactor < 1 ? { factor: d.frostFactor, time: d.frostTime } : null;
        return payload;
      default:
        return payload;
    }
  }

  C.core = C.core || {};
  C.core.perks = {
    TABLE: TABLE, IDS: IDS, RARITY_LABEL: RARITY_LABEL, RARITY_RANK: RARITY_RANK,
    BALANCE: BALANCE, RECALL: RECALL, IMPACT: IMPACT,
    stacks: stacks, canOffer: canOffer, add: add, derive: derive, on: on,
    synergies: synergies,
    /* T28：UI 展示接口（不参与规则运算） */
    SYNERGIES: SYNERGIES, MECHANIC: MECHANIC, synergyHint: synergyHint
  };
})(window.Corridor = window.Corridor || {});
