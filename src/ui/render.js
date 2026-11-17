/* ui/render.js — Canvas 2D 渲染：纯程序化色块与符号，零美术资源
 * 房间主色由 color_token 决定；敌人形状由 pattern 决定；特效由规则引擎的状态驱动。
 */
(function (C) {
  'use strict';

  var W = 960, H = 600;
  var BG = '#0B0E15';

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

  function drawBackground(ctx, s, t) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    var accent = C.theme.color(s.room ? s.room.color_token : 'ink');

    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    for (var x = 48; x < W; x += 48) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    for (var y = 48; y < H; y += 48) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }

    ctx.globalAlpha = 0.055;
    ctx.fillStyle = accent;
    ctx.fillRect(W - 250, 0, 250, 250);
    ctx.beginPath(); ctx.arc(90, H - 60, 170, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(24.5, 24.5, W - 49, H - 49);
    ctx.globalAlpha = 1;

    var pulse = 0.05 + 0.025 * Math.sin(t * 1.2);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawWalls(ctx, s) {
    var accent = C.theme.color(s.room.color_token);
    s.walls.forEach(function (q) {
      ctx.fillStyle = '#1A2030';
      rr(ctx, q.x, q.y, q.w, q.h, 5);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      rr(ctx, q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawExit(ctx, s, t) {
    var x = W - 74, y = H / 2;
    var accent = C.theme.color(s.room ? s.room.color_token : 'teal');
    ctx.save();
    if (s.exitActive) {
      var r = C.core.engine.EXIT_R;
      ctx.strokeStyle = '#39C6A5';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.65 + 0.25 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(57,198,165,0.10)';
      ctx.beginPath(); ctx.arc(x, y, r - 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#39C6A5';
      ctx.font = '500 22px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('→', x, y + 1);
      ctx.font = '400 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('进入下一间', x, y + r + 18);
    } else {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(x, y, C.core.engine.EXIT_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawParticles(ctx, s) {
    s.particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawTrail(ctx, s) {
    s.trail.forEach(function (p) {
      ctx.globalAlpha = (p.life / p.max) * 0.35;
      ctx.fillStyle = '#39C6A5';
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawBullets(ctx, s) {
    s.bullets.forEach(function (b) {
      var tailX = b.x - b.vx * 0.022, tailY = b.y - b.vy * 0.022;
      ctx.strokeStyle = b.crit ? '#E9A23B' : '#8FF0D5';
      ctx.lineWidth = b.crit ? 4 : 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = b.crit ? '#E9A23B' : '#8FF0D5';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
    });
    s.enemyBullets.forEach(function (b) {
      ctx.fillStyle = '#B9A9FF';
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function drawEnemy(ctx, e, t) {
    var color = e.flash > 0 ? '#FFFFFF' : e.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;

    if (e.shape === 'chase') {
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 6, 0, Math.PI * 2); ctx.stroke();
    } else if (e.shape === 'orbit') {
      ctx.rotate(t * 1.6);
      ctx.beginPath();
      ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 7, 0, Math.PI * 2); ctx.stroke();
    } else if (e.shape === 'charge') {
      var a = Math.atan2(e.vy, e.vx);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(e.r + 4, 0); ctx.lineTo(-e.r, -e.r * 0.8); ctx.lineTo(-e.r, e.r * 0.8);
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
      ctx.globalAlpha = 0.3;
      polygon(ctx, 0, 0, e.r + 7, 6, t * 0.25); ctx.stroke();
    } else { /* boss */
      polygon(ctx, 0, 0, e.r, 8, t * 0.35); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      polygon(ctx, 0, 0, e.r + 12, 8, -t * 0.22); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = BG;
      polygon(ctx, 0, 0, e.r * 0.45, 4, t * 0.7); ctx.fill();
    }
    ctx.restore();

    /* 血条 */
    var bw = e.isBoss ? 90 : 34;
    var ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw, 3);
    ctx.fillStyle = e.isBoss ? '#D9644B' : '#E9A23B';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw * ratio, 3);
  }

  function drawPlayer(ctx, s, t) {
    var p = s.player;
    if (p.invuln > 0 && Math.floor(t * 18) % 2 === 0 && p.dashTime <= 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);

    if (p.dashTime > 0) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#39C6A5';
      ctx.beginPath(); ctx.arc(-p.dashX * 18, -p.dashY * 18, p.r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(57,198,165,0.14)';
    ctx.beginPath(); ctx.arc(0, 0, p.r + 9, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#39C6A5';
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BG;
    ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(p.angle);
    ctx.fillStyle = '#8FF0D5';
    ctx.beginPath();
    ctx.moveTo(p.r + 11, 0); ctx.lineTo(p.r + 2, -5); ctx.lineTo(p.r + 2, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawIdle(ctx, t) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    for (var x = 48; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (var y = 48; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = '#39C6A5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 110, H / 2);
    ctx.bezierCurveTo(W / 2 - 110, H / 2 - 62, W / 2 - 24, H / 2 - 62, W / 2, H / 2);
    ctx.bezierCurveTo(W / 2 + 24, H / 2 + 62, W / 2 + 110, H / 2 + 62, W / 2 + 110, H / 2);
    ctx.bezierCurveTo(W / 2 + 110, H / 2 - 62, W / 2 + 24, H / 2 - 62, W / 2, H / 2);
    ctx.bezierCurveTo(W / 2 - 24, H / 2 + 62, W / 2 - 110, H / 2 + 62, W / 2 - 110, H / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function draw(ctx, s, t) {
    if (!s) { drawIdle(ctx, t || 0); return; }
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
      ctx.fillStyle = C.theme.color(s.room ? s.room.color_token : 'ink');
      ctx.globalAlpha = a * 0.16;
      ctx.fillRect(0, 0, W, H * (1 - a));
      ctx.globalAlpha = 1;
    }
  }

  C.ui = C.ui || {};
  C.ui.render = { draw: draw, W: W, H: H };
})(window.Corridor = window.Corridor || {});
