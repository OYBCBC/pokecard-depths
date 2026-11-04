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
    <div id="peek" class="hidden"></div>
    <div id="sheet" class="hidden"></div>
    <div id="start" class="hidden"></div>
    <div id="dex" class="hidden"></div>
    <div id="achv" class="hidden"></div>
    <div id="toasts"></div>
    <div id="stick-l" class="stick"><div class="knob"></div></div>
    <div id="stick-r" class="stick"><div class="knob"></div></div>
    <button id="btn-dash" class="tbtn" style="right: 132px; bottom: 34px;">冲刺</button>
    <button id="btn-dex" class="tbtn" style="right: 30px; bottom: 96px;">图鉴</button>
    <button id="btn-sheet" class="tbtn" style="right: 30px; bottom: 176px;">面板</button>
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
        <div class="v-title">三枚徽章集齐！</div>
        <div class="d-sub">娜姿：……你的羁绊，比我的念力更强。晶穴的故事，等你续写下一章。</div>
        <div id="v-stats"></div>
        <div class="d-hint">按 R 再来一局</div>
      </div>
    </div>`);

  const hpEl = $('hp'), ppFill = $('pp-fill'), ppText = $('pp-text');
  const waveEl = $('wave'), dashEl = $('dash'), numsEl = $('nums');
  const moneyEl = $('money'), slotsEl = $('slots'), minimapEl = $('minimap');
  const pricesEl = $('prices'), itemcardEl = $('itemcard');
  const peekEl = $('peek'), sheetEl = $('sheet');
  const startEl = $('start'), dexEl = $('dex');
  const achvEl = $('achv'), toastsEl = $('toasts');
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

  // ---------- 地图 SVG（小地图 / Tab 大图共用） ----------
  const MM_ICON = { boss: '☠', shop: '$', treasure: '▣', challenge: '⚔', secret: '?', start: '▲', camp: '♥' };
  // 可见性（以撒式迷雾）：已访问；或紧邻已访问房（隐藏房须已揭示）
  function visibleCells(cells) {
    const vis = new Set();
    for (const c of cells.values()) {
      const revealed = c.type !== 'secret' || c.visited
        || !!(c.doors && Object.values(c.doors).includes('revealed'));
      if (!revealed) continue;
      if (c.visited) { vis.add(c.x + ',' + c.y); continue; }
      const adj = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => {
        const n = cells.get((c.x + dx) + ',' + (c.y + dy));
        return n && n.visited;
      });
      if (adj) vis.add(c.x + ',' + c.y);
    }
    return vis;
  }

  function mapSvg(cells, cellKey, { win = 5, size = 20, gap = 5 } = {}) {
    const cur = cells.get(cellKey);
    if (!cur) return '';
    const vis = visibleCells(cells);
    const shown = [...cells.values()].filter((c) => vis.has(c.x + ',' + c.y));
    if (!shown.length) return '';
    const pitch = size + gap;
    let x0 = cur.x - (win - 1) / 2, x1 = cur.x + (win - 1) / 2;
    let y0 = cur.y - (win - 1) / 2, y1 = cur.y + (win - 1) / 2;
    if (!win) {   // 全层：可见房包围盒
      x0 = Math.min(...shown.map((c) => c.x)); x1 = Math.max(...shown.map((c) => c.x));
      y0 = Math.min(...shown.map((c) => c.y)); y1 = Math.max(...shown.map((c) => c.y));
    }
    const inWin = (c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
    const px = (x) => (x - x0) * pitch, py = (y) => (y - y0) * pitch;
    let out = '';
    // 门连接线（两房都可见且至少一侧已到过）
    for (const c of shown) {
      if (!inWin(c)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const n = cells.get((c.x + dx) + ',' + (c.y + dy));
        if (!n || !vis.has(n.x + ',' + n.y) || !inWin(n)) continue;
        if (!c.visited && !n.visited) continue;
        out += `<line class="mmline" x1="${px(c.x) + size / 2}" y1="${py(c.y) + size / 2}" x2="${px(n.x) + size / 2}" y2="${py(n.y) + size / 2}"/>`;
      }
    }
    // 房块
    for (const c of shown) {
      if (!inWin(c)) continue;
      const cls = ['mmr', 't-' + c.type, c.visited ? (c.cleared ? 'cleared' : 'seen') : 'fog',
        c.x === cur.x && c.y === cur.y ? 'cur' : ''].filter(Boolean).join(' ');
      const icon = c.visited ? (MM_ICON[c.type] || '') : '';
      out += `<g class="${cls}"><rect class="body" x="${px(c.x)}" y="${py(c.y)}" width="${size}" height="${size}" rx="${size * 0.16}"/>` +
        (icon ? `<text x="${px(c.x) + size / 2}" y="${py(c.y) + size / 2}">${icon}</text>` : '') + '</g>';
    }
    const w = (x1 - x0 + 1) * pitch - gap, h = (y1 - y0 + 1) * pitch - gap;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${out}</svg>`;
  }

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
    game(hp, maxHp, pp, dashCharges, dashMax, roomLabel, money, companion, zReady) {
      hpEl.innerHTML = hearts(hp, maxHp) + (companion ? `<span class="comp">${companion}</span>` : '');
      ppFill.style.width = `${Math.round(pp / (zReady ? 1 : 1) * 1)}%`;
      ppText.textContent = zReady ? 'PP 满！按 R 放 Z' : `PP ${Math.round(pp)}`;
      waveEl.textContent = roomLabel;
      moneyEl.textContent = `¥ ${money}`;
      document.getElementById('pp').classList.toggle('zready', !!zReady);
      dashEl.innerHTML = '<span class="d-label">冲刺</span>' +
        Array.from({ length: dashMax }, (_, i) => `<span class="d-dot ${i < dashCharges ? 'on' : ''}"></span>`).join('');
    },
    slots(slotA, slotB, active, lockB) {
      const nm = {
        'thunder-shock': '电击', 'water-gun': '水枪', 'fire-spin': '火焰漩涡', 'grass-knot': '打草结',
        'swift': '高速星星', 'bone-club': '骨棒', 'bubble': '泡沫',
      };
      slotsEl.innerHTML =
        `<span class="slot ${active === 'A' ? 'on' : ''}">A·${nm[slotA] || slotA}</span>` +
        (slotB ? `<span class="slot ${active === 'B' && !lockB ? 'on' : ''}${lockB ? ' lock' : ''}">B·${nm[slotB] || slotB}${lockB ? '🔒' : ''}</span>` : '');
    },
    minimap(cells, cellKey, W) {
      minimapEl.innerHTML = mapSvg(cells, cellKey, { win: 5, size: 20, gap: 5 });
    },
    // 台座详情（靠近时显示）
    peek(info) {
      if (!info) { peekEl.classList.add('hidden'); return; }
      const q = info.quality || 0;
      const pips = `<span class="pk-q q${q}">${q ? '◆'.repeat(q) : '◇'}</span>`;
      const price = info.price > 0
        ? `<span class="pk-p">¥${info.price}</span>`
        : `<span class="pk-p free">${info.free ? '免费' : '踏上拾取'}</span>`;
      peekEl.innerHTML = `<div class="pk">${info.icon ? `<img src="assets/items/${info.icon}.png">` : ''}` +
        `<div><div class="pk-n">${info.name} ${pips}</div><div class="pk-d">${info.desc || ''}</div></div>${price}</div>`;
      peekEl.classList.remove('hidden');
    },
    hidePeek() { peekEl.classList.add('hidden'); },
    // 开始界面：继续存档 / 新开 / 每日挑战 / 图鉴 / 成就 / 存档管理 + 本机榜
    startScreen({ save, board, onContinue, onNew, onDaily, onDex, onAchv, onExport, onImport, achvCount }) {
      const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      const btns = [
        save ? `<button class="st-btn primary" id="st-continue">继续探险 · 第 ${save.floorNo} 层 ${save.name}</button>` : '',
        `<button class="st-btn" id="st-new">${save ? '新的探险' : '开始探险'}</button>`,
        '<button class="st-btn" id="st-daily">每日挑战 · 今日同图</button>',
        '<div class="st-row">' +
          '<button class="st-btn st-sub-btn" id="st-dex">图鉴</button>' +
          `<button class="st-btn st-sub-btn" id="st-achv">成就${achvCount != null ? ' ' + achvCount : ''}</button>` +
          (save ? '<button class="st-btn st-sub-btn" id="st-export">导出存档</button>' : '') +
          '<button class="st-btn st-sub-btn" id="st-import">导入存档</button>' +
        '</div>',
      ].join('');
      const boardHtml = board.length
        ? '<div class="st-title">本机榜</div><div class="st-board">' + board.map((b, i) =>
          `<div>${i + 1}. ${b.win ? '🏆 通关' : '第 ' + b.floor + ' 层'} · ${fmt(b.time)} · 击倒 ${b.kills} · 道具 ${b.items} · 种子 ${b.seed}${b.daily ? ' ·每日' : ''}</div>`).join('') + '</div>'
        : '';
      startEl.innerHTML = `<div class="st-box">
          <div class="st-logo">宝可梦 · 晶穴深处</div>
          <div class="st-sub">Pokémon: Crystal Depths</div>
          ${btns}
          ${boardHtml}
          <div class="st-hint">WASD 移动 · 鼠标射击 · 空格冲刺 · Q 切招式 · 长按 Tab 面板 · M 静音 · 手柄直插即用</div>
          <input type="file" id="st-file" accept=".json,application/json" style="display:none">
        </div>`;
      startEl.classList.remove('hidden');
      const hide = () => startEl.classList.add('hidden');
      const q = (id) => startEl.querySelector('#' + id);
      const primary = (save && q('st-continue')) || q('st-new');
      if (save && q('st-continue')) q('st-continue').onclick = () => { hide(); onContinue(); };
      q('st-new').onclick = () => { hide(); onNew(); };
      q('st-daily').onclick = () => { hide(); onDaily(); };
      if (q('st-dex')) q('st-dex').onclick = () => { onDex(); };
      if (q('st-achv')) q('st-achv').onclick = () => { onAchv && onAchv(); };
      if (q('st-export')) q('st-export').onclick = () => { onExport && onExport(); };
      q('st-import').onclick = () => {
        const inp = q('st-file');
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => { onImport && onImport(String(rd.result)); };
          rd.readAsText(f);
        };
        inp.click();
      };
      primary.focus();
      startEl.onkeydown = (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); primary.click(); } };
    },
    // 搭档选择（新的探险/每日挑战之后）：4 张卡，未解锁的显示条件
    starterPick({ list, thumbs, isUnlocked, onPick, title }) {
      const cards = list.map((s) => {
        const ok = isUnlocked(s);
        return `<div class="sp-card ${ok ? '' : 'locked'}" data-sid="${s.id}" tabindex="0">
          <img src="${thumbs[s.anim] || ''}" ${ok ? '' : 'class="sil"'} draggable="false" alt="">
          <div class="sp-name">${ok ? s.name : '？？？'}</div>
          <div class="sp-role">${ok ? s.role : (s.lockName || '未解锁')}</div>
          <div class="sp-desc">${ok ? s.desc : '达成条件后解锁'}</div>
        </div>`;
      }).join('');
      startEl.innerHTML = `<div class="st-box sp-box">
          <div class="st-logo sp-title">${title || '选择搭档'}</div>
          <div class="sp-grid">${cards}</div>
          <div class="st-hint">点击选择</div>
        </div>`;
      startEl.classList.remove('hidden');
      startEl.querySelectorAll('.sp-card').forEach((el) => {
        const pick = () => {
          const s = list.find((x) => x.id === el.dataset.sid);
          if (s && isUnlocked(s)) { startEl.classList.add('hidden'); onPick(s.id); }
        };
        el.onclick = pick;
        el.onkeydown = (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); pick(); } };
      });
    },
    // 图鉴：物种网格（未点亮=剪影+？？？），点击试听叫声
    dex(species, dexState, thumbs, opts = {}) {
      const unlocked = species.filter((c) => dexState[c.eid] && dexState[c.eid].seen).length;
      const cells = species.map((c) => {
        const st = dexState[c.eid] || {};
        const seen = !!st.seen;
        return `<div class="dx-cell ${seen ? '' : 'locked'}" data-eid="${c.eid}">
          <img src="${thumbs[c.anim] || ''}" ${seen ? '' : 'class="sil"'} draggable="false" alt="">
          <div class="dx-no">#${String(c.dex).padStart(3, '0')}</div>
          <div class="dx-name">${seen ? c.name : '？？？'}</div>
          ${seen && st.kills ? `<div class="dx-kills">击倒 ${st.kills}</div>` : ''}
          ${c.tag ? `<div class="dx-tag">${c.tag}</div>` : ''}
        </div>`;
      }).join('');
      dexEl.innerHTML = `<div class="dx-box">
        <div class="dx-head"><span>宝可梦图鉴</span><span class="dx-count">${unlocked} / ${species.length} 已点亮</span></div>
        <div class="dx-grid">${cells}</div>
        <div class="dx-hint">点击已点亮的条目试听叫声 · B / Esc 关闭</div>
      </div>`;
      dexEl.classList.remove('hidden');
      dexEl.querySelectorAll('.dx-cell:not(.locked)').forEach((el) => {
        el.onclick = () => {
          dexEl.querySelectorAll('.dx-cell').forEach((x) => x.classList.remove('picked'));
          el.classList.add('picked');
          const c = species.find((s) => s.eid === el.dataset.eid);
          if (opts.onCry && c) opts.onCry(c);
        };
      });
    },
    hideDex() { dexEl.classList.add('hidden'); },
    get dexOpen() { return !dexEl.classList.contains('hidden'); },
    // 成就面板：20 格（未解锁灰显 + 进度条），J 键或开始界面入口。
    // ctx = { progress: (id)=>{cur,need}|null, speciesName: (sid)=>string }
    achv(achvs, set, ctx = {}) {
      const done = achvs.filter((a) => set.has(a.id)).length;
      const cells = achvs.map((a) => {
        const ok = set.has(a.id);
        const pr = ok ? null : (ctx.progress && ctx.progress(a.id));
        return `<div class="ac-cell ${ok ? 'done' : ''}">
          <div class="ac-name">${ok ? '🏅' : '🔒'} ${a.name}</div>
          <div class="ac-desc">${a.desc}</div>
          ${pr ? `<div class="ac-bar"><i style="width:${Math.round(pr.cur / pr.need * 100)}%"></i><span>${pr.cur}/${pr.need}</span></div>` : ''}
          ${a.unlock ? `<div class="ac-unlock">解锁搭档：${(ctx.speciesName && ctx.speciesName(a.unlock)) || a.unlock}</div>` : ''}
        </div>`;
      }).join('');
      achvEl.innerHTML = `<div class="ac-box">
        <div class="ac-head"><span>成就</span><span class="ac-count">${done} / ${achvs.length}</span></div>
        <div class="ac-grid">${cells}</div>
        <div class="ac-hint">J / Esc 关闭 · 成就跨局永久保存</div>
      </div>`;
      achvEl.classList.remove('hidden');
    },
    hideAchv() { achvEl.classList.add('hidden'); },
    get achvOpen() { return !achvEl.classList.contains('hidden'); },
    // 成就解锁 toast（右上角堆叠，3.6s 自动消失）
    toast(title, sub) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = `<div class="t-title">${title}</div>${sub ? `<div class="t-sub">${sub}</div>` : ''}`;
      toastsEl.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 3600);
    },
    // Tab 长按：以撒式数据页（全层地图 + 面板 + 道具收藏）
    sheet(show, run, data) {
      if (!show) { sheetEl.classList.add('hidden'); return; }
      const p = run.player, s = p.stats, m = p.mods;
      const moveA_eff = (p.activeSide === 'companion' && p.companion) ? p.companion.moveA : p.moveA;
      const row = (label, val) => `<div class="s-row"><span>${label}</span><b>${val}</b></div>`;
      const chips = [];
      const pct = (v) => Math.round(v * 100) + '%';
      if (m.pierce) chips.push(['穿透+' + m.pierce, '#7fd4ff']);
      if (m.homing) chips.push(['追踪', '#c79fff']);
      if (m.bounce) chips.push(['反弹×' + m.bounce, '#9fe070']);
      if (m.split) chips.push(['分裂弹', '#ffd24a']);
      if (m.crit) chips.push(['暴击 ' + pct(m.crit), '#ff9a4a']);
      if (m.dodge) chips.push(['闪避 ' + pct(m.dodge), '#9fe070']);
      if (m.blockChance) chips.push(['格挡 ' + pct(m.blockChance), '#7fd4ff']);
      if (m.hurtResist) chips.push(['受伤减免', '#9aa7bd']);
      if (m.killHeal) chips.push(['击杀回血 ' + pct(m.killHeal), '#ff8a97']);
      if (m.regenRoom) chips.push(['清房回血+' + m.regenRoom, '#ff8a97']);
      if (m.flinch) chips.push(['畏缩 ' + pct(m.flinch), '#ffd24a']);
      if (m.magnet > 1) chips.push(['磁力 ' + m.magnet.toFixed(1) + '格', '#ffd24a']);
      if (m.lethalGuard) chips.push(['气势披带', '#ff8a97']);
      if (m.superBonus) chips.push(['克制增伤+' + pct(m.superBonus), '#ffd24a']);
      const TN = { electric: '电', water: '水', fire: '火', grass: '草', ground: '地', rock: '岩', psychic: '超' };
      for (const [k, v] of Object.entries(m.typeMul)) if (v > 1) chips.push([(TN[k] || k) + '伤×' + v.toFixed(2), '#ff9a4a']);
      const moveName = (id) => (data.moves[id] && data.moves[id].name) || id;
      const ids = [...p.inv.passives, ...(p.inv.trinket ? [p.inv.trinket] : []), ...p.inv.badges];
      const itemHtml = ids.length
        ? ids.map((id) => {
          const it = data.items[id];
          return it ? `<div class="s-item"><img src="assets/items/${it.icon}.png"><span>${it.name}</span></div>` : '';
        }).join('')
        : '<span class="s-none">（还没有道具）</span>';
      const consum = p.inv.consumable ? data.items[p.inv.consumable] : null;
      const mm = Math.floor(run.t / 60), ss = String(Math.floor(run.t % 60)).padStart(2, '0');
      sheetEl.innerHTML = `<div class="sh-box">
        <div class="sh-map">
          <div class="sh-title">第 ${run.floorNo} 层 · ${data.floors[run.floorNo].name}</div>
          ${mapSvg(run.map, run.cellKey, { win: 0, size: 24, gap: 6 })}
        </div>
        <div class="sh-stats">
          <div class="sh-title">面板数据</div>
          ${row('伤害', s.damage.toFixed(1))}
          ${row('攻速', (1 / s.fireInterval).toFixed(2) + ' 发/秒')}
          ${row('移速', s.moveSpeed.toFixed(1))}
          ${row('射程', '×' + m.rangeMul.toFixed(2))}
          ${row('弹速', '×' + m.shotSpeedMul.toFixed(2))}
          ${row('弹径', '×' + m.sizeMul.toFixed(2))}
          <div class="s-moves">A·${moveName(moveA_eff)}${p.moveB ? `　B·${moveName(p.moveB)}` : ''}${consum ? `　携带·${consum.name}` : ''}</div>
          ${chips.length ? '<div class="s-chips">' + chips.map(([t, c]) => `<span style="border-color:${c};color:${c}">${t}</span>`).join('') + '</div>' : ''}
          <div class="sh-title sh-title2">道具收藏</div>
          <div class="s-items">${itemHtml}</div>
          <div class="s-run">用时 ${mm}:${ss} · 击倒 ${run.stats.kills} · 清房 ${run.stats.roomsCleared} · 克制 ${run.stats.superHits}</div>
        </div>
      </div>`;
      sheetEl.classList.remove('hidden');
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
    showDeath(stats, seed, name = '搭档') {
      deathEl.querySelector('.d-sub').textContent = `${name}被护送撤出了洞窟`;
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
