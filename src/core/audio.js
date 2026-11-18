/* core/audio.js — 程序化音效，零音频资源
 * WebAudio 合成：所有音色由振荡器 + 包络实时生成，不加载任何文件。
 * 必须由用户手势触发 resume()，否则浏览器会挂起 AudioContext。
 */
(function (C) {
  'use strict';

  var ctx = null;
  var muted = false;
  var master = null;

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function tone(opts) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.08;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from || 440, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.5, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    var gain = c.createGain();
    gain.gain.value = vol || 0.35;
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start();
  }

  var SFX = {
    ui:     function () { tone({ from: 520, to: 700, dur: 0.05, type: 'triangle', vol: 0.25 }); },
    shoot:  function () { tone({ from: 760, to: 320, dur: 0.09, type: 'square', vol: 0.18 }); },
    dash:   function () { noise(0.14, 0.18, 900); tone({ from: 240, to: 620, dur: 0.12, type: 'sawtooth', vol: 0.16 }); },
    hit:    function () { noise(0.06, 0.22, 2200); tone({ from: 180, to: 90, dur: 0.07, type: 'square', vol: 0.2 }); },
    hurt:   function () { tone({ from: 220, to: 70, dur: 0.22, type: 'sawtooth', vol: 0.4 }); noise(0.12, 0.2, 600); },
    kill:   function () { tone({ from: 420, to: 880, dur: 0.1, type: 'triangle', vol: 0.28 }); },
    pick:   function () { tone({ from: 620, dur: 0.09, type: 'sine', vol: 0.3 }); tone({ from: 930, dur: 0.13, type: 'sine', vol: 0.25, delay: 0.07 }); },
    recall: function () { tone({ from: 660, to: 220, dur: 0.42, type: 'triangle', vol: 0.28 }); },
    clear:  function () { [523, 659, 784].forEach(function (f, i) { tone({ from: f, dur: 0.16, type: 'triangle', vol: 0.26, delay: i * 0.075 }); }); },
    boss:   function () { tone({ from: 90, to: 55, dur: 0.6, type: 'sawtooth', vol: 0.4 }); noise(0.4, 0.2, 400); },
    death:  function () { tone({ from: 300, to: 45, dur: 0.8, type: 'sawtooth', vol: 0.42 }); },
    start:  function () { [392, 523, 659, 880].forEach(function (f, i) { tone({ from: f, dur: 0.2, type: 'triangle', vol: 0.24, delay: i * 0.09 }); }); }
  };

  function play(name) { if (SFX[name]) SFX[name](); }
  function setMuted(v) { muted = !!v; }
  function isMuted() { return muted; }

  C.core = C.core || {};
  C.core.audio = { resume: resume, play: play, setMuted: setMuted, isMuted: isMuted };
})(window.Corridor = window.Corridor || {});
