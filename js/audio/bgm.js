// 以撒式分层 BGM（WebAudio 程序化，零素材）：
//   探索层=和弦垫+低音持续音（常驻）  战斗层=低音八分脉冲+十六分琶音（房内有敌渐入）
//   Boss 层=提速 ×1.22 + 噪声打击 + 琶音升八度（Boss 房渐入）
// 三层楼层主题：洞窟（A 小调·暗）/ 发电厂（E 小调·电流感）/ 遗迹（D 小调·钟磬）。
// 全部调度走 lookahead 定时器（40ms tick / 0.18s 提前量），层增益 setTargetAtTime 平滑过渡。
export function createBgm({ ensureCtx, onLog } = {}) {
  let ctx = null, master = null, padGain = null, combatGain = null, bossGain = null;
  let noiseBuf = null, delay = null;
  let timer = null, step = 0, nextT = 0;
  let started = false, pending = false;
  let muted = false;
  try { muted = localStorage.getItem('depths-bgm-muted') === '1'; } catch (e) { /* ignore */ }
  let scene = { floorNo: 1, combat: false, boss: false, roomType: null };

  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // 和弦进行（midi 音高，四和弦 ×2 小节一轮）
  const THEMES = {
    1: { bpm: 76, wave: 'sawtooth', cutoff: 750,
      prog: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],      // Am F C G
      motif: [57, 60, 62, 64, 67, 69, 72] },                                // A 小五声
    2: { bpm: 100, wave: 'square', cutoff: 1200,
      prog: [[52, 55, 59], [55, 60, 64], [50, 54, 57], [55, 59, 62]],      // Em C D G
      motif: [52, 55, 57, 59, 62, 64, 67] },                                // E 小五声
    3: { bpm: 84, wave: 'triangle', cutoff: 900,
      prog: [[50, 53, 57], [53, 58, 62], [53, 57, 60], [57, 61, 64]],      // Dm Bb F A(和声小调V)
      motif: [50, 53, 57, 60, 62, 65, 69] },                                // D 多利安
    4: { bpm: 64, wave: 'sine', cutoff: 2400,                               // 晶核之间：空灵梦幻
      prog: [[56, 59, 63], [52, 56, 59], [47, 51, 54], [54, 57, 61]],      // G#m E B F#
      motif: [68, 71, 73, 75, 78, 80, 83] },                                // 高八度泛音感
  };
  // 房间变奏（覆盖楼层主题）：黑市=阴冷小二度 / 祭坛=钟磬圣咏
  const ROOM_THEMES = {
    blackmarket: { bpm: 60, wave: 'square', cutoff: 520,
      prog: [[50, 53, 57], [51, 54, 58], [50, 53, 57], [49, 53, 56]],      // Dm Eb(m) Dm Cm——b2 阴影
      motif: [50, 51, 53, 56, 57, 58] },
    altar: { bpm: 58, wave: 'sine', cutoff: 1600,
      prog: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]],      // C G Am F
      motif: [72, 76, 79, 81, 84] },                                        // 高音钟磬
  };
  const theme = () => (scene.roomType && ROOM_THEMES[scene.roomType])
    || THEMES[scene.floorNo] || THEMES[1];
  const bpm = () => theme().bpm * (scene.boss ? 1.22 : 1);

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.42;
    master.connect(ctx.destination);
    padGain = ctx.createGain(); padGain.gain.value = 0.36; padGain.connect(master);
    combatGain = ctx.createGain(); combatGain.gain.value = 0; combatGain.connect(master);
    bossGain = ctx.createGain(); bossGain.gain.value = 0; bossGain.connect(master);
    // 稀疏动机的空间感：短延迟反馈
    delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    delay.connect(fb).connect(delay);
    delay.connect(master);
    // 噪声源（Boss 打击乐）
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0.0001, t + a, d / 3);
  }

  function osc(type, freq, t, dur, peak, dest, { detune = 0 } = {}) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    env(g, t, Math.min(0.02, dur * 0.2), peak, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  }

  // 探索层：和弦垫（双失谐 + 低通，长音 2 小节）
  function playChord(chord, t, dur) {
    const th = theme();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = th.cutoff;
    lp.connect(padGain);
    for (const m of chord) {
      osc(th.wave, midi(m), t, dur, 0.05, lp, { detune: -6 });
      osc(th.wave, midi(m), t, dur, 0.05, lp, { detune: 7 });
    }
    // 低八度持续音（每 4 小节一次，铺底）
    if (step % 128 === 0) osc('sine', midi(chord[0] - 24), t, dur * 4, 0.07, padGain);
  }

  // 稀疏旋律动机（以撒式"偶尔的钢琴碎片"）：小三角波 + 延迟
  function playMotif(t) {
    if (Math.random() > 0.55) return;
    const notes = theme().motif;
    const n = notes[Math.floor(Math.random() * notes.length)];
    osc('triangle', midi(n + 12), t, 1.1, 0.075, delay);
    if (Math.random() > 0.6) {
      const n2 = notes[Math.floor(Math.random() * notes.length)];
      osc('triangle', midi(n2 + 12), t + 0.24, 0.9, 0.06, delay);
    }
  }

  // 战斗层：低音八分脉冲（根/五度交替）+ 十六分琶音
  function playCombat(chord, s, t) {
    const root = chord[0] - 12, fifth = chord[2] - 12;
    if (s % 2 === 0) osc('triangle', (s % 8 < 4) ? root : fifth, t, 0.16, 0.16, combatGain);
    const tones = [...chord, chord[0] + 12, chord[1] + 12];
    const tone = tones[(s * 5) % tones.length] + (scene.boss ? 12 : 0);
    osc(scene.boss ? 'square' : 'sawtooth', midi(tone), t, 0.09, scene.boss ? 0.045 : 0.05, combatGain);
  }

  // Boss 层：噪声打击（四分）+ 每两小节一记低鼓
  function playBoss(t, s) {
    if (s % 4 !== 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = s % 32 === 28 ? 120 : 2400; bp.Q.value = 1.1;
    const g = ctx.createGain();
    env(g, t, 0.004, s % 32 === 28 ? 0.5 : 0.12, s % 32 === 28 ? 0.4 : 0.08);
    src.connect(bp).connect(g).connect(bossGain);
    src.start(t); src.stop(t + 0.3);
  }

  function scheduleStep(s, t) {
    const th = theme();
    const chord = th.prog[Math.floor(s / 32) % th.prog.length];
    const sixteenth = 60 / bpm() / 4;
    if (s % 32 === 0) playChord(chord, t, sixteenth * 32);
    if (s % 32 === 16) playMotif(t);
    if (combatGain.gain.value > 0.01) playCombat(chord, s, t);
    if (bossGain.gain.value > 0.01) playBoss(t, s);
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (nextT < now) nextT = now + 0.05;            // 掉帧后重对齐（标签页挂起恢复等）
    while (nextT < now + 0.18) {
      scheduleStep(step, nextT);
      nextT += 60 / bpm() / 4;
      step++;
    }
  }

  function applyGains() {
    if (!ctx) return;
    const tc = 0.8;                                  // 平滑时间常数（秒）
    padGain.gain.setTargetAtTime(scene.combat ? 0.26 : 0.36, ctx.currentTime, tc);
    combatGain.gain.setTargetAtTime(scene.combat ? 0.55 : 0, ctx.currentTime, tc);
    bossGain.gain.setTargetAtTime(scene.boss ? 0.6 : 0, ctx.currentTime, tc);
    master.gain.setTargetAtTime(muted ? 0 : 0.42, ctx.currentTime, 0.1);
  }

  return {
    start() {
      if (started) return;
      try {
        ctx = ensureCtx ? ensureCtx() : new (window.AudioContext || window.webkitAudioContext)();
        if (!ctx) return;
        if (ctx.state !== 'running') {
          // 手势解锁中：resume 是异步的（Safari/iOS 尤其），等真正 running 再起；
          // 原来这里直接 return 且只在首次交互调一次——那一次没赶上就整局无 BGM
          if (!pending && ctx.resume) {
            pending = true;
            ctx.resume().then(() => { pending = false; if (ctx.state === 'running') this.start(); },
              () => { pending = false; });
          }
          return;
        }
        buildGraph();
        applyGains();
        nextT = ctx.currentTime + 0.1;
        timer = setInterval(tick, 40);
        started = true;
      } catch (e) { if (onLog) onLog('BGM 启动失败（静默降级）: ' + e.message); }
    },
    setScene(patch) {
      const next = { ...scene, ...patch };
      const changed = next.floorNo !== scene.floorNo || next.combat !== scene.combat
        || next.boss !== scene.boss || next.roomType !== scene.roomType;
      scene = next;
      if (changed) applyGains();
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('depths-bgm-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.42, ctx.currentTime, 0.08);
      return muted;
    },
    get muted() { return muted; },
    get running() { return started; },
  };
}
