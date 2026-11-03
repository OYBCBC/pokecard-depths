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
    <div id="money"></div>
    <div id="slots"></div>
    <div id="dash"></div>
    <div id="minimap"></div>
    <div id="nums"></div>
    <div id="prices"></div>
    <div id="itemcard" class="hidden"></div>
    <div id="bossbar" class="hidden"><div id="boss-fill"></div><span id="boss-name"></span></div>
    <div id="banner" class="hidden"></div>
    <div id="flashmask"></div>
    <div id="death" class="hidden">
      <div class="box">
        <div class="d-title">体力不支……</div>
        <div class="d-sub">皮卡丘被护送撤出了洞窟</div>
        <div id="d-stats"></div>
        <div class="d-hint">按 R 重新出发</div>
      </div>
    </div>
    <div id="victory" class="hidden">
      <div class="box">
        <div class="v-title">灰色徽章 GET！</div>
        <div class="d-sub">小刚：石头一样的意志，也有裂缝啊……这枚徽章是你的了。</div>
        <div id="v-stats"></div>
        <div class="d-hint">按 R 再来一局</div>
      </div>
    </div>`);

  const hpEl = $('hp'), ppFill = $('pp-fill'), ppText = $('pp-text');
  const waveEl = $('wave'), dashEl = $('dash'), numsEl = $('nums');
  const moneyEl = $('money'), slotsEl = $('slots'), minimapEl = $('minimap');
  const pricesEl = $('prices'), itemcardEl = $('itemcard');
  const bossbarEl = $('bossbar'), bossFill = $('boss-fill'), bossName = $('boss-name');
  const bannerEl = $('banner'), flashEl = $('flashmask');
  const deathEl = $('death'), deathStats = $('d-stats');
  const victoryEl = $('victory'), victoryStats = $('v-stats');
  let itemcardTimer = null, bannerTimer = null;

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
    game(hp, maxHp, pp, dashCharges, dashMax, roomLabel, money, slots, slotActive, moveB) {
      hpEl.innerHTML = hearts(hp, maxHp);
      ppFill.style.width = `${Math.round(pp)}%`;
      ppText.textContent = `PP ${Math.round(pp)}`;
      waveEl.textContent = roomLabel;
      moneyEl.textContent = `¥ ${money}`;
      slotsEl.innerHTML = `<span class="slot ${slotActive === 'A' ? 'on' : ''}">A 电击</span>` +
        (moveB ? `<span class="slot ${slotActive === 'B' ? 'on' : ''}">B ${'换'}</span>` : '');
      dashEl.innerHTML = '<span class="d-label">冲刺</span>' +
        Array.from({ length: dashMax }, (_, i) => `<span class="d-dot ${i < dashCharges ? 'on' : ''}"></span>`).join('');
    },
    slots(slotA, slotB, active, lockB) {
      const nm = { 'thunder-shock': '电击', 'water-gun': '水枪', 'fire-spin': '火焰漩涡', 'grass-knot': '打草结' };
      slotsEl.innerHTML =
        `<span class="slot ${active === 'A' ? 'on' : ''}">A·${nm[slotA] || slotA}</span>` +
        (slotB ? `<span class="slot ${active === 'B' && !lockB ? 'on' : ''}${lockB ? ' lock' : ''}">B·${nm[slotB] || slotB}${lockB ? '🔒' : ''}</span>` : '');
    },
    minimap(cells, cellKey, W) {
      const cur = cells.get(cellKey);
      if (!cur) return;
      // 以当前房为中心的 5×5 视窗
      let html = '';
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const c = cells.get((cur.x + dx) + ',' + (cur.y + dy));
          if (!c) { html += '<span class="mm off"></span>'; continue; }
          const icon = { boss: '☠', shop: '$', treasure: '▣', challenge: '⚔', secret: '?', start: '▲' }[c.type] || '';
          const cls = ['mm', c.x + ',' + c.y === cellKey ? 'cur' : c.visited ? (c.cleared ? 'cleared' : 'seen') : 'unseen',
            c.type === 'secret' && !(c.doors && Object.values(c.doors).includes('revealed')) && !c.visited ? 'hide' : ''].join(' ');
          html += `<span class="${cls}">${icon}</span>`;
        }
      }
      minimapEl.innerHTML = html;
    },
    price(d, sx, sy) {
      let el = pricesEl.querySelector(`[data-pid="${d.id}"]`);
      if (d.taken) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement('span');
        el.className = 'price' + (d.price ? '' : ' free');
        el.dataset.pid = d.id;
        pricesEl.appendChild(el);
      }
      el.textContent = d.price ? `¥${d.price}` : '免费';
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
    },
    clearPrices() { pricesEl.innerHTML = ''; },
    itemCard(name, desc, quality, icon) {
      const q = ['', '白', '绿', '蓝', '紫', '红金'][quality + 1] || '';
      itemcardEl.innerHTML = `<div class="ic-q${quality}">${icon ? `<img src="assets/items/${icon}.png">` : ''}<div><b>${name}</b><span>${desc}</span></div></div>`;
      itemcardEl.classList.remove('hidden');
      clearTimeout(itemcardTimer);
      itemcardTimer = setTimeout(() => itemcardEl.classList.add('hidden'), 1600);
    },
    bossBar(name, hpRatio) {
      bossbarEl.classList.remove('hidden');
      bossName.textContent = name;
      bossFill.style.width = `${Math.max(0, Math.round(hpRatio * 100))}%`;
    },
    hideBossBar() { bossbarEl.classList.add('hidden'); },
    banner(text, sub, ms = 2200) {
      bannerEl.innerHTML = `<div class="b-title">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
      bannerEl.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), ms);
    },
    flash() {
      flashEl.classList.add('on');
      setTimeout(() => flashEl.classList.remove('on'), 240);
    },
    showVictory(stats, seed) {
      victoryStats.innerHTML =
        `用时 ${Math.round(stats.tRun)} 秒 · 清房 ${stats.roomsCleared} · 击倒 ${stats.kills}<br>` +
        `道具 ${stats.items} 件 · 克制命中 ${stats.superHits} · 赚钱 ¥${stats.coins}<br>` +
        `<span class="d-seed">种子 ${seed >>> 0}</span>`;
      victoryEl.classList.remove('hidden');
    },
    hideVictory() { victoryEl.classList.add('hidden'); },
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
