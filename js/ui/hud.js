// HUD / 加载页 / debug 面板 / 战斗 UI（血量、PP、波次、伤害飘字、死亡页）
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const loading = $('loading');
  const fill = $('load-fill');
  const text = $('load-text');
  const errBox = $('load-err');
  const hud = $('hud');
  const debug = $('debug');
  const debugOn = new URLSearchParams(location.search).has('debug');

  // 动态插入战斗 HUD
  hud.insertAdjacentHTML('beforeend', `
    <div id="hp"></div>
    <div id="pp"><div id="pp-fill"></div><span id="pp-text">PP 0</span></div>
    <div id="wave"></div>
    <div id="dash"></div>
    <div id="nums"></div>
    <div id="death" class="hidden">
      <div class="box">
        <div class="d-title">体力不支……</div>
        <div class="d-sub">皮卡丘被护送撤出了洞窟</div>
        <div id="d-stats"></div>
        <div class="d-hint">按 R 重新出发</div>
      </div>
    </div>`);

  const hpEl = $('hp'), ppFill = $('pp-fill'), ppText = $('pp-text');
  const waveEl = $('wave'), dashEl = $('dash'), numsEl = $('nums');
  const deathEl = $('death'), deathStats = $('d-stats');

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

  function hearts(hp, maxHp) {
    let s = '<span class="hp-label">亲密</span>';
    for (let i = 0; i < maxHp; i += 2) {
      const v = hp - i;
      s += `<span class="hp-pip ${v >= 2 ? 'full' : v >= 1 ? 'half' : ''}"></span>`;
    }
    return s;
  }

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
    game(hp, maxHp, pp, dashCharges, dashMax, room, wave, waveTotal, cleared) {
      hpEl.innerHTML = hearts(hp, maxHp);
      ppFill.style.width = `${Math.round(pp)}%`;
      ppText.textContent = `PP ${Math.round(pp)}`;
      waveEl.textContent = cleared
        ? `房 ${room} · 已清空 —— 北门开了，上去！`
        : `房 ${room} · 波 ${Math.min(wave, waveTotal)}/${waveTotal}`;
      dashEl.innerHTML = '<span class="d-label">冲刺</span>' +
        Array.from({ length: dashMax }, (_, i) => `<span class="d-dot ${i < dashCharges ? 'on' : ''}"></span>`).join('');
    },
    damageNum(sx, sy, txt, kind) {
      if (numsEl.children.length > 40) numsEl.firstChild.remove();
      const el = document.createElement('span');
      el.className = `num ${kind}`;
      el.textContent = txt;
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      numsEl.appendChild(el);
      setTimeout(() => el.remove(), 750);
    },
    hideDeath() { deathEl.classList.add('hidden'); },
    showDeath(stats, seed) {
      deathStats.innerHTML =
        `击倒 ${stats.kills} 只 · 总伤害 ${Math.round(stats.dmgDealt)}<br>` +
        `克制命中 ${stats.superHits} 次 · 发射 ${stats.shots} 发<br>` +
        `<span class="d-seed">种子 ${seed >>> 0}</span>`;
      deathEl.classList.remove('hidden');
    },
    frame(dt, stats) {
      fpsFrames++; fpsTime += dt; frameMs = dt * 1000;
      if (fpsTime >= 0.5) {
        fps = Math.round(fpsFrames / fpsTime);
        fpsFrames = 0; fpsTime = 0;
        if (debugOn && stats) {
          const s = stats;
          debug.textContent =
            `fps ${fps}（帧 ${frameMs.toFixed(1)}ms）\n` +
            `画质 ${s.tier} · dpr ${s.dpr}\n` +
            `draw calls ${s.calls} · 三角形 ${s.tris}\n` +
            `实体 敌${s.enemies} 弹${s.projs} · 步长×${s.steps}\n` +
            `玩家 (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) HP ${s.hp} PP ${Math.round(s.pp)}\n` +
            `叫声 ${s.cry}\n` +
            `后处理 ${s.postfx}\n` +
            `光照 ${s.light}`;
        }
      }
    },
    get errors() { return errors; },
  };
}
