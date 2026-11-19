/* Canvas 2D —「深蓝测绘图 / 夜航档案」视觉语言。
 * 母题：脚下走过的回廊，就是这一击的攻击路线。
 * 全套画面由 C.theme 的色板 + VISUALS 材质驱动，纯程序化绘制、零外部资源。
 * 保留 direction='print' 套印版（docs/界面对照.html 同帧对照用）。
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
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 旧版 M1 数据色 → 主题 token：让 engine 里遗留的硬编码色也随主题走。 */
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
    palette: null, bgStyle: 'survey-grid', enemyStyle: 'geometric', particleStyle: 'shard',
    ground: { step: 40, major: 5, motif: 'rings', line: 0.075 },
    frame: { code: 'ATLAS 00', name: '抽象几何', ticks: true },
    glow: 1,
    postFx: { bloom: 0.22, grain: 0.014, vignette: 0.34, halo: 0.08, shock: 0.90 }
  };
  var CUR = null;

  function safeActive() {
    try { return (C.theme && C.theme.active) ? C.theme.active() : 'geometry'; }
    catch (e) { return 'geometry'; }
  }

  /* 套印版：保留同帧对照，不做暗场后处理 */
  var PRINT = {
    bg: '#F4EAD5', field: '#E8DCC4', wall: '#B6B9A6', wallEdge: '#585E55', wallShadow: '#D1BD9B',
    grid: 'rgba(50,51,47,0.13)', outline: '#1E2C3C', flash: '#FFFFFF',
    player: '#FFF7D4', playerInk: '#1E2C3C', playerGlow: 'rgba(30,44,60,0.09)',
    bullet: '#22654D', trail: '#22654D', crit: '#88551B', enemyBullet: '#B82C22',
    rust: '#AB3023', flank: '#376C8B', amber: '#92571E', guide: '#17655D', fold: '#5B417A'
  };

  /* 由主题色板推导整幅画面的语义色：amber 是唯一高亮，teal 是路径，rust 是危险。 */
  function nightFrom(pal, vis) {
    var ink = pal.ink || '#0A1018';
    var amb = pal.amber || '#E9B44C';
    var tea = pal.teal || '#5FD3C4';
    var vio = pal.violet || '#A99BE8';
    var rus = pal.rust || '#E4584A';
    var line = (vis.ground && vis.ground.line) || 0.075;
    return {
      bg: shade(ink, -0.42),
      field: mix(ink, tea, 0.10),
      wall: mix(ink, tea, 0.15),
      wallEdge: mix(tea, '#FFFFFF', 0.24),
      wallShadow: shade(ink, -0.62),
      grid: rgba(tea, line),
      outline: shade(ink, -0.55),
      flash: '#FFF7E2',
      player: amb,
      playerInk: shade(ink, -0.22),
      playerGlow: rgba(amb, 0.15),
      bullet: mix(amb, '#FFFFFF', 0.44),
      trail: amb,
      crit: mix(amb, '#FFFFFF', 0.68),
      enemyBullet: rus,
      rust: rus,
      flank: tea,
      amber: mix(amb, rus, 0.30),
      guide: mix(tea, '#FFFFFF', 0.14),
      fold: vio,
      violet: vio,
      teal: tea
    };
  }

  function buildCur(s, direction) {
    var th = C.theme || {};
    var id = (s && s.run && s.run.theme) ? s.run.theme : safeActive();
    var valid = (th.THEMES && th.THEMES[id]) ? id : 'geometry';
    var vis = (typeof th.visual === 'function') ? th.visual(valid) : null;
    if (!vis || !vis.palette) vis = DEFAULT_VIS;
    var pal = vis.palette || {};
    var pp = {};
    TOKENS.forEach(function (tk) {
      pp[tk] = pal[tk] || (typeof th.palette === 'function' ? th.palette(valid, tk) : '#5FD3C4');
    });
    var paper = direction === 'print';
    var col = paper ? Object.assign({}, PRINT) : nightFrom(pp, vis);
    col.violet = col.fold;
    col.teal = col.guide;
    pp.teal = col.guide;
    pp.rust = col.rust;
    pp.amber = col.amber;
    pp.violet = col.fold;
    return { id: valid, vis: vis, P: pp, col: col, paper: paper };
  }
  function P(token) { return (CUR && CUR.P[token]) || (CUR ? CUR.P.ink : '#0A1018'); }

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
  function path(ctx, vertices) {
    ctx.beginPath();
    vertices.forEach(function (point, i) {
      if (i) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
    });
    ctx.closePath();
  }
  function tracePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  /* 多层描边模拟发光，避免逐帧大量 shadowBlur */
  function layeredStroke(ctx, pts, width, color, alpha, glow) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (glow > 0) {
      tracePath(ctx, pts); ctx.lineWidth = width + glow * 2;
      ctx.strokeStyle = rgba(color, alpha * 0.09); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = width + glow;
      ctx.strokeStyle = rgba(color, alpha * 0.20); ctx.stroke();
    }
    tracePath(ctx, pts); ctx.lineWidth = width;
    ctx.strokeStyle = rgba(color, alpha); ctx.stroke();
  }

  /* 固定噪点阵：不用 Math.random，保证每帧稳定、无闪烁 */
  var GRAIN = (function () {
    var a = [];
    for (var i = 0; i < 230; i++) {
      var n = Math.sin(i * 12.9898) * 43758.5453;
      var m = Math.sin(i * 78.233) * 12345.6789;
      a.push({ x: (n - Math.floor(n)) * W, y: (m - Math.floor(m)) * H, r: i % 3 === 0 ? 1.1 : 0.7 });
    }
    return a;
  })();

  /* ---------- 底纹：四套主题真正换材质，而不只是换网格间距 ---------- */
  function drawMotif(ctx, motif, col, vis, t) {
    ctx.save();
    if (motif === 'rings') {
      ctx.strokeStyle = rgba(col.guide, 0.10); ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash([3, 9]);
      for (var k = 0; k < 5; k++) {
        ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, 74 + k * 74, 0, Math.PI * 2); ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.strokeStyle = rgba(col.guide, 0.07);
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W * 0.5, H * 0.5); ctx.lineTo(W, 0); ctx.stroke();
      ctx.font = '500 9px ui-monospace, Consolas, monospace';
      ctx.fillStyle = rgba(col.guide, 0.24);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (var i = 1; i <= 4; i++) ctx.fillText('0' + i, 30 + i * 38, H - 46);
    } else if (motif === 'brick') {
      ctx.strokeStyle = rgba(col.amber, 0.075); ctx.lineWidth = 1;
      var bh = 28, bw = 76;
      for (var row = 0; row * bh < H + bh; row++) {
        var off = (row % 2) * bw / 2;
        ctx.beginPath(); ctx.moveTo(0, row * bh + 0.5); ctx.lineTo(W, row * bh + 0.5); ctx.stroke();
        for (var bx = -off; bx < W; bx += bw) {
          ctx.beginPath(); ctx.moveTo(bx + 0.5, row * bh); ctx.lineTo(bx + 0.5, row * bh + bh); ctx.stroke();
        }
      }
      [[168, 132, 125], [742, 186, 145], [430, 470, 115]].forEach(function (L) {
        var lg = ctx.createRadialGradient(L[0], L[1], 0, L[0], L[1], L[2]);
        lg.addColorStop(0, rgba(col.amber, 0.14));
        lg.addColorStop(1, rgba(col.amber, 0));
        ctx.fillStyle = lg; ctx.fillRect(L[0] - L[2], L[1] - L[2], L[2] * 2, L[2] * 2);
      });
      ctx.strokeStyle = rgba(col.teal, 0.055);
      for (var r = 0; r < 26; r++) {
        var rx = (r * 137) % W, ry = (r * 83) % H;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 6, ry + 34); ctx.stroke();
      }
    } else if (motif === 'paper') {
      var half = 14;
      ctx.strokeStyle = rgba(col.teal, 0.055); ctx.lineWidth = 1;
      ctx.beginPath();
      for (var px = 0; px <= W; px += half) { ctx.moveTo(px + 0.5, 0); ctx.lineTo(px + 0.5, H); }
      for (var py = 0; py <= H; py += half) { ctx.moveTo(0, py + 0.5); ctx.lineTo(W, py + 0.5); }
      ctx.stroke();
      ctx.strokeStyle = rgba(col.rust, 0.16);
      ctx.beginPath(); ctx.moveTo(66, 0); ctx.lineTo(66, H); ctx.stroke();
      ctx.strokeStyle = rgba(col.teal, 0.11);
      for (var q = 40; q < H; q += 40) {
        ctx.beginPath(); ctx.moveTo(58, q); ctx.lineTo(66, q); ctx.moveTo(W - 66, q); ctx.lineTo(W - 58, q); ctx.stroke();
      }
      ctx.strokeStyle = rgba(col.violet, 0.13);
      for (var f = 0; f < 7; f++) {
        var fy = 90 + f * 66, fx = 120 + (f * 97) % 600;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + 42 + (f % 3) * 24, fy);
        ctx.moveTo(fx + 8, fy + 6); ctx.lineTo(fx + 30, fy + 6); ctx.stroke();
      }
    } else if (motif === 'ink') {
      ctx.fillStyle = rgba(col.teal, 0.05);
      for (var m = 0; m < 3; m++) {
        ctx.beginPath();
        ctx.moveTo(-40, H - 40 - m * 30);
        ctx.bezierCurveTo(180, H - 190 - m * 46, 320, H - 90 - m * 30, 500, H - 200 - m * 52);
        ctx.bezierCurveTo(680, H - 300 - m * 40, 820, H - 140 - m * 30, W + 40, H - 220 - m * 46);
        ctx.lineTo(W + 40, H); ctx.lineTo(-40, H); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = rgba(col.guide, 0.10); ctx.lineWidth = 1.2;
      for (var c2 = 0; c2 < 5; c2++) {
        ctx.beginPath();
        ctx.ellipse(746, 470 - c2 * 26, 60 + c2 * 34, 16 + c2 * 9, -0.16, 0, Math.PI * 2); ctx.stroke();
      }
      var mg = ctx.createRadialGradient(240, 160, 0, 240, 160, 155);
      mg.addColorStop(0, rgba('#FFFFFF', 0.045));
      mg.addColorStop(1, rgba('#FFFFFF', 0));
      ctx.fillStyle = mg; ctx.fillRect(85, 5, 310, 310);
    }
    ctx.restore();
  }

  function drawBackground(ctx, t) {
    var col = CUR.col, vis = CUR.vis, g = vis.ground || DEFAULT_VIS.ground;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
    if (!CUR.paper) {
      var light = ctx.createRadialGradient(W * 0.52, H * 0.44, 20, W * 0.52, H * 0.44, H * 0.98);
      light.addColorStop(0, rgba(col.field, 0.80));
      light.addColorStop(1, rgba(col.field, 0));
      ctx.fillStyle = light; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#E8DCC4'; ctx.fillRect(24, 206, W - 48, 188);
    }
    var step = g.step || 40, major = g.major || 5;
    ctx.save(); ctx.lineWidth = 1;
    for (var y = 0, iy = 0; y <= H; y += step, iy++) {
      ctx.strokeStyle = iy % major === 0 ? rgba(col.guide, CUR.paper ? 0.13 : 0.10) : col.grid;
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    for (var x = 0, ix = 0; x <= W; x += step, ix++) {
      ctx.strokeStyle = ix % major === 0 ? rgba(col.guide, CUR.paper ? 0.13 : 0.10) : col.grid;
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    ctx.restore();
    if (!CUR.paper) drawMotif(ctx, g.motif, col, vis, t);
  }

  /* 墙体：体积感（投影 / 顶面高光 / 内侧纹理 / 发光边 / 角刻度） */
  function drawWalls(ctx, s) {
    var col = CUR.col;
    s.walls.forEach(function (q) {
      ctx.fillStyle = col.wallShadow;
      rr(ctx, q.x + 3, q.y + 5, q.w, q.h, 3); ctx.fill();
      ctx.fillStyle = col.wall;
      rr(ctx, q.x, q.y, q.w, q.h, 3); ctx.fill();
      ctx.fillStyle = rgba(col.wallEdge, CUR.paper ? 0.30 : 0.24);
      ctx.fillRect(q.x + 2, q.y + 1, q.w - 4, 2);
      ctx.save();
      ctx.beginPath(); ctx.rect(q.x + 1, q.y + 1, q.w - 2, q.h - 2); ctx.clip();
      ctx.strokeStyle = rgba(col.wallEdge, CUR.paper ? 0.20 : 0.12);
      ctx.lineWidth = 1; ctx.beginPath();
      for (var dx = -q.h; dx <= q.w; dx += 18) {
        ctx.moveTo(q.x + dx, q.y + q.h - 2);
        ctx.lineTo(q.x + dx + q.h - 2, q.y + 2);
      }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = rgba(col.wallEdge, CUR.paper ? 0.72 : 0.52);
      ctx.lineWidth = 1;
      rr(ctx, q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 3); ctx.stroke();
      if (q.w > 44 && q.h > 44) {
        ctx.strokeStyle = rgba(col.guide, 0.34); ctx.lineWidth = 1.2;
        var c = 8;
        [[q.x + 3, q.y + 3, 1, 1], [q.x + q.w - 3, q.y + 3, -1, 1],
         [q.x + 3, q.y + q.h - 3, 1, -1], [q.x + q.w - 3, q.y + q.h - 3, -1, -1]].forEach(function (k) {
          ctx.beginPath();
          ctx.moveTo(k[0] + k[2] * c, k[1]); ctx.lineTo(k[0], k[1]); ctx.lineTo(k[0], k[1] + k[3] * c);
          ctx.stroke();
        });
      }
    });
  }

  /* 回廊长局：三条廊道画成有宽度的「未走通道」，折角与岔路可读。 */
  function drawLoopLanes(ctx, s, t) {
    var rec = s.recall;
    if (!rec || !rec.layout || !rec.layout.lanes) return;
    var lanes = rec.layout.lanes, col = CUR.col, glow = CUR.vis.glow || 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Object.keys(lanes).forEach(function (id) {
      var pts = lanes[id].points;
      if (!pts || pts.length < 2) return;
      tracePath(ctx, pts); ctx.lineWidth = 34;
      ctx.strokeStyle = rgba(col.guide, 0.05 * glow); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 28;
      ctx.strokeStyle = rgba(col.guide, 0.18); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 24;
      ctx.strokeStyle = rgba(shade(col.bg, 0.05), 0.94); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(col.guide, 0.38);
      if (ctx.setLineDash) ctx.setLineDash([5, 9]);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      for (var i = 1; i < pts.length - 1; i++) {
        var p = pts[i];
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = rgba(col.guide, 0.55); ctx.lineWidth = 1.2;
        ctx.strokeRect(-4.5, -4.5, 9, 9); ctx.restore();
      }
      [pts[0], pts[pts.length - 1]].forEach(function (p) {
        ctx.strokeStyle = rgba(col.amber, 0.34); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
      });
    });
    ctx.restore();
  }

  /* 已走路径点亮为实线，回扫是一道沿去程逆行的光带 + 头部光点。 */
  function drawRecallPaths(ctx, s, t) {
    var recall = s.recall;
    var rules = C.core.recall;
    /* M9：回扫波颜色随护盾状态变 —— 青=削壳、金=窗口重击、藕紫=重构中 */
    var color = waveColor(s), glow = CUR.vis.glow || 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    rules.trace(recall).forEach(function (points) {
      if (!points || points.length < 2) return;
      layeredStroke(ctx, points, 3.2, color, 0.88, 10 * glow);
      tracePath(ctx, points); ctx.lineWidth = 1;
      ctx.strokeStyle = rgba('#FFFFFF', 0.32); ctx.stroke();
    });
    if (recall.wave) {
      var wave = recall.wave;
      var all = [{ x: wave.parts[0].a.x, y: wave.parts[0].a.y }];
      wave.parts.forEach(function (part) { all.push({ x: part.b.x, y: part.b.y }); });
      layeredStroke(ctx, all, 2.2, color, 0.34, 6 * glow);
      var sections = rules.waveSections(wave, wave.position - 110, wave.position);
      sections.forEach(function (part) {
        var seg = [{ x: part.a.x, y: part.a.y }, { x: part.b.x, y: part.b.y }];
        tracePath(ctx, seg); ctx.lineWidth = part.radius * 2;
        ctx.strokeStyle = rgba(color, 0.12); ctx.stroke();
        layeredStroke(ctx, seg, 5, color, 0.92, 14 * glow);
      });
      if (sections.length) {
        var tip = sections[sections.length - 1].b;
        var rg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 18 * glow);
        rg.addColorStop(0, rgba('#FFFFFF', 0.95));
        rg.addColorStop(0.35, rgba(color, 0.72));
        rg.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 18 * glow, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawRecallHubs(ctx, s, t) {
    var r = s.recall;
    var boss = s.enemies.find(function (e) { return e.patrol; });
    var hubs = (r.layout && r.layout.hub) || C.core.recall.hub;
    var col = CUR.col, glow = CUR.vis.glow || 1;
    ctx.save();
    hubs.forEach(function (p, i) {
      var marked = r.origin === i;
      var available = r.origin == null && !r.wave;
      var pulse = 0.5 + 0.5 * Math.sin(t * 4);
      var w = marked ? 24 + 3 * pulse : 18;
      ctx.fillStyle = rgba(col.guide, marked ? 0.10 * glow : 0.04);
      ctx.beginPath(); ctx.arc(p.x, p.y, w + 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(col.guide, marked ? 0.95 : available ? 0.62 : 0.24);
      ctx.lineWidth = marked ? 2 : 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, w, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.amber, marked ? 0.75 : 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, w - 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.guide, marked ? 0.8 : 0.3);
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.stroke();
      if (marked) {
        ctx.fillStyle = rgba(col.amber, 0.95);
        ctx.font = '500 10px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('ORIGIN', p.x, p.y - w - 8);
      }
    });
    if (boss && boss.patrol && boss.patrol.warning > 0) {
      var patrol = boss.patrol, points = patrol.route.points;
      var a = hubs[patrol.hub], b = points[patrol.hub === 0 ? 1 : points.length - 2];
      if (a && b) {
        var len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.save(); ctx.translate(a.x, a.y);
        ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        ctx.strokeStyle = rgba(col.rust, 0.75 + 0.25 * Math.sin(t * 16)); ctx.lineWidth = 3;
        for (var d = 42; d < Math.min(len, 105); d += 22) {
          ctx.beginPath(); ctx.moveTo(d - 9, -10); ctx.lineTo(d, 0); ctx.lineTo(d - 9, 10); ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawExit(ctx, s, t) {
    if (s.recall && s.run && s.run.rooms && s.roomIndex === s.run.rooms.length) return;
    var x = W - 74;
    var y = s.recall ? ((s.recall.layout || C.core.recall.DEFAULT).hub[1].y) : H / 2;
    var accent = P(s.room ? s.room.color_token : 'teal');
    var col = CUR.col;
    ctx.save();
    if (s.exitActive) {
      var r = C.core.engine.EXIT_R;
      var pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = rgba(col.player, 0.28); ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.player, 0.65 + 0.3 * pulse); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(col.player, 0.10);
      ctx.beginPath(); ctx.arc(x, y, r - 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col.player;
      ctx.font = '500 20px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('→', x, y + 1);
      ctx.font = '400 10px ui-monospace, Consolas, monospace';
      ctx.fillStyle = rgba(col.player, 0.72);
      ctx.fillText(s.recall ? 'NEXT / BOSS' : 'NEXT / ROOM', x, y + r + 17);
    } else {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.4;
      if (ctx.setLineDash) ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(x, y, C.core.engine.EXIT_R, 0, Math.PI * 2); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------- 试玩原型视觉（保持原有行为，颜色自动继承新色板） ---------- */
  function drawImpactCorridor(ctx, impact) {
    if (impact.trial) {
      var rail = C.core.enemyTrial.walls[0];
      ctx.save();
      ctx.strokeStyle = rgba(CUR.col.violet, 0.58); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rail.x + 8, rail.y + rail.h);
      ctx.lineTo(rail.x + rail.w - 8, rail.y + rail.h); ctx.stroke();
      ctx.restore();
      return;
    }
    var wall = C.core.impact.reflector;
    ctx.save();
    ctx.strokeStyle = rgba(CUR.col.player, 0.20); ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([7, 15]);
    ctx.beginPath(); ctx.moveTo(102, 300); ctx.lineTo(wall.x, 300); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.strokeStyle = rgba(CUR.col.amber, 0.85); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wall.x, wall.y + 8); ctx.lineTo(wall.x, wall.y + wall.h - 8); ctx.stroke();
    if (impact.combinations) {
      var upper = C.core.impact.walls[0];
      ctx.strokeStyle = rgba(CUR.col.violet, 0.74);
      ctx.beginPath(); ctx.moveTo(upper.x + 8, upper.y + upper.h);
      ctx.lineTo(upper.x + upper.w - 8, upper.y + upper.h); ctx.stroke();
    }
    ctx.fillStyle = CUR.col.amber;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('反弹墙', wall.x + wall.w / 2, wall.y - 8);
    ctx.restore();
  }

  function drawTrialWarnings(ctx, s) {
    var stroke = ctx.canvas.clientWidth < 560 ? 1.4 : 1;
    ctx.save(); ctx.lineCap = 'round';
    s.enemies.forEach(function (e) {
      var brain = e.brain, a = brain.attack;
      if (!a) return;
      var wind = brain.state === 'wind';
      var color = a.kind === 'charge' ? CUR.col.rust : (a.kind === 'press' ? CUR.col.amber : CUR.col.flank);
      ctx.strokeStyle = color;
      if (a.fan) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        a.fan.forEach(function (p) { ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        ctx.fillStyle = rgba(color, wind ? 0.19 : 0.31); ctx.fill();
        ctx.lineWidth = 2.1 * stroke; ctx.stroke();
      } else {
        ctx.lineWidth = a.radius * 2;
        ctx.strokeStyle = rgba(color, wind ? 0.13 : 0.26);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + a.dx * a.travel, a.y + a.dy * a.travel); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = a.kind === 'charge' ? 3 : 2.3;
        if (a.kind === 'charge') {
          var side = a.radius * 0.92;
          ctx.beginPath();
          [-side, side].forEach(function (o) {
            var x = a.x + a.dy * o, y = a.y - a.dx * o;
            ctx.moveTo(x, y); ctx.lineTo(x + a.dx * a.travel, y + a.dy * a.travel);
          });
          ctx.lineWidth = 1.05 * stroke; ctx.stroke();
          ctx.lineWidth = 3 * stroke;
          if (wind && ctx.setLineDash) ctx.setLineDash([10, 6]);
        }
        impactArrow(ctx, a.x, a.y, Math.atan2(a.dy, a.dx), a.travel);
        if (ctx.setLineDash) ctx.setLineDash([]);
      }
    });
    ctx.restore();
  }

  function trialLabel(ctx, text, x, y, color) {
    ctx.save(); ctx.textAlign = 'center';
    ctx.font = '700 16px "Microsoft YaHei", system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = CUR.col.bg; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }

  function drawCombatGuide(ctx, s, cue) {
    if (!cue) return;
    var stroke = ctx.canvas.clientWidth < 560 ? 1.45 : 1;
    var p = s.player, e = cue.enemy;
    var spot = cue.ready ? e : cue.spot;
    var guide = CUR.col.guide;
    ctx.save();
    var r = cue.ready ? e.r + 9 : 15 * Math.sqrt(stroke);
    ctx.translate(spot.x, spot.y);
    ctx.strokeStyle = guide; ctx.lineWidth = (cue.ready ? 3 : 2.5) * stroke;
    ctx.beginPath();
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (corner) {
      var dx = corner[0], dy = corner[1];
      ctx.moveTo(dx * (r - 7), dy * r); ctx.lineTo(dx * r, dy * r);
      ctx.lineTo(dx * r, dy * (r - 7));
    });
    ctx.stroke();
    if (!cue.ready) {
      ctx.fillStyle = guide;
      path(ctx, [[0, -3], [3, 0], [0, 3], [-3, 0]]); ctx.fill();
    }
    ctx.restore();
    if (cue.ready) return;
    var dx = cue.next.x - p.x, dy = cue.next.y - p.y;
    var gap = Math.hypot(dx, dy);
    ctx.save();
    ctx.strokeStyle = guide; ctx.lineWidth = 2.2 * stroke;
    if (gap >= 25) {
      if (ctx.setLineDash) ctx.setLineDash([7, 5]);
      impactArrow(ctx, p.x + dx / gap * 17, p.y + dy / gap * 17,
        Math.atan2(dy, dx), Math.max(8, Math.min(86, gap - 25)));
    }
    if (ctx.setLineDash) ctx.setLineDash([2, 6]);
    var len = Math.hypot(e.x - spot.x, e.y - spot.y);
    if (len > e.r + 20) {
      ctx.globalAlpha = 0.58;
      impactArrow(ctx, spot.x + (e.x - spot.x) / len * 17, spot.y + (e.y - spot.y) / len * 17,
        Math.atan2(e.y - spot.y, e.x - spot.x), len - e.r - 19);
    }
    ctx.restore();
  }

  function drawImpactTrails(ctx, s) {
    ctx.save(); ctx.lineCap = 'round';
    s.enemies.forEach(function (e) {
      if (!e.flight) {
        if (e.charger && (e.mode === 'wind' || e.mode === 'charge')) {
          ctx.strokeStyle = CUR.col.rust; ctx.lineWidth = 2.5;
          if (e.mode === 'wind' && ctx.setLineDash) ctx.setLineDash([6, 5]);
          impactArrow(ctx, e.x + e.lockX * 18, e.y + e.lockY * 18, Math.atan2(e.lockY, e.lockX), 53);
          if (ctx.setLineDash) ctx.setLineDash([]);
        }
        return;
      }
      var x = e.x - e.vx * 0.084, y = e.y - e.vy * 0.084;
      var effect = e.flight.effect;
      var col = e.hp === 0 ? CUR.col.rust : (effect ? impactColor(effect.kind) : CUR.col.amber);
      var trail = ctx.createLinearGradient(x, y, e.x, e.y);
      trail.addColorStop(0, rgba(col, 0)); trail.addColorStop(1, rgba(col, 0.82));
      ctx.strokeStyle = trail; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, 0, Math.PI * 2); ctx.stroke();
      if (s.impact.combinations) {
        var speed = Math.hypot(e.vx, e.vy) || 1;
        var dx = e.vx / speed, dy = e.vy / speed;
        var tipX = e.x + dx * 24, tipY = e.y + dy * 24;
        var heading = Math.atan2(dy, dx);
        if (e.flight.reflected && (!s.impact.trial || effect)) {
          ctx.strokeStyle = CUR.col.violet;
          ctx.beginPath(); ctx.moveTo(tipX, tipY);
          tipX += dx * 11; tipY += dy * 11;
          ctx.lineTo(tipX, tipY); ctx.stroke();
          heading = effect ? Math.atan2(effect.dy, effect.dx) : s.player.angle;
        }
        ctx.lineWidth = effect ? 3 : 1.75;
        impactArrow(ctx, tipX, tipY, heading, 18);
      }
    });
    ctx.restore();
  }

  function impactColor(kind) {
    if (kind === 'fold') return CUR.col.violet;
    if (kind === 'borrow') return CUR.col.rust;
    if (kind === 'confirm') return CUR.col.bullet;
    return kind === 'straight' || kind === 'redirect' ? CUR.col.player : CUR.col.amber;
  }

  function impactArrow(ctx, x, y, heading, length) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(heading);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length, 0);
    ctx.moveTo(length - 6, -5); ctx.lineTo(length, 0); ctx.lineTo(length - 6, 5); ctx.stroke();
    ctx.restore();
  }

  function drawImpactActions(ctx, g) {
    ctx.save();
    if (g.swing && g.swing.life > 0) {
      var sw = g.swing;
      var w = C.core.perks.BALANCE.impact.blade;
      ctx.globalAlpha = sw.life / sw.max;
      ctx.fillStyle = rgba(CUR.col.player, 0.16);
      ctx.strokeStyle = CUR.col.player; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sw.x, sw.y);
      ctx.arc(sw.x, sw.y, w.range, sw.angle - w.halfArc, sw.angle + w.halfArc);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (g.shot && g.shot.life > 0) {
      var points = g.shot.points;
      ctx.globalAlpha = g.shot.life / g.shot.max;
      ctx.lineCap = 'round'; ctx.strokeStyle = CUR.col.bullet; ctx.lineWidth = 3;
      for (var i = 1; i < points.length; i++) {
        if (i === 2) ctx.strokeStyle = CUR.col.amber;
        ctx.beginPath(); ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y); ctx.stroke();
      }
    }
    g.marks.forEach(function (m) {
      var ratio = m.life / m.max;
      var color = impactColor(m.kind);
      ctx.globalAlpha = ratio; ctx.lineWidth = 2; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(m.x, m.y, 7 + (1 - ratio) * 27, 0, Math.PI * 2); ctx.stroke();
      if (g.trial && (m.kind === 'fold' || m.kind === 'borrow')) {
        trialLabel(ctx, m.kind === 'fold' ? '折冲' : '借冲锋', m.x, m.y + 34, color);
      }
      if (m.kind === 'relay' && !g.combinations) {
        ctx.fillStyle = color;
        ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('×' + m.depth, m.x, m.y + 28 + (1 - ratio) * 8);
      } else if (m.kind !== 'relay') {
        var heading = Math.atan2(m.dy, m.dx);
        if (m.kind === 'fold') {
          var spread = C.core.perks.BALANCE.impact.combinations.foldAngle;
          impactArrow(ctx, m.x, m.y, heading - spread, 43);
          impactArrow(ctx, m.x, m.y, heading + spread, 43);
        } else {
          var length = m.kind === 'straight' || m.kind === 'borrow' ? 54 : 29;
          impactArrow(ctx, m.x + m.dx * 8, m.y + m.dy * 8, heading, length);
        }
      }
    });
    ctx.restore();
  }

  /* ---------- 粒子 / 拖影 ---------- */
  function drawParticles(ctx, s) {
    var ps = CUR.vis.particleStyle;
    s.particles.forEach(function (p) {
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a; ctx.fillStyle = mapColor(p.color);
      var size = p.size;
      if (ps === 'ember') {
        ctx.save(); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (ps === 'dot') {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, size / 3), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.globalAlpha = a * 0.6;
        ctx.beginPath(); ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x + size, p.y);
        ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x, p.y + size); ctx.stroke();
      } else if (ps === 'petal') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 3);
        ctx.beginPath(); ctx.ellipse(0, 0, size * 0.7, size * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6);
        ctx.fillRect(-size / 2, -size / 2, size, size); ctx.restore();
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawTrail(ctx, s) {
    s.trail.forEach(function (p) {
      ctx.globalAlpha = (p.life / p.max) * 0.32;
      ctx.fillStyle = CUR.col.trail;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ---------- 子弹：细长光针 + 拖尾；敌弹改菱形 ---------- */
  function drawBullets(ctx, s) {
    var col = CUR.col, es = CUR.vis.enemyStyle, glow = CUR.vis.glow || 1;
    s.bullets.forEach(function (b) {
      var tx = b.x - b.vx * 0.026, ty = b.y - b.vy * 0.026;
      var c = b.crit ? col.crit : col.bullet;
      var lg = ctx.createLinearGradient(tx, ty, b.x, b.y);
      lg.addColorStop(0, rgba(c, 0)); lg.addColorStop(1, rgba(c, 0.88));
      ctx.strokeStyle = lg; ctx.lineWidth = b.crit ? 4.5 : 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = rgba(c, 0.16 * glow);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 8 : 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath();
      if (es === 'academic') ctx.rect(b.x - 3, b.y - 3, 6, 6);
      else if (es === 'taiji') ctx.ellipse(b.x, b.y, b.crit ? 6 : 4.5, b.crit ? 3.6 : 2.8, Math.atan2(b.vy, b.vx), 0, Math.PI * 2);
      else ctx.arc(b.x, b.y, b.crit ? 4 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (b.homing) {
        /* M11 导引弹：投射物实体用一圈细环 + 前向短矢与直线弹区分。 */
        ctx.strokeStyle = rgba(col.amber, 0.85); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x + 9, b.y); ctx.lineTo(b.x + 15, b.y); ctx.stroke();
      }
      if (b.crit) { ctx.strokeStyle = rgba(col.flash, 0.8); ctx.lineWidth = 1; ctx.stroke(); }
    });
    s.enemyBullets.forEach(function (b) {
      var c = col.enemyBullet;
      ctx.fillStyle = rgba(c, 0.22);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba(c, 0.95);
      ctx.fillRect(-b.r * 0.7, -b.r * 0.7, b.r * 1.4, b.r * 1.4); ctx.restore();
      ctx.fillStyle = rgba(col.flash, 0.75);
      ctx.beginPath(); ctx.arc(b.x, b.y, 1.6, 0, Math.PI * 2); ctx.fill();
    });
  }

  /* ---------- 敌人：形状沿用 M1（碰撞体积可辨识），双层描边 + 发光 + 细刻度血条 ---------- */
  function enemyColor(e) {
    var col = CUR.col;
    if (e.isBoss || e.shape === 'charge') return col.rust;
    if (e.shape === 'orbit') return col.flank;
    if (e.shape === 'ranged') return col.fold;
    return col.amber;
  }

  function silhouette(ctx, shape, r) {
    if (shape === 'charge') {
      path(ctx, [[r + 3, 0], [-r, -r * 0.82], [-r * 0.52, 0], [-r, r * 0.82]]);
    } else if (shape === 'orbit') {
      path(ctx, [[0, -r * 1.13], [r, 0], [0, r * 1.13], [-r, 0]]);
    } else if (shape === 'ranged') {
      rr(ctx, -r, -r, r * 2, r * 2, 2);
    } else {
      polygon(ctx, 0, 0, r, shape === 'boss' ? 8 : 6, Math.PI / 6);
    }
  }

  function enemyGlyph(ctx, e, color) {
    var r = e.r || 14;
    var shape = e.isBoss ? 'boss' : (e.shape || 'chase');
    var col = CUR.col;
    if (shape === 'charge') {
      var locked = (e.brain && e.brain.attack) || (e.charger && e.mode === 'wind');
      var vx = locked ? (e.lockX || 0) : (e.vx || 0);
      var vy = locked ? (e.lockY || 0) : (e.vy || 0);
      ctx.rotate(Math.atan2(vy, vx || 0.0001));
    } else if (e.turret) ctx.rotate(e.angle || 0);
    ctx.lineJoin = 'round';
    if (!CUR.paper && CUR.vis.glow > 0) {
      ctx.save(); ctx.shadowColor = rgba(color, 0.7); ctx.shadowBlur = 12 * CUR.vis.glow;
      silhouette(ctx, shape, r + 2); ctx.fillStyle = rgba(color, 0.5); ctx.fill(); ctx.restore();
    }
    silhouette(ctx, shape, r + 2);
    ctx.fillStyle = col.outline; ctx.fill();
    silhouette(ctx, shape, r);
    ctx.fillStyle = e.flash > 0 ? col.flash : (CUR.paper ? shade(color, 0.18) : shade(color, -0.66));
    ctx.fill();
    ctx.lineWidth = CUR.paper ? 2.2 : 1.8;
    ctx.strokeStyle = CUR.paper ? col.outline : color; ctx.stroke();
    ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(col.flash, CUR.paper ? 0.25 : 0.30);
    silhouette(ctx, shape, Math.max(3, r - 3.5)); ctx.stroke();
    ctx.fillStyle = CUR.paper ? col.outline : color;
    if (shape === 'charge') {
      path(ctx, [[r * 0.55, 0], [-r * 0.56, -r * 0.29], [-r * 0.35, 0], [-r * 0.56, r * 0.29]]); ctx.fill();
    } else if (shape === 'orbit') {
      polygon(ctx, 0, 0, r * 0.34, 4, 0); ctx.fill();
      ctx.fillRect(-r * 0.83, -1, r * 0.25, 2);
      ctx.fillRect(r * 0.58, -1, r * 0.25, 2);
    } else if (e.turret) {
      ctx.fillRect(-r * 0.40, -2.5, r * 1.48, 5);
    } else if (shape === 'ranged') {
      ctx.fillRect(-r * 0.63, -1, r * 1.26, 2);
      ctx.fillRect(-1, -r * 0.63, 2, r * 1.26);
    } else {
      ctx.fillRect(-r * 0.54, -r * 0.2, r * 0.38, r * 0.4);
      ctx.fillRect(r * 0.16, -r * 0.2, r * 0.38, r * 0.4);
    }
    ctx.fillStyle = rgba(col.flash, CUR.paper ? 0.5 : 0.35);
    ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  function drawEnemy(ctx, e, t) {
    var color = enemyColor(e), col = CUR.col;
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.fillStyle = rgba(col.outline, CUR.paper ? 0.20 : 0.62);
    ctx.beginPath(); ctx.ellipse(1.5, e.r * 0.78, e.r * 1.08, e.r * 0.52, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(color, 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, e.r + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); enemyGlyph(ctx, e, color); ctx.restore();
    /* M9：长局首领有独立护盾绘制（drawBossShield），这里只保留旧原型的一圈虚线 */
    if (e.patrol && !e.shield) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = e.guardOpen > 0 ? col.crit : col.fold;
      if (ctx.setLineDash) ctx.setLineDash(e.guardOpen > 0 ? [6, 5] : [13, 6]);
      ctx.beginPath(); ctx.arc(0, 0, e.r + 11, 0, Math.PI * 2); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      if (e.guardOpen > 0) {
        ctx.strokeStyle = rgba(col.crit, 0.16); ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 11, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    var width = e.isBoss ? 88 : 32;
    var ratio = Math.max(0, e.hp / e.maxHp), y = e.y - e.r - 11;
    ctx.fillStyle = rgba(col.outline, 0.85);
    ctx.fillRect(e.x - width / 2 - 1, y - 1, width + 2, 5);
    ctx.fillStyle = rgba(color, 0.22);
    ctx.fillRect(e.x - width / 2, y, width, 3);
    ctx.fillStyle = color;
    ctx.fillRect(e.x - width / 2, y, width * ratio, 3);
    ctx.strokeStyle = rgba(col.outline, 0.5); ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < 4; i++) {
      var tx = e.x - width / 2 + width * i / 4;
      ctx.moveTo(tx, y); ctx.lineTo(tx, y + 3);
    }
    ctx.stroke();
  }

  /* ---------- 玩家：唯一高亮色，外环旋转、冲刺拖影、指向三角 ---------- */
  function playerGlyph(ctx, r, weapon) {
    var col = CUR.col;
    ctx.strokeStyle = rgba(col.player, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col.player; ctx.strokeStyle = col.outline; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = rgba(col.playerInk, 0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col.playerInk;
    path(ctx, [[-3, -6], [6, 0], [-3, 6], [0, 0]]); ctx.fill();
    ctx.fillStyle = col.player;
    ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.player; ctx.strokeStyle = col.outline; ctx.lineWidth = 1.4;
    if (weapon === 'blade') path(ctx, [[r + 2, 6], [r + 13, -13], [r + 14, -3], [r + 7, 7]]);
    else rr(ctx, r - 2, -4, r + 11, 8, 2);
    ctx.fill(); ctx.stroke();
  }

  function drawPlayer(ctx, s, t) {
    var p = s.player, col = CUR.col, glow = CUR.vis.glow || 1;
    ctx.save(); ctx.translate(p.x, p.y);
    if (p.invuln > 0 && Math.floor(t * 18) % 2 === 0 && p.dashTime <= 0) ctx.globalAlpha = 0.45;
    var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r + 18);
    rg.addColorStop(0, rgba(col.player, 0.20 * glow));
    rg.addColorStop(1, rgba(col.player, 0));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 18, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.rotate(t * 0.7);
    ctx.strokeStyle = rgba(col.player, 0.45); ctx.lineWidth = 1.2;
    if (ctx.setLineDash) ctx.setLineDash([9, 11]);
    ctx.beginPath(); ctx.arc(0, 0, p.r + 11, 0, Math.PI * 2); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();
    if (p.dashTime > 0) {
      ctx.strokeStyle = rgba(col.player, 0.35); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-6, 0); ctx.stroke();
    }
    ctx.rotate(p.angle || 0);
    playerGlyph(ctx, p.r, s.impact && s.impact.weapon);
    ctx.restore();
  }

  /* 首页取景：直接把「闭环回廊 + 逆行回扫」画出来，而不是抽象线框。 */
  function drawIdle(ctx, t) {
    drawBackground(ctx, t);
    var col = CUR.col;
    var cx = 716, cy = 292;
    var routes = [
      [{ x: cx - 250, y: cy - 96 }, { x: cx + 236, y: cy - 96 }, { x: cx + 236, y: cy }],
      [{ x: cx - 250, y: cy }, { x: cx + 236, y: cy }],
      [{ x: cx - 250, y: cy + 96 }, { x: cx - 78, y: cy + 96 }, { x: cx - 78, y: cy + 58 },
       { x: cx + 96, y: cy + 58 }, { x: cx + 96, y: cy + 96 }, { x: cx + 236, y: cy + 96 }, { x: cx + 236, y: cy }]
    ];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    routes.forEach(function (pts, idx) {
      tracePath(ctx, pts); ctx.lineWidth = 28; ctx.strokeStyle = rgba(col.guide, 0.05); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 24; ctx.strokeStyle = rgba(col.guide, 0.16); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 20; ctx.strokeStyle = rgba(shade(col.bg, 0.05), 0.92); ctx.stroke();
      tracePath(ctx, pts); ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(col.guide, 0.35);
      if (ctx.setLineDash) ctx.setLineDash([5, 9]);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      var total = 0, segs = [];
      for (var i = 1; i < pts.length; i++) {
        var L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        segs.push(L); total += L;
      }
      var d = (t * 95 + idx * total / 3) % total;
      for (var j = 0; j < segs.length; j++) {
        if (d <= segs[j]) {
          var a = pts[j], b = pts[j + 1], k = d / segs[j];
          var px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
          var rg = ctx.createRadialGradient(px, py, 0, px, py, 13);
          rg.addColorStop(0, rgba(col.flash, 0.9));
          rg.addColorStop(0.3, rgba(col.player, 0.65));
          rg.addColorStop(1, rgba(col.player, 0));
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill();
          break;
        }
        d -= segs[j];
      }
    });
    [routes[0][0], routes[0][routes[0].length - 1]].forEach(function (p) {
      ctx.strokeStyle = rgba(col.teal, 0.75); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.amber, 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
    });
    var sweep = (t * 140) % 486;
    var up = routes[0];
    ctx.strokeStyle = rgba(col.player, 0.22); ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(up[1].x - sweep, up[0].y);
    ctx.lineTo(up[1].x - Math.max(0, sweep - 120), up[0].y); ctx.stroke();
    ctx.save(); ctx.translate(cx - 140, cy - 96); playerGlyph(ctx, 15, 'blade'); ctx.restore();
    ctx.save(); ctx.translate(cx + 80, cy);
    enemyGlyph(ctx, { r: 17, shape: 'orbit', vx: 0, vy: 0 }, col.flank); ctx.restore();
    ctx.save(); ctx.translate(cx - 20, cy + 96);
    enemyGlyph(ctx, { r: 16, shape: 'charge', vx: 1, vy: 0 }, col.rust); ctx.restore();
    ctx.restore();
    ctx.save();
    ctx.font = '500 10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = rgba(col.guide, 0.55);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('ROUTE / CLOSED LOOP', cx - 250, cy - 140);
    ctx.fillText('RETURN SWEEP  ←', cx + 60, cy + 132);
    ctx.restore();
  }

  /* ---------- 打击反馈 ---------- */
  function drawDamagePops(ctx, s) {
    if (!Array.isArray(s.damagePops)) return;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    s.damagePops.forEach(function (d) {
      if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
      var life = (typeof d.life === 'number' && typeof d.max === 'number' && d.max > 0)
        ? clamp(d.life / d.max, 0, 1) : 1;
      var rise = (1 - life) * 28;
      var val = d.value == null ? '' : String(d.value);
      var crit = !!d.crit;
      var col = crit ? CUR.col.crit : CUR.col.bullet;
      ctx.globalAlpha = 0.3 + 0.7 * life;
      ctx.font = '500 ' + (crit ? 25 : 17) + 'px ui-monospace, Consolas, monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(CUR.col.outline, 0.85);
      ctx.strokeText(val, d.x, d.y - rise);
      if (crit) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
      ctx.fillStyle = col; ctx.fillText(val, d.x, d.y - rise);
      ctx.shadowBlur = 0;
    });
    ctx.restore();
  }
  function drawBossPhase(ctx, s, t) {
    if (!Array.isArray(s.enemies)) return;
    s.enemies.forEach(function (e) {
      if (!e.isBoss) return;
      ctx.save();
      ctx.strokeStyle = CUR.col.rust; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 4);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 18, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 30, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }

  /* ---------- M9：巡廊首领护盾三态强视觉 ----------
   * closed    → 双层六边形护盾壳 + 相位刻线 + 蓄势进度弧 + 「需 XX 圈」标签
   * exposed   → 外壳碎裂飞散 + 琥珀倒计时环 + 中心准星
   * reforming → 六边形逐边重建 + REBUILD 读数
   * 用户诉求「boss 破盾与否没有视觉上展示」就在这里落地：
   * 三态在战场上一眼可辨，且护盾上直接画出「还差几圈」。 */
  function waveColor(s) {
    var col = CUR.col, list = (s && s.enemies) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].patrol && list[i].shield) {
        var st = list[i].shield.state;
        if (st === 'exposed') return col.amber;
        if (st === 'reforming') return col.fold;
        return col.guide;
      }
    }
    return col.guide;
  }
  function shieldHex(ctx, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 3;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function shieldBoss(s) {
    var list = (s && s.enemies) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].patrol && list[i].shield) return list[i];
    }
    return null;
  }
  function drawBossShield(ctx, s, t) {
    var boss = shieldBoss(s);
    if (!boss) return;
    var sh = boss.shield, spec = sh.spec, col = CUR.col, glow = CUR.vis.glow || 1;
    var R0 = boss.r + 15;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    if (sh.state === 'closed') {
      var pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      ctx.strokeStyle = rgba(col.fold, 0.20 + 0.10 * pulse);
      ctx.lineWidth = 12 * glow;
      shieldHex(ctx, R0 + 7); ctx.stroke();
      ctx.fillStyle = rgba(col.fold, 0.055);
      shieldHex(ctx, R0 + 7); ctx.fill();
      ctx.strokeStyle = rgba(col.fold, 0.85);
      ctx.lineWidth = 2.2;
      shieldHex(ctx, R0 + 7); ctx.stroke();
      ctx.strokeStyle = rgba(sh.flash > 0 ? col.flash : col.rust, sh.flash > 0 ? 0.9 : 0.42);
      ctx.lineWidth = 1.2;
      shieldHex(ctx, R0 + 2); ctx.stroke();
      /* 相位刻线：第 n 相位画 n 道内环，护盾越到后面越「厚」 */
      for (var k = 0; k < Math.min(spec.phase, 6); k++) {
        ctx.strokeStyle = rgba(col.fold, 0.24);
        ctx.lineWidth = 1;
        shieldHex(ctx, R0 - 3 - k * 4); ctx.stroke();
      }
      /* 蓄势进度弧：把「还差几圈破盾」直接画在壳上 */
      var ratio = clamp(sh.charge / spec.need, 0, 1);
      ctx.strokeStyle = rgba(col.amber, 0.9);
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(0, 0, R0 + 13, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
      if (boss.shieldFlash > 0) {
        ctx.strokeStyle = rgba(col.flash, 0.75);
        ctx.lineWidth = 4;
        shieldHex(ctx, R0 + 9); ctx.stroke();
      }
    } else if (sh.state === 'exposed') {
      /* 碎裂的外壳：随 flash 向外飞散 */
      var f = sh.flash;
      ctx.strokeStyle = rgba(col.amber, 0.55 * (0.35 + f));
      ctx.lineWidth = 2;
      for (var q = 0; q < 6; q++) {
        var a0 = -Math.PI / 2 + q * Math.PI / 3;
        var rr = R0 + 8 + (1 - f) * 26;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
        ctx.lineTo(Math.cos(a0 + Math.PI / 3) * rr, Math.sin(a0 + Math.PI / 3) * rr);
        ctx.stroke();
      }
      /* 输出窗口倒计时环：从满到空，肉眼可读还剩多久 */
      var left = clamp(boss.guardOpen / spec.window, 0, 1);
      ctx.strokeStyle = rgba(col.amber, 0.18);
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R0 + 14, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.crit, 0.95);
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R0 + 14, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.flash, 0.85); ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.lineTo(-3, 0); ctx.moveTo(9, 0); ctx.lineTo(3, 0);
      ctx.moveTo(0, -9); ctx.lineTo(0, -3); ctx.moveTo(0, 9); ctx.lineTo(0, 3);
      ctx.stroke();
    } else {
      /* 重构：六边形按进度逐边点亮 */
      var done = clamp(sh.reform, 0, 1) * 6;
      ctx.strokeStyle = rgba(col.guide, 0.18);
      ctx.lineWidth = 3;
      shieldHex(ctx, R0 + 8); ctx.stroke();
      for (var e2 = 0; e2 < 6; e2++) {
        var seg = clamp(done - e2, 0, 1);
        if (seg <= 0) continue;
        var ab = -Math.PI / 2 + e2 * Math.PI / 3;
        ctx.strokeStyle = rgba(col.guide, 0.35 + 0.6 * seg);
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ab) * (R0 + 8), Math.sin(ab) * (R0 + 8));
        ctx.lineTo(Math.cos(ab + Math.PI / 3 * seg) * (R0 + 8),
                   Math.sin(ab + Math.PI / 3 * seg) * (R0 + 8));
        ctx.stroke();
      }
    }
    ctx.restore();
    /* 相位 / 圈型要求标签：永远画在首领正上方，是玩家改走法的唯一提示源 */
    ctx.save();
    ctx.font = '500 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var label = sh.state === 'exposed' ? 'SHIELD BREAK / 全额输出' :
      (sh.state === 'reforming' ? 'REBUILD / 护盾重构' :
        'PHASE ' + String(spec.phase).padStart(2, '0') + ' / ' + spec.requiredLabel);
    var lc = sh.state === 'exposed' ? col.crit : (sh.state === 'reforming' ? col.guide : col.fold);
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(col.bg, 0.9);
    ctx.strokeText(label, boss.x, boss.y - R0 - 24);
    ctx.fillStyle = lc; ctx.fillText(label, boss.x, boss.y - R0 - 24);
    ctx.restore();
  }
  /* 破盾瞬间的全屏爆发信号：冲击环 + 放射线 + 大字，低强度不刺眼。 */
  function drawBreakBurst(ctx, s, t) {
    if (!s || !(s.breakFlash > 0)) return;
    var col = CUR.col, boss = shieldBoss(s);
    var f = clamp(s.breakFlash, 0, 1), k = 1 - f;
    var cx = boss ? boss.x : W / 2, cy = boss ? boss.y : H / 2;
    ctx.save();
    ctx.fillStyle = rgba(col.flash, 0.10 * f * f);
    ctx.fillRect(0, 0, W, H);
    for (var r = 0; r < 3; r++) {
      ctx.strokeStyle = rgba(r === 0 ? col.flash : col.amber, (0.55 - r * 0.14) * f);
      ctx.lineWidth = (5 - r) * (0.6 + f);
      ctx.beginPath(); ctx.arc(cx, cy, 42 + k * (150 + r * 78) + r * 26, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = rgba(col.amber, 0.42 * f);
    ctx.lineWidth = 1.6;
    for (var q = 0; q < 12; q++) {
      var a = q * Math.PI / 6 + t * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (36 + k * 90), cy + Math.sin(a) * (36 + k * 90));
      ctx.lineTo(cx + Math.cos(a) * (78 + k * 190), cy + Math.sin(a) * (78 + k * 190));
      ctx.stroke();
    }
    ctx.globalAlpha = clamp(f * 1.4, 0, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 34px "Microsoft YaHei", system-ui, sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(col.outline, 0.92);
    ctx.strokeText('护盾崩解', cx, cy - 62 - k * 18);
    ctx.fillStyle = col.crit; ctx.fillText('护盾崩解', cx, cy - 62 - k * 18);
    ctx.font = '500 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = col.amber;
    ctx.fillText('SHIELD BREAK / FULL DAMAGE WINDOW', cx, cy - 38 - k * 18);
    ctx.restore();
  }

  /* M10：闭环兑现瞬间的战场演出。与 M9 破盾爆发刻意区分：破盾是全屏琥珀爆发，
   * 兑现是沿「这一圈走过的两条廊」收束的光带 + 玩家脚下扩散环 + 读数，
   * 克制但一眼能读出圈型、长度、连扫层数。此前 onLoopClosed 只发空壳事件，
   * 闭环这一下在画面上完全没有反馈，是「不够爽」最直接的一处缺口。 */
  function drawClosure(ctx, s, t) {
    var c = s && s.closure;
    if (!c || !(c.t > 0) || !s.player) return;
    var col = CUR.col, f = clamp(c.t, 0, 1), k = 1 - f;
    var rep = c.report, p = s.player, color = waveColor(s);
    ctx.save();
    var lanes = s.recall && s.recall.layout && s.recall.layout.lanes;
    if (rep.path && rep.path.length > 2) {
      /* M11 自由回廊：这一圈就是玩家真实走出来的多边形，沿边界收束成光带。 */
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      tracePath(ctx, rep.path); ctx.closePath();
      ctx.fillStyle = rgba(color, 0.07 * f); ctx.fill();
      layeredStroke(ctx, rep.path.concat([rep.path[0]]), 3 + 8 * f, color, 0.55 * f, 14);
    } else if (lanes && rep.lanes.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      rep.lanes.forEach(function (id) {
        var lane = lanes[id];
        if (!lane) return;
        tracePath(ctx, lane.points); ctx.lineWidth = 6 + 10 * f;
        ctx.strokeStyle = rgba(color, 0.16 * f); ctx.stroke();
        tracePath(ctx, lane.points); ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(color, 0.55 * f); ctx.stroke();
      });
    }
    for (var r = 0; r < 2; r++) {
      ctx.strokeStyle = rgba(color, (0.5 - r * 0.2) * f);
      ctx.lineWidth = (3 - r) * (0.7 + f);
      ctx.beginPath(); ctx.arc(p.x, p.y, 16 + k * (52 + r * 30), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = clamp(f * 1.6, 0, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var bx = clamp(p.x, 150, W - 150), by = clamp(p.y - 58 - k * 14, 44, H - 44);
    ctx.font = '700 20px "Microsoft YaHei", system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = rgba(col.outline, 0.9);
    var title = s.free ? '自由闭环' : '闭环兑现';
    ctx.strokeText(title, bx, by);
    ctx.fillStyle = color; ctx.fillText(title, bx, by);
    ctx.font = '500 10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = col.amber;
    var metric = rep.area ? rep.area + 'm²' : rep.length;
    ctx.fillText('LOOP CLOSED / ' + rep.label + ' / ' + metric + ' / STREAK x' + rep.streak, bx, by + 19);
    /* M13：把「这一圈附带了什么效果 / 倍率怎么来的」也拍在画面上。 */
    if (s.free && rep.effectLabel) {
      ctx.font = '600 11px "Microsoft YaHei", system-ui, sans-serif';
      var eff = rep.effectLabel + ' · 回扫 ' + (rep.mul || 1).toFixed(2) + '×' +
        (rep.switched ? ' · 换型连扫 ×' + rep.streak : ' · 同型衰减') +
        (rep.pierce ? ' · 穿透' : '');
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(col.outline, 0.9);
      ctx.strokeText(eff, bx, by + 38);
      ctx.fillStyle = rep.switched ? col.amber : col.guide;
      ctx.fillText(eff, bx, by + 38);
    }
    ctx.restore();
  }

  /* ==================== M11 自由回扫主模式渲染 ====================
   * 主模式已从「固定廊道」换成「玩家自己走出来的多边形」。这里把四件此前
   * 只存在于状态里、画面上完全看不见的东西画出来：
   *   ⑥ 常驻正负地效格；⑤-b 正在走的路径 / 起点 / 回扫波；
   *   ①③④ 凝滞 / 完美闪避 / 连段等级；⑩ 自由闭环兑现（复用 drawClosure）。
   * 护盾三态与破盾爆发直接复用 M9 的 drawBossShield / drawBreakBurst ——
   * freewave 刻意沿用同一份 boss.shield 结构，因此无需第二套绘制逻辑。 */
  function freeState(s) { return s && s.free; }

  function drawFreeTiles(ctx, s, t) {
    var f = freeState(s), tiles = f && f.tiles;
    if (!tiles || !tiles.length) return;
    var col = CUR.col, glow = CUR.vis.glow || 1;
    ctx.save();
    tiles.forEach(function (tile) {
      var good = tile.kind === 'good';
      var c = good ? col.guide : col.rust;
      var pulse = 0.5 + 0.5 * Math.sin(t * 2.1 + tile.gx * 0.7 + tile.gy * 0.9);
      ctx.fillStyle = rgba(c, (good ? 0.055 : 0.07) * (0.7 + 0.3 * pulse) * glow);
      ctx.fillRect(tile.x + 1, tile.y + 1, tile.w - 2, tile.h - 2);
      ctx.strokeStyle = rgba(c, good ? 0.45 : 0.55); ctx.lineWidth = 1.2;
      ctx.strokeRect(tile.x + 2.5, tile.y + 2.5, tile.w - 5, tile.h - 5);
      ctx.lineCap = 'round'; ctx.lineWidth = 1.8;
      ctx.strokeStyle = rgba(c, 0.8);
      var cx = tile.x + tile.w / 2, cy = tile.y + tile.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
      if (good) { ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); }
      ctx.stroke();
      ctx.font = '500 8px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = rgba(c, 0.78);
      ctx.fillText(good ? 'BOOST' : 'SLOW', cx, tile.y + tile.h - 4);
    });
    ctx.restore();
  }

  /* 只读地从波的 position 求头部，绝不调用 FW.advanceWave（那会改状态）。 */
  function waveHead(w) {
    if (!w || !w.path || !w.path.length) return null;
    var total = 0, i, head = w.path[0];
    for (i = 1; i < w.path.length; i++)
      total += Math.hypot(w.path[i].x - w.path[i - 1].x, w.path[i].y - w.path[i - 1].y);
    var d = Math.min(w.position, total);
    for (i = 1; i < w.path.length; i++) {
      var a = w.path[i - 1], b = w.path[i];
      var seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= seg) {
        var k = seg ? d / seg : 0;
        head = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        break;
      }
      d -= seg;
    }
    return { head: head, total: total };
  }

  function drawFreePath(ctx, s, t) {
    var f = freeState(s);
    if (!f) return;
    var col = CUR.col, glow = CUR.vis.glow || 1, color = waveColor(s);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (f.armed && f.path.length > 1) {
      var poly = f.path;
      /* 已走区域淡填充，让「圈住了多少」在走的过程中就可读 */
      tracePath(ctx, poly); ctx.closePath();
      ctx.fillStyle = rgba(color, 0.045); ctx.fill();
      layeredStroke(ctx, poly, 3.4, col.guide, 0.9, 11 * glow);
      tracePath(ctx, poly); ctx.lineWidth = 1;
      ctx.strokeStyle = rgba('#FFFFFF', 0.30); ctx.stroke();
      /* 起点标记 + 回到起点的虚线：玩家唯一需要知道的「还差多远」 */
      var o = f.origin, p = s.player;
      if (ctx.setLineDash) ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(o.x, o.y);
      ctx.strokeStyle = rgba(col.amber, 0.42); ctx.lineWidth = 1.4; ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      var pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = rgba(col.amber, 0.85); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(o.x, o.y, 9 + 3 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(col.amber, 0.14);
      ctx.beginPath(); ctx.arc(o.x, o.y, 9 + 3 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.font = '500 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(col.bg, 0.9);
      ctx.strokeText('ORIGIN / 回到此处兑现', o.x, o.y - 16);
      ctx.fillStyle = col.amber; ctx.fillText('ORIGIN / 回到此处兑现', o.x, o.y - 16);
      /* M13：走的过程中就把「正在画哪种圈 / 是否换了型 / 还差多少」画出来，
       * 不再等兑现才知道自己画了什么。f.live 由 updateFree 每帧算一次。 */
      var lv = f.live;
      if (lv) {
        var lx = clamp(p.x, 150, W - 150), ly = clamp(p.y - 36, 40, H - 40);
        ctx.font = '600 11px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var lvText = 'LIVE ' + lv.label + ' / ' + lv.area + 'm²' +
          (lv.switched ? ' / 换型 ×' + Math.min(3, (f.craftStreak || 0) + 1) : ' / 与上圈同型') +
          (lv.pierce ? ' / 穿透' : '');
        ctx.lineWidth = 3; ctx.strokeStyle = rgba(col.bg, 0.92);
        ctx.strokeText(lvText, lx, ly);
        ctx.fillStyle = lv.switched ? col.amber : col.guide;
        ctx.fillText(lvText, lx, ly);
        if (!lv.ready) {
          ctx.font = '500 9px ui-monospace, Consolas, monospace';
          var need = '面积 / 点数未达标 · 继续绕大一点';
          ctx.strokeText(need, lx, ly + 15);
          ctx.fillStyle = '#D9644B'; ctx.fillText(need, lx, ly + 15);
        }
      }
    }
    if (f.wave) {
      var w = f.wave, pts = w.path, info = waveHead(w);
      layeredStroke(ctx, pts, 3.0, color, 0.30, 8 * glow);
      /* 已推进部分亮起：从起点一路点到 head */
      var travelled = [pts[0]], acc = 0, d = Math.min(w.position, info.total);
      for (var i = 1; i < pts.length; i++) {
        var seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (acc + seg >= d) { travelled.push(info.head); break; }
        acc += seg; travelled.push(pts[i]);
      }
      layeredStroke(ctx, travelled, 5, color, 0.95, 16 * glow);
      var tip = info.head;
      var rg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 20 * glow);
      rg.addColorStop(0, rgba('#FFFFFF', 0.95));
      rg.addColorStop(0.35, rgba(color, 0.72));
      rg.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 20 * glow, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ①③④ 凝滞 / 完美闪避 / 连段等级：全部画在玩家身上，不占 HUD。 */
  function drawFreeDodge(ctx, s, t) {
    var f = freeState(s), ch = s.chrono, p = s.player;
    if (!f || !ch || !p) return;
    var Q = C.core.perks.BALANCE.chrono;
    var col = CUR.col;
    ctx.save(); ctx.translate(p.x, p.y);
    if (ch.stall > 0) {
      /* 斯安维斯坦：世界被压慢时的时间刻度环 */
      var k = clamp(ch.stall / Q.stallTime, 0, 1);
      ctx.strokeStyle = rgba(col.fold, 0.22 + 0.35 * k); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 26 + 10 * (1 - k), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.fold, 0.55); ctx.lineWidth = 1;
      for (var q = 0; q < 12; q++) {
        var a = q * Math.PI / 6 + t * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (p.r + 20), Math.sin(a) * (p.r + 20));
        ctx.lineTo(Math.cos(a) * (p.r + 27), Math.sin(a) * (p.r + 27));
        ctx.stroke();
      }
    }
    if (ch.perfect && ch.perfect.t > 0) {
      /* 完美闪避窗口：金色倒计时环，明确告诉玩家「现在按 Shift」 */
      var pk = clamp(ch.perfect.t / Q.perfectWindow, 0, 1);
      ctx.strokeStyle = rgba(col.amber, 0.22); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 15, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(col.crit, 0.95); ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 15, -Math.PI / 2, -Math.PI / 2 + pk * Math.PI * 2);
      ctx.stroke();
    }
    if (s.dodgeFlash > 0) {
      var df = clamp(s.dodgeFlash, 0, 1), perfect = ch.buff && ch.buff.kind === 'perfect';
      ctx.strokeStyle = rgba(perfect ? col.crit : col.guide, 0.7 * df);
      ctx.lineWidth = (perfect ? 4 : 2) * df;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 12 + (1 - df) * 56, 0, Math.PI * 2); ctx.stroke();
    }
    /* 连段等级环：T1/T2/T3 分别点亮 1/2/3 段弧 */
    var tier = s.comboTier || 0, cf = clamp(s.comboFlash || 0, 0, 1);
    if (tier > 0) {
      ctx.lineWidth = 3.4;
      for (var n = 0; n < tier; n++) {
        ctx.strokeStyle = rgba(col.amber, 0.5 + 0.4 * cf);
        ctx.beginPath();
        ctx.arc(0, 0, p.r + 20 + n * 7, -Math.PI / 2 + n * 0.35,
                -Math.PI / 2 + n * 0.35 + Math.PI * 1.25);
        ctx.stroke();
      }
      ctx.font = '700 11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = col.amber;
      ctx.fillText('COMBO T' + tier + ' · ×' + (s.combo || 0), 0, p.r + 24 + tier * 7);
    }
    /* 当前所处地效贴在脚下：不看 HUD 也知道为什么这一下变快 / 变慢 */
    var tb = f.tileBuff;
    if (tb && tb.kind !== 'none') {
      ctx.font = '500 9px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = tb.kind === 'good' ? col.guide : col.rust;
      ctx.fillText(tb.label.toUpperCase(), 0, p.r + 38 + tier * 7);
    }
    ctx.restore();
    if (ch.stall > 0 && !CUR.paper) {
      ctx.save();
      ctx.globalAlpha = clamp(ch.stall / Q.stallTime, 0, 1) * 0.9;
      ctx.font = '600 11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = col.fold;
      ctx.fillText('CHRONO / WORLD ' + Q.stallScale.toFixed(2) + 'x · PLAYER 1.00x', 26, 34);
      ctx.restore();
    }
  }

  /* ---------- 后处理：VISUALS.postFx 真正接线 ---------- */
  function drawPostFx(ctx, s, t) {
    if (CUR.paper) return;
    var fx = (CUR.vis && CUR.vis.postFx) || DEFAULT_VIS.postFx;
    if (fx.halo > 0) {
      var hg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, H * 0.72);
      hg.addColorStop(0, rgba(CUR.col.guide, fx.halo * 0.12));
      hg.addColorStop(1, rgba(CUR.col.guide, 0));
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    }
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.92);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, rgba('#000000', 0.20 + fx.vignette * 0.7));
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (s && s.player && s.player.maxHp) {
      var ratio = s.player.hp / s.player.maxHp;
      if (ratio < 0.35) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 6);
        var rg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
        rg.addColorStop(0, 'rgba(0,0,0,0)');
        rg.addColorStop(1, rgba(CUR.col.rust, (0.35 - ratio) * 0.9 * (0.6 + 0.4 * pulse)));
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    }
    if (fx.grain > 0.004) {
      ctx.save();
      ctx.fillStyle = rgba('#FFFFFF', Math.min(0.5, fx.grain * 2.2));
      for (var i = 0; i < GRAIN.length; i++) {
        var g = GRAIN[i]; ctx.fillRect(g.x, g.y, g.r, g.r);
      }
      ctx.restore();
    }
    if (s && s.shake > 0 && fx.shock > 0) {
      ctx.fillStyle = rgba(CUR.col.flash, Math.min(0.16, s.shake * 0.012 * fx.shock));
      ctx.fillRect(0, 0, W, H);
    }
    if (fx.bloom > 0) {
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, rgba(CUR.col.guide, fx.bloom * 0.05));
      bg.addColorStop(0.5, 'rgba(0,0,0,0)');
      bg.addColorStop(1, rgba('#000000', fx.bloom * 0.12));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- 图廓：测绘档案感，四角刻度 / 编号 / 层级读数 ---------- */
  function drawFrame(ctx, s, t) {
    var vis = CUR.vis, fr = vis.frame || DEFAULT_VIS.frame;
    var ink = CUR.paper ? '#1E2C3C' : CUR.col.guide;
    var m = 18, c = 22;
    ctx.save();
    ctx.strokeStyle = rgba(ink, CUR.paper ? 0.35 : 0.28); ctx.lineWidth = 1;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(function (k) {
      ctx.beginPath();
      ctx.moveTo(k[0] + k[2] * c, k[1]); ctx.lineTo(k[0], k[1]); ctx.lineTo(k[0], k[1] + k[3] * c);
      ctx.stroke();
    });
    ctx.strokeStyle = rgba(ink, 0.16);
    ctx.beginPath(); ctx.moveTo(m + c + 8, m); ctx.lineTo(W - m - c - 8, m); ctx.stroke();
    ctx.font = '500 10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = rgba(ink, CUR.paper ? 0.65 : 0.55);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(fr.code + ' / ' + fr.name, m + c + 14, m - 4);
    ctx.textAlign = 'right';
    var tag = '';
    if (s && s.free) {
      tag = 'LAYER ' + (s.free.layer || 1) + ' · ROOM ' + ((s.free.roomInLayer || 0) + 1) +
        ' · LOOP ' + (s.free.closures || 0);
      var fb = shieldBoss(s);
      if (fb) tag += ' · SHIELD P' + fb.shield.spec.phase + '/' + fb.shield.spec.requiredLabel +
        ' [' + fb.shield.state.toUpperCase() + ']';
      if (s.chrono && s.chrono.stall > 0)
        tag += ' · CHRONO ' + C.core.perks.BALANCE.chrono.stallScale.toFixed(2) + 'x';
      /* M13：图廓右上角给出当前圈型策略倍率，换型 / 同型一眼可辨。 */
      if (s.free.lastCraft) tag += ' · CRAFT ' + s.free.lastCraft.mul.toFixed(2) + '×' +
        (s.free.lastCraft.switched ? '[换型]' : '[同型]');
    } else if (s && s.loop) {
      tag = 'LAYER ' + (s.loop.layer || 1) + ' · ROOM ' + ((s.loop.roomInLayer || 0) + 1) +
        ' · LOOP ' + ((s.recall && s.recall.loops) || 0);
      var sb = shieldBoss(s);
      if (sb) tag += ' · SHIELD P' + sb.shield.spec.phase + '/' + sb.shield.spec.requiredLabel +
        ' [' + sb.shield.state.toUpperCase() + ']';
    } else if (s && s.run && s.run.rooms) {
      tag = 'ROOM ' + ((s.roomIndex || 0) + 1) + ' / ' + s.run.rooms.length;
    }
    ctx.fillText(tag, W - m - c - 14, m - 4);
    ctx.strokeStyle = rgba(ink, 0.20); ctx.beginPath();
    for (var x = m + c; x <= W - m - c; x += 24) {
      var big = ((x - (m + c)) % 120) < 24;
      ctx.moveTo(x, H - m); ctx.lineTo(x, H - m - (big ? 7 : 3));
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(ink, 0.06); ctx.beginPath();
    ctx.moveTo(W / 2 - 14, H / 2); ctx.lineTo(W / 2 + 14, H / 2);
    ctx.moveTo(W / 2, H / 2 - 14); ctx.lineTo(W / 2, H / 2 + 14); ctx.stroke();
    ctx.restore();
  }

  /* ---------- 主入口 ---------- */
  function draw(ctx, s, t, direction, cue) {
    t = t || 0;
    CUR = buildCur(s, direction);
    if (!s) {
      drawIdle(ctx, t);
      drawPostFx(ctx, null, t);
      drawFrame(ctx, null, t);
      return;
    }
    ctx.save();
    drawBackground(ctx, t);
    if (s.free) drawFreeTiles(ctx, s, t);
    if (s.shake > 0 && !direction) {
      ctx.translate(Math.sin(t * 135) * s.shake * 0.5, Math.cos(t * 151) * s.shake * 0.5);
    }
    if (s.loop) drawLoopLanes(ctx, s, t);
    if (s.recall) drawRecallPaths(ctx, s, t);
    if (s.impact && s.impact.trial) drawTrialWarnings(ctx, s);
    drawWalls(ctx, s);
    if (s.free) drawFreePath(ctx, s, t);
    if (s.recall) drawRecallHubs(ctx, s, t);
    if (s.impact) drawImpactCorridor(ctx, s.impact);
    else if (!s.free) drawExit(ctx, s, t);
    drawParticles(ctx, s);
    drawTrail(ctx, s);
    if (s.impact) drawImpactTrails(ctx, s);
    s.enemies.forEach(function (e) { drawEnemy(ctx, e, t); });
    if (s.loop || s.free) drawBossShield(ctx, s, t);
    drawBullets(ctx, s);
    if (s.impact) drawImpactActions(ctx, s.impact);
    drawPlayer(ctx, s, t);
    if (s.free) drawFreeDodge(ctx, s, t);
    drawCombatGuide(ctx, s, cue === undefined ? C.ui.combatGuide.get(s) : cue);
    ctx.restore();

    /* 房间转场：从上往下扫过的薄色幕 */
    if (s.transition > 0) {
      var a = Math.min(1, s.transition / 0.45);
      ctx.fillStyle = P(s.room ? s.room.color_token : 'ink');
      ctx.globalAlpha = a * 0.16;
      ctx.fillRect(0, 0, W, H * (1 - a));
      ctx.globalAlpha = 1;
    }

    drawDamagePops(ctx, s);
    if (s.loop || s.free) drawClosure(ctx, s, t);
    if (s.loop || s.free) drawBreakBurst(ctx, s, t);
    if (s.bossPhase === 2) drawBossPhase(ctx, s, t);
    drawPostFx(ctx, s, t);
    drawFrame(ctx, s, t);
  }

  C.ui = C.ui || {};
  C.ui.render = { draw: draw, W: W, H: H };
})(window.Corridor = window.Corridor || {});
