// 宝可梦叫声（《06》§2.2 的两个坑都在这里兜底：
//   1) 皮卡丘 latest/25.ogg 实为 MP3 数据 —— decodeAudioData 失败即静默降级
//   2) Safari <18.4 无 Ogg 解码 —— 同上）
export function createCries() {
  let ctx = null;
  const buffers = new Map();       // id -> AudioBuffer | null（null=已降级）
  const status = new Map();        // id -> 'ok' | 'degraded' | 'loading'

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function load(id, url) {
    status.set(id, 'loading');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const audio = await ensureCtx().decodeAudioData(buf);
      buffers.set(id, audio);
      status.set(id, 'ok');
    } catch (e) {
      buffers.set(id, null);
      status.set(id, 'degraded');
      console.info(`[cries] ${id} 解码失败，静默降级：`, e && e.message);
    }
  }

  function play(id, { volume = 0.5, rateJitter = true } = {}) {
    const buf = buffers.get(id);
    if (!buf) return false;
    const src = ensureCtx().createBufferSource();
    src.buffer = buf;
    if (rateJitter) src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const gain = ensureCtx().createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
    return true;
  }

  function statusOf(id) { return status.get(id) || '未加载'; }

  return { load, play, statusOf, ensureCtx };
}
