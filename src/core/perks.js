/* core/perks.js — 词条表 v1
 * 唯一允许出现效果数值的地方。生成器只选 id，关卡 JSON 内不得携带任何数值。
 * 规则引擎通过 derive() 把叠层换算成派生属性，通过 on() 分发事件钩子。
 */
(function (C) {
  'use strict';

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
    p_greed:  { id: 'p_greed',  name: '贪取', rarity: 'epic',   max: 1,        tag: '风险', desc: '结算金币 +50%，但敌人伤害 +2' }
  };

  var IDS = Object.keys(TABLE);
  var RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗' };

  function stacks(state, id) { return (state.perks && state.perks[id]) || 0; }

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

  /* 派生属性：所有效果数值在这里一次性换算 */
  function derive(state) {
    var s = stacks;
    return {
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
      enemyDamageBonus: s(state, 'p_greed') > 0 ? 2 : 0
    };
  }

  /* 事件钩子：返回被修改过的 payload，由引擎决定是否采用 */
  function on(state, event, payload) {
    var d = derive(state);
    switch (event) {
      case 'attack':
        if (Math.random() < d.critChance) payload.damage *= 2, payload.crit = true;
        payload.range += d.rangeBonus * 46;
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
        return payload;
      case 'runEnd':
        if (d.greed) payload.gold = Math.floor(payload.gold * 1.5);
        return payload;
      default:
        return payload;
    }
  }

  C.core = C.core || {};
  C.core.perks = {
    TABLE: TABLE, IDS: IDS, RARITY_LABEL: RARITY_LABEL,
    stacks: stacks, canOffer: canOffer, add: add, derive: derive, on: on
  };
})(window.Corridor = window.Corridor || {});
