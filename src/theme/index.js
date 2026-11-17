/* theme/index.js — 主题包：只放命名素材与配色，绝不承载规则
 * geometry 为默认主题；其余三个是空壳接口，待后续填充词表即可启用。
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
    oldtown:  { id: 'oldtown',  label: '旧城',   ready: false, vocab: null, summary_lines: [] },
    subject:  { id: 'subject',  label: '学科',   ready: false, vocab: null, summary_lines: [] },
    wudang:   { id: 'wudang',   label: '武当',   ready: false, vocab: null, summary_lines: [] }
  };

  function get(id) { return THEMES[id] || THEMES.geometry; }
  function color(token) { return COLORS[token] || COLORS.ink; }
  function readyIds() { return Object.keys(THEMES).filter(function (k) { return THEMES[k].ready; }); }
  function randomSummary(id, seed) {
    var t = get(id);
    if (!t.summary_lines.length) return '';
    return t.summary_lines[Math.abs(seed | 0) % t.summary_lines.length];
  }

  C.theme = { THEMES: THEMES, COLORS: COLORS, COLOR_TOKENS: COLOR_TOKENS, get: get, color: color, readyIds: readyIds, randomSummary: randomSummary };
})(window.Corridor = window.Corridor || {});
