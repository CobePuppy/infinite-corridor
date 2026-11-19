/* core/chrono.js — M11 统一时间轴：影子历史 / 凝滞 / 完美闪避 / 连段等级
 * 纯规则层，不依赖 DOM、主题、音频。数值只从 perks.js 的 BALANCE.chrono 读。
 *
 * 设计要点（用户口径 ①②④）：
 * - 玩家永远用真实 dt，只有「世界」（敌人 / 飞行物 / 子弹）吃 worldScale，
 *   所以这是「斯安维斯坦」而不是全局慢放；
 * - 影子历史按真实 elapsed 采样，与凝滞解耦，时停期间仍能读到 0.3s 前的玩家；
 * - 冲锋进入 wind 时开完美闪避窗口，窗口按真实时间递减，避免与缩放时间轴打架。
 */
(function (C) {
  'use strict';

  function B() { return C.core.perks.BALANCE.chrono; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function create() {
    return { hist: [], stall: 0, scale: 1, perfect: null, buff: null, tier: 0 };
  }

  /* 玩家位置环形缓冲。凝滞不改写采样时间轴，影子读的是真实过去。 */
  function push(c, t, p) {
    c.hist.push({ t: t, x: p.x, y: p.y });
    var cut = t - B().historyWindow;
    while (c.hist.length > 2 && c.hist[0].t < cut) c.hist.shift();
  }

  function sample(c, t, delay) {
    var want = t - (delay == null ? B().shadowDelay : delay);
    var h = c.hist;
    if (!h.length) return null;
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= want) {
        var a = h[i], b = h[Math.min(i + 1, h.length - 1)];
        var span = b.t - a.t;
        var k = span > 0 ? clamp((want - a.t) / span, 0, 1) : 0;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: h[0].x, y: h[0].y };
  }

  /* Boss 延迟减半（0.15s），普通小怪 0.3s。 */
  function shadow(c, t, isBoss) {
    return sample(c, t, isBoss ? B().shadowBossDelay : B().shadowDelay);
  }

  /* 命中 / 击飞瞬间触发凝滞：世界 0.30 倍速、持续 0.35s，玩家全速。 */
  function stall(c) {
    c.stall = B().stallTime;
    c.scale = B().stallScale;
  }
  function worldScale(c) { return c.stall > 0 ? c.scale : 1; }

  function armPerfect(c) { c.perfect = { t: B().perfectWindow }; }
  function perfectActive(c) { return !!(c.perfect && c.perfect.t > 0); }

  /* 完美闪避给全额 buff，一般闪避给半额且时长减半；两者都给（用户口径）。 */
  function resolveDodge(c, dashed, perks) {
    if (!dashed) return null;
    var q = B(), perfect = perfectActive(c);
    c.perfect = null;
    var extra = perks && perks.p_loop_dodge ? 0.8 * perks.p_loop_dodge : 0;
    c.buff = perfect
      ? { kind: 'perfect', t: q.perfectBuffTime + extra,
          damage: q.perfectDamage, cd: q.perfectCdCut }
      : { kind: 'normal', t: q.normalBuffTime + extra * 0.5,
          damage: q.normalDamage, cd: q.normalCdCut };
    return c.buff;
  }
  function buffDamage(c) { return c.buff ? c.buff.damage : 1; }
  function buffCd(c) { return c.buff ? c.buff.cd : 0; }

  function tier(combo) {
    var t = B().comboTiers, n = 0;
    for (var i = 0; i < t.length; i++) if (combo >= t[i]) n = i + 1;
    return n;
  }

  function update(c, dt) {
    c.stall = Math.max(0, c.stall - dt);
    if (c.stall === 0) c.scale = 1;
    if (c.perfect) { c.perfect.t -= dt; if (c.perfect.t <= 0) c.perfect = null; }
    if (c.buff) { c.buff.t -= dt; if (c.buff.t <= 0) c.buff = null; }
  }

  C.core = C.core || {};
  C.core.chrono = {
    create: create, push: push, sample: sample, shadow: shadow,
    stall: stall, worldScale: worldScale,
    armPerfect: armPerfect, perfectActive: perfectActive, resolveDodge: resolveDodge,
    buffDamage: buffDamage, buffCd: buffCd, tier: tier, update: update
  };
})(window.Corridor = window.Corridor || {});
