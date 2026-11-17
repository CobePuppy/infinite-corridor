/* theme/index.js — 主题包：只放命名素材、配色与视觉参数，绝不承载规则或数值
 * geometry 为默认主题；oldtown / subject / wudang 三套词表与 geometry 完全同构，
 * 供 gen/templates.js 的 reseed() 按「geometry 索引 → 当前词表同索引项」重映射名称。
 *
 * ── 视觉层契约（M4 / T26-A）──────────────────────────────────────────
 *   · PALETTES：四套主题各自独立的 5-token 色板（token ∈ ink/amber/teal/violet/rust）。
 *     与 gen/schema.js 的 ENUM.color_token 一一对应，几何色板即 M1 的 COLORS。
 *   · VISUALS：每套主题的命名构图 / 造型 / 粒子风格标识 + 程序化后处理参数。
 *     全部是「命名素材 / 配色 / 视觉参数」，不含任何规则、伤害或结算数值（不变量）。
 *   · C.theme.palette(id, token) → 色值字符串；C.theme.visual(id) →
 *     { palette, bgStyle, enemyStyle, particleStyle, postFx }；未知 id 一律回落 geometry。
 *   · 旧接口 color / COLORS / COLOR_TOKENS / get / readyIds / active / setActive /
 *     randomSummary / THEMES 一律保留且行为兼容；color(token) 按 geometry 色板取值。
 *   · vocab 键集合与四套词表保持原样（m2m3.js 校验同构性，禁止增删键）。
 */
(function (C) {
  'use strict';

  /* ---------- 四套独立色板（命名素材：配色） ---------- */
  var PALETTES = {
    /* geometry · 冷调几何：沿用 M1 原值，高饱和冷青 + 明琥珀 / 紫 / 锈红 */
    geometry: {
      ink:    '#141821',
      amber:  '#E9A23B',
      teal:   '#39C6A5',
      violet: '#8E7CE8',
      rust:   '#D9644B'
    },
    /* oldtown · 潮湿市井暖光：灯橘为主，苔绿 / 藕紫 / 砖红低饱和，整体偏暖褐 */
    oldtown: {
      ink:    '#1A1410',
      amber:  '#F2A63C',
      teal:   '#78A88E',
      violet: '#A5818C',
      rust:   '#C25736'
    },
    /* subject · 清冷学理：钢笔冷蓝为主，粉笔黄 / 靛紫 / 批注红克制内敛 */
    subject: {
      ink:    '#101820',
      amber:  '#D8B06A',
      teal:   '#5FA6C9',
      violet: '#7E88C8',
      rust:   '#B45E58'
    },
    /* wudang · 山岚留白：淡墨青灰，灰青 / 远山紫霭 / 朱砂皆低饱和，留白感 */
    wudang: {
      ink:    '#232A2C',
      amber:  '#C9A579',
      teal:   '#6F9C8D',
      violet: '#8E8CAA',
      rust:   '#A96357'
    }
  };

  /* COLORS / COLOR_TOKENS 保留 M1 语义：COLORS 即 geometry 色板，color() 按它取值 */
  var COLORS = PALETTES.geometry;
  var COLOR_TOKENS = Object.keys(COLORS);

  /* ---------- 四套视觉配置（命名素材 + 程序化绘制/后处理参数） ----------
   * bgStyle / enemyStyle / particleStyle：render.js 用来分流的命名标识。
   * postFx：后处理强度系数（bloom 发光 / aberration 色差 / grain 噪点 /
   *   halo 动态光晕 / vignette 暗角 / shock 冲击波），纯视觉参数，非规则数值。
   * 四套的构图、造型、粒子、后处理强度刻意拉开，保证视觉真正不同。 */
  var VISUALS = {
    geometry: {
      palette: PALETTES.geometry,
      bgStyle: 'grid-arcs',        /* 细网格 + 对称弧线 */
      enemyStyle: 'geometric',     /* 硬边多边形 / 细描边 */
      particleStyle: 'shard',      /* 方形碎片 */
      postFx: { bloom: 0.16, aberration: 1.1, grain: 0.012, halo: 0.05, vignette: 0.30, shock: 0.85 }
    },
    oldtown: {
      palette: PALETTES.oldtown,
      bgStyle: 'noisy-bricks',     /* 颗粒噪点 + 暖光晕 + 横竖砖缝 */
      enemyStyle: 'lantern',       /* 圆润灯笼 / 暖光晕 */
      particleStyle: 'ember',      /* 暖色圆点火星 */
      postFx: { bloom: 0.34, aberration: 0.5, grain: 0.055, halo: 0.24, vignette: 0.44, shock: 1.15 }
    },
    subject: {
      palette: PALETTES.subject,
      bgStyle: 'formula-ticks',    /* 公式网格 + 刻度线 */
      enemyStyle: 'academic',      /* 规整方 / 圆 + 标注角 */
      particleStyle: 'dot',        /* 细小圆点 / 粉笔末 */
      postFx: { bloom: 0.09, aberration: 1.6, grain: 0.008, halo: 0.03, vignette: 0.24, shock: 0.65 }
    },
    wudang: {
      palette: PALETTES.wudang,
      bgStyle: 'ink-wash',         /* 留白渐变 + 柔和墨迹弧 */
      enemyStyle: 'taiji',         /* 柔圆 / 阴阳弧 */
      particleStyle: 'petal',      /* 柔和墨瓣 */
      postFx: { bloom: 0.13, aberration: 0.35, grain: 0.02, halo: 0.14, vignette: 0.18, shock: 0.55 }
    }
  };

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

  /* 新接口：按主题 id 取色板色值 / 视觉配置；非法 id 由 get() 回落 geometry */
  function palette(id, token) {
    var p = PALETTES[get(id).id] || PALETTES.geometry;
    return p[token] || p.ink;
  }
  function visual(id) {
    return VISUALS[get(id).id] || VISUALS.geometry;
  }

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
    /* 旧接口（行为兼容） */
    THEMES: THEMES, COLORS: COLORS, COLOR_TOKENS: COLOR_TOKENS,
    get: get, color: color, readyIds: readyIds, randomSummary: randomSummary,
    active: active, setActive: setActive,
    /* 新接口（视觉层契约） */
    PALETTES: PALETTES, VISUALS: VISUALS, palette: palette, visual: visual
  };
})(window.Corridor = window.Corridor || {});
