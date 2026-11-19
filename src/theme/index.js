/* theme/index.js — 主题包：只放命名素材、配色与视觉参数，绝不承载规则或数值
 * geometry 为默认主题；oldtown / subject / wudang 三套词表与 geometry 完全同构，
 * 供 gen/templates.js 的 reseed() 按「geometry 索引 → 当前词表同索引项」重映射名称。
 *
 * ── 视觉层契约（M8 美术大改）────────────────────────────────────────
 *   · PALETTES：四套主题各自独立的 5-token 色板（token ∈ ink/amber/teal/violet/rust）。
 *     与 gen/schema.js 的 ENUM.color_token 一一对应。整套画面由色板驱动，不再由
 *     render.js 里的硬编码常量主导，四套主题的差异因此是「整幅画面」而非网格间距。
 *   · VISUALS：每套主题的材质与后处理配置，全部字段都真的被 render.js 读取：
 *       bgStyle / enemyStyle / particleStyle —— 造型分流标识
 *       ground  —— 网格步长 / 主线间隔 / 底纹母题 / 线强度
 *       frame   —— 图廓编号与题名（测绘档案感）
 *       glow    —— 发光倍率
 *       postFx  —— bloom / grain / vignette / halo / shock 强度
 *     全部是「命名素材 / 配色 / 视觉参数」，不含任何规则、伤害或结算数值（不变量）。
 *   · C.theme.palette(id, token) → 色值字符串；C.theme.visual(id) → 上述对象；
 *     未知 id 一律回落 geometry。
 *   · 旧接口 color / COLORS / COLOR_TOKENS / get / readyIds / active / setActive /
 *     randomSummary / THEMES 一律保留且行为兼容；color(token) 按 geometry 色板取值。
 *   · vocab 键集合与四套词表保持原样（m2m3.js 校验同构性，禁止增删键）。
 */
(function (C) {
  'use strict';

  /* ---------- 四套独立色板 ----------
   * 统一到「深墨底 + 单一强强调色」的测绘图语言：
   *   amber = 唯一高亮（玩家 / 闭环 / 主按钮 / 图廓读数）
   *   teal  = 路径与可走区域
   *   rust  = 危险与首领
   *   violet= 远程 / 次级信息
   * 四套只调整色相与明度，不换语义，保证「同一套仪器、四种材质」。 */
  var PALETTES = {
    /* geometry · 精密坐标网：墨蓝 + 琥珀金 + 雾青，冷净、无杂色 */
    geometry: {
      ink:    '#0A1018',
      amber:  '#E9B44C',
      teal:   '#5FD3C4',
      violet: '#A99BE8',
      rust:   '#E4584A'
    },
    /* oldtown · 潮湿砖巷：暖灯橘、苔青、藕紫、砖红，整体偏赭 */
    oldtown: {
      ink:    '#14100C',
      amber:  '#EFA847',
      teal:   '#8CB79C',
      violet: '#B98D94',
      rust:   '#D4643F'
    },
    /* subject · 方格纸与钢笔：冷蓝、粉笔黄、靛紫、批注红 */
    subject: {
      ink:    '#0B121B',
      amber:  '#D8C07C',
      teal:   '#6FA9CB',
      violet: '#9098D6',
      rust:   '#C46C63'
    },
    /* wudang · 墨晕山岚：灰青、淡金、远山紫霭、朱砂 */
    wudang: {
      ink:    '#161C1E',
      amber:  '#CBA77E',
      teal:   '#7FA99A',
      violet: '#9C99B6',
      rust:   '#B26C5E'
    }
  };

  /* COLORS / COLOR_TOKENS 保留 M1 语义：COLORS 即 geometry 色板，color() 按它取值 */
  var COLORS = PALETTES.geometry;
  var COLOR_TOKENS = Object.keys(COLORS);

  /* ---------- 四套视觉配置（全部字段都会被 render.js 读取） ---------- */
  var VISUALS = {
    geometry: {
      palette: PALETTES.geometry,
      bgStyle: 'survey-grid',       /* 精密等距网 + 同心圆刻度 + 角标 */
      enemyStyle: 'geometric',      /* 硬边多边形 / 双描边 */
      particleStyle: 'shard',       /* 方形碎片 */
      ground: { step: 40, major: 5, motif: 'rings', line: 0.075 },
      frame: { code: 'ATLAS 00', name: '抽象几何', ticks: true },
      glow: 1,
      postFx: { bloom: 0.22, grain: 0.014, vignette: 0.34, halo: 0.08, shock: 0.90 }
    },
    oldtown: {
      palette: PALETTES.oldtown,
      bgStyle: 'rain-bricks',       /* 错缝砖纹 + 暖灯晕 + 雨痕 */
      enemyStyle: 'lantern',        /* 圆润灯笼 / 暖光晕 */
      particleStyle: 'ember',       /* 暖色火星 */
      ground: { step: 44, major: 4, motif: 'brick', line: 0.065 },
      frame: { code: 'ATLAS 01', name: '旧城', ticks: true },
      glow: 1.35,
      postFx: { bloom: 0.38, grain: 0.055, vignette: 0.46, halo: 0.26, shock: 1.10 }
    },
    subject: {
      palette: PALETTES.subject,
      bgStyle: 'formula-paper',     /* 方格纸 + 装订线 + 刻度 */
      enemyStyle: 'academic',       /* 规整方 / 圆 + 标注角 */
      particleStyle: 'dot',         /* 细小圆点 / 粉笔末 */
      ground: { step: 28, major: 5, motif: 'paper', line: 0.085 },
      frame: { code: 'ATLAS 02', name: '学科', ticks: true },
      glow: 0.75,
      postFx: { bloom: 0.12, grain: 0.010, vignette: 0.26, halo: 0.05, shock: 0.70 }
    },
    wudang: {
      palette: PALETTES.wudang,
      bgStyle: 'ink-wash',          /* 墨晕山形 + 云纹弧 + 留白 */
      enemyStyle: 'taiji',          /* 柔圆 / 阴阳弧 */
      particleStyle: 'petal',       /* 柔和墨瓣 */
      ground: { step: 48, major: 4, motif: 'ink', line: 0.055 },
      frame: { code: 'ATLAS 03', name: '武当', ticks: true },
      glow: 0.95,
      postFx: { bloom: 0.18, grain: 0.022, vignette: 0.22, halo: 0.18, shock: 0.60 }
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
