// HUD / 加载页 / debug 面板（DOM 部分；游戏世界由 three 渲染）
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const loading = $('loading');
  const fill = $('load-fill');
  const text = $('load-text');
  const errBox = $('load-err');
  const hud = $('hud');
  const debug = $('debug');
  const debugOn = new URLSearchParams(location.search).has('debug');

  const errors = [];
  window.addEventListener('error', (e) => {
    errors.push(String(e.message || e.error || e));
    errBox.textContent = errors.join('\n');
    errBox.style.display = 'block';
  });
  window.addEventListener('unhandledrejection', (e) => {
    errors.push(String(e.reason || e));
    errBox.textContent = errors.join('\n');
    errBox.style.display = 'block';
  });

  let fpsFrames = 0, fpsTime = 0, fps = 0, frameMs = 0;
  let lastStats = null;

  return {
    progress(pct, msg) {
      fill.style.width = `${Math.round(pct * 100)}%`;
      if (msg) text.textContent = msg;
    },
    ready() {
      loading.classList.add('done');
      hud.classList.remove('hidden');
      if (debugOn) debug.classList.remove('hidden');
    },
    frame(dt, stats) {
      fpsFrames++; fpsTime += dt; frameMs = dt * 1000;
      if (fpsTime >= 0.5) {
        fps = Math.round(fpsFrames / fpsTime);
        fpsFrames = 0; fpsTime = 0;
        lastStats = stats;
        if (debugOn && stats) {
          const s = stats;
          debug.textContent =
            `fps ${fps}（帧 ${frameMs.toFixed(1)}ms）\n` +
            `画质 ${s.tier} · dpr ${s.dpr}\n` +
            `draw calls ${s.calls} · 三角形 ${s.tris}\n` +
            `实体 ${s.entities} · 步长 60Hz ×${s.steps}\n` +
            `动画 ${s.anim} #${s.frame} 方向 ${s.dirName}\n` +
            `位置 (${s.x.toFixed(2)}, ${s.y.toFixed(2)})\n` +
            `叫声 ${s.cry}\n` +
            `后处理 ${s.postfx}\n` +
            `光照 ${s.light}`;
        }
      }
    },
    get errors() { return errors; },
  };
}
