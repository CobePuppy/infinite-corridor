/* Canvas 2D。夜光制图用于实玩，套印版本用于同帧对照。 */
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
  var NIGHT = {
    bg: '#101A25', field: '#223C4B', wall: '#254152', wallEdge: '#547582', wallShadow: '#080E15',
    grid: 'rgba(162,207,219,0.095)', outline: '#081019', flash: '#FBFCDA',
    player: '#E3FA79', playerInk: '#263B08', playerGlow: 'rgba(227,250,121,0.12)',
    bullet: '#F1FFB6', trail: '#DDFA73', crit: '#FFE196', enemyBullet: '#FF9381',
    rust: '#FF796A', flank: '#84B5FF', amber: '#FAC474', guide: '#62EFE2', fold: '#C3ACFF'
  };
  var PRINT = {
    bg: '#F4EAD5', field: '#E8DCC4', wall: '#B6B9A6', wallEdge: '#585E55', wallShadow: '#D1BD9B',
    grid: 'rgba(50,51,47,0.13)', outline: '#1E2C3C', flash: '#FFFFFF',
    player: '#FFF7D4', playerInk: '#1E2C3C', playerGlow: 'rgba(30,44,60,0.09)',
    bullet: '#22654D', trail: '#22654D', crit: '#88551B', enemyBullet: '#B82C22',
    rust: '#AB3023', flank: '#376C8B', amber: '#92571E', guide: '#17655D', fold: '#5B417A'
  };
  function buildCur(s, direction) {
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
    var paper = direction === 'print';
    var col = Object.assign({}, paper ? PRINT : NIGHT);
    if (!paper && valid !== 'geometry') {
      col.bg = mix(col.bg, pp.ink, 0.46);
      col.field = mix(col.field, pp.teal, 0.12);
      col.wall = mix(col.wall, pp.teal, 0.14);
    }
    col.violet = col.fold;
    col.teal = col.guide;
    pp.teal = col.guide;
    pp.rust = col.rust;
    pp.amber = col.amber;
    pp.violet = col.fold;
    return { id: valid, vis: vis, P: pp, col: col, paper: paper };
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

  /* 领域主题只改变空间质地和房名。角色、危险和操作提示使用固定的辨识规则。 */
  function drawBackground(ctx) {
    var col = CUR.col;
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, W, H);
    if (CUR.paper) {
      ctx.fillStyle = '#E8DCC4';
      ctx.fillRect(24, 206, W - 48, 188);
    } else {
      var light = ctx.createRadialGradient(500, 286, 10, 500, 286, 640);
      light.addColorStop(0, rgba(col.field, 0.82));
      light.addColorStop(1, rgba(col.field, 0));
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, W, H);
    }

    var tile = CUR.id === 'subject' ? 28 : 40;
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var y = 20; y < H; y += tile) {
      ctx.moveTo(18, y + 0.5);
      ctx.lineTo(W - 18, y + 0.5);
      if (CUR.id === 'oldtown') {
        for (var x = 26 + (y % (tile * 2) < tile ? 0 : 39); x < W - 20; x += 78) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, Math.min(y + tile, H - 18));
        }
      }
    }
    if (CUR.id !== 'oldtown') {
      for (var gx = 20; gx < W; gx += tile) {
        ctx.moveTo(gx + 0.5, 18);
        ctx.lineTo(gx + 0.5, H - 18);
      }
    }
    ctx.stroke();
    if (CUR.id === 'wudang') {
      ctx.strokeStyle = rgba(col.fold, 0.14);
      for (var k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(750, 516, 54 + k * 42, 15 + k * 18, -0.18, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawWalls(ctx, s) {
    var col = CUR.col;
    s.walls.forEach(function (q) {
      ctx.fillStyle = col.wallShadow;
      ctx.fillRect(q.x + 2, q.y + 4, q.w, q.h);
      ctx.fillStyle = col.wall;
      ctx.fillRect(q.x, q.y, q.w, q.h);
      ctx.strokeStyle = col.wallEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1);
      if (q.w < 22 || q.h < 22) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x + 1, q.y + 1, q.w - 2, q.h - 2);
      ctx.clip();
      ctx.strokeStyle = rgba(col.wallEdge, CUR.paper ? 0.32 : 0.35);
      ctx.beginPath();
      for (var dx = -q.h; dx <= q.w; dx += (CUR.paper ? 8 : 24)) {
        ctx.moveTo(q.x + dx, q.y + q.h - 3);
        ctx.lineTo(q.x + dx + q.h - 3, q.y + 3);
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawExit(ctx, s, t) {
    if (s.recall && s.roomIndex === s.run.rooms.length) return;
    var x = W - 74;
    var y = s.recall ? ((s.recall.layout || C.core.recall.DEFAULT).hub[1].y) : H / 2;
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
      ctx.fillText(s.recall ? '进入首领战' : '进入下一间', x, y + r + 18);
    } else {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(x, y, C.core.engine.EXIT_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* 回廊长局：把当前房间的三条廊道画成「未走」的地面状态。
   * 中心虚线表示可走路线，宽淡带表示廊道宽度；已走 / 回扫由 drawRecallPaths 叠加。
   * 没有这一步，玩家看不到折角与岔路，就无从判断该走短圈还是长圈。 */
  function drawLoopLanes(ctx, s) {
    var rec = s.recall;
    if (!rec || !rec.layout) return;
    var lanes = rec.layout.lanes;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Object.keys(lanes).forEach(function (id) {
      var pts = lanes[id].points;
      function stroke(width, style, dash) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.lineWidth = width; ctx.strokeStyle = style;
        if (dash && ctx.setLineDash) ctx.setLineDash(dash);
        ctx.stroke();
        if (dash && ctx.setLineDash) ctx.setLineDash([]);
      }
      stroke(20, rgba(CUR.col.teal, 0.06), null);
      stroke(1.5, rgba(CUR.col.teal, 0.30), [4, 9]);
    });
    ctx.restore();
  }

  function drawRecallPaths(ctx, recall) {
    var rules = C.core.recall;
    var color = CUR.col.teal;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(color, 0.75);
    ctx.lineWidth = 2.5;
    rules.trace(recall).forEach(function (points) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    });
    if (recall.wave) {
      var wave = recall.wave;
      ctx.strokeStyle = rgba(color, 0.45);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(wave.parts[0].a.x, wave.parts[0].a.y);
      wave.parts.forEach(function (part) { ctx.lineTo(part.b.x, part.b.y); });
      ctx.stroke();
      var sections = rules.waveSections(wave, wave.position - 95, wave.position);
      sections.forEach(function (part) {
        ctx.beginPath();
        ctx.moveTo(part.a.x, part.a.y);
        ctx.lineTo(part.b.x, part.b.y);
        ctx.strokeStyle = rgba(color, 0.15);
        ctx.lineWidth = part.radius * 2;
        ctx.stroke();
        ctx.strokeStyle = shade(color, 0.45);
        ctx.lineWidth = 5;
        ctx.stroke();
      });
      if (sections.length) {
        var tip = sections[sections.length - 1].b;
        ctx.fillStyle = shade(color, 0.85);
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawRecallHubs(ctx, s, t) {
    var r = s.recall;
    var boss = s.enemies.find(function (e) { return e.patrol; });
    var hubs = (r.layout && r.layout.hub) || C.core.recall.hub;
    ctx.save();
    hubs.forEach(function (p, i) {
      var marked = r.origin === i;
      var available = r.origin == null && !r.wave;
      var w = marked ? 25 + 2 * Math.sin(t * 5) : 19;
      ctx.strokeStyle = rgba(CUR.col.teal, marked ? 0.95 : available ? 0.65 : 0.25);
      ctx.fillStyle = rgba(CUR.col.teal, marked ? 0.16 : 0.05);
      ctx.lineWidth = marked ? 2 : 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, w, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (marked) {
        ctx.fillStyle = shade(CUR.col.teal, 0.35);
        ctx.font = '500 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('起点', p.x, p.y - 33);
      }
    });
    if (boss && boss.patrol.warning > 0) {
      var patrol = boss.patrol;
      var points = patrol.route.points;
      var a = hubs[patrol.hub], b = points[patrol.hub === 0 ? 1 : points.length - 2];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.translate(a.x, a.y);
      ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      ctx.strokeStyle = rgba(CUR.col.amber, 0.8 + 0.2 * Math.sin(t * 16));
      ctx.lineWidth = 4;
      for (var d = 42; d < Math.min(len, 105); d += 22) {
        ctx.beginPath(); ctx.moveTo(d - 9, -10); ctx.lineTo(d, 0); ctx.lineTo(d - 9, 10); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawImpactCorridor(ctx, impact) {
    if (impact.trial) {
      var rail = C.core.enemyTrial.walls[0];
      ctx.save();
      ctx.strokeStyle = rgba(CUR.col.violet, 0.58);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rail.x + 8, rail.y + rail.h);
      ctx.lineTo(rail.x + rail.w - 8, rail.y + rail.h); ctx.stroke();
      ctx.restore();
      return;
    }
    var wall = C.core.impact.reflector;
    ctx.save();
    ctx.strokeStyle = rgba(CUR.col.player, 0.20);
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 15]);
    ctx.beginPath(); ctx.moveTo(102, 300); ctx.lineTo(wall.x, 300); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = rgba(CUR.col.amber, 0.85);
    ctx.lineWidth = 2;
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
    ctx.save();
    ctx.lineCap = 'round';
    s.enemies.forEach(function (e) {
      var brain = e.brain, a = brain.attack;
      if (!a) return;
      var wind = brain.state === 'wind';
      var color = a.kind === 'charge' ? CUR.col.rust :
        (a.kind === 'press' ? CUR.col.amber : CUR.col.flank);
      ctx.strokeStyle = color;
      if (a.fan) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        a.fan.forEach(function (p) { ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        ctx.fillStyle = rgba(color, wind ? 0.19 : 0.31);
        ctx.fill();
        ctx.lineWidth = 2.1 * stroke;
        ctx.stroke();
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
          ctx.lineWidth = 1.05 * stroke;
          ctx.stroke();
          ctx.lineWidth = 3 * stroke;
          if (wind) ctx.setLineDash([10, 6]);
        }
        impactArrow(ctx, a.x, a.y, Math.atan2(a.dy, a.dx), a.travel);
        ctx.setLineDash([]);
      }
    });
    ctx.restore();
  }

  function trialLabel(ctx, text, x, y, color) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 16px "Microsoft YaHei", system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = CUR.col.bg;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
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
    ctx.strokeStyle = guide;
    ctx.lineWidth = (cue.ready ? 3 : 2.5) * stroke;
    ctx.beginPath();
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function (corner) {
      var dx = corner[0], dy = corner[1];
      ctx.moveTo(dx * (r - 7), dy * r); ctx.lineTo(dx * r, dy * r);
      ctx.lineTo(dx * r, dy * (r - 7));
    });
    ctx.stroke();
    if (!cue.ready) {
      ctx.fillStyle = guide;
      path(ctx, [[0, -3], [3, 0], [0, 3], [-3, 0]]);
      ctx.fill();
    }
    ctx.restore();
    if (cue.ready) return;
    var dx = cue.next.x - p.x, dy = cue.next.y - p.y;
    var gap = Math.hypot(dx, dy);
    ctx.save();
    ctx.strokeStyle = guide;
    ctx.lineWidth = 2.2 * stroke;
    if (gap >= 25) {
      ctx.setLineDash([7, 5]);
      impactArrow(ctx, p.x + dx / gap * 17, p.y + dy / gap * 17,
        Math.atan2(dy, dx), Math.max(8, Math.min(86, gap - 25)));
    }
    ctx.setLineDash([2, 6]);
    var len = Math.hypot(e.x - spot.x, e.y - spot.y);
    if (len > e.r + 20) {
      ctx.globalAlpha = 0.58;
      impactArrow(ctx, spot.x + (e.x - spot.x) / len * 17, spot.y + (e.y - spot.y) / len * 17,
        Math.atan2(e.y - spot.y, e.x - spot.x), len - e.r - 19);
    }
    ctx.restore();
  }

  function drawImpactTrails(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    s.enemies.forEach(function (e) {
      if (!e.flight) {
        if (e.charger && (e.mode === 'wind' || e.mode === 'charge')) {
          ctx.strokeStyle = CUR.col.rust;
          ctx.lineWidth = 2.5;
          ctx.setLineDash(e.mode === 'wind' ? [6, 5] : []);
          impactArrow(ctx, e.x + e.lockX * 18, e.y + e.lockY * 18, Math.atan2(e.lockY, e.lockX), 53);
          ctx.setLineDash([]);
        }
        return;
      }
      var x = e.x - e.vx * 0.084, y = e.y - e.vy * 0.084;
      var effect = e.flight.effect;
      var col = e.hp === 0 ? CUR.col.rust : (effect ? impactColor(effect.kind) : CUR.col.amber);
      var trail = ctx.createLinearGradient(x, y, e.x, e.y);
      trail.addColorStop(0, rgba(col, 0));
      trail.addColorStop(1, rgba(col, 0.82));
      ctx.strokeStyle = trail;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
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
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
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
      ctx.strokeStyle = CUR.col.player;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sw.x, sw.y);
      ctx.arc(sw.x, sw.y, w.range, sw.angle - w.halfArc, sw.angle + w.halfArc);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (g.shot && g.shot.life > 0) {
      var points = g.shot.points;
      ctx.globalAlpha = g.shot.life / g.shot.max;
      ctx.lineCap = 'round';
      ctx.strokeStyle = CUR.col.bullet;
      ctx.lineWidth = 3;
      for (var i = 1; i < points.length; i++) {
        if (i === 2) ctx.strokeStyle = CUR.col.amber;
        ctx.beginPath(); ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y); ctx.stroke();
      }
    }
    g.marks.forEach(function (m) {
      var ratio = m.life / m.max;
      var color = impactColor(m.kind);
      ctx.globalAlpha = ratio;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(m.x, m.y, 7 + (1 - ratio) * 27, 0, Math.PI * 2); ctx.stroke();
      if (g.trial && (m.kind === 'fold' || m.kind === 'borrow')) {
        trialLabel(ctx, m.kind === 'fold' ? '折冲' : '借冲锋', m.x, m.y + 34, color);
      }
      if (m.kind === 'relay' && !g.combinations) {
        ctx.fillStyle = color;
        ctx.font = '700 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
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
    var col = CUR.col;
    if (e.isBoss || e.shape === 'charge') return col.rust;
    if (e.shape === 'orbit') return col.flank;
    if (e.shape === 'ranged') return col.fold;
    return col.amber;
  }

  function path(ctx, vertices) {
    ctx.beginPath();
    vertices.forEach(function (point, i) {
      if (i) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
    });
    ctx.closePath();
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
    var r = e.r;
    var shape = e.isBoss ? 'boss' : e.shape;
    if (shape === 'charge') {
      var locked = (e.brain && e.brain.attack) || (e.charger && e.mode === 'wind');
      ctx.rotate(locked ? Math.atan2(e.lockY, e.lockX) : Math.atan2(e.vy, e.vx));
    } else if (e.turret) ctx.rotate(e.angle);
    ctx.lineJoin = 'round';
    silhouette(ctx, shape, r + 2);
    ctx.fillStyle = CUR.col.outline;
    ctx.fill();
    silhouette(ctx, shape, r);
    ctx.fillStyle = e.flash > 0 ? CUR.col.flash : (CUR.paper ? shade(color, 0.18) : shade(color, -0.62));
    ctx.fill();
    ctx.lineWidth = CUR.paper ? 2.4 : 1.9;
    ctx.strokeStyle = CUR.paper ? CUR.col.outline : color;
    ctx.stroke();

    ctx.fillStyle = CUR.paper ? CUR.col.outline : color;
    if (shape === 'charge') {
      path(ctx, [[r * 0.55, 0], [-r * 0.56, -r * 0.29], [-r * 0.35, 0], [-r * 0.56, r * 0.29]]);
      ctx.fill();
    } else if (shape === 'orbit') {
      polygon(ctx, 0, 0, r * 0.38, 4, 0);
      ctx.fill();
      ctx.fillRect(-r * 0.83, -1, r * 0.25, 2);
      ctx.fillRect(r * 0.58, -1, r * 0.25, 2);
    } else if (e.turret) {
      ctx.fillRect(-r * 0.40, -3, r * 1.48, 6);
    } else if (shape === 'ranged') {
      ctx.fillRect(-r * 0.63, -1, r * 1.26, 2);
      ctx.fillRect(-1, -r * 0.63, 2, r * 1.26);
    } else {
      ctx.fillRect(-r * 0.54, -r * 0.2, r * 0.38, r * 0.4);
      ctx.fillRect(r * 0.16, -r * 0.2, r * 0.38, r * 0.4);
    }
  }

  function drawEnemy(ctx, e) {
    var color = enemyColor(e);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = rgba(CUR.col.outline, CUR.paper ? 0.24 : 0.72);
    ctx.beginPath(); ctx.ellipse(1.5, e.r * 0.72, e.r * 1.06, e.r * 0.58, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    enemyGlyph(ctx, e, color);
    ctx.restore();
    if (e.patrol) {
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = e.guardOpen > 0 ? CUR.col.crit : CUR.col.fold;
      ctx.setLineDash(e.guardOpen > 0 ? [7, 5] : [14, 5]);
      ctx.beginPath(); ctx.arc(0, 0, e.r + 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    var width = e.isBoss ? 85 : 30;
    var ratio = Math.max(0, e.hp / e.maxHp), y = e.y - e.r - 8;
    ctx.fillStyle = CUR.col.outline;
    ctx.fillRect(e.x - width / 2 - 1, y - 1, width + 2, 5);
    ctx.fillStyle = rgba(color, 0.25);
    ctx.fillRect(e.x - width / 2, y, width, 3);
    ctx.fillStyle = color;
    ctx.fillRect(e.x - width / 2, y, width * ratio, 3);
  }

  function playerGlyph(ctx, r, weapon) {
    var col = CUR.col;
    ctx.strokeStyle = col.outline;
    ctx.fillStyle = col.player;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = col.player;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col.playerInk;
    path(ctx, [[-4, -5], [5, 0], [-4, 5], [-1, 0]]);
    ctx.fill();
    ctx.fillStyle = col.player;
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = 1.6;
    if (weapon === 'blade') path(ctx, [[r + 2, 6], [r + 12, -12], [r + 13, -3], [r + 7, 7]]);
    else rr(ctx, r - 2, -4, r + 10, 8, 2);
    ctx.fill(); ctx.stroke();
  }

  function drawPlayer(ctx, s, t) {
    var p = s.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.invuln > 0 && Math.floor(t * 18) % 2 === 0 && p.dashTime <= 0) ctx.globalAlpha = 0.43;
    ctx.fillStyle = CUR.col.playerGlow;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(p.angle);
    playerGlyph(ctx, p.r, s.impact && s.impact.weapon);
    ctx.restore();
  }

  /* 首页的程序化预览只作取景，不构造额外关卡状态。 */
  function drawIdle(ctx, t) {
    drawBackground(ctx);
    var col = CUR.col, cx = 728, cy = 282;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.15);
    for (var i = 0; i < 4; i++) {
      var box = 134 + 36 * i, gap = 15 + 6 * i;
      ctx.strokeStyle = rgba(col.guide, 0.37 - i * 0.055);
      ctx.lineWidth = i === 0 ? 3 : 1;
      ctx.beginPath(); ctx.moveTo(-box, gap); ctx.lineTo(-box, -box + 35);
      ctx.lineTo(-box + 35, -box); ctx.lineTo(box - 36, -box);
      ctx.moveTo(box, -gap); ctx.lineTo(box, box - 36);
      ctx.lineTo(box - 36, box); ctx.lineTo(-box + 36, box); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = rgba(col.guide, 0.60);
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    ctx.beginPath(); ctx.moveTo(586, 393); ctx.lineTo(716, 128); ctx.lineTo(861, 295); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(col.rust, 0.14);
    path(ctx, [[808, 342], [913, 253], [948, 297], [845, 387]]);
    ctx.fill();
    ctx.save(); ctx.translate(618, 376); ctx.rotate(-0.85); playerGlyph(ctx, 28, 'blade'); ctx.restore();
    ctx.save(); ctx.translate(782, 211 + Math.sin(t * 1.2) * 4);
    enemyGlyph(ctx, { r: 28, shape: 'orbit' }, col.flank); ctx.restore();
    ctx.save(); ctx.translate(858, 319); ctx.rotate(-0.7);
    enemyGlyph(ctx, { r: 29, shape: 'charge', vx: 1, vy: 0 }, col.rust); ctx.restore();
    ctx.strokeStyle = col.guide;
    ctx.beginPath(); ctx.arc(716, 128, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
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
  function drawBossPhase(ctx, s, t) {
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
  /* ---------- 主入口 ---------- */
  function draw(ctx, s, t, direction, cue) {
    t = t || 0;
    CUR = buildCur(s, direction);
    if (!s) { drawIdle(ctx, t); return; }
    ctx.save();
    drawBackground(ctx);
    if (s.shake > 0 && !direction) {
      ctx.translate(Math.sin(t * 135) * s.shake * 0.5, Math.cos(t * 151) * s.shake * 0.5);
    }
    if (s.loop) drawLoopLanes(ctx, s);
    if (s.recall) drawRecallPaths(ctx, s.recall);
    if (s.impact && s.impact.trial) drawTrialWarnings(ctx, s);
    drawWalls(ctx, s);
    if (s.recall) drawRecallHubs(ctx, s, t);
    if (s.impact) drawImpactCorridor(ctx, s.impact);
    else drawExit(ctx, s, t);
    drawParticles(ctx, s);
    drawTrail(ctx, s);
    if (s.impact) drawImpactTrails(ctx, s);
    s.enemies.forEach(function (e) { drawEnemy(ctx, e, t); });
    drawBullets(ctx, s);
    if (s.impact) drawImpactActions(ctx, s.impact);
    drawPlayer(ctx, s, t);
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
    if (s.bossPhase === 2) drawBossPhase(ctx, s, t);
  }

  C.ui = C.ui || {};
  C.ui.render = { draw: draw, W: W, H: H };
})(window.Corridor = window.Corridor || {});
