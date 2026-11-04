// 合成音效（M5 首批 16 个）：振荡器/噪声短音，零素材。
// 与 cries/bgm 共享 AudioContext（手势解锁后生效）；M 键静音与 BGM 联动（setMuted）。
export function createSfx({ ensureCtx } = {}) {
  let ctx = null, master = null, muted = false;
  let lastPlay = {};                       // 节流：同类音效最小间隔（防帧内重复炸耳）

  function ensure() {
    if (!ctx) {
      ctx = ensureCtx ? ensureCtx() : new (window.AudioContext || window.webkitAudioContext)();
      if (!ctx) return null;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') { ctx.resume(); return null; }
    return ctx;
  }

  // 基元：单音（type/f0→f1 扫频 + 包络）
  function tone({ type = 'square', f0 = 440, f1 = null, dur = 0.09, vol = 0.2, delay = 0, slide = 'exp' }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 != null) {
      if (slide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 基元：噪声（滤波打击）
  function noise({ dur = 0.12, vol = 0.2, freq = 2000, q = 1, type = 'bandpass', delay = 0 }) {
    const t = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  // 音效配方（名称 → 合成序列）
  const RECIPES = {
    shot:     () => tone({ type: 'square', f0: 880, f1: 320, dur: 0.05, vol: 0.05 }),
    hit:      () => { tone({ type: 'triangle', f0: 520, f1: 190, dur: 0.07, vol: 0.16 }); noise({ dur: 0.05, vol: 0.10, freq: 3200 }); },
    superhit: () => { tone({ type: 'sawtooth', f0: 720, f1: 240, dur: 0.12, vol: 0.2 }); tone({ type: 'square', f0: 1320, f1: 660, dur: 0.10, vol: 0.10, delay: 0.02 }); },
    hurt:     () => { tone({ type: 'sawtooth', f0: 300, f1: 90, dur: 0.22, vol: 0.26 }); noise({ dur: 0.16, vol: 0.16, freq: 700, type: 'lowpass' }); },
    dodge:    () => tone({ type: 'sine', f0: 990, f1: 1480, dur: 0.08, vol: 0.10 }),
    kill:     () => { noise({ dur: 0.14, vol: 0.18, freq: 1400, q: 0.7 }); tone({ type: 'triangle', f0: 640, f1: 110, dur: 0.14, vol: 0.15 }); },
    coin:     () => { tone({ type: 'square', f0: 1180, dur: 0.05, vol: 0.10 }); tone({ type: 'square', f0: 1760, dur: 0.10, vol: 0.10, delay: 0.05 }); },
    heart:    () => { tone({ type: 'sine', f0: 660, dur: 0.09, vol: 0.16 }); tone({ type: 'sine', f0: 880, dur: 0.12, vol: 0.16, delay: 0.08 }); },
    item:     () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.09, vol: 0.13, delay: i * 0.06 })),
    tm:       () => [392, 523, 784].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.08, vol: 0.10, delay: i * 0.05 })),
    door:     () => { tone({ type: 'sine', f0: 220, f1: 440, dur: 0.18, vol: 0.16 }); noise({ dur: 0.10, vol: 0.06, freq: 500, type: 'lowpass' }); },
    dash:     () => noise({ dur: 0.12, vol: 0.14, freq: 2600, q: 0.6 }),
    zmove:    () => { tone({ type: 'sawtooth', f0: 160, f1: 60, dur: 0.5, vol: 0.26 }); tone({ type: 'square', f0: 640, f1: 1600, dur: 0.35, vol: 0.12, delay: 0.05 }); noise({ dur: 0.4, vol: 0.18, freq: 1800, delay: 0.05 }); },
    evolve:   () => [523, 587, 659, 784, 880, 1047, 1319].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.14, vol: 0.12, delay: i * 0.08 })),
    bossIntro:() => { tone({ type: 'sawtooth', f0: 110, f1: 82, dur: 0.6, vol: 0.24 }); tone({ type: 'sawtooth', f0: 165, f1: 123, dur: 0.6, vol: 0.14, delay: 0.02 }); },
    achv:     () => { tone({ type: 'triangle', f0: 880, dur: 0.08, vol: 0.15 }); tone({ type: 'triangle', f0: 1175, dur: 0.14, vol: 0.15, delay: 0.07 }); },
    death:    () => [440, 349, 262, 175].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.16, delay: i * 0.18 })),
    win:      () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.16, vol: 0.10, delay: i * 0.13 })),
  };
  // 节流表（ms）：高频事件不逐发
  const THROTTLE = { shot: 55, hit: 45, superhit: 60, coin: 40, kill: 60 };

  return {
    play(name) {
      const r = RECIPES[name];
      if (!r) return false;
      const now = ctx ? ctx.currentTime : 0;
      const min = THROTTLE[name] || 0;
      if (min && now - (lastPlay[name] || -9) < min / 1000) return false;
      if (!ensure()) return false;
      lastPlay[name] = ctx.currentTime;
      try { r(); } catch (e) { /* 音频失败静默 */ }
      return true;
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    get muted() { return muted; },
  };
}
