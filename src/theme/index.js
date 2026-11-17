/* theme/index.js — 主题包：只放命名素材与配色，绝不承载规则
 * geometry 为默认主题；oldtown / subject / wudang 三套词表与 geometry 完全同构，
 * 供 gen/templates.js 的 reseed() 按「geometry 索引 → 当前词表同索引项」重映射名称。
 */
(function (C) {
  'use strict';

  var COLORS = {
    ink:    '#141821',
    amber:  '#E9A23B',
    teal:   '#39C6A5',
    violet: '#8E7CE8',
    rust:   '#D9644B'
  };

  var COLOR_TOKENS = Object.keys(COLORS);

  var THEMES = {
    geometry: {
      id: 'geometry',
      label: '抽象几何',
      ready: true,
      vocab: {
        enemy_types: ['e_dot', 'e_orbit', 'e_charge', 'e_ranged', 'e_block'],
        room_names: ['方庭', '折廊', '交集', '环室', '隙间'],
        boss_names: ['合点', '重线', '闭域'],
        color_tokens: COLOR_TOKENS.slice(),
        summary_prefix: '冷静、几何感、不带情绪的短句'
      },
      summary_lines: [
        '方与线再次相遇，走廊记住了你上次停下的位置。',
        '每一次折返都通向不同的房间，几何从不为谁停留。',
        '边界收拢，色彩退去，只剩路径仍然成立。',
        '你走过的形状会被下一局悄悄改写。'
      ]
    },
    oldtown: {
      id: 'oldtown',
      label: '旧城',
      ready: true,
      vocab: {
        enemy_types: ['o_stray', 'o_lantern', 'o_cart', 'o_window', 'o_stall'],
        room_names: ['青砖巷', '雨棚街', '拆迁口', '旧钟楼', '灯火弄', '石阶下'],
        boss_names: ['钟楼守', '拆墙人', '巷底影'],
        color_tokens: COLOR_TOKENS.slice(),
        summary_prefix: '潮湿、市井、带一点旧日人烟的短句'
      },
      summary_lines: [
        '青砖被雨洗过，巷口的灯还亮着，像在等谁回来。',
        '招牌褪了色，路径却比上一回更熟，旧城认得你的脚步。',
        '钟楼敲过几下，拆迁口的围墙又往前挪了一寸。',
        '烟火气从窗缝里漏出来，走廊把你留在了这条街上。',
        '石阶尽头仍是那盏灯，走多远都会拐回这里。'
      ]
    },
    subject: {
      id: 'subject',
      label: '学科',
      ready: true,
      vocab: {
        enemy_types: ['s_lemma', 's_orbit', 's_vector', 's_proof', 's_axiom'],
        room_names: ['阶梯教室', '公式长廊', '实验台', '图书馆', '考场', '黑板前'],
        boss_names: ['终极考题', '未证猜想', '闭卷之末'],
        color_tokens: COLOR_TOKENS.slice(),
        summary_prefix: '清冷、克制、像写在黑板边缘的推演短句'
      },
      summary_lines: [
        '公式还留在黑板上，走廊把你上次停下的那一步又摆了出来。',
        '每一间房都是一道未解的题，解法换了，条件却似曾相识。',
        '铃声落下，推导收束，只剩结论仍然成立。',
        '草稿纸翻到新的一页，先前的笔迹会悄悄改写这一局。',
        '考场尽头没有标准答案，只有你走出来的那条路径。'
      ]
    },
    wudang: {
      id: 'wudang',
      label: '武当',
      ready: true,
      vocab: {
        enemy_types: ['w_sword', 'w_cloud', 'w_strike', 'w_needle', 'w_stake'],
        room_names: ['山门', '云阶', '演武场', '紫霄院', '松风涧', '丹房'],
        boss_names: ['守山人', '太极宗师', '闭关者'],
        color_tokens: COLOR_TOKENS.slice(),
        summary_prefix: '清逸、沉稳、带山岚与吐纳气息的短句'
      },
      summary_lines: [
        '山门未掩，云海漫过石阶，走廊记得你上次收势的地方。',
        '一招一式都通向不同的院落，气韵从不为谁停留。',
        '松风收拢，晨钟落下，只剩脚下这条路径仍然成立。',
        '起手与收势之间，上一局的气息会悄悄换到这一局。',
        '演武场尽头无人喝彩，太极的圆却一直画到你回来。'
      ]
    }
  };

  var ACTIVE_KEY = 'corridor.theme.v1';

  function get(id) { return THEMES[id] || THEMES.geometry; }
  function color(token) { return COLORS[token] || COLORS.ink; }
  function readyIds() { return Object.keys(THEMES).filter(function (k) { return THEMES[k].ready; }); }
  function isReady(id) { return !!(THEMES[id] && THEMES[id].ready); }
  function randomSummary(id, seed) {
    var t = get(id);
    if (!t.summary_lines.length) return '';
    return t.summary_lines[Math.abs(seed | 0) % t.summary_lines.length];
  }

  /* 当前主题：仅存 id，缺省或非法一律回落 geometry；读写都容错无痕模式 */
  function active() {
    var id = null;
    try { id = localStorage.getItem(ACTIVE_KEY); } catch (e) { /* 无痕模式忽略 */ }
    return isReady(id) ? id : 'geometry';
  }
  function setActive(id) {
    if (!isReady(id)) return false;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* 无痕模式忽略 */ }
    return true;
  }

  C.theme = {
    THEMES: THEMES, COLORS: COLORS, COLOR_TOKENS: COLOR_TOKENS,
    get: get, color: color, readyIds: readyIds, randomSummary: randomSummary,
    active: active, setActive: setActive
  };
})(window.Corridor = window.Corridor || {});
