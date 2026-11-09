// M8 招式特效靶场（lab.html）：与游戏同一套 sim + 特效模块，专门调攻击特效与伤害。
// 结构：左面板（DOM）选攻击方/招式/靶子 → createRun 的沙盒局（出生房清空，塞一只可控 dummy）
// → stepRun 驱动真实战斗路径 → consumeEvents 出特效/伤害数字/记录。
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize } from './gfx/renderer.js?v=m7b';
import { createLights } from './gfx/lights.js?v=m7b';
import { createCamera } from './gfx/camera.js?v=m7b';
import { buildRoom } from './gfx/scene.js?v=m7b';
import { createBillboard } from './gfx/sprites.js?v=m7b';
import { createEffects } from './gfx/effects.js?v=m8';
import { createPostfx } from './gfx/postfx.js?v=m7b';
import { createInput } from './core/input.js?v=m7b';
import { createRun, stepRun, recompute, STEP } from './sim/engine.js?v=m7b';
import { computeHit } from './sim/combat.js?v=m7b';
import { styleOf, TYPE_COLORS } from './gfx/vfxdefs.js?v=m8';

const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', grass: '草', electric: '电', ice: '冰',
  fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行', psychic: '超能',
  bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
};
// 无 moveA 的敌方物种（自爆型）按一属性兜底（与 actors.js COMPANION_MOVES 同表）
const TYPE_FALLBACK_MOVE = {
  electric: 'thunder-shock', water: 'bubble', fire: 'fire-spin', grass: 'grass-knot',
  normal: 'swift', ground: 'bone-club', rock: 'bone-club', fighting: 'bone-club',
  poison: 'swift', psychic: 'swift', ghost: 'swift', bug: 'swift', steel: 'thunder-shock',
};

const $ = (id) => document.getElementById(id);
const loadJson = async (u) => (await fetch(u)).json();
function loadTexture(url, { pixel = true } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
      t.needsUpdate = true;
      resolve(t);
    };
    img.onerror = () => reject(new Error('纹理加载失败: ' + url));
    img.src = url;
  });
}

async function boot() {
  // ---- 数据 ----
  const [tcD, edD, mvD, bal, itemsD, floorsD, spD] = await Promise.all([
    loadJson('js/data/typechart.json'), loadJson('js/data/enemies.json'),
    loadJson('js/data/moves.json'), loadJson('js/data/balance.json'), loadJson('js/data/items.json'),
    loadJson('js/data/floors.json'), loadJson('js/data/species.json'),
  ]);
  const data = {
    typechart: tcD.chart, enemies: edD.enemies, moves: mvD.moves, items: itemsD.items,
    itemPools: itemsD.poolConfig, balance: bal, waves: floorsD.floors['1'].waves,
    floors: floorsD.floors, species: spD.species, floorNo: 1,
  };

  // ---- 场景 ----
  const tierParam = new URLSearchParams(location.search).get('q');
  const tier = tierParam === 'low' ? 'low' : (tierParam === 'high' ? 'high' : 'med');   // 靶场默认中档（有 Bloom）
  const canvas = $('game');
  const renderer = createRenderer(THREE, canvas, tier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e18);
  scene.fog = new THREE.Fog(0x0b0e18, 26, 60);
  const lights = createLights(THREE, scene, tier, 17, 11);
  const camCtl = createCamera(THREE);
  function fitView() { resize(THREE, renderer, camCtl.camera); const extra = camCtl.fit(camCtl.camera.aspect); scene.fog.near = 26 + extra; scene.fog.far = 60 + extra; }
  fitView();
  const [shadowTex, ringTex, doorTex, flameTex] = await Promise.all([
    loadTexture('assets/tiles/shadow.png'),
    loadTexture('assets/tiles/ring.png'),
    loadTexture('assets/tiles/door.png').catch(() => null),
    loadTexture('assets/tiles/flame.png'),
  ]);
  const theme = {};
  await Promise.all(Object.entries({ floor: 'cave-floor', wall: 'cave-wall', wallTop: 'cave-wall-top' })
    .map(async ([k, file]) => { theme[k] = await loadTexture(`assets/tiles/${file}.png`); }));
  theme.wall.wrapS = theme.wall.wrapT = THREE.RepeatWrapping;
  theme.wallTop.wrapS = theme.wallTop.wrapT = THREE.RepeatWrapping;
  flameTex.wrapS = THREE.RepeatWrapping; flameTex.repeat.set(1 / 4, 1);
  const tex = { floor: theme.floor, wall: theme.wall, wallTop: theme.wallTop, door: doorTex, crack: ringTex, flame: flameTex };
  const roomView = buildRoom(THREE, scene, tex, lights, tier, { type: 'start', w: 17, h: 11, doors: {} });
  const fx = createEffects(THREE, scene, ringTex, { flashLights: true });
  let postfx = await createPostfx(THREE, renderer, scene, camCtl.camera, tier);
  // composer 黑图探测（与主游戏 composerWorks 同套路）：个别 webview 上后处理链输出全黑 → 回退直渲染
  if (postfx) {
    postfx.setSize(...viewportSize());
    try {
      postfx.composer.render(1 / 60);
      const probe = document.createElement('canvas');
      probe.width = 16; probe.height = 10;
      const pctx = probe.getContext('2d');
      pctx.drawImage(canvas, 0, 0, 16, 10);
      const d = pctx.getImageData(0, 0, 16, 10).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 45) lit++;
      if (lit < 8) { postfx = null; renderer.setRenderTarget(null); console.warn('[lab] composer 黑图，回退直渲染'); }
    } catch (e) { postfx = null; renderer.setRenderTarget(null); }
  }

  // ---- 沙盒局：出生房清空干扰（台座/拾取/门全拆），只留玩家 ----
  const run = createRun(data, 424242, 'pikachu');
  run.pedestals.length = 0; run.pickups.length = 0;
  run.room.cleared = true; run.room.doorOpen = true;
  run.map.get(run.cellKey).doors = {};
  run.map.get(run.cellKey).cleared = true;
  const p = run.player;

  // ---- 图集缓存与精灵 ----
  const atlasCache = new Map();
  async function ensureAtlas(slug) {
    if (atlasCache.has(slug)) return atlasCache.get(slug);
    const entry = (async () => {
      try {
        const [atlas, t] = await Promise.all([
          loadJson(`assets/atlas/${slug}.json`), loadTexture(`assets/atlas/${slug}.png`),
        ]);
        return { atlas, tex: t };
      } catch (e) { return null; }
    })();
    atlasCache.set(slug, entry);
    return entry;
  }
  async function cryOf(dex) {
    if (!dex) return;
    try { new Audio(`assets/cries/${dex}.ogg`).play().catch(() => {}); } catch (e) { /* 忽略 */ }
  }

  let playerSlug = '';
  let player = null;
  async function setPlayerSprite(slug) {
    const eff = slug === 'grimer-small' ? 'grimer' : slug;
    if (eff === playerSlug) return;
    const got = await ensureAtlas(eff);
    if (!got) return;
    const px = player ? player.group.position.x : p.x, pz = player ? player.group.position.z : p.y;
    if (player) { scene.remove(player.group); player.dispose(); }
    player = createBillboard(THREE, got.tex, got.atlas, shadowTex);
    player.place(px, pz);
    scene.add(player.group);
    playerSlug = eff;
  }

  // ---- 靶子 ----
  const dummyUI = { eid: 'rhyhorn', behavior: 'still', hpMax: 100, respawns: 0 };
  let dummyView = null, dummySlug = '';
  let respawnAt = -1;
  function makeDummy() {
    const spec = data.enemies[dummyUI.eid];
    const fam = dummyUI.behavior === 'wander' ? 'wanderer' : dummyUI.behavior === 'chase' ? 'charger' : 'tank';
    const spd = dummyUI.behavior === 'wander' ? 0.9 : dummyUI.behavior === 'chase' ? 1.5 : 0;
    run.enemies.length = 0;
    run.enemies.push({
      id: run.nextId++, eid: dummyUI.eid, name: spec.name, types: spec.types, family: fam,
      radius: spec.radius, score: spec.score, spdMod: spec.spdMod,
      hp: dummyUI.hpMax, maxHp: dummyUI.hpMax,
      touchDmg: 0, speed: spd,
      x: p.x + 3.4, y: p.y - 0.4, px: p.x + 3.4, py: p.y - 0.4, kx: 0, ky: 0,
      state: 'active', spawnT: 0, flash: 0, touchCd: 0, stun: 0,
      anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
      shoot: null, shootCd: 9, lunge: dummyUI.behavior === 'chase' ? spec.lunge : undefined,
      kbRes: dummyUI.behavior === 'still' ? 1 : 0,   // 站桩靶不吃击退（训练桩定住）；游走/追击保留击退手感
      splitOnDeath: undefined, transformTo: null, dropHearts: undefined,
    });
    respawnAt = -1;
    fx.burst(p.x + 3.4, p.y - 0.4, 8, 0x9fb8d8);
  }
  async function setDummySprite() {
    const spec = data.enemies[dummyUI.eid];
    const slug = spec.anim || dummyUI.eid;
    const got = await ensureAtlas(slug);
    if (!got) return;
    if (dummyView) { scene.remove(dummyView.group); dummyView.dispose(); }
    dummyView = createBillboard(THREE, got.tex, got.atlas, shadowTex);
    scene.add(dummyView.group);
    dummySlug = slug;
    cryOf(spec.dex);
  }
  makeDummy();
  setDummySprite();

  // ---- 攻击方 ----
  const atk = { id: 'pikachu', isEnemy: false };
  function attackerInfo(id, isEnemy) {
    if (isEnemy) {
      const spec = data.enemies[id];
      return {
        id, name: spec.name, types: spec.types, anim: spec.anim || id, dex: spec.dex,
        moveA: spec.moveA || TYPE_FALLBACK_MOVE[spec.types[0]] || 'swift',
        zmove: spec.zmove || 'thunderbolt-z',
        recs: [
          { id: spec.moveA || TYPE_FALLBACK_MOVE[spec.types[0]] || 'swift', tag: '主' },
          { id: spec.zmove || 'thunderbolt-z', tag: 'Z' },
        ],
      };
    }
    const spec = data.species[id];
    const tms = (spec.startTMs || [])
      .map((tmId) => data.items[tmId])
      .filter((it) => it && it.effect && it.effect.tm && (!it.learn || it.learn.includes(id)))
      .map((it) => ({ id: it.effect.tm, tag: 'TM' }));
    return {
      id, name: spec.name, types: spec.types, anim: spec.anim || id, dex: spec.cry,
      moveA: spec.moveA, zmove: spec.zmove,
      recs: [{ id: spec.moveA, tag: '主' }, { id: spec.zmove, tag: 'Z' }, ...tms],
    };
  }
  function setAttacker(id, isEnemy) {
    atk.id = id; atk.isEnemy = isEnemy;
    const info = attackerInfo(id, isEnemy);
    p.types = info.types;
    p.moveA = info.moveA;
    p.zmove = info.zmove;
    if (!isEnemy) p.species = id;          // 敌物种没有 species 表：保留皮卡丘面板，只换属性/招式/贴图
    p.slot = 'A';
    recompute(run, data);
    setPlayerSprite(info.anim);
    cryOf(info.dex);
    $('atk-types').innerHTML = info.types.map((t) => badge(t)).join('');
    buildMoveList(info);
    selectMove(info.moveA);
  }

  // ---- 招式列表 ----
  const movesArr = Object.entries(data.moves).map(([id, m]) => ({ id, ...m }));
  function badge(type) {
    const c = (TYPE_COLORS[type] || ['#888'])[0];
    return `<span class="badge" style="background:${c}">${TYPE_ZH[type] || type}</span>`;
  }
  function moveRow(m, tag) {
    const mv = data.moves[m.id];
    return `<label class="move-opt" data-mv="${m.id}"><input type="radio" name="mv">${badge(mv.type)}<span class="mn">${mv.name}</span><span class="pw">${tag || ('威力' + mv.power)}</span></label>`;
  }
  function buildMoveList(info) {
    const recIds = new Set(info.recs.map((r) => r.id));
    const recHtml = info.recs.map((r) => moveRow(r, r.tag)).join('');
    const playerMoves = movesArr.filter((m) => m.kind === 'projectile' && m.power > 0 && m.speed > 0 && !m.enemyShot && !recIds.has(m.id));
    const enemyMoves = movesArr.filter((m) => m.kind === 'projectile' && m.enemyShot && m.speed > 0);
    const zMoves = movesArr.filter((m) => m.kind === 'zmove' && !recIds.has(m.id));
    $('move-list').innerHTML =
      `<h4>◆ ${info.name} 可用招式</h4>${recHtml}` +
      `<h4>玩家弹幕（全部）</h4>${playerMoves.map((m) => moveRow(m)).join('')}` +
      `<h4>敌方弹幕</h4>${enemyMoves.map((m) => moveRow(m)).join('')}` +
      `<h4>Z 招式（R 触发）</h4>${zMoves.map((m) => moveRow(m)).join('')}`;
    for (const el of $('move-list').querySelectorAll('.move-opt')) {
      el.addEventListener('click', () => selectMove(el.dataset.mv, true));
    }
  }
  let curMoveId = 'thunder-shock';
  function selectMove(id, fromUser) {
    const mv = data.moves[id];
    if (!mv) return;
    if (mv.kind === 'zmove') {
      p.zmove = id;
      p.pp = 100 * p.mods.ppCost;          // 选 Z 顺手充满，立即能试
    } else {
      p.moveA = id; p.slot = 'A';
    }
    curMoveId = id;
    for (const el of $('move-list').querySelectorAll('.move-opt')) el.classList.toggle('sel', el.dataset.mv === id);
    refreshMoveInfo();
  }

  // ---- 数据面板 ----
  function refreshMoveInfo() {
    const mv = data.moves[curMoveId] || {};
    const rows = [
      ['招式', `${mv.name || '？'} ${badge(mv.type)}`],
      ['类别', mv.kind === 'zmove' ? 'Z 招式' : '弹幕'],
      ['威力', mv.power || 0],
      ['弹速', mv.speed || 0], ['射程', mv.range || 0], ['弹径', mv.radius || 0],
      ['散射', mv.spread > 1 ? `${mv.spread} 发 / ${mv.arcDeg}°` : '单发'],
      ['贯通', mv.pierce ? `+${mv.pierce}` : '—'],
      ['追踪', mv.homing ? `×${mv.homing}` : '—'],
      ['击退', mv.knock ? `×${mv.knock}` : '—'],
      ['出招间隔', (p.stats.fireInterval * (mv.intervalMul || 1)).toFixed(3) + ' s'],
    ];
    $('moveinfo').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');
    refreshTheory();
  }
  function refreshTheory() {
    const mv = data.moves[curMoveId];
    if (!mv) return;
    const e = run.enemies[0];
    const atkTypes = p.types || ['electric'];
    const rawMult = (function () {           // 原始克制（图表直读）
      const row = data.typechart[mv.type] || {};
      let m = 1; for (const t of (e ? e.types : [])) m *= (row[t] !== undefined ? row[t] : 1);
      return m;
    })();
    const hit = computeHit({
      D: p.stats.damage, power: mv.kind === 'zmove' ? mv.power * 0.5 : mv.power, moveType: mv.type,
      atkTypes, defTypes: e ? e.types : [], spdMod: e ? e.spdMod : 1,
      critChance: p.mods.crit, rng01: 0.5, stabMul: 1.5, chart: data.typechart, immuneFloor: 0.5,
    });
    const stab = atkTypes.includes(mv.type);
    const interval = p.stats.fireInterval * (mv.intervalMul || 1);
    const pellets = mv.spread || 1;
    const dps = mv.kind === 'zmove' ? hit.dmg : hit.dmg * pellets / Math.max(interval, 0.05);
    const multTxt = rawMult === 0 ? `<span class="bad">免疫 ×0（结算按 ×0.5 防卡关）</span>`
      : rawMult > 1 ? `<span class="hl">效果绝佳 ×${rawMult}</span>` : rawMult < 1 ? `<span class="bad">效果不好 ×${rawMult}</span>` : '×1';
    $('theory').innerHTML = [
      ['属性克制', multTxt],
      ['STAB', stab ? '<span class="hl">同属性 ×1.5</span>' : '—'],
      ['特防修正', '×' + (e ? e.spdMod : 1).toFixed(2)],
      ['期望单发', hit.dmg.toFixed(2)],
      ...(mv.kind === 'zmove' ? [['AoE 半威力', 'Z 招式按 50% 威力结算']] : []),
      ['理论 DPS', dps.toFixed(2) + (pellets > 1 ? `（${pellets} 连发）` : '')],
    ].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // ---- 命中记录 ----
  const logRows = [];
  const hitTimes = [];
  let hits = 0, kills = 0;
  function pushLog(txt, kind) {
    logRows.unshift(`<div class="k-${kind}">${txt}</div>`);
    if (logRows.length > 14) logRows.pop();
    $('log').innerHTML = logRows.join('');
    $('stat-hits').textContent = `${hits} / ${kills}`;
  }
  function measuredDps() {
    const now = run.t;
    while (hitTimes.length && now - hitTimes[0].t > 6) hitTimes.shift();
    let sum = 0;
    for (const h of hitTimes) sum += h.d;
    $('stat-dps').textContent = (sum / 6).toFixed(1);
  }

  // ---- 伤害数字 / 血条投影 ----
  const v3 = new THREE.Vector3();
  function project(x, z) {
    v3.set(x, 1.2, z).project(camCtl.camera);
    return [(v3.x + 1) / 2 * window.innerWidth, (1 - (v3.y + 1) / 2) * window.innerHeight];
  }
  const NUM_COLOR = { super: '#ffd24a', weak: '#9aa7bd', immune: '#7d8aa5', normal: '#ffffff' };
  function damageNum(x, z, txt, kind) {
    const el = document.createElement('span');
    el.textContent = txt;
    el.style.color = NUM_COLOR[kind] || '#fff';
    const [sx, sy] = project(x, z);
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    $('dmgnums').appendChild(el);
    setTimeout(() => el.remove(), 750);
  }
  const dhp = document.createElement('div');
  dhp.id = 'dhp-wrap';
  dhp.innerHTML = '<div id="dhp-name"></div><div id="dhp-bar"><div id="dhp-fill"></div></div><div id="dhp-txt"></div>';
  document.body.appendChild(dhp);

  // ---- 事件消费（特效 + 记录）----
  function consumeEvents() {
    for (const ev of run.events) {
      switch (ev.t) {
        case 'shot': {
          const mt = (data.moves[ev.moveId] || {}).type;
          fx.muzzle(ev.x, ev.y, styleOf(ev.moveId, mt), mt);
          break;
        }
        case 'enemy-hurt': {
          const mt = (data.moves[ev.moveId] || {}).type;
          fx.hitFx(ev.x, ev.y, styleOf(ev.moveId, mt), mt, ev.kind);
          hits++;
          hitTimes.push({ t: run.t, d: ev.dmg });
          damageNum(ev.x, ev.y, ev.dmg >= 10 ? Math.round(ev.dmg) : ev.dmg.toFixed(1), ev.kind);
          pushLog(`${(data.moves[ev.moveId] || {}).name || '？'} → ${ev.dmg.toFixed(1)}（${{ super: '效果绝佳', weak: '效果不好', immune: '免疫', normal: '正常' }[ev.kind] || ev.kind}）`, ev.kind);
          refreshTheory();
          break;
        }
        case 'enemy-die': {
          const mt = (data.moves[ev.moveId] || {}).type;
          const pal = TYPE_COLORS[mt] || TYPE_COLORS.normal;
          fx.hitFx(ev.x, ev.y, styleOf(ev.moveId, mt), mt, ev.kind);
          fx.burst(ev.x, ev.y, 12, pal[0], { spd: 3.4, up: 3, grav: 5, life: 0.55 });
          camCtl.shake(0.25, 0.2);
          kills++;
          dummyUI.respawns++;
          pushLog(`击倒 ${ev.name}（第 ${dummyUI.respawns} 只）`, 'kill');
          respawnAt = run.t + 0.7;
          break;
        }
        case 'zmove': {
          const mt = (data.moves[ev.id] || {}).type;
          fx.zmoveFx(ev.x, ev.y, mt, ev.radius);
          camCtl.shake(0.5, 0.5);
          damageNum(ev.x, ev.y - 0.6, ev.name + '！', 'super');
          pushLog(`Z 招式 ${ev.name}（命中 ${ev.hits} 目标）`, 'super');
          break;
        }
        default: break;
      }
    }
  }

  // ---- UI 装配 ----
  const bossIds = new Set(Object.entries(data.enemies).filter(([, e]) => e.family === 'boss').map(([id]) => id));
  const atkSel = $('atk-species');
  atkSel.innerHTML =
    '<optgroup label="搭档（species 表）">' +
    Object.entries(data.species).filter(([, s]) => !s.evolved).map(([id, s]) => `<option value="s:${id}">${s.name}</option>`).join('') +
    '</optgroup><optgroup label="野生宝可梦（enemies 表）">' +
    Object.entries(data.enemies).filter(([id]) => !bossIds.has(id)).map(([id, e]) => `<option value="e:${id}">${e.name}</option>`).join('') +
    '</optgroup>';
  atkSel.value = 's:pikachu';
  atkSel.addEventListener('change', () => {
    const [src, id] = atkSel.value.split(':');
    setAttacker(id, src === 'e');
  });
  const dummySel = $('dummy-species');
  dummySel.innerHTML = Object.entries(data.enemies)
    .map(([id, e]) => `<option value="${id}">${e.name}（${e.types.map((t) => TYPE_ZH[t]).join('/')}）</option>`).join('');
  dummySel.value = dummyUI.eid;
  function refreshDummyTypes() {
    const spec = data.enemies[dummyUI.eid];
    $('dummy-types').innerHTML = spec.types.map((t) => badge(t)).join('') + `<span style="color:#7d8aa5;font-size:11px">特防修正 ×${spec.spdMod}</span>`;
  }
  refreshDummyTypes();
  dummySel.addEventListener('change', () => {
    dummyUI.eid = dummySel.value;
    refreshDummyTypes();
    setDummySprite();
    makeDummy();
    refreshTheory();
  });
  for (const el of $('dummy-behavior').querySelectorAll('.btn')) {
    el.addEventListener('click', () => {
      for (const o of $('dummy-behavior').querySelectorAll('.btn')) o.classList.toggle('on', o === el);
      dummyUI.behavior = el.dataset.b;
      makeDummy();
    });
  }
  $('dummy-hp').addEventListener('change', () => {
    dummyUI.hpMax = Math.max(5, Math.min(9999, +$('dummy-hp').value || 100));
    $('dummy-hp').value = dummyUI.hpMax;
    makeDummy();
  });
  $('btn-reset').addEventListener('click', () => { makeDummy(); pushLog('靶子已重置', 'normal'); });
  $('btn-pp').addEventListener('click', () => { p.pp = 100 * p.mods.ppCost; });
  $('btn-z').addEventListener('click', () => { zOnce = true; });
  for (const el of $('timescale').querySelectorAll('.btn')) {
    el.addEventListener('click', () => {
      for (const o of $('timescale').querySelectorAll('.btn')) o.classList.toggle('on', o === el);
      timeScale = +el.dataset.s;
    });
  }
  let timeScale = 1, zOnce = false;
  let overPanel = false;
  $('panel').addEventListener('pointerenter', () => { overPanel = true; });
  $('panel').addEventListener('pointerleave', () => { overPanel = false; });

  // ---- 瞄准（鼠标 → 地面）----
  const input = createInput();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  function aimVector() {
    if (window.__lab && window.__lab.forceAim) return window.__lab.forceAim;   // 自动化测试钩子
    raycaster.setFromCamera(input.mouse, camCtl.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const dx = hitPoint.x - p.x, dz = hitPoint.z - p.y;
      if (Math.hypot(dx, dz) > 0.05) return { x: dx, y: dz };
    }
    return { x: p.lastDir.x, y: p.lastDir.y };
  }

  setAttacker('pikachu', false);
  $('loading').classList.add('hidden');

  // ---- 主循环 ----
  let last = performance.now(), acc = 0, fpsN = 0, fpsT = 0, ambT = 0;
  let zPend = false, pumping = false;
  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    if (window.__lab && window.__lab.frozen && !pumping) return;   // 冻结真实循环（自动化脚本用 pump 驱动）
    let dt = forcedDt ?? (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsT) + ' fps · 弹体 ' + run.projectiles.length; fpsN = 0; fpsT = 0; }

    input.poll();
    const live = p.alive && !run.over;
    if (input.consumePress('KeyR') || zOnce) {
      zOnce = false;
      if (p.pp >= 100 * p.mods.ppCost) zPend = true;
      else pushLog('PP 不满，Z 招式未发动（点「PP 充满」）', 'immune');
    }
    const autofire = $('autofire').checked;
    const gameInput = {
      move: input.getMove(),
      aim: aimVector(),
      fire: live && !overPanel && (autofire || input.fire || !!input.touchAim() || !!input.padAim() || input.padFire()),
      dashEdge: false, slotEdge: false, useEdge: false, zEdge: false, swapEdge: false,
    };
    if (input.consumePress('Space')) gameInput.dashEdge = true;

    acc += dt * timeScale;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      if (steps === 0 && zPend) gameInput.zEdge = true;    // Z 边沿只交给第一步（事件不被后续步清掉）
      stepRun(run, gameInput, data);
      acc -= STEP; steps++;
      gameInput.dashEdge = gameInput.zEdge = false;
    }
    if (steps > 0) zPend = false;                          // 有步执行过：边沿消费完毕
    if (steps === 4) acc = 0;
    input.endFrame();
    consumeEvents();
    if (respawnAt > 0 && run.t >= respawnAt) makeDummy();

    // 玩家精灵
    const alpha = acc / STEP;
    const rx = p.px + (p.x - p.px) * alpha, ry = p.py + (p.y - p.py) * alpha;
    if (player) {
      player.setPose(p.anim, p.dir);
      player.update(dt);
      player.place(rx, ry);
    }
    // 靶子精灵 + 血条
    const e = run.enemies[0];
    if (dummyView) {
      if (e) {
        dummyView.setPose(e.flash > 0 ? 'Hurt' : e.anim, e.dir);
        dummyView.update(dt);
        dummyView.place(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
        dummyView.mesh.visible = true;
      } else dummyView.mesh.visible = false;
    }
    if (e) {
      const [sx, sy] = project(e.x, e.y - 0.2);
      dhp.style.display = 'block';
      dhp.style.left = sx + 'px'; dhp.style.top = (sy - 46) + 'px';
      $('dhp-name').textContent = `${e.name}（第 ${dummyUI.respawns + 1} 只）`;
      $('dhp-fill').style.width = Math.max(0, e.hp / e.maxHp * 100) + '%';
      $('dhp-fill').style.background = e.hp / e.maxHp > 0.5 ? '#7dff9b' : e.hp / e.maxHp > 0.25 ? '#ffd24a' : '#ff7d7d';
      $('dhp-txt').textContent = `${Math.max(0, e.hp).toFixed(1)} / ${e.maxHp}`;
    } else dhp.style.display = 'none';

    fx.syncProjectiles(run.projectiles, alpha, dt * timeScale, data);
    fx.update(dt * timeScale);
    roomView.update(dt, ambT += dt);                     // 火把/浮尘氛围
    measuredDps();
    camCtl.update(dt, rx, ry);
    if (postfx) postfx.composer.render(dt);
    else renderer.render(scene, camCtl.camera);
  }
  requestAnimationFrame(frame);

  // 帧泵（内嵌浏览器 rAF 挂起/自动化脚本用；与主游戏 __depths.pump 同一套路）
  window.__lab = {
    run, frozen: false,
    pump: (n = 1, dtMs = 1000 / 60) => {
      pumping = true;
      try {
        let t = performance.now();
        for (let i = 0; i < n; i++) { t += dtMs; frame(t, dtMs / 1000); input.endFrame(); }
      } finally { pumping = false; }
    },
    // 同步渲染一帧并采样（内嵌浏览器失焦时合成器截图拿不到 WebGL 帧——坑⑫）
    snap: (scale = 0.5) => {
      if (postfx) postfx.composer.render(1 / 60);
      else renderer.render(scene, camCtl.camera);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(canvas.width * scale));
      c.height = Math.max(1, Math.round(canvas.height * scale));
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
  };

  window.addEventListener('resize', () => { fitView(); if (postfx) postfx.setSize(...viewportSize()); });
}

boot().catch((e) => {
  const el = $('loading');
  el.textContent = '靶场启动失败：' + (e && e.stack || e);
  el.style.color = '#ff7d7d';
});
