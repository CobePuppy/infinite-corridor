/* ui/render.js — Canvas 2D 渲染：纯程序化色块与符号，零美术资源
 * T26：颜色一律从当前主题色板取；背景/造型/粒子按 visual 配置分流；
 *      draw 末尾叠加程序化后处理与 C5 打击反馈（全部字段可选，缺省不绘制）。
 * 主题来源：state.run.theme > C.theme.active() > geometry。
 * 保留 drawWalls/drawExit/drawParticles/drawTrail/drawBullets/drawPlayer/drawEnemy/draw
 * 等函数签名与 draw(ctx,s,t) 入口（main.js 调用方式不变）。
 */
(function (C) {
  'use strict';

  var W = 960, H = 600;
  var TOKENS = ['ink', 'amber', 'teal', 'violet', 'rust'];

  /* ---------- 颜色工具（纯程序化，无外部资源） ---------- */
  function hex2rgb(h) {
    var s = String(h || '').replace('#', '').trim();
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  function hexByte(v) {
    var s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
    return s.length < 2 ? '0' + s : s;
  }
  function mix(a, b, k) {
    var x = hex2rgb(a), y = hex2rgb(b);
    if (!x || !y) return a;
    return '#' + hexByte(x.r + (y.r - x.r) * k) + hexByte(x.g + (y.g - x.g) * k) + hexByte(x.b + (y.b - x.b) * k);
  }
  function shade(h, k) { return k >= 0 ? mix(h, '#FFFFFF', k) : mix(h, '#000000', -k); }
  function rgba(h, a) {
    var c = hex2rgb(h);
    if (!c) return 'rgba(127,127,127,' + a + ')';
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  /* 旧版 M1 数据色 → 主题 token：让 engine 里遗留的硬编码色也随主题走。
   * 未知色（白色闪光、rgba()、自定义色）原样返回，兼容 logic-dev 的扩展。 */
  var LEGACY = {
    '#39C6A5': 'teal', '#8FF0D5': 'teal',
    '#E9A23B': 'amber', '#F5C879': 'amber',
    '#8E7CE8': 'violet', '#B9A9FF': 'violet', '#C3B7FF': 'violet',
    '#D9644B': 'rust',
    '#141821': 'ink', '#1A2030': 'ink', '#0B0E15': 'ink'
  };
  function mapColor(c) {
    if (!c || typeof c !== 'string') return CUR.col.player;
    var key = c.trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(LEGACY, key)) return P(LEGACY[key]);
    return c;
  }

  /* ---------- 当前帧主题上下文 ---------- */
  var DEFAULT_VIS = {
    palette: null, bgStyle: 'grid-arcs', enemyStyle: 'geometric',
    particleStyle: 'shard', postFx: null /* 缺省 → 不叠加后处理，画面等价 M1 */
  };
  var CUR = null;

  function safeActive() {
    try { return (C.theme && C.theme.active) ? C.theme.active() : 'geometry'; }
    catch (e) { return 'geometry'; }
  }
  function derive(p) {
    var ink = p.ink, teal = p.teal, amber = p.amber, violet = p.violet, rust = p.rust;
    return {
      bg:         shade(ink, -0.35),
      wall:       shade(mix(ink, teal, 0.10), 0.10),
      inkCore:    shade(ink, -0.30),
      grid:       'rgba(255,255,255,0.028)',
      player:     teal,
      playerGlow: rgba(teal, 0.14),
      bullet:     shade(teal, 0.40),
      trail:      teal,
      crit:       amber,
      enemyBullet: shade(violet, 0.12),
      hpBar:      amber,
      bossBar:    rust,
      rust: rust, violet: violet, amber: amber, teal: teal, ink: ink
    };
  }
  function buildCur(s) {
    var th = C.theme || {};
    var id = (s && s.run && s.run.theme) ? s.run.theme : safeActive();
    var valid = (th.THEMES && th.THEMES[id]) ? id : 'geometry'; /* 非法/缺省回落 */
    var vis = (typeof th.visual === 'function') ? th.visual(valid) : null;
    if (!vis) vis = DEFAULT_VIS;                               /* 旧 theme 层回退 */
    var pp = {};
    TOKENS.forEach(function (tk) {
      pp[tk] = (typeof th.palette === 'function') ? th.palette(valid, tk)
             : (typeof th.color === 'function') ? th.color(tk) : '#39C6A5';
    });
    return { id: valid, vis: vis, P: pp, col: derive(pp) };
  }
  function P(token) { return (CUR && CUR.P[token]) || (CUR ? CUR.P.ink : '#141821'); }

  /* ---------- 基础几何 ---------- */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function polygon(ctx, x, y, r, sides, rot) {
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = rot + (i / sides) * Math.PI * 2;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /* ---------- 四套背景构图（按 visual.bgStyle 分流，全程序化） ---------- */
  function bgGeometry(ctx, accent, t) {
    ctx.strokeStyle = CUR.col.grid; ctx.lineWidth = 1;
    for (var x = 48; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (var y = 48; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    /* 对称弧线：左右两侧同半径圆弧，几何主题标志 */
    ctx.save(); ctx.strokeStyle = accent; ctx.globalAlpha = 0.10; ctx.lineWidth = 1.2;
    [140, 220, 300, 380].forEach(function (r) {
      ctx.beginPath(); ctx.arc(0, H / 2, r, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W, H / 2, r, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    });
    ctx.restore();
    ctx.globalAlpha = 0.055; ctx.fillStyle = accent;
    ctx.fillRect(W - 250, 0, 250, 250);
    ctx.beginPath(); ctx.arc(90, H - 60, 170, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.16; ctx.lineWidth = 1.5;
    ctx.strokeRect(24.5, 24.5, W - 49, H - 49); ctx.globalAlpha = 1;
    var pulse = 0.05 + 0.025 * Math.sin(t * 1.2);
    ctx.strokeStyle = accent; ctx.globalAlpha = pulse; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function bgOldtown(ctx, accent, t) {
    /* 暖光晕（几处灯火，随时间脉动） */
    var lights = [[W * 0.22, H * 0.28], [W * 0.78, H * 0.34], [W * 0.55, H * 0.80], [W * 0.12, H * 0.72]];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    lights.forEach(function (L, i) {
      var r = 150 + 18 * Math.sin(t * 0.9 + i);
      var g = ctx.createRadialGradient(L[0], L[1], 0, L[0], L[1], r);
      g.addColorStop(0, rgba(CUR.col.amber, 0.16));
      g.addColorStop(0.45, rgba(CUR.col.amber, 0.05));
      g.addColorStop(1, rgba(CUR.col.amber, 0));
      ctx.fillStyle = g; ctx.fillRect(L[0] - r, L[1] - r, r * 2, r * 2);
    });
    ctx.restore();
    /* 横竖砖缝（错位砖） */
    ctx.strokeStyle = rgba(CUR.col.wall, 0.55); ctx.lineWidth = 2;
    var bh = 46, bw = 96;
    for (var row = 0, y = 0; y < H; row++, y += bh) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
      var off = (row % 2) ? bw / 2 : 0;
      for (var x = off; x < W; x += bw) { ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + bh); ctx.stroke(); }
    }
    /* 颗粒噪点 */
    ctx.fillStyle = rgba(CUR.col.amber, 0.05);
    for (var i = 0; i < 260; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (var j = 0; j < 160; j++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.20; ctx.lineWidth = 1.5;
    ctx.strokeRect(24.5, 24.5, W - 49, H - 49); ctx.globalAlpha = 1;
  }
  function bgSubject(ctx, accent, t) {
    /* 细密公式网格 + 主网格 */
    ctx.strokeStyle = rgba(CUR.col.teal, 0.055); ctx.lineWidth = 1;
    for (var x = 0; x <= W; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (var y = 0; y <= H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    ctx.strokeStyle = rgba(CUR.col.teal, 0.12);
    for (var x2 = 0; x2 <= W; x2 += 128) { ctx.beginPath(); ctx.moveTo(x2 + 0.5, 0); ctx.lineTo(x2 + 0.5, H); ctx.stroke(); }
    for (var y2 = 0; y2 <= H; y2 += 128) { ctx.beginPath(); ctx.moveTo(0, y2 + 0.5); ctx.lineTo(W, y2 + 0.5); ctx.stroke(); }
    /* 四边刻度线，长短交替 */
    ctx.strokeStyle = rgba(accent, 0.30); ctx.lineWidth = 1;
    for (var k = 0; k <= W; k += 16) {
      var l = (k % 80 === 0) ? 12 : (k % 32 === 0 ? 8 : 4);
      ctx.beginPath(); ctx.moveTo(k + 0.5, 0); ctx.lineTo(k + 0.5, l); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k + 0.5, H); ctx.lineTo(k + 0.5, H - l); ctx.stroke();
    }
    for (var m = 0; m <= H; m += 16) {
      var l2 = (m % 80 === 0) ? 12 : (m % 32 === 0 ? 8 : 4);
      ctx.beginPath(); ctx.moveTo(0, m + 0.5); ctx.lineTo(l2, m + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W, m + 0.5); ctx.lineTo(W - l2, m + 0.5); ctx.stroke();
    }
    /* 淡淡的公式符号（Canvas 文字，系统字体，零外部资源） */
    ctx.save(); ctx.fillStyle = rgba(CUR.col.teal, 0.10); ctx.font = 'italic 26px system-ui, serif';
    ['∑', '∫', '√', 'π', '≈', '∂', '∆', '∞'].forEach(function (sym, i) {
      ctx.fillText(sym, 90 + (i % 4) * 240 + 18 * Math.sin(t * 0.2 + i), 150 + Math.floor(i / 4) * 280);
    });
    ctx.restore();
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.16; ctx.lineWidth = 1.5;
    ctx.strokeRect(24.5, 24.5, W - 49, H - 49); ctx.globalAlpha = 1;
  }
  function bgWudang(ctx, accent, t) {
    /* 留白渐变 */
    var g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, shade(CUR.col.ink, 0.55));
    g.addColorStop(0.45, shade(CUR.col.ink, 0.18));
    g.addColorStop(1, CUR.col.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 柔和墨迹弧（粗细渐变） */
    ctx.save(); ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      ctx.strokeStyle = rgba(shade(CUR.col.ink, -0.1), 0.06 + i * 0.015);
      ctx.lineWidth = 26 - i * 5;
      var yy = 120 + i * 140 + 12 * Math.sin(t * 0.25 + i);
      ctx.beginPath(); ctx.moveTo(-40, yy);
      ctx.bezierCurveTo(W * 0.28, yy - 90 + 40 * Math.sin(t * 0.2 + i), W * 0.7, yy + 90, W + 40, yy - 30);
      ctx.stroke();
    }
    /* 远山轮廓 */
    ctx.strokeStyle = rgba(CUR.col.teal, 0.14); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H * 0.72);
    ctx.bezierCurveTo(W * 0.18, H * 0.60, W * 0.30, H * 0.78, W * 0.5, H * 0.68);
    ctx.bezierCurveTo(W * 0.70, H * 0.58, W * 0.84, H * 0.74, W, H * 0.64);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.10; ctx.lineWidth = 1;
    ctx.strokeRect(24.5, 24.5, W - 49, H - 49); ctx.globalAlpha = 1;
  }
  function drawBackground(ctx, s, t) {
    var accent = P(s && s.room ? s.room.color_token : 'ink');
    ctx.fillStyle = CUR.col.bg; ctx.fillRect(0, 0, W, H);
    var style = CUR.vis.bgStyle;
    if (style === 'noisy-bricks') bgOldtown(ctx, accent, t);
    else if (style === 'formula-ticks') bgSubject(ctx, accent, t);
    else if (style === 'ink-wash') bgWudang(ctx, accent, t);
    else bgGeometry(ctx, accent, t);
  }

  /* ---------- 墙 / 出口 / 粒子 / 拖尾 ---------- */
  function drawWalls(ctx, s) {
    var accent = P(s.room ? s.room.color_token : 'ink');
    var es = CUR.vis.enemyStyle;
    s.walls.forEach(function (q) {
      ctx.fillStyle = CUR.col.wall;
      rr(ctx, q.x, q.y, q.w, q.h, es === 'taiji' ? 8 : (es === 'lantern' ? 6 : 5)); ctx.fill();
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      rr(ctx, q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 5); ctx.stroke();
      ctx.globalAlpha = 1;
      if (es === 'academic') {
        ctx.strokeStyle = rgba(accent, 0.18);
        ctx.beginPath(); ctx.moveTo(q.x + 3, q.y + q.h / 2); ctx.lineTo(q.x + q.w - 3, q.y + q.h / 2); ctx.stroke();
      } else if (es === 'lantern') {
        ctx.strokeStyle = rgba(CUR.col.amber, 0.22); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x + 2, q.y + 2); ctx.lineTo(q.x + q.w - 2, q.y + 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    });
  }

  function drawExit(ctx, s, t) {
    var x = W - 74, y = H / 2;
    var accent = P(s.room ? s.room.color_token : 'teal');
    ctx.save();
    if (s.exitActive) {
      var r = C.core.engine.EXIT_R;
      ctx.strokeStyle = CUR.col.player; ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.65 + 0.25 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(CUR.col.player, 0.10);
      ctx.beginPath(); ctx.arc(x, y, r - 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CUR.col.player;
      ctx.font = '500 22px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('→', x, y + 1);
      ctx.font = '400 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('进入下一间', x, y + r + 18);
    } else {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(x, y, C.core.engine.EXIT_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawParticles(ctx, s) {
    var ps = CUR.vis.particleStyle;
    s.particles.forEach(function (p) {
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = mapColor(p.color);
      var size = p.size;
      if (ps === 'ember') {                    /* 旧城：发光火星 */
        ctx.save(); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (ps === 'dot') {               /* 学科：细点 + 十字 */
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, size / 3), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.globalAlpha = a * 0.6;
        ctx.beginPath(); ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x + size, p.y);
        ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x, p.y + size); ctx.stroke();
      } else if (ps === 'petal') {             /* 武当：柔瓣 */
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 3);
        ctx.beginPath(); ctx.ellipse(0, 0, size * 0.7, size * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else {                                 /* 几何：方形碎片（等价 M1 rect） */
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6);
        ctx.fillRect(-size / 2, -size / 2, size, size); ctx.restore();
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawTrail(ctx, s) {
    s.trail.forEach(function (p) {
      ctx.globalAlpha = (p.life / p.max) * 0.35;
      ctx.fillStyle = CUR.col.trail;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ---------- 子弹（造型按 enemyStyle 分化） ---------- */
  function drawBullets(ctx, s) {
    var es = CUR.vis.enemyStyle;
    s.bullets.forEach(function (b) {
      var tailX = b.x - b.vx * 0.022, tailY = b.y - b.vy * 0.022;
      var c = b.crit ? CUR.col.crit : CUR.col.bullet;
      ctx.strokeStyle = c; ctx.fillStyle = c;
      ctx.lineWidth = b.crit ? 4 : 2.6; ctx.lineCap = 'round';
      if (es === 'academic') {
        ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x - 4, b.y); ctx.lineTo(b.x + 4, b.y);
        ctx.moveTo(b.x, b.y - 4); ctx.lineTo(b.x, b.y + 4); ctx.stroke();
      } else if (es === 'taiji') {
        ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.beginPath(); ctx.ellipse(0, 0, b.crit ? 6 : 4, b.crit ? 3.4 : 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (es === 'lantern') {
        ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 4 : 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else {
        ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
      }
    });
    s.enemyBullets.forEach(function (b) {
      ctx.fillStyle = CUR.col.enemyBullet; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  /* ---------- 敌人（主体保留 M1 形态 → 碰撞体积/朝向可辨识；装饰按 enemyStyle 分化） ---------- */
  function enemyColor(e) {
    if (e.flash > 0) return '#FFFFFF';                                    /* 受击闪白，通用反馈 */
    if (e.colorToken && TOKENS.indexOf(e.colorToken) !== -1) return P(e.colorToken); /* C5 优先 */
    if (e.color) return mapColor(e.color);                               /* e.color 兼容回退 */
    return CUR.col.player;                                               /* 末级回退 */
  }
  function styleEnemy(ctx, e, color, es) {
    var r = e.r;
    if (es === 'lantern') {
      ctx.save(); ctx.globalAlpha = 0.35; ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(-r * 0.35, -r - 2);
      ctx.quadraticCurveTo(0, -r - 12, r * 0.35, -r - 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (es === 'academic') {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
      var d = r + 6, L = 5;
      [[-d, -d, 1, 1], [d, -d, -1, 1], [-d, d, 1, -1], [d, d, -1, -1]].forEach(function (c) {
        ctx.beginPath(); ctx.moveTo(c[0], c[1] + c[3] * L); ctx.lineTo(c[0], c[1]);
        ctx.lineTo(c[0] + c[2] * L, c[1]); ctx.stroke();
      });
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (es === 'taiji') {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.4, r * 0.4, Math.PI / 2, -Math.PI / 2, true);
      ctx.arc(0, r * 0.4, r * 0.4, Math.PI / 2, -Math.PI / 2, false);
      ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(0, -(r + 6), 2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function drawEnemy(ctx, e, t) {
    var color = enemyColor(e);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 1;
    if (e.shape === 'chase') {
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(0, 0, e.r + 6, 0, Math.PI * 2); ctx.stroke();
    } else if (e.shape === 'orbit') {
      ctx.rotate(t * 1.6);
      ctx.beginPath(); ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, e.r + 7, 0, Math.PI * 2); ctx.stroke();
    } else if (e.shape === 'charge') {
      var a = Math.atan2(e.vy, e.vx); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(-e.r, -e.r * 0.8); ctx.lineTo(-e.r, e.r * 0.8);
      ctx.closePath(); ctx.fill();
      if (e.mode === 'wind') {
        ctx.globalAlpha = 0.4 + 0.5 * Math.sin(t * 22);
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 9, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (e.shape === 'ranged') {
      ctx.rotate(t * 0.7);
      rr(ctx, -e.r, -e.r, e.r * 2, e.r * 2, 3); ctx.fill();
      ctx.globalAlpha = 0.35;
      rr(ctx, -e.r - 5, -e.r - 5, e.r * 2 + 10, e.r * 2 + 10, 4); ctx.stroke();
    } else if (e.shape === 'static') {
      polygon(ctx, 0, 0, e.r, 6, t * 0.25); ctx.fill();
      ctx.globalAlpha = 0.3; polygon(ctx, 0, 0, e.r + 7, 6, t * 0.25); ctx.stroke();
    } else {
      polygon(ctx, 0, 0, e.r, 8, t * 0.35); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
      polygon(ctx, 0, 0, e.r + 12, 8, -t * 0.22); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = CUR.col.bg;
      polygon(ctx, 0, 0, e.r * 0.45, 4, t * 0.7); ctx.fill();
    }
    styleEnemy(ctx, e, color, CUR.vis.enemyStyle);
    ctx.restore();

    var bw = e.isBoss ? 90 : 34;
    var ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw, 3);
    ctx.fillStyle = e.isBoss ? CUR.col.bossBar : CUR.col.hpBar;
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw * ratio, 3);
  }

  /* ---------- 玩家（造型按 enemyStyle 分化） ---------- */
  function drawPlayer(ctx, s, t) {
    var p = s.player;
    if (p.invuln > 0 && Math.floor(t * 18) % 2 === 0 && p.dashTime <= 0) return;
    var es = CUR.vis.enemyStyle;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dashTime > 0) {
      ctx.globalAlpha = 0.28; ctx.fillStyle = CUR.col.player;
      ctx.beginPath(); ctx.arc(-p.dashX * 18, -p.dashY * 18, p.r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = CUR.col.playerGlow;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CUR.col.player;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CUR.col.bg;
    ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(p.angle);
    ctx.fillStyle = CUR.col.bullet;
    if (es === 'academic') {
      ctx.strokeStyle = CUR.col.bullet; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.r + 11, 0); ctx.lineTo(p.r + 3, 0);
      ctx.moveTo(p.r + 7, -4); ctx.lineTo(p.r + 7, 4); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, p.r + 4, 0, Math.PI * 2); ctx.stroke();
    } else if (es === 'taiji') {
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(p.r + 6, 0, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = CUR.col.player;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else if (es === 'lantern') {
      ctx.save(); ctx.shadowColor = CUR.col.bullet; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.r + 7, 0, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.strokeStyle = CUR.col.bullet; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 5, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(p.r + 11, 0); ctx.lineTo(p.r + 2, -5); ctx.lineTo(p.r + 2, 5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = CUR.col.bullet; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------- 静态背景（开局前，随开始页选中主题变化） ---------- */
  function drawIdle(ctx, t) {
    var accent = P('teal');
    ctx.fillStyle = CUR.col.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = CUR.col.grid; ctx.lineWidth = 1;
    for (var x = 48; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (var y = 48; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    ctx.globalAlpha = 0.10; ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 110, H / 2);
    ctx.bezierCurveTo(W / 2 - 110, H / 2 - 62, W / 2 - 24, H / 2 - 62, W / 2, H / 2);
    ctx.bezierCurveTo(W / 2 + 24, H / 2 + 62, W / 2 + 110, H / 2 + 62, W / 2 + 110, H / 2);
    ctx.bezierCurveTo(W / 2 + 110, H / 2 - 62, W / 2 + 24, H / 2 - 62, W / 2, H / 2);
    ctx.bezierCurveTo(W / 2 - 24, H / 2 + 62, W / 2 - 110, H / 2 + 62, W / 2 - 110, H / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ---------- C5 打击反馈叠加（所有字段可选，缺省不绘制 → 画面等价 M1） ---------- */
  function drawDamagePops(ctx, s) {
    if (!Array.isArray(s.damagePops)) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    s.damagePops.forEach(function (d) {
      if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
      var life = (typeof d.life === 'number' && typeof d.max === 'number' && d.max > 0)
        ? Math.max(0, Math.min(1, d.life / d.max)) : 1;
      var rise = (1 - life) * 26;
      var val = (d.value == null ? '' : String(d.value));
      var crit = !!d.crit;
      var col = crit ? CUR.col.crit : CUR.col.bullet;
      ctx.globalAlpha = 0.35 + 0.65 * life;
      ctx.font = '700 ' + (crit ? 26 : 18) + 'px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(val, d.x, d.y - rise);
      if (crit) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.fillStyle = col; ctx.fillText(val, d.x, d.y - rise);
      ctx.shadowBlur = 0;
    });
    ctx.restore();
  }
  /* T28：normal 为默认态（engine 缺省值与 Boss 房都设为 normal），不画徽标，
   * 只有 elite / event / rest 三种特殊房才在左下角标注，避免常驻噪音。 */
  var ROOM_LABEL = { elite: '精英', event: '事件', rest: '休整' };
  function drawRoomBadge(ctx, s) {
    var rt = s.roomType;
    if (typeof rt !== 'string' || !Object.prototype.hasOwnProperty.call(ROOM_LABEL, rt)) return;
    var col = rt === 'elite' ? CUR.col.rust : rt === 'rest' ? CUR.col.teal
            : rt === 'event' ? CUR.col.violet : CUR.col.amber;
    ctx.save();
    var x = 24, y = H - 42, w = 86, h = 24;
    ctx.fillStyle = rgba(CUR.col.bg, 0.75); rr(ctx, x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6); ctx.stroke();
    ctx.fillStyle = col; ctx.font = '500 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ROOM_LABEL[rt] + '间', x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
  }
  function drawCombo(ctx, s, t) {
    if (typeof s.combo !== 'number' || s.combo < 2) return;
    ctx.save();
    var pulse = 1 + 0.06 * Math.sin(t * 6);
    ctx.translate(W / 2, 70); ctx.scale(pulse, pulse);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = CUR.col.amber; ctx.shadowColor = CUR.col.amber; ctx.shadowBlur = 10;
    ctx.fillText('×' + s.combo + ' COMBO', 0, 0);
    ctx.restore();
  }
  function drawBossPhase(ctx, s, t) {
    if (s.bossPhase !== 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(CUR.col.rust, 0.05 + 0.02 * Math.sin(t * 3));
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = CUR.col.rust; ctx.shadowColor = CUR.col.rust; ctx.shadowBlur = 10;
    ctx.fillText('二阶段 · PHASE II', W - 24, 64);
    ctx.restore();
    if (Array.isArray(s.enemies)) s.enemies.forEach(function (e) {
      if (!e.isBoss) return;
      ctx.save(); ctx.strokeStyle = CUR.col.rust; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 4);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 18, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 30, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }
  function drawC5(ctx, s, t) {
    drawDamagePops(ctx, s);
    drawRoomBadge(ctx, s);
    drawCombo(ctx, s, t);
    drawBossPhase(ctx, s, t);
  }

  /* ---------- 程序化后处理（配置可选：postFx 缺省/关闭时整层跳过） ---------- */
  function fxBloom(ctx, s, t, fx) {
    var b = fx.bloom;
    if (!(b > 0)) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(CUR.col.teal, b * 0.05);
    ctx.fillRect(0, 0, W, H);
    var p = s && s.player;
    if (p && typeof p.x === 'number') {
      ctx.strokeStyle = rgba(CUR.col.player, b * 0.5); ctx.lineWidth = 6;
      ctx.shadowColor = CUR.col.player; ctx.shadowBlur = 18; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 12) + 7, 0, Math.PI * 2); ctx.stroke();
    }
    if (s && s.exitActive) {
      ctx.globalAlpha = 1; ctx.strokeStyle = rgba(CUR.col.player, b * 0.5); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(W - 74, H / 2, C.core.engine.EXIT_R + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  function fxAberration(ctx, fx) {
    var a = fx.aberration;
    if (!(a > 0)) return;
    var dx = Math.min(2.5, a);
    ctx.save();
    /* 两侧 RGB 色边（红 / 青微偏移） */
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,70,70,' + (0.04 * a).toFixed(3) + ')');
    g.addColorStop(0.16, 'rgba(255,70,70,0)');
    g.addColorStop(0.84, 'rgba(70,120,255,0)');
    g.addColorStop(1, 'rgba(70,120,255,' + (0.04 * a).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 极淡微偏移重影 */
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.05, 0.02 * a);
    try { ctx.drawImage(ctx.canvas, -dx, 0, W, H); } catch (e) { /* 自绘副本不受支持则跳过 */ }
    ctx.restore();
  }
  function fxGrain(ctx, fx) {
    var g = fx.grain;
    if (!(g > 0)) return;
    var n = Math.min(700, Math.round(g * 5000));
    ctx.save();
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = (i % 2)
        ? 'rgba(255,255,255,' + (g * 1.6).toFixed(3) + ')'
        : 'rgba(0,0,0,' + (g * 2.0).toFixed(3) + ')';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
    }
    ctx.restore();
  }
  function fxHalo(ctx, s, t, fx) {
    var h = fx.halo;
    if (!(h > 0)) return;
    var p = s && s.player;
    var cx = (p && typeof p.x === 'number') ? p.x : W / 2;
    var cy = (p && typeof p.y === 'number') ? p.y : H / 2;
    var r = 160 + 24 * Math.sin(t * 0.8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(CUR.col.amber, h * 0.5));
    g.addColorStop(0.5, rgba(CUR.col.amber, h * 0.15));
    g.addColorStop(1, rgba(CUR.col.amber, 0));
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
  function fxVignette(ctx, s, t, fx) {
    var v = fx.vignette;
    var p = s && s.player;
    var low = 0;
    if (p && typeof p.hp === 'number' && typeof p.maxHp === 'number' && p.maxHp > 0) {
      var ratio = Math.max(0, Math.min(1, p.hp / p.maxHp));
      if (ratio < 0.3) low = (0.3 - ratio) / 0.3;
    }
    var phase = (s && s.bossPhase === 2) ? 0.12 : 0;
    ctx.save();
    var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.7, v).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (low > 0) {
      var pulse = 0.55 + 0.45 * Math.sin(t * 4);
      var a = Math.min(0.6, (low * 0.5 + phase) * pulse);
      var rg = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.72);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, rgba(CUR.col.rust, a));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
  function fxShock(ctx, s, t, fx) {
    var sh = fx.shock;
    if (!(sh > 0)) return;
    var p = s && s.player;
    var invuln = (p && typeof p.invuln === 'number') ? p.invuln : 0;
    var shake = (s && typeof s.shake === 'number') ? s.shake : 0;
    if (invuln <= 0 && shake <= 6) return;      /* 无受击迹象 → 不画（缺省等价 M1） */
    var cx = (p && typeof p.x === 'number') ? p.x : W / 2;
    var cy = (p && typeof p.y === 'number') ? p.y : H / 2;
    var prog = invuln > 0 ? Math.max(0, Math.min(1, 1 - invuln / 0.62)) : Math.min(1, shake / 12);
    var r = 30 + prog * 180;
    ctx.save();
    ctx.globalAlpha = (1 - prog) * 0.45 * sh;
    ctx.strokeStyle = CUR.col.rust; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = (1 - prog) * 0.25 * sh;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function drawPostFx(ctx, s, t) {
    var fx = CUR.vis.postFx;
    if (!fx || fx.enabled === false) return;  /* 可选配置：缺省/关闭整层跳过 */
    fxBloom(ctx, s, t, fx);
    fxAberration(ctx, fx);
    fxGrain(ctx, fx);
    fxHalo(ctx, s, t, fx);
    fxVignette(ctx, s, t, fx);
    fxShock(ctx, s, t, fx);
  }

  /* ---------- 主入口 ---------- */
  function draw(ctx, s, t) {
    t = t || 0;
    CUR = buildCur(s);                          /* 每帧解析主题（缺省回落 geometry） */
    if (!s) { drawIdle(ctx, t); return; }
    ctx.save();
    if (s.shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * s.shake, (Math.random() * 2 - 1) * s.shake);
    }
    drawBackground(ctx, s, t);
    drawWalls(ctx, s);
    drawExit(ctx, s, t);
    drawParticles(ctx, s);
    drawTrail(ctx, s);
    s.enemies.forEach(function (e) { drawEnemy(ctx, e, t); });
    drawBullets(ctx, s);
    drawPlayer(ctx, s, t);
    ctx.restore();

    /* 房间转场：从上往下扫过的薄色幕 */
    if (s.transition > 0) {
      var a = Math.min(1, s.transition / 0.45);
      ctx.fillStyle = P(s.room ? s.room.color_token : 'ink');
      ctx.globalAlpha = a * 0.16;
      ctx.fillRect(0, 0, W, H * (1 - a));
      ctx.globalAlpha = 1;
    }

    drawC5(ctx, s, t);       /* C5 字段可选，缺省不绘制 */
    drawPostFx(ctx, s, t);   /* 程序化后处理（可选） */
  }

  C.ui = C.ui || {};
  C.ui.render = { draw: draw, W: W, H: H };
})(window.Corridor = window.Corridor || {});
